# Rubin Browser 🔭

A web browser for Vera Rubin Observatory (LSST) public data products.

Rubin Browser is a custom, canvas-based HiPS sky viewer built with Svelte 5. It
renders progressive HiPS survey imagery directly to an HTML canvas (no Aladin
Lite, no OpenSeadragon), with DS9-style post-processing controls, survey
overlays, an object browser, and a token-gated path to Rubin Science Platform
data.

## Project Status

**Early / work in progress.** What exists today:

- ✅ UI shell + custom canvas HiPS viewer (pan / zoom / reset)
- ✅ Tile indexing, projection, pan/zoom recently rebuilt on HEALPix NESTED math
  (`@hscmap/healpix`) with gnomonic projection to the canvas
- ✅ Scaling / colormap / invert / interpolation post-processing
- ✅ Survey overlay UI (public CDS HiPS), FOV minimap, pixel readout, WCS grid
- ✅ Object browser backed by a small **local** catalog (`src/data/objects.ts`)
- ✅ RSP token entry dialog (🔑 in the toolbar); falls back to public DSS preview
- ⚠️ Time-series / blink / epochs are **mock data** (`src/constants.ts`)
- ⚠️ Filter / RGB-composite selectors are present in the UI but do not yet load
  per-band imagery (the base viewer currently loads a single color survey)
- ❌ TAP catalog search UI, SODA cutouts, light curves, galaxy stacking are
  **not yet implemented** (see [Planned](#planned--not-yet-implemented))

## Features

### Implemented

- **Custom HiPS Sky Viewer** — Canvas-based progressive HiPS tile rendering with
  gnomonic projection, HEALPix NESTED tile indexing, and smooth pan/zoom
- **Image Post-Processing** — Intensity scaling (linear, log, sqrt, asinh, sinh,
  mtf, histogram, zscale, percentile), color maps (grayscale, viridis, plasma,
  inferno, hot, cool), invert, and interpolation (nearest, bilinear, bicubic,
  lanczos)
- **Survey Overlays** — Add/remove public CDS HiPS layers (Gaia DR3, DSS2 Color,
  2MASS J, WISE, PanSTARRS DR1) with per-layer opacity
- **FOV Minimap** — All-sky position indicator; click/drag to reposition
- **Object Browser** — Browse and jump to objects from a bundled local catalog
  (Messier, bright stars, popular galaxies, nebulae, clusters)
- **Coordinate & Name Search** — Enter `RA, Dec` (degrees or sexagesimal) or an
  object name (e.g. `M42`) to navigate
- **Pixel Readout** — RA/Dec and pixel value under the cursor
- **WCS Grid Overlay** — Coordinate grid, N/E indicator, and scale bar
- **Authentication** — RSP token entry dialog stored for the browser session;
  without a token the app uses public DSS preview imagery

### Partially implemented (mock / UI-only)

- **Time-Series Navigation & Blink** — Epoch slider and blink controls operate on
  **mock** epochs generated in `src/constants.ts` (`generateMockEpochs`), not
  real DP1 observations
- **Filter / RGB Composite** — Selectors exist in the UI but band-specific
  imagery is not yet wired to the viewer

### Planned / not yet implemented

- **TAP Catalog Search** — A TAP/ADQL client exists (`src/api/tap.ts`) but there
  is no catalog-search UI (query builder / results table) yet
- **SODA Image Cutouts** — Not implemented (no SODA client)
- **Object Photometry & Light Curves** — Not implemented
- **Galaxy Analysis / Stacking** — Not implemented

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:5173`. Out of the box the viewer shows public DSS
preview imagery from CDS — no login required.

### Authenticated Rubin data (optional)

To reach Rubin Science Platform HiPS/TAP you need an RSP token:

1. Click the **🔑** button in the toolbar to open the token dialog.
2. Paste your RSP token and click **Save** (optionally **Validate** first).
3. The viewer switches to Rubin HiPS while the token is valid for the session.

**How to get a token:** log in at
[data.lsst.cloud](https://data.lsst.cloud), open your **username menu →
Security Tokens → Create Token** with scopes `read:image` and `read:tap`, then
copy the token. Access to Rubin DP1 data requires an account with data rights;
without one, only the public DSS/CDS HiPS preview works.

Tokens are held in `sessionStorage` only (never written to disk) and are sent as
an `Authorization: Bearer <token>` header.

## Architecture

See [docs/architecture/](docs/architecture/) for detailed design documentation.

## Testing

```bash
npm test              # All unit tests (Vitest)
npm run test:coverage # With coverage report
npm run test:regression # Regression tests with fixture data
npm run test:ui       # Playwright browser tests
```

## Data Sources

| Source | Endpoint | Auth |
|--------|----------|------|
| Rubin DP1 TAP | `https://data.lsst.cloud/api/dp1/{sync,async}` | Token |
| Rubin HiPS Images | `https://data.lsst.cloud/api/hips/` | Token |
| Public HiPS preview (DSS) | `https://alasky.cds.unistra.fr/DSS/DSSColor` | None |

The survey-overlay HiPS sources listed in `src/constants.ts` (Gaia DR3, DSS2,
2MASS, WISE, PanSTARRS, served from CDS/alasky) are public and need no token.
Rubin HiPS and TAP require an RSP token as described above.

## Tech Stack

- **Svelte 5** — UI framework (runes mode)
- **Vite** — Build tool and dev server
- **TypeScript** — Type safety
- **@hscmap/healpix** — HEALPix NESTED tile indexing and tile-corner geometry
- **HTML Canvas 2D** — Custom HiPS tile rendering (no Aladin Lite / OpenSeadragon / D3)
- **Vitest** — Unit / regression testing
- **Playwright** — E2E / UI testing

## License

MIT
