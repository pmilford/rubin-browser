# Rubin Browser — Feature-Set Review vs. Mature Astronomy Viewers

_Research date: 2026-07-10. Scope: BACKLOG item #9. This is a research/planning
document only — no source was changed. It compares the Rubin Browser (custom
Svelte 5 + Canvas 2D HiPS viewer; **not** Aladin) against the mature viewers and
proposes a prioritized set of additions._

## Viewers surveyed

| Viewer | What it is | Why it matters here |
|---|---|---|
| **Aladin Lite v3** | Embeddable JS/WebGL HiPS sky viewer (CDS) | Closest peer — the reference bar for a browser HiPS viewer |
| **Aladin Desktop** | Java desktop sky atlas (CDS) | Superset: SAMP hub, cross-match, MOC algebra |
| **JS9** | Browser FITS viewer (SAO), "DS9 in the browser" | Reference for regions, FITS analysis, pixel tables |
| **SAOImage DS9** | Desktop FITS analysis standard | Reference for frames/blink/tile, RGB, contours, regions |
| **WorldWide Telescope** | HiPS/TOAST sky + 3D universe (web + desktop) | Reference for tours, time simulation, 3D |
| **ESASky** | Multi-mission discovery portal (ESA) | Reference for MOC footprints, SSO, multi-mission overlay |
| **Firefly** | IPAC viewer — **the actual Rubin RSP Portal viewer** | The system our users are told to use; strongest "must reach parity" target |
| **Legacy Survey viewer** | DESI/DECaLS sky browser | Reference for permalink URL state, custom catalog overlays |

Because Firefly **is** the Rubin RSP viewer, "what Firefly does that we don't" is
the most directly relevant gap list for our users.

## 1. Comparison matrix (feature × viewer × us)

Legend: ● full · ◐ partial/limited · ○ none · — n/a.
"Us" = Rubin Browser today (see notes column for the file that implements it).

| Feature | AladinLite v3 | Aladin Desktop | JS9 | DS9 | WWT | ESASky | Firefly | LegacySurvey | **Us** | Notes (our impl / gap) |
|---|---|---|---|---|---|---|---|---|---|---|
| HiPS progressive tiles | ● | ● | ◐ | ○ | ● | ● | ● | ● | **●** | `ImageViewer.svelte` + `hips.ts`, quad-subdivided gnomonic |
| Pan / zoom / reset | ● | ● | ● | ● | ● | ● | ● | ● | **●** | pointer gestures |
| DS9-style scaling / stretch / colormap | ◐ | ● | ● | ● | ◐ | ● | ● | ◐ | **●** | `scaling.ts`,`colormap.ts` — 9 stretches, MTF/zscale |
| Coordinate grid | ● | ● | ● | ● | ● | ● | ● | ● | **◐** | `WcsOverlay.svelte` — rectangular approx, not curved WCS |
| Compass (N/E) + scale bar | ● | ● | ● | ● | ● | ● | ● | ◐ | **●** | `WcsOverlay.svelte` |
| Pixel readout (RA/Dec + value) | ● | ● | ● | ● | ● | ● | ● | ● | **●** | `PixelReadout.svelte` (relative luminance, not flux) |
| Base-layer / survey switch | ● | ● | ◐ | — | ● | ● | ● | ● | **●** | `SurveySelector`,`baseLayer.ts` Auto/DSS/DP1 |
| Additional HiPS overlay layers + opacity | ● | ● | ◐ | ◐ | ● | ● | ● | ● | **●** | `SurveySelector.svelte` |
| WCS catalog **point** overlay (markers) | ● | ● | ● | ● | ● | ● | ● | ● | **◐** | Alert/DIA overlay only (`data/alerts.ts`); no generic catalog |
| Catalog hover / select / popup | ● | ● | ● | ● | ● | ● | ● | ● | **◐** | click-identify on **local** catalog (`objects.ts`); no hover on overlay |
| Live TAP / cone-search catalog | ● | ● | ◐ | ◐ | ○ | ● | ● | ◐ | **○** | `tap.ts` client exists, **no UI**, DP0.2→DP1 namespace bug |
| Catalog crossmatch | ○ | ● | ○ | ◐ | ○ | ◐ | ● | ○ | **○** | none |
| MOC / coverage footprint display | ● | ● | ○ | ○ | ○ | ● | ● | ◐ | **○** | none |
| Region files (DS9 regions r/w) | ◐ | ● | ● | ● | ○ | ◐ | ● | ○ | **○** | none; no region model at all |
| Measurement (distance / aperture photometry) | ◐ | ● | ● | ● | ○ | ◐ | ● | ○ | **◐** | cross-section profile only (`CrossSectionPlot`) |
| Contour plots | ○ | ● | ● | ● | ○ | ○ | ● | ○ | **○** | none |
| RGB composite from arbitrary bands | ◐ | ● | ● | ● | ○ | ◐ | ● | ◐ | **◐** | `FilterSelector` R/G/B channel picker; per-band DP1 wired, composite render path partial |
| Multi-panel / tile frames | ○ | ● | ● | ● | ○ | ◐ | ● | ○ | **○** | single view only |
| Blink | ◐ | ● | ● | ● | ○ | ◐ | ● | ◐ | **●** | `BlinkController` over epoch/band cube (mock + offline) |
| Time / epoch animation (data) | ◐ | ● | ○ | ◐ | — | ● | ● | ● | **◐** | `TimeSlider` over MOCK epochs; offline synthetic cube real |
| Proper-motion / time simulation | ○ | ◐ | ○ | ○ | ● | ◐ | ○ | ○ | **○** | none |
| SAMP / table interop | ○ | ● | ● | ● | ○ | ● | ● | ○ | **○** | none |
| FITS support (float pixels) | ◐ | ● | ● | ● | ○ | ● | ● | ○ | **○** | 8-bit JPEG/PNG HiPS only (BACKLOG #7) |
| Permalink / URL view state | ● | ◐ | ● | — | ● | ● | ● | ● | **○** | none — view not encoded in URL |
| Keyboard-driven navigation | ● | ● | ● | ● | ● | ◐ | ● | ● | **◐** | only blink/help/search/token keys; no pan/zoom keys |
| 3D / solar-system / SSO | ○ | ○ | ○ | ○ | ● | ● | ○ | ○ | **○** | out of scope |
| Guided tours | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | **○** | out of scope |
| Light-curve / 1-D plots | ○ | ◐ | ● | ● | ○ | ◐ | ● | ○ | **◐** | `LightCurvePlot` (mock), cross-section, 3D surface |
| Constellation lines / nearest-object readout | ● | ● | ○ | ○ | ● | ○ | ○ | ○ | **●** | `constellation.ts` + readout — nicer than most peers |
| Density/LOD overlay at volume (200k pts) | ◐ | ◐ | ○ | ○ | ◐ | ◐ | ● | ● | **●** | alert overlay LOD heatmap — genuinely strong |

Sources for the viewer columns are cited in §5.

## 2. Top gaps ranked by value ÷ effort

Ordering is by **value-to-effort**, with Firefly-parity and "our users expect it"
weighted up. Effort is rough: **S** ≈ ≤1 day, **M** ≈ a few days, **L** ≈ 1–2+
weeks, given our architecture.

1. **Permalink / URL view state** — _Value: high · Effort: S._
   Encode `ra,dec,fov,survey,stretch,colormap` (and overlay toggles) in the URL
   hash; parse on load, push on view-change (debounced). Every peer that lives in
   a browser has this (Aladin Lite, Firefly, Legacy Survey, ESASky). It is the
   single cheapest credibility feature and unlocks sharing/bookmarking/bug-repro.
   **Fit:** `TileViewer.svelte` already owns all this `$state`; add a
   `urlState.ts` util (pure encode/decode, unit-testable) + one `$effect` to
   write the hash and a one-time read in `onMount`. No rendering risk.

2. **Live TAP cone-search catalog overlay (with hover/select)** — _Value: very high · Effort: M._
   This is the biggest capability gap vs. Firefly/Aladin and is half-built: the
   `tap.ts` client and `buildConeSearch()` exist, and the **alert overlay already
   proves we can draw WCS-aligned, viewport-culled, hit-testable points at scale**
   (`data/alerts.ts`). Generalize that overlay to accept a `CatalogSet` fed by a
   TAP cone search around the current view, with hover tooltip + click → existing
   `ObjectInfoPanel`. **Blocker to clear first:** the known DP0.2→DP1 namespace
   bug + phantom `dist` column in `tap.ts` (already flagged in code + BACKLOG
   B-d/#10). **Fit:** new `CatalogOverlay` reusing the alert renderer's spatial
   index + LOD; new `CatalogSearchPanel` in the side panel.

3. **Coordinate grid → true curved WCS grid** — _Value: high · Effort: S–M._
   `WcsOverlay` draws grid lines on a **rectangular RA/Dec approximation**; near
   the poles and at wide FOV they diverge from the real projection. Reproject grid
   vertices through the existing pure `skyToCanvas()` (same path tiles use) and
   stroke poly-lines. Turns a "◐ looks-right-near-equator" into a correct ●.
   **Fit:** pure geometry we already have; contain to `WcsOverlay.svelte`. Needs a
   geometry invariant test (grid crossing lands where `skyToCanvas` predicts).

4. **Keyboard-driven navigation** — _Value: medium-high · Effort: S._
   Arrows pan, `+`/`-` zoom, `r` reset, `g` toggle grid, `[`/`]` blink step,
   `f` fit. Accessibility + power-user parity (all peers have it). **Fit:** one
   `handleKeydown` on the viewer that mutates the same view `$state` the pointer
   handlers use; guard when focus is in an input. Reuse pan/zoom math — no new
   geometry. Pairs naturally with a keyboard-shortcuts row in `HelpModal`.

5. **DS9 region read/write (circle/ellipse/box/polygon/line)** — _Value: high · Effort: M–L._
   Regions are the lingua franca of DS9/JS9/Firefly/Aladin and the substrate for
   measurement, apertures, and interop. Define a `Region` model + a DS9-regions
   text parser/serializer (pure, very testable), an overlay to draw them (RA/Dec
   anchored, reprojected each frame like the cross-section line already is), and
   drag-to-create/edit. **Fit:** new overlay canvas following the cross-section
   tool's "own canvas, pointer-events only in mode, endpoints stored as RA/Dec"
   pattern (BACKLOG #3 blockers already solved that class). Import/export .reg
   files. This is the keystone that later enables #6 and SAMP region messages.

6. **Measurement tools: distance ruler + aperture photometry** — _Value: high · Effort: M (ruler S; photometry M and gated)._
   Distance ruler (great-circle arcmin between two RA/Dec points) is nearly free —
   we already compute great-circle distance for the cross-section axis
   (`crossSection.ts`, `skyGeom.ts`). Aperture photometry (sum within a circular
   region) needs **linear pixels to be meaningful** — on 8-bit JPEG HiPS it is only
   relative luminance, so it must be labelled honestly (same rule the cross-section
   follows) and becomes truly useful only with the FITS path (#10 below / BACKLOG
   #7). **Fit:** ruler = a special region type from #5; photometry consumes a
   circle region + the pre-colormap sampler the cross-section already has.

7. **Contour plots** — _Value: medium · Effort: M._
   Marching-squares over the sampled (pre-colormap) luminance/flux grid — we
   already build such a grid for `SurfacePlot`/`surfacePlot.ts`. Draw iso-level
   poly-lines on an overlay. Standard in DS9/JS9/Firefly. **Fit:** new pure
   `contour.ts` (marching squares, unit-testable against a synthetic gradient) +
   an overlay; reuse the surface-plot sampler. Value rises a lot once FITS gives
   real flux levels.

8. **MOC / coverage footprint display** — _Value: medium-high (very Rubin-relevant) · Effort: M._
   ESASky/Aladin/Firefly show survey/observation footprints as MOCs. We already
   have HEALPix NESTED math (`@hscmap/healpix`) and tile-quad drawing, so rendering
   a MOC (a set of `(order,ipix)` cells) as shaded HEALPix diamonds is squarely in
   our wheelhouse — no new dependency. Lets us show "where does DP1 actually have
   data" vs. blank sky, and later alert/visit coverage. **Fit:** parse FITS/JSON
   MOC → cell list → draw via the existing `corners_nest` quad path; a MOC overlay
   layer in `SurveySelector`.

9. **Finish RGB composite from arbitrary bands (wire the render path)** — _Value: medium-high · Effort: M._
   We are further along than the matrix's ◐ suggests: `FilterSelector.svelte`
   already lets the user assign **any** of ugrizy to R/G/B channels, per-band DP1
   datasets exist (`baseLayer.ts` `band_*`), and the channels are wired into
   `TileViewer` state. The missing piece is the **compositing render path** (fetch
   three band tiles, combine into one RGB canvas with per-channel stretch — a
   Lupton-style asinh would be ideal). This is a headline Rubin capability
   (user-chosen colour from real bands) that no generic HiPS viewer does as
   naturally. **Fit:** extend `ImageViewer` to fetch N band-tiles per HEALPix cell
   and composite offscreen before post-processing; needs a visual/outcome test
   (channel swap changes pixels the expected way). Full fidelity wants FITS (#10).

10. **FITS / higher-bit-depth pixel path** — _Value: high · Effort: L (foundational)._
    The quiet root cause under photometry, honest contours, real stretch, and
    un-saturated cores: everything today is 8-bit, pre-stretched JPEG. A FITS path
    (Rubin SODA `read:image` cutouts or FITS HiPS) keeping linear float pixels is
    what turns several ◐/○ above into ●. It is BACKLOG #7 and the largest single
    lever, but also the most work and needs an auth'd data path. Ranked last here
    only on effort, not value — treat it as the enabler milestone that unlocks
    6/7/9's full versions.

**Deliberately out of scope** (low value for this app / large effort): SAMP hub
(needs a running hub + other desktop apps; niche for a standalone browser tool —
revisit only if we want Firefly/TOPCAT interop), 3D/solar-system/SSO and guided
tours (WWT/ESASky territory, orthogonal to a HiPS pixel browser), full catalog
crossmatch engine.

## 3. Quick wins (cheap, high-perceived-value, low rendering risk)

These are the "do them this week" set — each is small, mostly pure/testable, and
none touches the risky tile-projection core:

- **Permalink URL state** (#1) — pure `urlState.ts` + one effect. Sharable views.
- **Keyboard navigation** (#4) — arrows/`+`/`-`/`r`/`g`; reuses existing view
  math; add the shortcut list to `HelpModal.svelte`.
- **Curved WCS grid** (#3) — reproject grid vertices through `skyToCanvas` instead
  of the rectangular approximation; correctness upgrade to something we already
  ship. (Grid + compass + scale bar otherwise already done — see §4.)
- **Distance ruler** (part of #6) — great-circle arcmin between two clicked
  RA/Dec; we already have the great-circle helper and the "store endpoints as
  RA/Dec, reproject each frame" pattern from the cross-section tool.
- **Screenshot / PNG export of the current canvas** — `canvas.toBlob()` +
  download; trivial, and every peer has "save image." (Not in the matrix; noted
  as a bonus quick win.)

## 4. What we already do as well as, or better than, the peers

Worth stating plainly so we don't "gap-chase" things we've already nailed:

- **DS9-style post-processing is genuinely strong.** Nine stretch functions
  (linear/log/sqrt/asinh/sinh/mtf/histogram/zscale/percentile), MTF display
  transfer, multiple colormaps, invert, and 4 interpolation kernels
  (`scaling.ts`/`colormap.ts`/`interpolation.ts`) — richer than Aladin Lite's and
  on par with JS9/DS9 for _display_ (the honest caveat is we operate on 8-bit
  JPEG, so it's display-value not flux — fixed by the FITS path).
- **Coordinate grid + N/E compass + scale bar already exist** (`WcsOverlay.svelte`)
  — the only upgrade is curving the grid (§3). Many "quick wins" lists would put
  these as gaps; for us only the grid's accuracy is the gap.
- **Blink + epoch/band cube UX is a first-class feature, not an afterthought**
  (`BlinkController`, `TimeSlider`, `OfflineLayerControls` over a real multi-epoch
  multi-band synthetic cube). DS9/Firefly blink frames, but our purpose-built
  time+band scrubber with "find a transient" is more discoverable for the Rubin
  time-domain use case.
- **High-volume overlay rendering (LOD/heatmap at 200k points)** — the alert/DIA
  overlay's columnar TypedArrays + uniform spatial index + density-heatmap LOD
  (`data/alerts.ts`) stays O(cells) at full sky. This matches Firefly/Legacy-Survey
  scaling and beats naive marker overlays in Aladin Lite. It is also the ready
  substrate for gap #2 (generic catalog overlay).
- **User-assignable RGB channel mapping from arbitrary bands** (`FilterSelector`)
  — the _UI/model_ for user-mixed colour is already there and is a more natural
  Rubin workflow than any generic HiPS viewer exposes; only the composite render
  path remains (#9).
- **Analysis plots built in** — cross-section profile with gap-honest sampling,
  3-D luminance surface, and light-curve panel. JS9/DS9 have projections/plots
  too, but shipping them in a lightweight browser viewer (no server) is ahead of
  Aladin Lite and Legacy Survey.
- **Constellation lines + nearest-object readout** — a nice orientation aid most
  analysis viewers (JS9/DS9/Firefly) don't bother with.
- **Engineering rigor peers don't advertise**: pure, invariant-tested projection
  (`projection.ts`) and a 4-layer visual/geometry test regime that asserts pixel
  outcomes — directly relevant because it's what lets us add overlays (grid,
  catalog, regions, contours) without regressing the tile core.

## 5. Sources

- Aladin Lite v3 (grid, catalogs, MOC, SAMP, FITS upload): <https://aladin.cds.unistra.fr/AladinLite/doc/> · <https://aladin.cds.unistra.fr/AladinLite/IVOA2023/> · <https://aladin.cds.unistra.fr/AladinLite/doc/API/> · CHANGELOG <https://raw.githubusercontent.com/cds-astro/aladin-lite/develop/CHANGELOG.md>
- Firefly / Rubin RSP Portal (DS9-like tools, coverage, regions, IVOA TAP/ObsCore/DataLink): <https://dp0-2.lsst.io/tutorials-examples/Portal-6.html> · <https://rsp.lsst.io/guides/portal/index.html> · <https://dp1.lsst.io/tutorials/portal/105/portal-105-2.html> · <https://firefly-client.lsst.io/> · <https://pretalx.com/adass2023/talk/DCPSGU/>
- JS9 (FITS, regions, analysis, WCS): <https://js9.si.edu/> · <https://js9.si.edu/js9/help/user.html> · <https://github.com/ericmandel/js9>
- SAOImage DS9 (blink/tile frames, RGB composite, contours, pixel table): <https://ds9.si.edu/doc/ref/index.html> · <https://cxc.cfa.harvard.edu/ciao/ahelp/ds9.html> · <https://arxiv.org/html/2606.30897v1>
- WorldWide Telescope (tours, time simulation, 3D, HiPS/TOAST): <https://worldwidetelescope.org/home/> · <https://docs.worldwidetelescope.org/user-manual/1/> · <https://worldwidetelescope.org/webclient/>
- ESASky (MOC footprints, multi-mission overlay, SSO, IVOA protocols): <https://iopscience.iop.org/article/10.1088/1538-3873/129/972/028001> · <https://arxiv.org/pdf/1811.10459>
- Legacy Survey viewer (permalink URL state, custom catalog overlays): <https://viewer.legacysurvey.org/> · <https://www.legacysurvey.org/viewer> · <https://discuss.legacysurvey.org/t/new-custom-catalog-page/12947>
- IVOA MOC standard (for gap #8): <https://www.ivoa.net/documents/MOC/20220727/REC-moc-2.0-20220727.html>
