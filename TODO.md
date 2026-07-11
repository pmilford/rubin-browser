# Rubin Browser — Canonical TODO

Single source of truth for actionable items. **IDs are globally unique and never
reused or renumbered** — reference an item by its ID (e.g. "do 100–104"). Detailed
rationale lives in `BACKLOG.md`; this file is the numbered index + status.

Status: `TODO` · `WIP` (in progress) · `DONE` · `BLOCKED` (needs a decision — see note).

## Active batch (being implemented now)

| ID | Item | Status | Notes |
|----|------|--------|-------|
| 100 | Plain-language glossary — hover tooltips + "?" panel | DONE | glossary section + filter in HelpModal; title= tooltips on DP1/Filter labels; module `glossary.ts` (44 terms) + HelpModal glossary tests |
| 101 | Catalog overlay + linked table (Gaia / Rubin Object via TAP) | DONE | Gaia DR3 overlay (public, no token): markers on the canvas + CatalogTable (row⇄marker select, recenter on click) over gaia.ts→catalog.ts; CatalogTable presentational + Playwright wiring test. Rubin Object source is a follow-up (needs tap.ts, now fixed). |
| 102 | MOC / DP1 footprint coverage layer (shade where data exists) | DONE | ImageViewer.renderCoverage() projects footprint.ts discs on the main canvas; ⊙ DP1 coverage toggle; Playwright paint/clear outcome test |
| 103 | Simbad "what's here?" (right-click) + name resolve | DONE | right-click → onSkyContext → objectsNear → SimbadPanel; public (no auth), works without a token; presentational + page.route Playwright tests |
| 104 | Click-to-copy coordinates (sexagesimal ⟷ decimal) | DONE | StatusBar: click RA/Dec to copy, format toggle, copy-pair (decimal); 4 tests |
| 105 | Grid coordinate-system toggle (equatorial ↔ galactic ↔ ecliptic) | DONE | graticuleLines generalized (equatorial path unchanged) via coords.ts; formatGridLabel (l/b, λ/β); System selector; iso-line + label unit tests + Playwright repaint test |
| 106 | PNG screenshot export of the current view | DONE | ImageViewer.exportPng() composites stacked canvases → toBlob download; ⤓ PNG button; Playwright download-outcome test |
| 107 | Magnifier loupe + whole-sky locator inset | DONE | loupe canvas magnifies pixels under the cursor (locator inset already existed as .fov-minimap); 🔍 Loupe toggle; Playwright tracks-cursor outcome test |
| 108 | Offline image-diff display (epoch A vs B → transients) | DONE | DiffPanel: A/B/diff (diverging) canvases + transient list over the tested offlineIntensityFrame→differenceImages(median)→detectTransients pipeline; ⧉ Diff toggle (offline only); ground-truth unit test + presentational + Playwright wiring test |
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
| 130 | Gravitational-lens catalog overlay | DONE | Bundled, web-verified (SIMBAD J2000 + discovery papers) set of 19 famous strong lenses spanning all 4 types (`lenses.ts`→`lensCatalogSet()`→feature-101 `CatalogSet`). New INDEPENDENT ImageViewer layer (`renderLensCatalog`, gold labelled diamond markers) that coexists with the Gaia cyan layer (no silent conflict); ⬦ Lenses toggle + linked CatalogTable; row click recenters + reports name/type/z. Fixed a sign error in the Einstein Cross anchor (Dec is +3.3585, not −3.3586). Tests: unit `lenses.test.ts` asserts 5 anchors by name (fails on zeros/sign-flip); Playwright `lens-catalog.spec.ts` asserts markers paint + view recenters onto the lens. |
