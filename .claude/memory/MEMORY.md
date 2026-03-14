# Claude Code Memory — Rubin Browser

## Decisions

- **2026-03-13**: Chose Svelte 5 over React/Vue for lighter weight
- **2026-03-13**: Chose Aladin Lite for sky maps (best astro library)
- **2026-03-13**: Chose D3 over Chart.js for flexibility with astronomical plots
- **2026-03-13**: 100% unit test coverage required from the start
- **2026-03-13**: Auth via session-only token storage (no disk persistence)

## Known Issues

- Rubin TAP requires authentication for DP1 data
- HiPS tiles may or may not work without auth (test needed)
- FITS.js needs investigation for browser compatibility

## Patterns Learned

_(Claude will add entries here as it discovers project-specific patterns)_
