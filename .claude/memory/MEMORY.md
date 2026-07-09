# Claude Code Memory — Rubin Browser

## Decisions

- **2026-03-13**: Chose Svelte 5 (runes) over React/Vue for lighter weight.
- **2026-03-13** _(later reversed)_: Originally chose Aladin Lite for sky maps and
  D3 for plots. **Reversed 2026-07-09** — the app is a CUSTOM canvas HiPS viewer;
  Aladin/D3/OpenSeadragon/FITS.js were never actually imported and are removed.
- **2026-03-13** _(later reversed)_: "100% coverage from the start." **Reversed
  2026-07-09** — coverage is a floor (see vitest.config), and real confidence
  comes from the Playwright visual + geometry test layers, not a line count.
- **2026-03-13**: Auth via session-only token storage (no disk persistence). Still true.
- **2026-07-09**: Projection/tiling math extracted to pure `src/utils/projection.ts`
  so pan/zoom/tiling geometry is unit-testable (see project CLAUDE.md test layers).

## Known Issues

- Rubin TAP requires authentication for DP1 data; app degrades to public CDS DSS
  when no/invalid token.
- `tap.ts` builds DP0.2 (`dp02_dc2_catalogs.*`) table names against `/api/dp1`
  endpoints — reconcile when catalog search is wired.
- Time-series/epoch data is MOCK (`src/constants.ts`); SODA cutouts / light curves
  not yet built.
- Diamond tile-seam is a per-tile brightness discontinuity in source JPEGs
  (cosmetic), not a geometry gap.

## Patterns Learned

- Unit tests with a mocked canvas cannot see rendering failures — assert OUTCOMES
  (pixels, pan direction/magnitude, zoom centering) via Playwright + pure geometry
  invariants, never the FOV label text (a tautology).
