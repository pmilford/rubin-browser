# Rubin Browser — Longer-term Backlog

Larger research/engineering items deferred from day-to-day work. Smaller known
gaps (DP0.2/DP1 namespace mismatch, wiring the mock filter/epoch controls, real
TAP catalog search, the per-tile brightness seam) are tracked in code comments
and the project CLAUDE.md.

> STATUS (2026-07-09): #1 generator DONE (`src/data/syntheticSky.ts`), #3
> cross-section DONE (MVP single trace), #5 zoom perf DONE (ancestor preview +
> memoization + fetch coalescing; LRU cap + allsky preview still open), and an
> in-app **Offline demo** base layer now renders the generator's tiles with no
> network (`src/data/offlineDataset.ts`). The offline layer is now a MULTI-EPOCH +
> MULTI-BAND browsable cube (`OfflineLayerControls.svelte`): scrub time, switch
> g/r/i/z/y, blink, "Find a transient". Remaining sub-items noted inline below.

## USER-REPORTED BUGS (2026-07-09, mid-session)

- **B-a Authenticated but no Rubin data. ✅ FIXED.** Root cause: the app requested
  the retired DP0.2 HiPS path (`/api/hips/images/color_gri`); DP1 is at
  `/api/hips/v2/dp1/deep_coadd/color_gri`, so every request 404'd and the swallowed
  auto-fallback silently showed DSS. Fixed the path + made failures visible (host +
  HTTP status). Remaining: fetch `/api/hips/v2/dp1/list` to offer the other DP1
  datasets instead of hardcoding `color_gri`; default color tiles to png.
- **B-b Zoom order-transition misregistration. ✅ FIXED.** Confirmed cause: the
  ancestor preview drew a large low-order tile with a single 2-triangle affine map
  over a wide, non-affine gnomonic extent. Fixed by piecewise-affine quad
  subdivision (`tileSubdivision`/`tileSubQuads`); small tiles stay n=1.
- **B-c Cross-section sticky + off-screen handles. ✅ FIXED.** Re-seed on enable +
  edge-clamped grabbable handles.
- **B-d Clicked-object identification. ✅ FIXED (catalog tier).** Thresholded
  `identifyAt` + persistent `ObjectInfoPanel` (type + brightness + provenance),
  click-vs-pan gesture. Remaining: the "Fetch details" live path — Rubin TAP cone
  search / SIMBAD, auth-gated — is BLOCKED on the DP0.2→DP1 `tap.ts` namespace +
  the phantom `dist` column (reconcile before wiring; see #9 / tap.ts).

## 1. Synthetic multi-time / multi-tile / multi-wavelength data source  ✅ generator done

Build a deterministic, generated data source with **known** source positions,
intensities, and noise — a controllable ground truth instead of live DSS/Rubin
imagery.

Purpose:
- **Tiling verification** — inject sources at known RA/Dec and assert they land
  at the pixel `skyToCanvas` predicts, across tile boundaries and orders. Lets
  the Playwright visual tests run offline and bit-stable (serve tiles via
  `page.route` instead of hitting CDS), removing network flakiness.
- **Future time-varying code** — a substrate for the epoch-difference work below.

Should span multiple epochs (time), multiple HEALPix tiles/orders, and multiple
wavelength bands, with configurable per-source light curves and a noise model.

## 2. Time-varying intensity measurement across multi-epoch image cubes

Research measuring intensity change across the multi-measurement data at
**multiple scales, including sub-pixel**.

Direction:
- Divide the image cubes into multiple epochs; look for differences **by epoch**
  and possibly **by direction**.
- Targets of interest include **huge-scale waves** and **supernova rate by
  epoch**, among other transient/variable phenomena.

Depends on item 1 (needs a known-truth generator to validate the measurement
pipeline before running it on real Rubin data).

## 3. Cross-section / profile tool

In the pixel-value browser, add a **linear cross-section at an arbitrary angle**
that plots **intensity vs. position** along the cut, with **one trace per image
layer** (multiple filters, multiple catalogs, or both). Needs a good UI: draggable
endpoints/angle, proper axis scales, and switchable **linear/log** intensity
scaling. (Requires real per-pixel values — full fidelity needs FITS; a relative-
luminance version works on JPEG now.)

**Design review done (2026-07-09) — NOT-ready-to-code blockers to resolve first:**
1. Do NOT reuse the alert overlay canvas — `renderAlerts()` `clearRect`s it every
   frame (it would erase the line) and it's `pointer-events:none`. Use a separate
   overlay (own canvas/SVG, higher z-index, `pointer-events:auto` only in mode).
2. Real pan suspension: gate `onPointerDown/Move/Up` on the mode and SKIP the
   pointerup recenter — else finishing a line pans the sky. Own `setPointerCapture`
   on whatever element gets the drag.
3. Store endpoints as **RA/Dec** and reproject via `skyToCanvas(currentView())`
   each render (or clear the line on any view change) — px endpoints decouple from
   the sky on pan/zoom, making the plot + RA/Dec labels wrong.
4. Sampling the displayed canvas conflates missing tiles / colormap non-monotonicity
   / invert / 8-bit saturation with real intensity. Sample the PRE-colormap gray
   (offscreen path), label it "displayed relative luminance, not flux," and mark
   all-zero / off-canvas samples as **gaps ("no data"), never silent 0**.
5. Do NOT wrap getImageData in a silent catch that returns zeros — surface failure
   (`showError`) and render "no data".
6. Distance axis = **great-circle arcmin** between endpoints' RA/Dec, not px.
7. Perf: one getImageData over the line's bounding box + in-buffer interp, not N
   1×1 readbacks.
8. "One trace per layer" structurally needs per-layer offscreen buffers (all
   overlays composite into one canvas today) — either add them or scope MVP to a
   single trace and be explicit.
Must-have falsifiable tests: pure-x gradient → horizontal line STRICTLY monotonic
AND vertical line constant (kills axis-swap / all-zero); zero-length → finite, no
NaN; off-canvas samples flagged as gaps not 0; luminance matches the readout
formula `(0.299R+0.587G+0.114B)/255`; Playwright over content-verified region
asserts the plotted path's y-RANGE > threshold (not merely that a path exists),
endpoint-drag changes the path `d`, log toggle changes curve shape, and pan is
verified suspended (center RA/Dec unchanged after a drag in mode).

## 4. Rubin time-series image browsing

Answer "how do I look at a time series of Rubin images?" — a real path to
multi-epoch Rubin imagery (visits/coadds over time) rather than the current MOCK
epochs in `src/constants.ts`. Ties into the blink/epoch UI that already exists as
a mock, and into items 1–2 (multi-epoch difference analysis).

## 5. Zoom / fetch performance

Zooming feels too slow — likely over-fetching. Investigate: is the correct (lower)
HiPS order being requested at low zoom, tile count per view, request cancellation
for superseded views, an allsky/low-res preview layer, and caching/prefetch.
`fovToOrder` already lowers order with FOV, so profile what actually dominates
(tile count, decode, network) before optimizing.

> STATUS: ancestor-preview + fetch coalescing + post-processing memo DONE; the
> wide-FOV ancestor warp is fixed via quad subdivision (B-b); an **LRU cap**
> (`src/utils/tileCache.ts`, MAX_TILE_CACHE=1500, evict least-recently-DRAWN,
> never a visible tile) bounds the cache; and an **allsky backdrop** (prefetch the
> 48 order-1 full-sky tiles, PINNED against eviction, drawn subdivided by the
> ancestor pass) prevents black flashes on jumps to unvisited regions — NETWORK
> bases only (offline synth needs no backdrop and it would jank blinking). STILL
> OPEN: off-thread decode (`createImageBitmap`) and replacing offline `toDataURL`
> with `createImageBitmap`; a higher-res allsky (order 2/3) if order-1 is too
> coarse; request cancellation for superseded views.

## 6. Rubin alert / DIA event overlay

**Performant overlay architecture DONE** (`src/data/alerts.ts` + ImageViewer
overlay canvas): columnar TypedArrays, a uniform RA/Dec spatial index with
viewport culling, and a level-of-detail renderer (individual type-colored
markers when sparse → density heatmap when dense) that stays O(cells) at volume.
Driven by a deterministic synthetic generator (200k events) with a toggle,
per-type filter legend, and count. Verified to full-sky at 200k.

Remaining for this item:
- **Real data source**: adapter from the actual Rubin alert stream / DIA-source
  TAP tables into the `AlertSet` shape (auth-gated; pluggable behind the current
  synthetic generator). Time-windowed / streaming loads.
- **Hover/click**: hit-test to show an event's ID, type, magnitude, and time.
- **Overlay with catalogs**: unify with the survey/catalog overlay controls.
- Longer term: **locally reproduce the simpler detections** (image differencing
  on multi-epoch cubes — depends on items 1, 2, 4).
- **Time filtering**: alerts need a time-window control (slider / range) to show
  only events in a chosen interval — essential once real time-stamped events land
  and for the multi-epoch analysis.

## 7. Higher bit-depth / less-compressed imagery

JPEG HiPS tiles are fine for quick browsing but are 8-bit and already stretched/
clipped (e.g. M31's core is saturated to white at the source — no stretch can
recover it). Add less-compressed / higher-bit-depth options: PNG HiPS where
available, and a FITS path (Rubin SODA `read:image` cutouts / FITS HiPS) that
keeps linear float pixels so real stretch, un-saturated cores, and calibrated
value readouts work. Let the user choose fidelity vs. speed. Overlaps with the
FITS-gated items (flux-accurate stretch, Lupton gri color, real value readout).

## 8. Cross-platform (PC / Mac / iOS / Android)

Short answer: it ALREADY runs on all four — it's a pure client-side web app
(Svelte + Vite, single self-contained `dist/index.html`), so any modern browser
on desktop or mobile loads it today. It is NOT a big project to "support" them;
the work is polish, not a port:
- **Touch/gesture input** — pointer events already cover tap/drag; add
  pinch-to-zoom and momentum, and larger touch targets for the controls.
- **Responsive layout** — the side panel / toolbar / object browser need mobile
  breakpoints (they assume a wide viewport).
- **PWA install** — add a manifest + service worker so it installs to the home
  screen and works offline (pairs with the bundled offline dataset, backlog #1).
- **Optional native shells** — Capacitor or Tauri wrap the same web build into
  App Store / Play Store / signed desktop apps IF store distribution is wanted;
  otherwise unnecessary. No rewrite either way.

## 9. Feature-set review vs. other astronomy viewers

Research the mature viewers — Aladin Lite/Desktop, JS9, DS9, WorldWide Telescope,
ESASky, Firefly (the actual Rubin RSP portal viewer), Legacy Survey viewer — and
compare our feature set + proposed backlog against theirs to find gaps and
best-practices worth adopting. Candidate areas to evaluate: coordinate grids &
compass, WCS-aligned catalog overlays with hover/select, multi-panel & blink,
SAMP/table interop, region files (DS9 regions), colour-composite band mixing,
contour plots, PM/proper-motion & time animation, keyboard-driven navigation,
and sharing/permalink of a view. Output: a prioritized list of additions with
rationale, folded back into this backlog.

## 10. Smart object-type identification from the IMAGE under the cursor

Requested 2026-07-10. Today's click-to-identify (`objects.ts::identifyAt` +
`ObjectInfoPanel`) is a CATALOG LOOKUP — nearest bundled object by position. This
item is the opposite: INFER the object's class + properties FROM THE PIXELS under
the cursor, so it works where the catalog is silent, especially on real Rubin
multi-band (ugrizy) data. Must work on luminance-only imagery AND, better, on
multi-band colour from any survey (Rubin gri/per-band, PanSTARRS, DSS).

Process (explicit user ask): **research → PRD → design-review → implement with
robust, MEASURED testing.** This is exactly the class where a placeholder
classifier ("always galaxy") passes naive tests, so accuracy must be measured
against ground truth, not asserted to exist.

### Target outputs
- **Star vs galaxy vs cluster vs nebula** (coarse class) under the cursor.
- **Galaxy morphology / Hubble type** (elliptical / spiral / irregular; barred?).
- **Cluster kind** (open vs globular) + a crude **age** proxy.
- **Stellar** temperature / spectral-type proxy from colour.
- Each with a **confidence** and the **features it used**, clearly labelled
  "inferred from image" vs "catalog" — never a fabricated certainty.

### Candidate algorithms to research (from most to least classical)
- **Star–galaxy separation**: morphological — compactness vs the local PSF
  (FWHM, concentration, `spread_model`-style), SExtractor `CLASS_STAR`; Rubin's
  own pipeline uses i-band `extendedness`. ML: a small CNN on a cutout.
- **Galaxy morphology**: non-parametric **CAS** (concentration / asymmetry /
  clumpiness), **Gini–M20**, **Sérsic index** fit (n≈4 elliptical, n≈1 disk);
  or a CNN (Galaxy Zoo / Zoobot-style) for Hubble type.
- **Open vs globular cluster**: spatial **density/King profile** + symmetry
  (globulars compact, round, centrally concentrated; open clusters loose,
  irregular) + the **colour–magnitude diagram** shape when member stars resolve.
- **Age**: for a resolved population, **isochrone fitting to the CMD**
  (main-sequence turnoff) — needs multi-band photometry of individual stars;
  for a single unresolved source, **broadband colour** (g−r, r−i) as a coarse
  proxy (bluer = younger/hotter). SED fitting where multi-band available.
- **Stellar temp / type**: colour-index → effective temperature relations.
- Luminance-only fallback: morphology (extent, profile, symmetry) is the only
  signal; be explicit that colour-derived class/age is unavailable without bands.

### Data + honesty
- Real colour now available via the **Rubin per-band DP1 datasets** (multi-filter
  switch, `RUBIN_DATASETS`) and public multi-band surveys — feed the classifier
  cutouts across bands.
- Cross-check / label against **SIMBAD** or the **Rubin Object table (TAP,
  `extendedness`, `*_psfMag`)** for ground-truth types (blocked on the DP0.2→DP1
  `tap.ts` namespace, see the code smell). Show provenance + confidence.

### Robust testing strategy (the load-bearing part)
- **Synthetic ground truth**: extend `syntheticSky.ts` sources to carry a TRUE
  `class` (star / galaxy-by-type / open / globular / nebula) and render class-
  appropriate morphology (a PSF-like star vs an extended Sérsic galaxy vs a
  clustered point-set), so the classifier's output can be scored against the
  KNOWN class per pixel — report an **accuracy / confusion matrix**, not "it ran".
  Adversarial: an "always galaxy" model must FAIL (measured accuracy ≈ prior).
- **Real-object holdout**: a labelled set of catalog objects with SIMBAD types;
  assert star-vs-galaxy and coarse-type accuracy above a stated threshold with a
  confusion matrix, and that confidence correlates with correctness.
- **Invariance checks**: classification stable under the display stretch/colormap
  (must sample pre-colormap / calibrated pixels, like the cross-section does),
  and degrades gracefully (lower confidence) on luminance-only input.
- Wire the result into the existing `ObjectInfoPanel` as an "image-inferred"
  section distinct from the catalog match.
