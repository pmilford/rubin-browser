# Architecture Overview

## System Design

Rubin Browser is a single-page Svelte 5 app that renders HiPS survey imagery to
an HTML canvas using its own tiling/projection pipeline. There is **no** Aladin
Lite, OpenSeadragon, or D3 — the viewer is custom code.

```
┌─────────────────────────────────────────────────┐
│                  Browser UI (Svelte 5)           │
│  ┌───────────────────────────────────────────┐  │
│  │  TileViewer.svelte (view + app state)     │  │
│  │   ├─ CompactToolbar (search, zoom, 🔑)    │  │
│  │   ├─ SidePanel (display / filters /       │  │
│  │   │   surveys / time-series / blink)      │  │
│  │   ├─ ImageViewer.svelte (canvas HiPS)     │  │
│  │   ├─ ObjectBrowser (local catalog)        │  │
│  │   ├─ ColorBar / StatusBar                 │  │
│  │   └─ TokenDialog / HelpModal              │  │
│  └───────────────────┬───────────────────────┘  │
└──────────────────────┼───────────────────────────┘
                       │
┌──────────────────────┼───────────────────────────┐
│               API Layer (src/api)                 │
│  ┌──────────┐ ┌──────┴───┐ ┌──────────────────┐  │
│  │  hips.ts │ │  auth.ts │ │      tap.ts      │  │
│  │  tiles   │ │  token   │ │ (client only,    │  │
│  │          │ │          │ │  no UI yet)      │  │
│  └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
└───────┼────────────┼────────────────┼────────────┘
        │            │                │
┌───────┼────────────┼────────────────┼────────────┐
│   HiPS tiles   RSP token        DP1 TAP (token)   │
│   data.lsst.cloud  /  alasky.cds.unistra.fr (DSS) │
└───────────────────────────────────────────────────┘
```

## Module Responsibilities

### `src/api/`
- **hips.ts** — HiPS tile URL building, tile fetching, HEALPix NESTED tile
  indexing, and tile-center geometry
- **auth.ts** — RSP token management (session storage, expiry parsing, validation)
- **tap.ts** — TAP/ADQL client (sync + async). Library code only — no catalog
  search UI is wired up yet.

> There is no `soda.ts` / SODA cutout client. SODA is planned, not implemented.

### `src/components/`
- **ImageViewer.svelte** — Custom canvas HiPS renderer: tile loading, gnomonic
  projection, pan/zoom, post-processing, survey overlays, FOV minimap
- **CompactToolbar.svelte** — Always-visible toolbar (search, zoom, invert,
  fullscreen, help, 🔑 token)
- **Toolbar.svelte** — Alternate/fuller toolbar variant
- **SidePanel.svelte** — Collapsible panel hosting the control sections
- **FilterSelector.svelte** — Single-band + RGB-composite selector (UI present;
  per-band imagery not yet wired to the viewer)
- **SurveySelector.svelte** — Add/remove public HiPS overlays with opacity
- **TimeSlider.svelte** / **BlinkController.svelte** — Epoch scrubbing and blink
  over **mock** epochs
- **Histogram.svelte** — Canvas-drawn pixel-value histogram / stretch controls
- **PixelReadout.svelte** — RA/Dec + pixel value under the cursor
- **WcsOverlay.svelte** — Coordinate grid, N/E indicator, scale bar
- **ColorBar.svelte** / **StatusBar.svelte** — Colormap legend and status line
- **ObjectBrowser.svelte** — Browse/jump to objects from the local catalog
- **TokenDialog.svelte** — RSP token entry / validate / clear
- **HelpModal.svelte** — Keyboard-shortcut help

### `src/views/`
- **TileViewer.svelte** — The single top-level view; composes all components and
  owns app state

### `src/data/`
- **objects.ts** — Bundled local catalog (Messier, bright stars, galaxies,
  nebulae, clusters) used by the Object Browser and name search

### `src/utils/`
- **scaling.ts** — Intensity scaling functions
- **colormap.ts** — Color-map lookup
- **interpolation.ts** — Pixel interpolation kernels

### `src/types/`
- **catalog.ts** — Types for TAP table results
- **image.ts** — Types for HiPS/image data, viewer + epoch state

### `src/constants.ts`
- LSST filter definitions, public survey-overlay definitions, and the **mock**
  epoch generator (`generateMockEpochs` / `DEFAULT_MOCK_EPOCHS`)

## Coordinate & Tile Math

- RA/Dec are handled in **degrees** at the boundary.
- Tile indexing uses **HEALPix NESTED** ordering via `@hscmap/healpix`
  (`ang2pix_nest` / `pix2ang_nest` / `corners_nest`) to map a sky position to a
  HiPS `Norder`/`Npix` tile and to recover tile-corner geometry.
- The viewer projects sky coordinates to canvas pixels with a **gnomonic**
  (tangent-plane) projection centered on the current view.

See `SCALING_RESEARCH.md` at the repo root for background on the tiling/scaling
work.

## Data Flow

1. **App loads** → viewer renders public DSS HiPS (no token needed).
2. **User enters RSP token** (🔑 dialog) → stored in `sessionStorage` → viewer
   switches to Rubin HiPS while the token is valid.
3. **User pans/zooms or searches** → visible HEALPix tiles are computed and
   fetched, projected to canvas, and post-processed (scaling/colormap/invert).
4. **User adds a survey overlay** → its public HiPS is drawn over the base image
   at the chosen opacity.

## Authentication

- RSP tokens are obtained from data.lsst.cloud (username menu → Security Tokens →
  Create Token; scopes `read:image`, `read:tap`).
- The token is sent as `Authorization: Bearer <token>`.
- Tokens are held in `sessionStorage` only (never persisted to disk); expiry is
  parsed from the JWT when present.

## Testing Strategy

### Unit Tests (`tests/unit/`)
- API client functions with mocked responses
- Utility functions (scaling, colormap, interpolation, HEALPix helpers)
- Component structure with testing-library

### Regression Tests (`tests/regression/`)
- Fixture data in `tests/fixtures/`
- Verify parsing of real responses and rendering behavior

### UI Tests (`tests/ui/`)
- Playwright browser tests that verify **outcomes** (canvas has rendered pixels,
  controls change the image, no error overlays) — not just element existence

## Dependencies

| Library | Purpose |
|---------|---------|
| Svelte 5 | UI framework (runes) |
| Vite | Build / dev server |
| @hscmap/healpix | HEALPix NESTED indexing + tile-corner geometry |
| TypeScript | Types |
| Vitest | Unit / regression tests |
| Playwright | E2E / UI tests |

## Future Considerations

- TAP catalog-search UI on top of the existing `tap.ts` client
- SODA image cutouts
- Real per-band imagery and RGB composites
- Real DP1 time-series (replacing mock epochs)
- Object photometry / light curves and galaxy analysis
- WebGL-accelerated rendering; service-worker tile caching
