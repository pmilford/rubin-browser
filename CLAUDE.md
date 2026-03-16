# CLAUDE.md — Rubin Browser

## MANDATORY: Visual Tests Are Required

**You MUST run Playwright visual tests against the live dev server after EVERY change to rendering, tiles, canvas, or coordinate transforms.**

Unit tests with mocks CANNOT catch rendering failures. Passing 906 unit tests means nothing if the canvas is black.

### Required workflow after ANY rendering change:

1. Start the dev server: `npm run dev`
2. Run Playwright tests: `npx playwright test tests/ui/`
3. **Take actual screenshots** and verify canvas pixels contain data:
   ```bash
   npx playwright test --grep "canvas.*rendered"
   ```
4. If a visual regression test doesn't exist for what you changed, **write one**

### Visual test requirements:
- Tests must verify **OUTCOMES** (image rendered, non-black pixels), not just element existence
- Canvas must have non-zero dimensions AND non-trivial pixel data
- Tile loading must be verified (network requests succeed, no 404s for core tiles)
- Screenshots should be saved to `tests/ui/screenshots/` for comparison

### What "visual test" means:
- ❌ NOT: `expect(canvas).toBeAttached()` — this only checks DOM
- ❌ NOT: `expect(box.width).toBeGreaterThan(100)` — this checks size, not content
- ✅ YES: `canvas.toDataURL()` returns non-trivial image data
- ✅ YES: Screenshot comparison against known-good reference
- ✅ YES: Pixel sampling shows expected color ranges (stars = bright, background = dark)

## Architecture Notes

- Custom canvas-based HiPS viewer (no Aladin Lite, no OpenSeadragon)
- `src/api/hips.ts` — tile fetching, HEALPix indexing, tile center computation
- `src/components/ImageViewer.svelte` — main canvas rendering
- `src/utils/scaling.js` — image scaling algorithms
- `src/utils/colormap.js` — color mapping

## HEALPix Gotchas

- `radecToHealpixNest()` uses Math.floor + clamping → **non-invertible**
- Never assume a closed-form inverse exists; use `getTileCenter()` which uses precomputed grid search
- Tile centers are cached per order via `buildTileCenterMap()`
