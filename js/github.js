// read-only access to a github repo from the browser.
// primary: github rest api (unauthenticated, 60 requests / hour / ip) + raw.githubusercontent.com.
// fallback: jsdelivr (no rate limit, tags + branches it has cached).

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const JSD_DATA = 'https://data.jsdelivr.com/v1/packages/gh';
const JSD_CDN = 'https://cdn.jsdelivr.net/gh';

function cacheGet(key) {
  try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function cacheSet(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota or disabled storage */ }
}

// commit-pinned files never change: keep them across visits in the cache api (handles multi-MB files)
const FILES = 'htan2-files-v1';
async function getPinned(url) {
  let store = null;
  try { store = await caches.open(FILES); const hit = await store.match(url); if (hit) return await hit.json(); } catch { /* no cache api */ }
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText} for ${url}`), { status: res.status });
  if (store) store.put(url, res.clone()).catch(() => {});
  return res.json();
}

async function getJSON(url, { cache = true } = {}) {
  if (cache) { const hit = cacheGet(url); if (hit) return hit; }
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText} for ${url}`);
    err.status = res.status;
    err.rateLimited = res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0';
    throw err;
  }
  const data = await res.json();
  if (cache) cacheSet(url, data);
  return data;
}

// branches and tags, newest tags first
export async function listRefs(repo) {
  try {
    const [branches, tags] = await Promise.all([
      getJSON(`${API}/repos/${repo}/branches?per_page=100`),
      getJSON(`${API}/repos/${repo}/tags?per_page=100`),
    ]);
    return {
      branches: branches.map(b => b.name).sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b))),
      tags: tags.map(t => t.name).sort(semverDesc),
      source: 'github',
    };
  } catch (e) {
    // jsdelivr lists tags only; branches are still loadable by name
    const d = await getJSON(`${JSD_DATA}/${repo}`);
    return { branches: ['main'], tags: (d.versions || []).map(v => v.version).sort(semverDesc), source: 'jsdelivr', warning: e.message };
  }
}

// resolve a branch / tag / sha to a commit, then list the json schema folders in that commit
const BRANCH_TTL = 5 * 60 * 1000;
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota or disabled */ } }

export async function resolve(repo, ref) {
  const key = `htan2:${repo}@${ref}`, hit = lsGet(key);
  if (hit && (!isBranchLike(ref) || Date.now() - hit.at < BRANCH_TTL)) return hit.c;
  const c = await resolveLive(repo, ref);
  if (c.source === 'github') lsSet(key, { at: Date.now(), c });
  return c;
}

async function resolveLive(repo, ref) {
  try {
    const c = await getJSON(`${API}/repos/${repo}/commits/${encodeURIComponent(ref)}`, { cache: false });
    const tree = await getJSON(`${API}/repos/${repo}/git/trees/${c.sha}?recursive=1`, { cache: false });
    const paths = tree.tree.filter(t => t.type === 'blob' && t.path.startsWith('JSON_Schemas/')).map(t => t.path);
    return {
      sha: c.sha, date: c.commit.committer.date.slice(0, 10), message: c.commit.message.split('\n')[0],
      paths, source: 'github', truncated: !!tree.truncated,
    };
  } catch (e) {
    const d = await getJSON(`${JSD_DATA}/${repo}@${encodeURIComponent(ref)}?structure=flat`, { cache: !isBranchLike(ref) });
    return { sha: ref, date: '', message: '', paths: d.files.map(f => f.name.replace(/^\//, '')), source: 'jsdelivr', warning: e.message };
  }
}

export function schemaVersions(paths) {
  const v = new Set();
  for (const p of paths) { const m = p.match(/^JSON_Schemas\/([^/]+)\/[^/]+\.json$/); if (m) v.add(m[1]); }
  return [...v].sort(semverDesc);
}

export function schemaFiles(paths, version) {
  return paths.filter(p => p.startsWith(`JSON_Schemas/${version}/`) && p.endsWith('.json'));
}

export async function fetchFile(repo, commit, path) {
  const urls = commit.source === 'github'
    ? [`${RAW}/${repo}/${commit.sha}/${path}`, `${JSD_CDN}/${repo}@${commit.sha}/${path}`]
    : [`${JSD_CDN}/${repo}@${commit.sha}/${path}`];
  let last;
  for (const u of urls) {
    try { return commit.source === 'github' ? await getPinned(u) : await getJSON(u, { cache: false }); } catch (e) { last = e; }
  }
  throw last;
}

export const githubUrl = (repo, sha, path = '', kind = 'tree') => `https://github.com/${repo}/${kind}/${sha}/${path}`;

function isBranchLike(ref) { return !/^[0-9a-f]{7,40}$/i.test(ref) && !/^v?\d+\.\d+/.test(ref); }

function semverDesc(a, b) {
  const p = s => (s.replace(/^v/, '').match(/\d+/g) || []).map(Number);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] || 0) - (x[i] || 0);
    if (d) return d;
  }
  return b.localeCompare(a);
}
