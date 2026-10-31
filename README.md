# EBT World Land Map

Worldwide land dataset and map viewer for [EBT DotPick](https://github.com/ShortOkapi/ebt-dotpick), derived from OpenStreetMap.

[Open EBT World Land Map](https://shortokapi.github.io/ebt-world-land-map)

Candidate **1.0.1-rc.1**; current stable source release **1.0.0**. The source grid and shipped osm-base-mask.json are unchanged. The live placeholder overrides have been removed. With the shipped base, the viewer now counts **201,342** land dots instead of **201,341**; Antarctic dot **[10, 10]** is no longer removed by an example. The example inclusion [0, 0] was already land in the base and did not change the effective count.

## Maintained files

- **osm-base-mask.json** is the generated worldwide land/no-land mask, with the legacy grid, a land count and sorted row ranges. It is derived from OSM coastline land polygons; it does not by itself remove inland lakes or establish access, cash availability or Euro-use eligibility.
- **manual-overrides.json** contains reviewed additions/removals. Both arrays are currently empty. Keep illustrative entries in documentation, not these live arrays. Preserve real reviewed overrides in future revisions.
- **destination-overrides.json** remains the maintained source for prepared place exceptions. It is used by external place preparation and is not an unused file to delete. This candidate does not change it.
- **core.js** defines the legacy grid used by the generator and viewer. Do not renumber cells or round the calculation constants. The old grid ID intentionally retains Dot Safari's name.

## Generator reliability

The generator streams ZIP entries sequentially and awaits the input pipeline, shapefile processing and end-directory checks before preparing output. It rejects a missing shapefile, incomplete ZIP (including a missing final directory), geometry-processing errors, empty result, interrupted input, HTTP failure or inactivity timeout. Normal ZIP/ZIP64 end records and comments are handled with a bounded tail buffer; the full archive is not held in memory. Multiple .shp entries are processed sequentially.

A complete polygon strictly inside one cell can mark that cell without Turf intersection work. Edge-touching, multi-cell and clipped cases retain the precise intersection path. Row/column limits remain clamped to the existing grid. A geometry/intersection error stops generation instead of silently omitting land. Null geometries remain skippable shapefile null records.

Only after successful processing does the generator write a temporary file beside its chosen output and rename it into place. Download/parse/write/rename failure retains the previous mask. Cleanup failures are reported separately. The default output path is beside generate.js, including when launched from another working directory. Each download has a 30-second inactivity limit, not a 30-second limit for the whole large download. The existing Generate OSM Base Mask workflow is still a separate manually triggered full generation.

## Checks and generation

Use Node 24 for the maintained workflow:

```sh
npm ci --ignore-scripts
npm test
```

The repeatable checks use generated local ZIP/SHP fixtures and a local HTTP server; they do not download OSM, replace the repository's mask or write to GitHub. They cover geometry equivalence, stream chunk boundaries, ZIP comments/ZIP64, missing/corrupt/truncated input, empty results, HTTP/timeouts, atomic replacement failure, range compaction and placeholder detection. The read-only **Check world generator** Actions workflow runs these checks after relevant pushes/PRs. package-lock.json records the tested dependency versions. The unused direct @turf/helpers dependency is removed; Turf may still require helpers transitively.

A deliberate full data regeneration is different:

```sh
npm run generate
```

That downloads the current global OSM land source and replaces osm-base-mask.json only after success. Review any resulting data change before publishing or refreshing consumers. Do not run Generate OSM Base Mask merely to test this candidate.

## Coordinating consumers

This candidate prepares the corrected world source only. DotPick's bundled mirror and Target Map's pinned classification background are updated in the follow-up, after the corrected source is committed and has a real GitHub commit/hash to record. The source commit, base hash and overrides hash must describe the same source files; do not invent a commit or reuse old provenance for changed bytes.

Target Map's explicit decisions and history must survive its background refresh, and its master/compact revision must advance together. DotPick's Notes and prepared place lists are separate from this correction. Continue on the release branches until the coordinated changes and final release checks are complete.

OSM-derived data © OpenStreetMap contributors, under ODbL 1.0. Application code is MIT.
