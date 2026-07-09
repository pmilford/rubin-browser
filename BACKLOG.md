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
