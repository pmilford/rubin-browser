# Rubin Browser — Longer-term Backlog

Larger research/engineering items deferred from day-to-day work. Smaller known
gaps (DP0.2/DP1 namespace mismatch, wiring the mock filter/epoch controls, real
TAP catalog search, the per-tile brightness seam) are tracked in code comments
and the project CLAUDE.md.

## 1. Synthetic multi-time / multi-tile / multi-wavelength data source

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
