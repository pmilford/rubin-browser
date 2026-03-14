# Architecture Overview

## System Design

```
┌─────────────────────────────────────────────────┐
│                  Browser UI                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Sky Map  │ │ Catalog  │ │  Object/Galaxy   │ │
│  │ (Aladin) │ │  Search  │ │    Viewer        │ │
│  └────┬─────┘ └────┬─────┘ └───────┬──────────┘ │
│       │            │               │             │
│  ┌────┴────────────┴───────────────┴──────────┐ │
│  │            State Store (Svelte)            │ │
│  └────────────────────┬──────────────────────┘ │
└───────────────────────┼─────────────────────────┘
                        │
┌───────────────────────┼─────────────────────────┐
│               API Layer                         │
│  ┌──────────┐ ┌──────┴───┐ ┌──────────────────┐ │
│  │  TAP     │ │  HiPS    │ │   Image Cutouts  │ │
│  │ Client   │ │ Client   │ │   (SODA) Client  │ │
│  └────┬─────┘ └────┬─────┘ └───────┬──────────┘ │
└───────┼────────────┼───────────────┼─────────────┘
        │            │               │
┌───────┼────────────┼───────────────┼─────────────┐
│       │   Rubin Science Platform   │             │
│  ┌────┴─────┐ ┌────┴─────┐ ┌──────┴──────────┐ │
│  │ TAP API  │ │ HiPS API │ │   SODA API      │ │
│  │ DP1      │ │ /api/hips│ │                 │ │
│  └──────────┘ └──────────┘ └─────────────────┘ │
│              data.lsst.cloud                    │
└─────────────────────────────────────────────────┘
```

## Module Responsibilities

### `src/api/`
- **tap.ts** — TAP service client (ADQL queries, async jobs)
- **hips.ts** — HiPS tile access for sky visualization
- **soda.ts** — Image cutout and mosaic requests
- **auth.ts** — RSP token management

### `src/components/`
- **SkyMap.svelte** — Aladin Lite wrapper for sky browsing
- **SearchPanel.svelte** — Query builder for catalog searches
- **ResultsTable.svelte** — Paginated table for catalog results
- **LightCurve.svelte** — D3-based time series plot
- **ColorMagnitude.svelte** — CMD diagram
- **ImageViewer.svelte** — FITS image display with DS9-style controls
- **GalaxyStack.svelte** — Stacked galaxy cutout viewer

### `src/views/`
- **Dashboard.svelte** — Main landing page
- **SkyView.svelte** — Full sky map explorer
- **ObjectView.svelte** — Single object detail page
- **GalaxyView.svelte** — Galaxy analysis with cutouts + time series
- **SearchView.svelte** — Catalog search interface

### `src/types/`
- **catalog.ts** — Types for TAP table results
- **image.ts** — Types for FITS/HiPS image data
- **timeseries.ts** — Types for photometric time series

## Data Flow

1. **User enters RSP token** → stored in session (never persisted to disk)
2. **User searches sky/map** → HiPS tiles loaded directly from data.lsst.cloud
3. **User queries catalog** → ADQL sent to TAP endpoint → results in VOTable/JSON
4. **User clicks object** → metadata + photometry loaded → light curve rendered
5. **User requests cutout** → SODA request for FITS cutout → displayed in viewer

## Authentication

- RSP tokens from data.lsst.cloud tokens page
- Token sent as `Authorization: Bearer <token>` header
- Tokens expire — UI shows expiry and re-auth prompt
- No token storage on disk (session only)

## Testing Strategy

### Unit Tests (`tests/unit/`)
- API client functions with mocked responses
- Component rendering with testing-library
- Utility functions (coordinate transforms, ADQL builders)
- Target: 100% coverage

### Regression Tests (`tests/regression/`)
- Use downloaded fixture data in `tests/fixtures/`
- Verify parsing of real VOTable responses
- Verify image rendering with real HiPS tile data
- Compare output against known-good baselines

### UI Tests (`tests/ui/`)
- Playwright browser tests
- Full user flows: login → search → view object → download cutout
- Screenshot comparison for visual regression

## Dependencies

| Library | Purpose | Alternative |
|---------|---------|-------------|
| Aladin Lite | Sky visualization | OpenLayers (less astro-specific) |
| D3.js | Charts | Chart.js (simpler but less flexible) |
| Svelte | UI | React/Vue (heavier) |
| pyvo (server) | TAP client | Custom fetch (more work) |

## Future Considerations

- **FITS.js** — Client-side FITS parsing for cutout display
- **WebGL** — GPU-accelerated image rendering for large cutouts
- **Service Worker** — Offline caching of HiPS tiles
- **Export** — VOTable/CSV/FITS download of query results
