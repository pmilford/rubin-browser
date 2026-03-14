# Rubin Browser 🔭

A web browser for Vera Rubin Observatory (LSST) public data products.

## Features

- **Sky Map Viewer** — Browse HiPS survey images via Aladin Lite
- **Catalog Search** — TAP/ADQL queries on DP1 catalogs
- **Object Browser** — View individual objects with photometry, light curves
- **Galaxy Analysis** — Extracted image cutouts with time series and stacking
- **Time Series** — Interactive light curve plots
- **Authentication** — RSP token-based access for full data

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:5173`. Enter your RSP token from [data.lsst.cloud](https://data.lsst.cloud) for authenticated access.

## Architecture

See [docs/architecture/](docs/architecture/) for detailed design documentation.

## Testing

```bash
npm test              # All unit tests
npm run test:coverage # With coverage report
npm run test:regression # Regression tests with real data
npm run test:ui       # Playwright browser tests
```

## Data Sources

| Source | Endpoint | Auth |
|--------|----------|------|
| DP1 TAP | `https://data.lsst.cloud/api/dp1/query` | Token |
| HiPS Images | `https://data.lsst.cloud/api/hips/` | None* |
| Portal | `https://data.lsst.cloud` | Login |

*HiPS tiles may work without auth for preview; full access requires token.

## Tech Stack

- **Svelte 5** — UI framework
- **Vite** — Build tool
- **Aladin Lite** — Sky visualization
- **D3.js** — Charts (light curves, color-magnitude)
- **Vitest** — Unit/regression testing
- **Playwright** — E2E/UI testing
- **TypeScript** — Type safety

## License

MIT
