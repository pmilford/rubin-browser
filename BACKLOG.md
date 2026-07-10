# Rubin Browser — Longer-term Backlog

Larger research/engineering items deferred from day-to-day work. Smaller known
gaps (DP0.2/DP1 namespace mismatch, wiring the mock filter/epoch controls, real
TAP catalog search, the per-tile brightness seam) are tracked in code comments
and the project CLAUDE.md.

> STATUS (2026-07-09): #1 generator DONE (`src/data/syntheticSky.ts`), #3
> cross-section DONE (MVP single trace), #5 zoom perf DONE (ancestor preview +
> memoization + fetch coalescing; LRU cap + allsky preview still open), and an
> in-app **Offline demo** base layer now renders the generator's tiles with no
> network (`src/data/offlineDataset.ts`). Remaining sub-items noted inline below.

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
