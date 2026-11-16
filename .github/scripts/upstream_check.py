"""compare ncihtan/htan2-data-model main against the last recorded state.

records the main commit and the git tree sha of each JSON_Schemas/<version>/ folder in
data/upstream.json. a folder's tree sha changes only when a file inside it changes, so
commits that do not touch the compiled schemas are ignored.

writes github step outputs: changed (true/false), new_versions, changed_versions,
removed_versions (comma separated), sha, short, date, summary.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

UPSTREAM = os.environ.get('UPSTREAM_REPO', 'ncihtan/htan2-data-model')
BRANCH = os.environ.get('UPSTREAM_BRANCH', 'main')
STATE = Path(os.environ.get('STATE_FILE', 'data/upstream.json'))


def api(path):
    req = urllib.request.Request(f'https://api.github.com/{path}',
                                 headers={'Accept': 'application/vnd.github+json'})
    token = os.environ.get('GH_TOKEN')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    commit = api(f'repos/{UPSTREAM}/commits/{BRANCH}')
    sha, date = commit['sha'], commit['commit']['committer']['date']
    listing = api(f'repos/{UPSTREAM}/contents/JSON_Schemas?ref={sha}')
    versions = {e['name']: e['sha'] for e in listing if e['type'] == 'dir'}

    old = json.loads(STATE.read_text()) if STATE.exists() else None
    before = (old or {}).get('versions', {})
    new_v = sorted(set(versions) - set(before))
    removed_v = sorted(set(before) - set(versions))
    changed_v = sorted(v for v in versions if v in before and versions[v] != before[v])
    changed = old is None or bool(new_v or removed_v or changed_v)

    parts = [f'new {", ".join(new_v)}' if new_v else '',
             f'updated {", ".join(changed_v)}' if changed_v else '',
             f'removed {", ".join(removed_v)}' if removed_v else '']
    summary = 'baseline' if old is None else ('; '.join(p for p in parts if p) or 'no schema change')

    if changed:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps({
            'repo': UPSTREAM, 'branch': BRANCH, 'commit': sha, 'commit_date': date,
            'versions': dict(sorted(versions.items())),
        }, indent=2) + '\n')

    out = {
        'changed': str(changed).lower(), 'new_versions': ','.join(new_v),
        # a baseline run reports no "new" versions, so no issue is opened for existing ones
        'changed_versions': ','.join(changed_v), 'removed_versions': ','.join(removed_v),
        'sha': sha, 'short': sha[:7], 'date': date, 'summary': summary,
    }
    if old is None:
        out['new_versions'] = ''
    gh_out = os.environ.get('GITHUB_OUTPUT')
    if gh_out:
        with open(gh_out, 'a') as f:
            for k, v in out.items():
                f.write(f'{k}={v}\n')
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    sys.exit(main())
