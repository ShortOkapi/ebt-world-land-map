# EBT World Land Map

Worldwide land dataset and map viewer for [EBT DotPick](https://github.com/ShortOkapi/ebt-dotpick), derived from OpenStreetMap.

[Open EBT World Land Map](https://shortokapi.github.io/ebt-world-land-map)

Candidate **1.0.1-rc.2**; current stable source release **1.0.0**. The source grid and shipped osm-base-mask.json are unchanged. The live placeholder overrides have been removed. With the shipped base, the viewer now counts **201,342** land dots instead of **201,341**; Antarctic dot **[10, 10]** is no longer removed by an example. The example inclusion [0, 0] was already land in the base and did not change the effective count.

## Maintained files

- **osm-base-mask.json** is the generated worldwide land/no-land mask, with the legacy grid, a land count and sorted row ranges. It is derived from OSM coastline land polygons; it does not by itself remove inland lakes or establish access, cash availability or Euro-use eligibility.
- **manual-overrides.json** contains reviewed additions/removals. Both arrays are currently empty. Use manual-overrides.example.json to see the exact format; it is never loaded by the viewer. Keep illustrative entries in that separate file, not the live arrays. Preserve real reviewed overrides in future revisions.
- **destination-overrides.json** remains the maintained source for prepared place exceptions. It is used by external place preparation and is not an unused file to delete. This candidate does not change it.
- **core.js** defines the legacy grid used by the generator and viewer. Do not renumber cells or round the calculation constants. The old grid ID intentionally retains Dot Safari's name.

## Generator reliability

The generator streams ZIP entries sequentially and awaits the input pipeline, shapefile processing and end-directory checks before preparing output. It rejects a missing shapefile, incomplete ZIP (including a missing final directory), geometry-processing errors, empty result, interrupted input, HTTP failure or inactivity timeout. Normal ZIP/ZIP64 end records and comments are handled with a bounded tail buffer; the full archive is not held in memory. Multiple .shp entries are processed sequentially.

A complete polygon strictly inside one cell can mark that cell without Turf intersection work. Edge-touching, multi-cell and clipped cases retain the precise intersection path. Row/column limits remain clamped to the existing grid. A geometry/intersection error stops generation instead of silently omitting land. Null geometries remain skippable shapefile null records.

Only after successful processing does the generator write a temporary file beside its chosen output and rename it into place. Download/parse/write/rename failure retains the previous mask. Cleanup failures are reported separately. The default output path is beside generate.js, including when launched from another working directory. Each download has a 30-second inactivity limit, not a 30-second limit for the whole large download. The existing Generate OSM Base Mask workflow is still a separate manually triggered full generation.

## Map limits and world seam

The grid and source dataset keep rows **0–641** and columns **−3–853**, with their exact original geographic limits. The OSM background uses Leaflet’s Web Mercator map, which can display only about **85.0511°S to 85.0511°N**. Rows **16–624** intersect that band; rows 16 and 624 are partly clipped in the viewer. No source cell is trimmed or renumbered.

With the shipped base and empty live overrides there are **201,342 land dots worldwide**, of which **187,630** intersect the map’s latitude band. The other **13,712** polar land dots remain in the dataset. The status line distinguishes these counts; neither is the number currently on screen. Clicks beyond the map’s latitude band do not create misleading polar-dot popups.

At close zoom a dark dashed line marks the **±180° world seam**. The partial edge cells in columns **853** and **−3** are distinct. The seam is the map’s wrap cut, not a newly invented full-width column or a change to either cell. Repeated world copies retain the same canonical IDs.

## How to write a manual override

Open **manual-overrides.example.json** to see complete valid JSON examples for both arrays. That separate file is documentation: the viewer loads only **manual-overrides.json**. The old illustrative exclusion [10, 10] was a real applied decision and removed an Antarctic land cell. Its original purpose was to teach the format; that purpose is preserved without changing the live dataset.

1. Confirm the dot’s **row first, column second**, shown as `[row, column]` in the viewer. These are grid indices, not latitude/longitude.
2. In **manual-overrides.json**, put a reviewed land addition in `include`, or a reviewed false-land removal in `exclude`. Each entry has `"dot": [row, column]` and a short `"reason": "..."` with your evidence. Replace the example indices and text; do not copy the sample decisions unchanged.
3. Separate multiple entries with commas, without a trailing comma. JSON does not accept code comments. Keep explanatory text in `description`, each entry’s `reason`, or this README.
4. Avoid putting a dot in both arrays. If it is in both, exclusion wins in the effective dataset and viewer.
5. Reload the viewer and check the status/count and popup. Save and review the live file before refreshing DotPick or Target Map.

No OSM regeneration is needed to edit an override. The generated base stays separate from the reviewed corrections.

## Automatic checks: no extra software needed

For the normal GitHub/browser workflow, **you do not need to install Node.js or run commands**. After committing relevant changes, open **Actions → Check world generator** and wait for the green result. GitHub installs the required test software automatically. Continue to test the viewer in your browser as usual.

**Node.js** is software that runs JavaScript outside a browser. **24** is the major version used by this project’s automated checks. **npm**, supplied with Node.js, installs the generator’s dependencies and runs its checks. These are developer tools, not requirements for using the viewer.

If you already use Node.js 24 and want to repeat the automatic checks on your own computer, open a terminal in this folder and run:

```sh
npm ci --ignore-scripts
npm test
```

Otherwise skip these two commands; the green GitHub check covers the same tests. The repeatable checks use generated local ZIP/SHP fixtures and a local HTTP server. They do not download OSM, replace the repository’s mask or write to GitHub. package-lock.json records the tested dependency versions.

## Deliberate full regeneration

The separate **Generate OSM Base Mask** workflow (or the developer command `npm run generate`) downloads the current large global OSM land source and replaces osm-base-mask.json after success. The workflow can commit that output. This is a data-maintenance operation, **not a quick test**; do not start it merely to check a candidate. Review any resulting data change before publishing or refreshing consumers.

## Coordinating consumers

This candidate prepares the corrected world source and clarified viewer only. DotPick's bundled mirror and Target Map's pinned classification background are updated in the follow-up, after the corrected source is committed and has a real GitHub commit/hash to record. The source commit, base hash and overrides hash must describe the same source files; do not invent a commit or reuse old provenance for changed bytes.

Target Map's explicit decisions and history must survive its background refresh, and its master/compact revision must advance together. DotPick's Notes and prepared place lists are separate from this correction. Continue on the release branches until the coordinated changes and final release checks are complete.

OSM-derived data © OpenStreetMap contributors, under ODbL 1.0. Application code is MIT.
