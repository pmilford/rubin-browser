# CLAUDE.md — Rubin Browser

## MANDATORY: Test rendering by its OUTCOME, never by mocks

**After ANY change to rendering, tiles, canvas, projection, or coordinate
transforms you MUST verify the actual pixels — unit tests with mocks CANNOT
catch rendering failures.** A fully green unit suite means nothing if the canvas
is black, warped, seamed, or panning backwards. `tests/setup.ts` replaces the
canvas 2D context with a no-op mock, so no unit test can ever observe a pixel.

### The four test layers (use the right one)

1. **Geometric invariants** — `tests/unit/projection.test.ts`, pure, no DOM/mocks.
   Round-trip (`canvasToSky(skyToCanvas(p)) === p`), zoom-centering, pan
   direction+magnitude, FOV↔order monotonicity, tile-quad winding. Fast; run on
   every save. `npm run test:geometry`.
2. **Seam / coverage metrics** — `tests/ui/visual-regression.spec.ts`. Quantifies
   uncovered "gap" pixels and thin dark seam-lines; catches the diamond-quilt
   artifact and coverage holes that `percentNonBlack > 5` could not.
3. **Screenshot baseline** — `toHaveScreenshot('viewer-default.png', …)` in the
   same spec. Committed under `tests/ui/__snapshots__/`; fails on any structural
   pixel regression. Regenerate deliberately with `npm run test:visual:update`.
4. **Interaction outcomes** — `tests/ui/interaction-outcomes.spec.ts`. Reads real
   center RA/Dec and samples real canvas pixels: drag direction/magnitude, zoom
   center-preservation, no-black-frame mid-drag, scaling/colormap actually
   repaint. `npm run test:visual` runs layers 2–4.

### Required workflow after ANY rendering change
1. `npm run test:geometry` — must pass (pure, instant).
2. `npm run dev`, then `npm run test:visual` (or `npx playwright test tests/ui/`).
3. If you changed geometry/appearance intentionally, review then update the
   baseline with `npm run test:visual:update` and commit the new snapshot.
4. If a visual/geometric test doesn't exist for what you changed, **write one.**

### What a real visual test asserts (outcomes, not existence)
- ❌ `expect(canvas).toBeAttached()` / `expect(box.width).toBeGreaterThan(100)` —
  DOM/size only.
- ❌ `expect(fovLabel).toContain('22.50')` — a tautology; the label reads the same
  `$state` the test reads, so a black/warped canvas still passes.
- ✅ `getImageData()` shows expected content (gaps below threshold, pixels change
  when a control changes).
- ✅ Read center RA/Dec after a drag and assert the correct **direction and
  magnitude** — not merely "the text changed."
- ✅ Screenshot comparison against the committed baseline.

## Architecture Notes

- Custom canvas-based HiPS viewer — **no Aladin Lite, no OpenSeadragon, no D3,
  no FITS.js** (never real dependencies). Runtime deps are only
  `@hscmap/healpix` and `svelte`.
- `src/api/hips.ts` — HiPS tile URLs/fetch + HEALPix index/center helpers (thin
  wrappers over `@hscmap/healpix`).
- `src/utils/projection.ts` — **pure** gnomonic projection + FOV/order math
  (`skyToCanvas`, `canvasToSky`, `zoomToFov`, `fovToOrder`). Extracted from the
  component so it is unit-testable. Do NOT re-inline this math into the
  component; keep it here with its invariant tests.
- `src/components/ImageViewer.svelte` — canvas rendering; imports `projection.ts`
  and projects each tile's `corners_nest` unit-vectors via triangle affine
  texture mapping. `currentView()` snapshots view `$state` for the pure funcs.
- `src/views/TileViewer.svelte` — page-level view mounted by `src/main.ts`.
- `src/utils/scaling.ts` / `colormap.ts` / `interpolation.ts` — DS9-style
  post-processing.

## HEALPix Notes

HEALPix math comes from the **`@hscmap/healpix`** library — do NOT reimplement
it. The old homegrown, non-invertible implementation was removed; any doc or
comment mentioning "grid search" or "buildTileCenterMap()" is stale.

- `Nside = 2^order` via `order2nside` (wrapped as `orderToNside`).
- `radecToHealpixNest()` wraps `ang2pix_nest` — RA/Dec → NESTED pixel index,
  invertible and O(1).
- `getTileCenter()` wraps `pix2ang_nest` — exact analytic pixel center, O(1). It
  round-trips: `radecToTileIndex(getTileCenter(p), order) === p`. The
  `tileCenterCache` Map is only a memo, not a search.
- Tile corner geometry for drawing comes from `corners_nest(nside, pix)` (in
  `ImageViewer.svelte`), returning corners **[North, West, South, East]**. Do not
  assume a different winding.
- Gotcha: `query_disc_inclusive_nest` requires radius < π/2; at wide FOV enumerate
  pixels at the (low) order instead of calling it.
