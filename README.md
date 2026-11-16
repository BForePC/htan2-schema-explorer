# HTAN2 Schema Explorer

Interactive view of the [HTAN Phase 2 data model](https://github.com/ncihtan/htan2-data-model): which attributes each module requires, requires only under a condition (if/then rules), or leaves optional, organized by category and data level.

Terms: a **module** is one JSON schema (ex. `BulkWESLevel1`, `Demographics`); a **category** groups modules (ex. WES, scRNA-seq, Clinical).

The page reads the compiled JSON schemas (`JSON_Schemas/<version>/`) straight from GitHub in the browser, so any branch, release tag or commit of the data model repo, or a fork of it, can be explored without rebuilding the site.

## Views

| View | What it shows |
|---|---|
| Data level grid | categories x Level 1-4 (+ companion records), each module with a short description, counts and a required / conditional / optional bar |
| By module | one stacked bar per module, grouped by category |
| Conditional rules | every if/then rule: "when X" -> "then required: Y" |
| Shared attributes | attribute x module matrix for attributes reused across modules |
| File identifiers | [fileid-kit](https://github.com/BForePC/fileid-kit) naming convention: structure, builder, example ids per category, data type codes |
| 3D explore | force-directed graph: HTAN2 -> categories -> modules -> attributes |

## Blank workbook

**Download blank workbook (.xlsx)** builds an empty submission workbook for the loaded version, in the browser. It ports the `htan` profile of BioTreeBridge `preprocessing/htan2/workbook_gen` (no BForePC extensions, no carried sheets, no data):

- one sheet per module, in workbook_gen sheet order (Clinical, Biospecimen, DigitalPathology, MultiplexMicroscopy, SpatialOmics, WES, scRNA-seq, then others)
- columns: primary key, required, conditional, optional; alphabetical within each
- header fill by role: teal primary key, red required, lavender conditional, mint optional; comment on conditional headers naming the trigger
- enum dropdowns (rows 2-5000) backed by a hidden `_EnumValues` sheet; Instructions tab with legend and source commit
- conditional fields include rules written as a top-level `if/then` (single-rule schemas), not only `allOf`

Library: [ExcelJS](https://github.com/exceljs/exceljs) 4.4.0, loaded on first click.

Clicking a module or attribute opens a panel with its attributes, rules, permissible values and links to the source files.

## Choosing a version

The picker at the top selects:

- **Repository** - `owner/name`, default `ncihtan/htan2-data-model`
- **Branch or release tag** - listed from the repo
- **Commit SHA** - paste and press Enter
- **Data model version** - the `JSON_Schemas/<version>/` folders present in that commit

The selection is kept in the URL, so a view can be shared or bookmarked:

```
https://<user>.github.io/htan2-schema-explorer/?ref=main&v=v2.0.0
https://<user>.github.io/htan2-schema-explorer/?ref=8ce211c&v=v2.0.0
https://<user>.github.io/htan2-schema-explorer/?repo=<fork-owner>/htan2-data-model&ref=my-branch&v=v2.0.0
```

Note: in `ncihtan/htan2-data-model` the JSON for a release is committed after the release tag, so a tag such as `v1.0.0` contains only older schema folders. To see a released version, use `main` and pick the schema version folder.

## How module and level are derived

- module and level come from each schema's `$id` (ex. `https://w3id.org/htan/scrna_seq/level_3_4` -> scRNA-seq, Levels 3-4), with the file name as fallback
- schemas in an assay module without a level (ex. `SpatialPanel`, `ChannelMetadata`) go in the companion column
- Digital Pathology has a single schema with no level in its id; its module README defines it as Level 2 (`SINGLE_LEVEL` in `js/model.js`)
- unknown future modules are shown with a title-cased name; add a display name in `MODULES` in `js/model.js`
- "conditional" = listed in a `then.required` of an `if/then` rule (top-level or inside `allOf`) and not in the schema's `required` array

## Data access and limits

- GitHub REST API without sign-in: 60 requests per hour per IP. One version load uses about 4 API calls; schema files come from `raw.githubusercontent.com`, which is not counted. Responses are cached for the browser session.
- If the API is unavailable or rate limited, the page falls back to jsDelivr (`data.jsdelivr.com` for listings, `cdn.jsdelivr.net/gh` for files). jsDelivr lists tags but not branches; branch names still load by name.
- Only compiled JSON is read. Rule or attribute changes that exist only in LinkML YAML (ex. on a branch that has not regenerated its JSON) do not appear.
- The data levels figure is loaded from the [HTAN Manual - File Standards](https://docs.humantumoratlas.org/data_model/file_standards/) page and is not redistributed here.

## Run locally

ES modules need an HTTP server (opening `index.html` as a file will not work):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Files

```
index.html        page layout
css/style.css     styles and the color palette (CSS variables at the top)
js/github.js      branch / tag / tree listing and file fetching (GitHub API, jsDelivr fallback)
js/model.js       json schemas -> model: module, level, required / conditional / optional, rules, variants
js/workbook.js    blank xlsx workbook (port of workbook_gen htan profile)
js/fileid.js      fileid-kit codes, per-category examples, id builder
js/app.js         rendering: level grid, bars, rules table, matrix, 3D graph, side panel
.nojekyll         serve files as-is on GitHub Pages
```

## Colors

Required `#c4572f`, conditional `#d9a43a`, optional `#2f6ea8`, status differs `#5b4e45`. The three category colors were checked for color-vision deficiency separation (all pairs, protan / deutan / tritan) and also differ in lightness.

## Libraries

[D3](https://d3js.org) v7 and [3d-force-graph](https://github.com/vasturiano/3d-force-graph) (three.js + d3-force-3d), loaded from jsDelivr.

## Releasing changes

CSS and JS are referenced with a `?v=<timestamp>` tag so browsers pick up new files instead of GitHub Pages' 10-minute cache. After editing, bump it in `index.html`, `js/app.js` and `js/workbook.js`:

```bash
V=$(date +%Y%m%d%H%M); sed -i '' -E "s#\?v=[0-9]+#?v=$V#g" index.html js/app.js js/workbook.js
```

## Upstream check (GitHub Action)

The site reads `ncihtan/htan2-data-model` `main` live, so new commits and new `JSON_Schemas/<version>/` folders appear without a rebuild. `.github/workflows/upstream-check.yml` runs hourly (and on demand from the Actions tab) to record what changed:

- compares the main commit and the git tree sha of each `JSON_Schemas/<version>/` folder with `data/upstream.json` (commits that do not touch compiled schemas are ignored)
- on a change, commits the new `data/upstream.json` (this also keeps the scheduled workflow from being disabled after 60 days without commits)
- opens an issue for each new version folder

Needs Actions enabled with read/write workflow permissions (Settings -> Actions -> General -> Workflow permissions), and Issues enabled. Instant triggering on upstream pushes would need a `repository_dispatch` step in the upstream repo.

## License

MIT, see [LICENSE](LICENSE).
