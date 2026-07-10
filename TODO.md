# Rubin Browser — Canonical TODO

Single source of truth for actionable items. **IDs are globally unique and never
reused or renumbered** — reference an item by its ID (e.g. "do 100–104"). Detailed
rationale lives in `BACKLOG.md`; this file is the numbered index + status.

Status: `TODO` · `WIP` (in progress) · `DONE` · `BLOCKED` (needs a decision — see note).

## Active batch (being implemented now)

| ID | Item | Status | Notes |
|----|------|--------|-------|
| 100 | Plain-language glossary — hover tooltips + "?" panel | DONE | glossary section + filter in HelpModal; title= tooltips on DP1/Filter labels; module `glossary.ts` (44 terms) + HelpModal glossary tests |
| 101 | Catalog overlay + linked table (Gaia / Rubin Object via TAP) | WIP | modules `src/api/gaia.ts` DONE, `src/data/catalog.ts` building |
| 102 | MOC / DP1 footprint coverage layer (shade where data exists) | WIP | module `src/data/footprint.ts` building |
| 103 | Simbad "what's here?" (right-click) + name resolve | WIP | module `src/api/simbad.ts` building |
| 104 | Click-to-copy coordinates (sexagesimal ⟷ decimal) | TODO | small; StatusBar/readout |
| 105 | Grid coordinate-system toggle (equatorial ↔ galactic ↔ ecliptic) | WIP | module `src/utils/coords.ts` building; feeds `graticule.ts` |
| 106 | PNG screenshot export of the current view | TODO | `canvas.toBlob` compose visible layers |
| 107 | Magnifier loupe + whole-sky locator inset | TODO | reuses the render path |
| 108 | Offline image-diff display (epoch A vs B → transients) | WIP | linear-frame accessor `renderSyntheticIntensityFrame`/`offlineIntensityFrame` DONE; need diverging colormap + `DiffPanel` + `framePixelToRaDec` |
| 109 | FITS cutout display pipeline (SODA→FITS→WCS readout) | BLOCKED | **Design Q:** the DP1 SODA sync endpoint + per-band dataset `ID` (DataLink discovery) are unconfirmed and there is no DataLink client. Building the display pipeline (tested against a routed synthetic FITS) + honest live-endpoint errors; the live path stays unverified until the endpoint/ID is confirmed. |

## Backlog (not yet called out to implement)

| ID | Item | Status | Notes |
|----|------|--------|-------|
| 120 | RGB band-mixing composite (ugrizy → R/G/B, per-channel stretch, Lupton) | TODO | big #2; needs FITS pixels (109) |
| 121 | DS9 region files (draw / import / export circles·ellipses·polygons) | TODO | big #3 |
| 122 | Aperture / radial-profile photometry (click → profile, curve-of-growth) | TODO | big #5; calibrated once 109 lands |
| 123 | Object-type classification FROM the image under the cursor | TODO | BACKLOG #10 (PRD ready, measured accuracy required) |
| 124 | Time-varying intensity across multi-epoch cubes (multi-scale, sub-pixel) | TODO | BACKLOG #2 |
| 125 | Zoom/fetch perf tail: off-thread `createImageBitmap` decode, request cancellation, higher-res allsky | TODO | BACKLOG #5 remaining |
| 126 | Real-data TAP regression fixtures (`tests/regression/` + `tests/fixtures/`) | TODO | referenced by test scripts, not built |
| 127 | Cross-platform polish + PWA (pinch-zoom, responsive breakpoints, manifest/SW) | TODO | BACKLOG #8 |
| 128 | `tap.ts` DP0.2→DP1 namespace reconciliation | TODO | blocks live Rubin Object cone search / "Fetch details"; unblocks 101's Object source |
| 129 | DP1 dataset discovery: fetch `/api/hips/v2/dp1/list` instead of hardcoding datasets | TODO | BACKLOG B-a remainder |
