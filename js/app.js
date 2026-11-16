import { listRefs, resolve, schemaVersions, schemaFiles, fetchFile, githubUrl } from './github.js';
import { buildModel, moduleLabel, MODULE_DIRS, METADATA_MODULES } from './model.js';
import { KIT_URL, MODALITIES, TIERS, MODULE_EXAMPLES, buildId, exampleId } from './fileid.js';

const DEFAULT_REPO = 'ncihtan/htan2-data-model';
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = { required: css('--req'), optional: css('--opt'), conditional: css('--cond'), varies: css('--var') };
const ST = { required: 'Always required', optional: 'Always optional', conditional: 'Conditionally required', varies: 'Differs by module' };
const SCOL = { R: COL.required, C: COL.conditional, O: COL.optional };
const SNAME = { R: 'required', C: 'conditionally required', O: 'optional' };
const COND_TEXT = '#8f6312';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// current state
let M = null;            // model
let CTX = null;          // {repo, ref, sha, date, version}
let schemaById = new Map(), attrById = new Map();

// ---------------------------------------------------------------- url state
function readQuery() {
  const q = new URLSearchParams(location.search);
  return { repo: q.get('repo') || DEFAULT_REPO, ref: q.get('ref') || 'main', version: q.get('v') || '' };
}
function writeQuery(repo, ref, version) {
  const q = new URLSearchParams();
  if (repo !== DEFAULT_REPO) q.set('repo', repo);
  q.set('ref', ref); q.set('v', version);
  history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
}

// ---------------------------------------------------------------- picker + loading
function status(msg, err = false) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', err); }

async function fillRefs(repo, wanted) {
  status(`Listing branches and tags of ${repo}...`);
  const refs = await listRefs(repo);
  const sel = $('ref');
  sel.innerHTML = `<optgroup label="Branches">${refs.branches.map(b => `<option>${esc(b)}</option>`).join('')}</optgroup>`
    + `<optgroup label="Release tags">${refs.tags.map(t => `<option>${esc(t)}</option>`).join('')}</optgroup>`;
  const known = [...refs.branches, ...refs.tags];
  if (wanted && !known.includes(wanted)) sel.insertAdjacentHTML('afterbegin', `<option>${esc(wanted)}</option>`);
  sel.value = wanted || 'main';
  if (refs.warning) status(`GitHub API unavailable (${refs.warning}); using jsDelivr, tags only.`, true);
}

async function fillVersions(repo, ref, wanted) {
  status(`Reading ${ref}...`);
  const commit = await resolve(repo, ref);
  const versions = schemaVersions(commit.paths);
  const sel = $('ver');
  sel.innerHTML = versions.map(v => `<option>${esc(v)}</option>`).join('');
  if (!versions.length) { status(`No JSON_Schemas/<version>/ folders found at ${ref}.`, true); return null; }
  // a release tag selects its own schema folder when it has one (ex. tag v1.5.0 -> JSON_Schemas/v1.5.0)
  const tagMatch = versions.find(v => v.replace(/^v/, '') === ref.replace(/^v/, ''));
  sel.value = versions.includes(wanted) ? wanted : tagMatch || versions[0];
  return commit;
}

let commitCache = null;
async function load(repo, ref, version, commit) {
  document.body.classList.add('busy');
  $('main').classList.add('loading');
  try {
    commit = commit || commitCache || await resolve(repo, ref);
    const paths = schemaFiles(commit.paths, version);
    status(`Loading ${paths.length} modules from ${ref} / ${version}...`);
    const files = await Promise.all(paths.map(async p => ({ path: p, json: await fetchFile(repo, commit, p) })));
    M = buildModel(files);
    CTX = { repo, ref, sha: commit.sha, date: commit.date, version, source: commit.source };
    schemaById = new Map(M.schemas.map(s => [s.id, s]));
    attrById = new Map(M.attributes.map(a => [a.id, a]));
    writeQuery(repo, ref, version);
    renderAll();
    const short = commit.sha.length > 12 ? commit.sha.slice(0, 7) : commit.sha;
    status(`${M.schemas.length} modules · ${M.attributes.length} attributes · ${repo}@${ref} (${short}${commit.date ? ', ' + commit.date : ''}) · ${version}`
      + (commit.source === 'jsdelivr' ? ' · via jsDelivr' : ''));
  } catch (e) {
    console.error(e);
    status(e.rateLimited ? 'GitHub API rate limit reached (60 requests / hour without sign-in). Try again later.' : `Could not load: ${e.message}`, true);
  } finally {
    $('main').classList.remove('loading');
    document.body.classList.remove('busy');
  }
}

async function start() {
  const q = readQuery();
  $('repo').value = q.repo;
  try {
    const [, commit] = await Promise.all([fillRefs(q.repo, q.ref), fillVersions(q.repo, q.ref, q.version)]);
    commitCache = commit;
    if (commitCache) await load(q.repo, q.ref, $('ver').value, commitCache);
  } catch (e) { console.error(e); status(`Could not reach ${q.repo}: ${e.message}`, true); }
}

$('repo').addEventListener('change', async () => {
  const repo = $('repo').value.trim();
  try { await fillRefs(repo, 'main'); commitCache = await fillVersions(repo, 'main', ''); if (commitCache) load(repo, 'main', $('ver').value, commitCache); }
  catch (e) { status(`Could not reach ${repo}: ${e.message}`, true); }
});
$('ref').addEventListener('change', async () => {
  const repo = $('repo').value.trim(), ref = $('ref').value;
  try { commitCache = await fillVersions(repo, ref, ''); if (commitCache) load(repo, ref, $('ver').value, commitCache); }
  catch (e) { status(`Could not read ${ref}: ${e.message}`, true); }
});
$('ver').addEventListener('change', () => load($('repo').value.trim(), $('ref').value, $('ver').value, commitCache));
$('sha').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const repo = $('repo').value.trim(), ref = $('sha').value.trim();
  if (!ref) return;
  const sel = $('ref');
  if (![...sel.options].some(o => o.value === ref)) sel.insertAdjacentHTML('afterbegin', `<option>${esc(ref)}</option>`);
  sel.value = ref;
  sel.dispatchEvent(new Event('change'));
});

// ---------------------------------------------------------------- shared helpers
const jsonUrl = s => githubUrl(CTX.repo, CTX.sha, s.file, 'blob');
const modUrl = m => githubUrl(CTX.repo, CTX.sha, MODULE_DIRS[m] ? `modules/${MODULE_DIRS[m]}` : 'modules');
const stSummary = a => [a.nreq && `required in ${a.nreq}`, a.ncond && `conditional in ${a.ncond}`, a.nopt && `optional in ${a.nopt}`].filter(Boolean).join(' · ');
const rulesFor = (sid, aid) => (schemaById.get(sid).rules || []).filter(r => r.requires.includes(aid));

const tip = $('tip');
function showTip(html, e) { tip.innerHTML = html; tip.style.display = 'block'; moveTip(e); }
function moveTip(e) {
  const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { tip.style.display = 'none'; };

// ---------------------------------------------------------------- drawer
const drawer = $('drawer'), dbody = $('dbody');
$('close').onclick = () => drawer.classList.remove('open');
document.addEventListener('keydown', e => { if (e.key === 'Escape') drawer.classList.remove('open'); });
dbody.addEventListener('click', e => {
  const a = e.target.closest('[data-a]'), s = e.target.closest('[data-s]');
  if (a) openAttr(a.dataset.a); else if (s) openSchema(s.dataset.s);
});

function openSchema(id) {
  const s = schemaById.get(id); if (!s) return;
  const by = st => s.attrs.filter(x => x[1] === st);
  const li = (a, st) => `<li data-a="${esc(a.id)}"><span class="dot" style="background:${SCOL[st]}"></span><code>${esc(a.id)}</code>${a.in.length > 1 ? `<span class="s">in ${a.in.length} modules</span>` : ''}</li>`;
  const cli = a => `<li data-a="${esc(a.id)}" style="flex-wrap:wrap"><span class="dot" style="background:${COL.conditional}"></span><code>${esc(a.id)}</code><span class="whenline">when ${rulesFor(s.id, a.id).map(r => esc(r.when)).join('; or when ')}</span></li>`;
  dbody.innerHTML = `<h2>${s.id}</h2><span class="badge">${moduleLabel(s.module)}${s.levels.length ? ' · Level ' + s.levels.join(' & ') : ''}</span>
    <a class="badge lnk" href="${jsonUrl(s)}" target="_blank" rel="noopener">JSON schema ↗</a> <a class="badge lnk" href="${modUrl(s.module)}" target="_blank" rel="noopener">category source ↗</a>
    <div class="kv">${esc(s.description)}</div>
    <div class="kv"><b>Required (${by('R').length})</b><ul class="lst">${by('R').map(x => li(x[0], 'R')).join('')}</ul></div>
    ${by('C').length ? `<div class="kv"><b>Conditionally required (${by('C').length})</b><ul class="lst">${by('C').map(x => cli(x[0])).join('')}</ul></div>` : ''}
    <div class="kv"><b>Optional (${by('O').length})</b><ul class="lst">${by('O').map(x => li(x[0], 'O')).join('')}</ul></div>`;
  drawer.classList.add('open'); drawer.scrollTop = 0;
}

function openAttr(id) {
  const a = attrById.get(id); if (!a) return;
  const triggers = M.schemas.flatMap(s => s.rules.filter(r => r.trigger.includes(a.id)).map(r => [s.id, r]));
  dbody.innerHTML = `<h2>${esc(a.id)}</h2><span class="badge"><span class="dot" style="background:${COL[a.status]}"></span>${ST[a.status]}</span>
    <div class="kv"><b>Used in ${a.in.length} schema${a.in.length > 1 ? 's' : ''}</b><ul class="lst">${a.in.map(([s, r]) => `<li data-s="${s}" style="flex-wrap:wrap"><span class="dot" style="background:${SCOL[r]}"></span>${s}<span class="s">${SNAME[r]}</span>${r === 'C' ? `<span class="whenline">when ${rulesFor(s, a.id).map(x => esc(x.when)).join('; or when ')}</span>` : ''}</li>`).join('')}</ul></div>
    ${triggers.length ? `<div class="kv"><b>Triggers rules</b>${triggers.map(([sid, r]) => `<div style="margin-top:3px">${sid}: when ${esc(r.when)} → ${r.requires.length ? 'requires ' + r.requires.map(esc).join(', ') : 'must leave empty ' + r.forbids.map(esc).join(', ')}</div>`).join('')}</div>` : ''}
    ${a.variants.length > 1 ? `<div class="kv" style="color:var(--text-primary)">Definition differs across modules (${a.variants.length} variants)</div>` : ''}
    ${a.variants.map(v => `${a.variants.length > 1 ? `<div class="kv" style="border-top:1px solid var(--border);padding-top:8px"><b>In</b>${v.schemas.join(', ')}</div>` : ''}
      <div class="kv"><b>Description</b>${esc(v.description) || '-'}</div>
      <div class="kv"><b>Type</b><code>${esc(v.type) || '-'}</code></div>
      ${v.pattern ? `<div class="kv"><b>Pattern</b><code>${esc(v.pattern)}</code></div>` : ''}
      ${v.enum_n ? `<div class="kv"><b>Permissible values (${v.enum_n})</b><div class="enum">${v.enum.map(x => `<code>${esc(x)}</code>`).join('')}${v.enum_n > v.enum.length ? `<span class="badge">+${v.enum_n - v.enum.length} more</span>` : ''}</div></div>` : ''}`).join('')}`;
  drawer.classList.add('open'); drawer.scrollTop = 0;
}

// ---------------------------------------------------------------- header links + level grid
function renderHeader() {
  const short = CTX.sha.length > 12 ? CTX.sha.slice(0, 7) : CTX.sha;
  $('sub').innerHTML = `HTAN Phase 2 data model ${esc(CTX.version)} (${esc(CTX.ref)} @ <code>${esc(short)}</code>${CTX.date ? ', ' + CTX.date : ''}). What each module asks a submitter to fill in, by data level.`;
  $('links').innerHTML = `
    <a href="${githubUrl(CTX.repo, CTX.sha, 'modules')}" target="_blank" rel="noopener">HTAN Phase 2 modules (${esc(CTX.ref)} source)</a>
    <a href="https://htan2-data-model.readthedocs.io/en/main/" target="_blank" rel="noopener">Data model documentation (main)</a>
    <a href="${KIT_URL}" target="_blank" rel="noopener">fileid-kit</a>
    <a href="https://docs.humantumoratlas.org/data_submission/checklist/" target="_blank" rel="noopener">HTAN acceptance checklist</a>
    <a href="https://docs.humantumoratlas.org/addtnl_info/rfc/" target="_blank" rel="noopener">HTAN RFC process</a>`;
}

function cellHtml(s) {
  const o = s.n - s.nreq - s.ncond;
  return `<div class="cell" data-s="${s.id}" title="${esc(s.description)}"><div class="nm"><a href="${jsonUrl(s)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${s.id}</a></div>
    <div class="what">${esc(s.what)}</div>
    <div class="mini"><span style="flex:${s.nreq};background:${COL.required}"></span><span style="flex:${s.ncond};background:${COL.conditional}"></span><span style="flex:${o};background:${COL.optional}"></span></div>
    <div class="cnt">${s.nreq} · ${s.ncond} · ${o}${s.rules.length ? ` &nbsp;(${s.rules.length} rule${s.rules.length > 1 ? 's' : ''})` : ''}</div></div>`;
}

function renderLevels() {
  const maxL = Math.max(4, ...M.schemas.flatMap(s => s.levels));
  const assay = M.modules.filter(m => !METADATA_MODULES.has(m) && M.schemas.some(s => s.module === m && s.levels.length));
  const meta = M.modules.filter(m => !assay.includes(m));
  let h = `<thead><tr><th>Category</th>${Array.from({ length: maxL }, (_, i) => `<th>Level ${i + 1}</th>`).join('')}<th>Companion record</th></tr></thead><tbody>`;
  if (meta.length) {
    const ms = M.schemas.filter(s => meta.includes(s.module));
    h += `<tr><td class="m">${meta.map(m => `<a href="${modUrl(m)}" target="_blank" rel="noopener">${moduleLabel(m)}</a>`).join(' &amp; ')}</td>
      <td colspan="${maxL + 1}"><div class="what" style="margin-top:0">no data level - participant and sample metadata; click a name for its attributes</div>
      <div class="chips">${ms.map(s => `<a href="#" data-s="${s.id}">${s.id}</a>`).join('')}</div></td></tr>`;
  }
  for (const m of assay) {
    const ss = M.schemas.filter(s => s.module === m);
    h += `<tr><td class="m"><a href="${modUrl(m)}" target="_blank" rel="noopener">${moduleLabel(m)}</a></td>`;
    for (let L = 1; L <= maxL; L++) {
      if (ss.some(s => s.levels.length > 1 && s.levels.includes(L) && s.levels[0] !== L)) continue;
      const here = ss.filter(s => s.levels[0] === L);
      h += here.length ? `<td${here[0].levels.length > 1 ? ` colspan="${here[0].levels.length}"` : ''}>${here.map(cellHtml).join('')}</td>` : '<td class="na">-</td>';
    }
    const comp = ss.filter(s => !s.levels.length);
    h += `<td>${comp.length ? comp.map(cellHtml).join('') : '<span class="na">-</span>'}</td></tr>`;
  }
  $('levels').innerHTML = h + '</tbody>';
}
$('levels').addEventListener('click', e => { const c = e.target.closest('[data-s]'); if (c) { e.preventDefault(); openSchema(c.dataset.s); } });

// ---------------------------------------------------------------- by-schema bars
function renderBars() {
  const el = $('bars'); el.innerHTML = '';
  const W = el.clientWidth || 1100, labelW = Math.min(260, W * 0.32), countW = 130;
  const rows = [];
  for (const m of M.modules) {
    const ss = M.schemas.filter(s => s.module === m);
    if (ss.length) { rows.push({ mod: moduleLabel(m) }); ss.forEach(s => rows.push({ s })); }
  }
  const RH = 24, MH = 30, H = d3.sum(rows, r => (r.mod ? MH : RH)) + 30;
  const x = d3.scaleLinear().domain([0, d3.max(M.schemas, s => s.n)]).nice().range([labelW, W - countW]);
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img')
    .attr('aria-label', 'Required, conditional and optional attribute counts per module');
  svg.append('g').attr('class', 'axis').attr('transform', 'translate(0,20)').call(d3.axisTop(x).ticks(6).tickSize(-(H - 28)))
    .call(g => g.select('.domain').remove()).call(g => g.selectAll('text').attr('font-size', 13)).call(g => g.selectAll('line').attr('stroke', 'var(--grid)'));
  svg.append('text').attr('x', W - countW + 8).attr('y', 14).attr('class', 'modlbl').text('req + cond / total');
  let y = 26;
  for (const r of rows) {
    if (r.mod) { svg.append('text').attr('class', 'modlbl').attr('x', 0).attr('y', y + MH - 9).text(r.mod); y += MH; continue; }
    const s = r.s, g = svg.append('g').attr('class', 'row').attr('transform', `translate(0,${y})`);
    g.append('rect').attr('class', 'bg').attr('width', W).attr('height', RH).attr('fill', 'transparent').attr('rx', 4);
    g.append('text').attr('x', 10).attr('y', RH / 2).attr('dy', '.35em').attr('font-size', 13).text(s.id);
    const bh = 14, by = (RH - bh) / 2; let acc = 0;
    [[s.nreq, COL.required], [s.ncond, COL.conditional], [s.n - s.nreq - s.ncond, COL.optional]].forEach(([v, c]) => {
      if (!v) return; const a0 = x(acc), a1 = x(acc + v); acc += v;
      const gap = a0 > x(0) ? 1 : 0;
      g.append('rect').attr('x', a0 + gap).attr('y', by).attr('height', bh).attr('width', Math.max(1, a1 - a0 - gap - 1)).attr('fill', c).attr('rx', 2);
    });
    g.append('text').attr('x', W - countW + 8).attr('y', RH / 2).attr('dy', '.35em').attr('font-size', 13)
      .html(`<tspan font-weight="600">${s.nreq}</tspan>${s.ncond ? `<tspan fill="var(--text-muted)"> + </tspan><tspan font-weight="600" fill="${COND_TEXT}">${s.ncond}</tspan>` : ''}<tspan fill="var(--text-muted)"> / ${s.n}</tspan>`);
    g.on('mousemove', e => showTip(`<b>${s.id}</b><div class="m">${s.nreq} required · ${s.ncond} conditional · ${s.n - s.nreq - s.ncond} optional</div><div class="m">${esc(s.description)}</div>`, e))
      .on('mouseleave', hideTip).on('click', () => { hideTip(); openSchema(s.id); });
    y += RH;
  }
}

// ---------------------------------------------------------------- conditional rules table
function renderRules() {
  const msel = $('rmod'), keep = msel.value;
  msel.innerHTML = '<option value="">All categories</option>' + M.modules.filter(m => M.schemas.some(s => s.module === m && s.rules.length))
    .map(m => `<option value="${m}">${moduleLabel(m)}</option>`).join('');
  msel.value = [...msel.options].some(o => o.value === keep) ? keep : '';
  drawRules();
}
function drawRules() {
  const m = $('rmod').value, q = $('rq').value.trim().toLowerCase();
  const chip = (a, c) => `<span class="chip" data-a="${esc(a)}"><span class="dot" style="background:${c}"></span><code>${esc(a)}</code></span>`;
  let n = 0, h = '<table class="rt"><thead><tr><th style="width:42%">When</th><th>Then required</th></tr></thead><tbody>';
  for (const mod of M.modules) for (const s of M.schemas.filter(x => x.module === mod && (!m || mod === m) && x.rules.length)) {
    const rs = s.rules.filter(r => !q || `${r.when} ${r.requires.join(' ')} ${r.forbids.join(' ')}`.toLowerCase().includes(q));
    if (!rs.length) continue;
    n += rs.length;
    h += `<tr class="grp"><td colspan="2"><span style="cursor:pointer" data-s="${s.id}">${s.id}</span> <span style="font-weight:400;color:var(--text-muted)">· ${moduleLabel(mod)} · ${rs.length} rule${rs.length > 1 ? 's' : ''}</span></td></tr>`;
    for (const r of rs) h += `<tr><td class="w">${esc(r.when)}</td><td>${r.requires.map(a => chip(a, COL.conditional)).join('')}${r.forbids.length ? `<span style="color:var(--text-muted)">must be left empty: </span>${r.forbids.map(a => chip(a, '#cbbfb0')).join('')}` : ''}</td></tr>`;
  }
  $('rules').innerHTML = n ? h + '</tbody></table>' : '<div class="note">No if/then rules in this version.</div>';
  $('rcount').textContent = `${n} rules`;
}
$('rmod').onchange = drawRules;
$('rq').oninput = drawRules;
$('rules').addEventListener('click', e => { const a = e.target.closest('[data-a]'), s = e.target.closest('[data-s]'); if (a) openAttr(a.dataset.a); else if (s) openSchema(s.dataset.s); });

// ---------------------------------------------------------------- attribute x schema matrix
function drawMatrix() {
  const mode = $('mfilter').value, q = $('mq').value.trim().toLowerCase();
  const cols = M.modules.flatMap(m => M.schemas.filter(s => s.module === m));
  let rows = M.attributes.filter(a => (mode === 'varies' ? a.status === 'varies' : mode === 'cond' ? a.ncond > 0 : a.in.length >= +mode));
  if (q) rows = rows.filter(a => a.id.toLowerCase().includes(q));
  rows.sort((a, b) => d3.descending(a.in.length, b.in.length) || d3.descending(a.nreq, b.nreq) || d3.ascending(a.id, b.id));
  $('mcount').textContent = `${rows.length} attributes`;
  const C = 18, labelW = 340, headH = 230, W = labelW + cols.length * C + 60, H = headH + rows.length * C + 10;
  const el = $('matrix'); el.innerHTML = '';
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H);
  let col = 0;
  M.modules.forEach((m, i) => {
    const n = cols.filter(s => s.module === m).length; if (!n) return;
    if (i % 2 === 0) svg.append('rect').attr('x', labelW + col * C).attr('y', headH - 4).attr('width', n * C).attr('height', H - headH + 4).attr('fill', '#fbf7f1');
    col += n;
  });
  cols.forEach((s, i) => {
    svg.append('text').attr('transform', `translate(${labelW + i * C + C / 2 + 4},${headH - 8}) rotate(-60)`).attr('font-size', 13)
      .attr('fill', 'var(--text-secondary)').style('cursor', 'pointer').text(s.id).on('click', () => openSchema(s.id))
      .on('mousemove', e => showTip(`<b>${s.id}</b><div class="m">${moduleLabel(s.module)}</div>`, e)).on('mouseleave', hideTip);
  });
  rows.forEach((a, r) => {
    const y = headH + r * C, g = svg.append('g').style('cursor', 'pointer');
    g.append('rect').attr('y', y).attr('width', W).attr('height', C).attr('fill', 'transparent').attr('class', 'rowbg');
    if (a.status === 'varies') g.append('circle').attr('cx', 6).attr('cy', y + C / 2).attr('r', 4).attr('fill', COL.varies);
    g.append('text').attr('x', 16).attr('y', y + C / 2).attr('dy', '.35em').attr('font-size', 13).attr('font-family', 'ui-monospace,Menlo,monospace').text(a.id);
    g.append('text').attr('x', labelW - 8).attr('y', y + C / 2).attr('dy', '.35em').attr('font-size', 13).attr('text-anchor', 'end').attr('fill', 'var(--text-muted)').text(a.in.length);
    const used = new Map(a.in);
    cols.forEach((s, i) => {
      const u = used.get(s.id);
      g.append('rect').attr('x', labelW + i * C + 1).attr('y', y + 1).attr('width', C - 2).attr('height', C - 2).attr('rx', 2)
        .attr('fill', u === undefined ? 'var(--empty)' : SCOL[u])
        .on('mousemove', e => showTip(`<b>${a.id}</b><div class="m">${s.id}: ${u === undefined ? 'not used' : SNAME[u]}${u === 'C' ? ' when ' + esc(rulesFor(s.id, a.id).map(x => x.when).join('; or ')) : ''}</div><div class="m">${stSummary(a)}</div>`, e))
        .on('mouseleave', hideTip);
    });
    g.on('click', () => { hideTip(); openAttr(a.id); })
      .on('mouseenter', function () { d3.select(this).select('.rowbg').attr('fill', 'var(--surface-2)'); })
      .on('mouseleave', function () { d3.select(this).select('.rowbg').attr('fill', 'transparent'); });
  });
  svg.append('text').attr('x', labelW - 8).attr('y', headH - 8).attr('text-anchor', 'end').attr('font-size', 13).attr('fill', 'var(--text-muted)').text('# modules');
}
$('mfilter').onchange = drawMatrix;
$('mq').oninput = drawMatrix;

// ---------------------------------------------------------------- 3d force graph
let G = null, labelEls = [], hov = null;
function graphData() {
  const nodes = [{ id: '__root', kind: 'root', label: 'HTAN2' }];
  M.modules.forEach(m => nodes.push({ id: 'M:' + m, kind: 'module', label: moduleLabel(m) }));
  M.schemas.forEach(s => nodes.push({ id: 'S:' + s.id, kind: 'schema', label: s.id, s }));
  M.attributes.forEach(a => nodes.push({ id: 'A:' + a.id, kind: 'attr', label: a.id, a }));
  const links = [];
  M.modules.forEach(m => links.push({ source: '__root', target: 'M:' + m, kind: 'hub' }));
  M.schemas.forEach(s => links.push({ source: 'M:' + s.module, target: 'S:' + s.id, kind: 'hub' }));
  M.attributes.forEach(a => a.in.forEach(([s, r]) => links.push({ source: 'S:' + s, target: 'A:' + a.id, kind: { R: 'required', C: 'conditional', O: 'optional' }[r] })));
  return { nodes, links };
}
let lib3d = null;
const load3D = () => lib3d || (lib3d = new Promise((ok, fail) => {
  const el = document.createElement('script');
  el.src = 'https://cdn.jsdelivr.net/npm/3d-force-graph@1.79.1/dist/3d-force-graph.min.js';
  el.onload = ok; el.onerror = () => { lib3d = null; fail(new Error('could not load 3D library')); };
  document.head.appendChild(el);
}));
async function render3D() {
  const box = $('g3');
  if (!window.ForceGraph3D) {
    const prev = $('status').textContent;
    status('Loading 3D view...');
    try { await load3D(); } catch (e) { status(e.message, true); return; }
    status(prev);
  }
  if (tab !== 'three') return;
  const data = graphData();
  if (!G) {
    const size = n => (n.kind === 'root' ? 14 : n.kind === 'module' ? 9 : n.kind === 'schema' ? 2 + Math.sqrt(n.s.n) * 0.9
      : (n.a.status === 'optional' ? 1.1 : 1.8) * (1 + Math.min(n.a.in.length - 1, 20) * 0.06));
    G = ForceGraph3D({ controlType: 'orbit' })($('gc'))
      .width(box.clientWidth).height(box.clientHeight).backgroundColor('#fffdf9').showNavInfo(false)
      .nodeRelSize(2).nodeVal(n => Math.pow(size(n), 3) / 8).nodeResolution(12).nodeOpacity(1)
      .nodeColor(n => (n.kind === 'attr' ? COL[n.a.status] : n.kind === 'schema' ? '#d6cbbd' : n.kind === 'module' ? '#b8ab9c' : '#8c8076'))
      .nodeLabel(() => '')
      .linkColor(l => (l.kind === 'hub' ? '#d6cbbd' : COL[l.kind])).linkOpacity(0.45)
      .onNodeHover(n => { box.style.cursor = n ? 'pointer' : null; hov = n; if (!n) hideTip(); })
      .onNodeClick(n => { if (n.kind === 'attr') openAttr(n.a.id); else if (n.kind === 'schema') openSchema(n.s.id); });
    G.d3Force('link').distance(l => (l.kind === 'hub' ? ((l.source.id || l.source) === '__root' ? 120 : 70) : 38)).strength(l => (l.kind === 'hub' ? 0.9 : 0.25));
    G.d3Force('charge').strength(n => (n.kind === 'attr' ? -18 : n.kind === 'schema' ? -160 : -400));
    box.addEventListener('pointermove', e => {
      const n = hov; if (!n || box.style.cursor !== 'pointer') return;
      if (n.kind === 'attr') showTip(`<b>${n.a.id}</b><div class="m">${ST[n.a.status]}: ${stSummary(n.a)}</div>`, e);
      else if (n.kind === 'schema') showTip(`<b>${n.s.id}</b><div class="m">${n.s.nreq} required · ${n.s.ncond} conditional · ${n.s.n - n.s.nreq - n.s.ncond} optional</div>`, e);
      else showTip(`<b>${n.label}</b>`, e);
    });
    box.addEventListener('pointerleave', hideTip);
    addEventListener('resize', () => G.width(box.clientWidth).height(box.clientHeight));
    const tick = () => {
      const cam = G.camera(), m = cam.matrixWorld.elements, cp = cam.position;
      for (const { n, el } of labelEls) {
        if (n.x === undefined) { el.style.display = 'none'; continue; }
        const depth = (n.x - cp.x) * -m[8] + (n.y - cp.y) * -m[9] + (n.z - cp.z) * -m[10];
        if (depth <= 0) { el.style.display = 'none'; continue; }
        const p = G.graph2ScreenCoords(n.x, n.y, n.z);
        el.style.display = 'block'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
        el.style.opacity = Math.max(0, Math.min(1, 1.4 - depth / (n.kind === 'schema' ? 900 : 2200)));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  G.graphData(data);
  const layer = $('labels'); layer.innerHTML = '';
  labelEls = data.nodes.filter(n => n.kind !== 'attr').map(n => {
    const el = document.createElement('div');
    el.className = 'lbl ' + (n.kind === 'root' ? 'root' : n.kind === 'module' ? 'mod' : 'sch');
    el.textContent = n.label; layer.appendChild(el); return { n, el };
  });
  setTimeout(() => G.zoomToFit(1000, 30), 2500);
}

// ---------------------------------------------------------------- tabs + render
let tab = 'bars';
function showTab(v) {
  tab = v;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.v === v));
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  if (!M) return;
  if (v === 'matrix') drawMatrix();
  if (v === 'rules') renderRules();
  if (v === 'three') render3D();
  if (v === 'fileid') renderFileIdModules();
}
document.querySelectorAll('.tab').forEach(t => (t.onclick = () => showTab(t.dataset.v)));
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => M && renderBars(), 150); });

// ---------------------------------------------------------------- file identifiers
const SEG = {
  participant: ['participant', '#6b4f8a'], pool: ['pool', '#8a7a4f'], marker: ['file marker', '#a69a8e'],
  specimen: ['specimen index', '#2e7d6e'], modality: ['assay', '#a0446b'], tier: ['data type', '#3f6fa6'], seq: ['file number', '#b0782a'],
};
const modName = c => (MODALITIES.find(m => m[0] === c) || [, c])[1];
const tierName = c => (TIERS.find(t => t[0] === c) || [, c])[1];
function segHtml(segs, copy) {
  const sub = { modality: v => modName(v), tier: v => tierName(v) };
  return segs.map(([k, v]) => `<span class="seg" style="--sc:${SEG[k][1]}">${esc(v)}<small>${SEG[k][0]}${sub[k] ? ': ' + esc(sub[k](v)) : ''}</small></span>`).join('')
    + (copy ? `<button class="copy" data-copy="${esc(copy)}">copy</button>` : '');
}
function drawBuilder() {
  const r = buildId({ participant: $('fParticipant').value, pool: $('fPool').value, specimen: $('fSpecimen').value,
    modality: $('fModality').value, tier: $('fTier').value, seq: $('fSeq').value });
  $('idout').innerHTML = segHtml(r.segs, r.errors.length ? '' : r.id);
  $('iderr').textContent = r.errors.join(' · ');
}
function initFileId() {
  $('idex').innerHTML = segHtml(buildId({ participant: 'HTA201_4', specimen: 3, modality: '19', tier: '07', seq: 1 }).segs);
  $('fModality').innerHTML = MODALITIES.map(([c, n]) => `<option value="${c}">${c} ${esc(n)}</option>`).join('');
  $('fTier').innerHTML = TIERS.map(([c, n]) => `<option value="${c}">${c} ${esc(n)}</option>`).join('');
  $('fModality').value = '19';
  ['fParticipant', 'fPool', 'fSpecimen', 'fModality', 'fTier', 'fSeq'].forEach(id => $(id).addEventListener('input', drawBuilder));
  $('idtiers').innerHTML = `<table class="rt"><thead><tr><th>Code</th><th>Data type</th><th>Typical files</th></tr></thead><tbody>${
    TIERS.map(([c, n, f]) => `<tr><td><code>${c}</code></td><td>${esc(n)}</td><td class="w">${esc(f)}</td></tr>`).join('')}</tbody></table>`;
  document.getElementById('v-fileid').addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = 'copied'; setTimeout(() => (b.textContent = 'copy'), 1200); }, () => {});
  });
  drawBuilder();
}
function renderFileIdModules() {
  const mods = M.modules.filter(m => MODULE_EXAMPLES[m]);
  let h = '<table class="rt"><thead><tr><th>Level</th><th>File</th><th>Identifier</th><th>Format</th></tr></thead><tbody>';
  for (const m of mods) {
    const ex = MODULE_EXAMPLES[m];
    h += `<tr class="grp"><td colspan="4">${moduleLabel(m)} <span style="font-weight:400;color:var(--text-muted)">· ${
      ex.code ? `assay code ${ex.code} (${esc(modName(ex.code))})` : ''}${ex.note ? (ex.code ? ' · ' : '') + esc(ex.note) : ''}</span></td></tr>`;
    for (const [lv, file, tier, seq, fmt] of ex.rows || []) {
      h += `<tr><td>${lv}</td><td>${esc(file)}</td><td class="id"><code>${exampleId('HTA201_4', 3, ex.code, tier, seq)}</code></td><td class="w">${esc(fmt)}</td></tr>`;
    }
  }
  $('idmods').innerHTML = h + '</tbody></table>';
}
initFileId();

function renderAll() {
  drawer.classList.remove('open');
  renderHeader(); renderLevels(); renderBars();
  showTab(tab);
}

start();
