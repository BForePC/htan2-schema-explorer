// blank submission workbook for the loaded schema version.
// browser port of BioTreeBridge preprocessing/htan2/workbook_gen (htan profile: schema sheets only, no data):
// one sheet per module, columns ordered pk / required / conditional / optional, header fill by role,
// enum dropdowns backed by a hidden _EnumValues sheet, comment on conditional headers, Instructions tab.

import { MODULE_DIRS } from './model.js?v=202611161219';

const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const ROLE_ORDER = { pk: 0, required: 1, conditional: 2, optional: 3 };
const ROLE_FILL = { pk: 'FF4ECDC4', required: 'FFFF6B6B', conditional: 'FFC7CEEA', optional: 'FFA8E6CF' };
const ROLE_TEXT = { pk: 'primary key / identifier', required: 'required', conditional: 'required when a condition is met', optional: 'optional' };
const HEADER_FONT = { bold: true, color: { argb: 'FF222222' }, size: 10 };
const DATA_ROWS = 5000; // rows each dropdown covers
const WIDTH = 22;

let lib = null;
const loadLib = () => lib || (lib = new Promise((ok, fail) => {
  const el = document.createElement('script');
  el.src = EXCELJS_URL;
  el.onload = () => ok(window.ExcelJS);
  el.onerror = () => { lib = null; fail(new Error('could not load the spreadsheet library')); };
  document.head.appendChild(el);
}));

// field -> first trigger field, from allOf (and top-level) if/then rules
function triggers(d) {
  const out = {};
  for (const r of [...(d.allOf || []), ...(d.if ? [{ if: d.if, then: d.then }] : [])]) {
    const t = Object.keys((r.if && r.if.properties) || {})[0] || null;
    for (const f of (r.then && r.then.required) || []) if (!(f in out)) out[f] = t;
  }
  return out;
}

export function readModule(d) {
  const req = new Set(d.required || []), cond = triggers(d);
  return Object.entries(d.properties || {}).map(([name, spec]) => {
    const desc = spec.description || '';
    const role = desc.includes('(Primary Key)') ? 'pk' : req.has(name) ? 'required' : name in cond ? 'conditional' : 'optional';
    return { name, role, allowed: spec.enum || null, conditionalOn: cond[name] || null };
  }).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// sheet order as in workbook_gen: grouped by source module folder in SHEET_ORDER, others after (by folder name),
// then by module id (code-point order, like python sorted)
const SHEET_ORDER = ['Clinical', 'Biospecimen', 'DigitalPathology', 'MultiplexMicroscopy', 'SpatialOmics', 'WES', 'scRNA-seq'];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function workbookOrder(schemas) {
  const key = s => { const d = MODULE_DIRS[s.module] || s.module, i = SHEET_ORDER.indexOf(d); return [i < 0 ? SHEET_ORDER.length : i, d, s.id]; };
  return [...schemas].sort((x, y) => { const a = key(x), b = key(y); return a[0] - b[0] || cmp(a[1], b[1]) || cmp(a[2], b[2]); });
}

const colLetter = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

// modules: [{id, json}] already in sheet order; ctx: {repo, ref, sha, version}
export async function buildWorkbook(modules, ctx) {
  const ExcelJS = await loadLib();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HTAN2 Data Model Explorer';
  const model = modules.map(m => ({ id: m.id.slice(0, 31), fields: readModule(m.json) }));

  // instructions first
  const ins = wb.addWorksheet('Instructions');
  ins.getCell('A1').value = `HTAN2 workbook - schema ${ctx.version}`;
  ins.getCell('A1').font = { bold: true, size: 12 };
  ins.getCell('A2').value = `source: ${ctx.repo}@${ctx.ref} (${ctx.sha.slice(0, 7)})`;
  ins.getCell('A3').value = 'one sheet per module; fill one row per record. Dropdown columns accept only permissible values.';
  ins.getCell('A5').value = 'header color legend';
  ins.getCell('A5').font = { bold: true };
  Object.keys(ROLE_FILL).forEach((role, i) => {
    const c = ins.getCell(6 + i, 1);
    c.value = role; c.font = HEADER_FONT;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROLE_FILL[role] } };
    ins.getCell(6 + i, 2).value = ROLE_TEXT[role];
  });
  ins.getCell(11, 1).value = 'conditional headers carry a comment naming the field that triggers them.';
  ins.getColumn(1).width = 16; ins.getColumn(2).width = 52;

  // hidden enum sheet: one column per enum field (dedup by field name across sheets)
  const enums = new Map();
  for (const m of model) for (const f of m.fields) if (f.allowed && !enums.has(f.name)) enums.set(f.name, f.allowed);
  const ev = wb.addWorksheet('_EnumValues', { state: 'hidden' });
  const where = new Map();
  [...enums].forEach(([name, vals], i) => {
    const col = ev.getColumn(i + 1);
    col.values = [name, ...vals.map(String)];
    where.set(name, `'_EnumValues'!$${colLetter(i + 1)}$2:$${colLetter(i + 1)}$${vals.length + 1}`);
  });

  for (const m of model) {
    const ws = wb.addWorksheet(m.id, { views: [{ state: 'frozen', ySplit: 1 }] });
    m.fields.forEach((f, i) => {
      const c = ws.getCell(1, i + 1);
      c.value = f.name; c.font = HEADER_FONT;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROLE_FILL[f.role] } };
      c.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = WIDTH;
      if (f.conditionalOn) c.note = `required when ${f.conditionalOn} is set`;
      if (f.allowed) {
        const L = colLetter(i + 1);
        ws.dataValidations.add(`${L}2:${L}${DATA_ROWS}`, { type: 'list', allowBlank: true, formulae: [where.get(f.name)] });
      }
    });
  }
  return wb.xlsx.writeBuffer();
}

export function download(buf, name) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
