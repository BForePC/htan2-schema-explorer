// turn a folder of htan2 json schemas into the explorer's model:
// schemas (module, data level, counts, if/then rules) and attributes (per-schema state, definition variants).

// display names and order for known modules; unknown modules fall back to a title-cased id
const MODULES = {
  clinical: 'Clinical', biospecimen: 'Biospecimen', wes: 'WES', scrna_seq: 'scRNA-seq', scatac_seq: 'scATAC-seq',
  spatial: 'Spatial Omics', multiplex_microscopy: 'Multiplex Microscopy', mass_spectrometry_imaging: 'Mass Spec Imaging',
  digital_pathology: 'Digital Pathology',
};
// source folder of each module under modules/ in the data model repo
export const MODULE_DIRS = {
  clinical: 'Clinical', biospecimen: 'Biospecimen', wes: 'WES', scrna_seq: 'scRNA-seq', scatac_seq: 'scATAC-seq',
  spatial: 'SpatialOmics', multiplex_microscopy: 'MultiplexMicroscopy', mass_spectrometry_imaging: 'MassSpectrometryImaging',
  digital_pathology: 'DigitalPathology',
};
// modules that hold participant / sample metadata rather than leveled assay data
export const METADATA_MODULES = new Set(['clinical', 'biospecimen']);
// modules whose single schema carries no level in its id; level taken from the module readme
const SINGLE_LEVEL = { digital_pathology: 2 };

export const MODULE_ORDER = Object.keys(MODULES);
export const moduleLabel = m => MODULES[m] || m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// module and levels from the schema $id (ex. https://w3id.org/htan/scrna_seq/level_3_4), with filename fallback
export function placeSchema(id, $id) {
  const path = ($id || '').replace(/^https?:\/\/w3id\.org\/htan\//, '').split('/').filter(Boolean);
  let module = path[0] || 'other', levels = [];
  const glued = module.match(/^(.*)_level(\d+)$/);
  if (glued) { module = glued[1]; levels = [+glued[2]]; }
  const sub = path[1] || '';
  const lv = sub.match(/^level_(\d)(?:_(\d))?$/);
  if (lv) levels = lv[2] ? [+lv[1], +lv[2]] : [+lv[1]];
  if (!levels.length) {
    const f = id.match(/Level(\d)(?:and|_)?(\d)?$/);
    if (f) levels = f[2] ? [+f[1], +f[2]] : [+f[1]];
  }
  if (!levels.length && SINGLE_LEVEL[module]) levels = [SINGLE_LEVEL[module]];
  return { module, levels };
}

// short "what is at this level" text from the schema description
export function shortWhat(desc) {
  let d = (desc || '').trim();
  const dash = d.indexOf(' - ');
  if (dash > -1 && dash < 90) d = d.slice(dash + 3);
  d = d.split(/(?<=\.)\s/)[0].replace(/\.$/, '');
  d = d.replace(/^level \d+(?:\s*(?:and|&)\s*\d+)?\s+/i, '');
  d = d.charAt(0).toLowerCase() + d.slice(1);
  return d.length > 90 ? d.slice(0, 87).replace(/\s+\S*$/, '') + '...' : d;
}

const fmtVal = v => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

function fmtProp(k, spec) {
  if (!spec || !Object.keys(spec).length) return `${k} is provided`;
  if ('const' in spec) return `${k} = ${fmtVal(spec.const)}`;
  if (spec.anyOf) {
    const cs = spec.anyOf;
    if (cs.every(c => 'const' in c)) return cs.length > 1 ? `${k} is one of ${cs.map(c => fmtVal(c.const)).join(', ')}` : `${k} = ${fmtVal(cs[0].const)}`;
    if (cs.every(c => 'pattern' in c)) return `${k} contains ${cs.map(c => fmtVal(c.pattern.replace(/^\.\*|\.\*$/g, ''))).join(' or ')}`;
  }
  if (spec.not && spec.not.anyOf) return `${k} is not ${spec.not.anyOf.map(c => fmtVal(c.const)).join(' / ')}`;
  if ('minimum' in spec || 'maximum' in spec) {
    const lo = spec.minimum, hi = spec.maximum;
    if (lo !== undefined && hi !== undefined) return `${k} is ${lo}-${hi}`;
    return lo !== undefined ? `${k} ≥ ${lo}` : `${k} ≤ ${hi}`;
  }
  if (spec.contains) return fmtProp(k, spec.contains).replace(`${k} `, `${k} includes `).replace('includes = ', 'includes ');
  if (spec.pattern) return `${k} matches ${spec.pattern}`;
  return `${k} ${JSON.stringify(spec)}`;
}

function fmtIf(c) {
  if (c.anyOf) return c.anyOf.map(fmtIf).join(' or ');
  const props = c.properties || {};
  const parts = Object.entries(props).map(([k, v]) => fmtProp(k, v));
  for (const k of c.required || []) if (!(k in props)) parts.push(`${k} is provided`);
  return parts.join(' and ');
}

function trigSlots(c) {
  if (c.anyOf) return [...new Set(c.anyOf.flatMap(trigSlots))];
  return [...new Set([...Object.keys(c.properties || {}), ...(c.required || [])])];
}

function rulesOf(d) {
  const raw = [...(d.allOf || []), ...(d.if ? [{ if: d.if, then: d.then || {} }] : [])].filter(r => r.if);
  return raw.map(r => {
    const th = r.then || {};
    return {
      when: fmtIf(r.if), trigger: trigSlots(r.if).sort(),
      requires: th.required || [], forbids: (th.not && th.not.required) || [],
    };
  });
}

// files: [{path, json}]
export function buildModel(files) {
  const schemas = [], attrs = new Map();
  for (const { path, json: d } of files) {
    if (!d || !d.properties) continue;
    const fname = path.split('/').pop();
    const id = (fname.match(/^HTAN\.(.+?)-v[\d.]+-schema\.json$/) || [, d.title || fname])[1];
    const req = new Set(d.required || []);
    const rules = rulesOf(d);
    const cond = new Set(rules.flatMap(r => r.requires).filter(a => !req.has(a)));
    const props = d.properties;
    const names = Object.keys(props);
    const place = placeSchema(id, d.$id);
    schemas.push({
      id, file: path, $id: d.$id || '', module: place.module, levels: place.levels,
      description: d.description || '', what: shortWhat(d.description),
      n: names.length, nreq: names.filter(a => req.has(a)).length, ncond: names.filter(a => cond.has(a) && !req.has(a)).length, rules,
    });
    for (const [a, spec] of Object.entries(props)) {
      let t = spec.type, en = spec.enum, pat = spec.pattern;
      if (t === 'array') { const it = spec.items || {}; t = `array<${it.type || ''}>`; en = it.enum; pat = it.pattern; }
      if (Array.isArray(t)) t = t.join('|');
      const v = { description: spec.description || '', type: t || '', enum_n: en ? en.length : 0, enum: (en || []).slice(0, 40), pattern: pat || '' };
      const full = JSON.stringify(spec, Object.keys(spec).sort());
      let e = attrs.get(a);
      if (!e) { e = { id: a, in: [], variants: [] }; attrs.set(a, e); }
      e.in.push([id, req.has(a) ? 'R' : cond.has(a) ? 'C' : 'O']);
      const same = e.variants.find(x => x._full === full);
      if (same) same.schemas.push(id); else e.variants.push({ ...v, schemas: [id], _full: full });
    }
  }
  for (const e of attrs.values()) {
    e.variants.forEach(x => delete x._full);
    Object.assign(e, (({ description, type, enum_n, enum: en, pattern }) => ({ description, type, enum_n, enum: en, pattern }))(e.variants[0]));
    const states = new Set(e.in.map(x => x[1]));
    e.status = states.size === 1 ? { R: 'required', C: 'conditional', O: 'optional' }[[...states][0]] : 'varies';
    e.nreq = e.in.filter(x => x[1] === 'R').length;
    e.ncond = e.in.filter(x => x[1] === 'C').length;
    e.nopt = e.in.length - e.nreq - e.ncond;
  }
  schemas.sort((a, b) => a.id.localeCompare(b.id));
  const attributes = [...attrs.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const s of schemas) s.attrs = attributes.filter(a => a.in.some(x => x[0] === s.id)).map(a => [a, a.in.find(x => x[0] === s.id)[1]]);
  const modules = [...new Set(schemas.map(s => s.module))]
    .sort((a, b) => ((MODULE_ORDER.indexOf(a) + 1 || 99) - (MODULE_ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  return { schemas, attributes, modules };
}
