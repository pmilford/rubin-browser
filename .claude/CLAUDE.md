# Rubin Browser — Claude Code Instructions

## Project Overview

A web browser for Vera Rubin Observatory (LSST) public data: sky maps, catalog search, object inspection, galaxy analysis with cutouts and time series.

## Build & Test

```bash
npm install          # Install dependencies
npm run dev          # Dev server (localhost:5173)
npm test             # Run all unit tests
npm run test:coverage # Tests with coverage report (target: 100%)
npm run test:regression # Regression tests with fixture data
npm run test:ui      # Playwright E2E tests
npm run build        # Production build
```

## Architecture

- **Svelte 5** — UI framework (runes mode, not legacy reactivity)
- **Vite** — Build tool and dev server
- **TypeScript** — Strict mode, no `any` without justification
- **Aladin Lite** — Sky map visualization (loaded as ES module)
- **D3.js** — Charts (light curves, color-magnitude diagrams)
- **Vitest** — Unit and regression tests (100% coverage required)
- **Playwright** — Browser E2E tests

## Code Organization

```
src/
├── api/          # Rubin API clients (TAP, HiPS, SODA, auth)
├── components/   # Reusable Svelte components
├── views/        # Page-level Svelte components
├── types/        # TypeScript interfaces and types
└── utils/        # Pure functions (coordinate transforms, ADQL builders)
```

## Rubin Data Access

- **TAP endpoint**: `https://data.lsst.cloud/api/dp1/sync` (POST, ADQL queries)
- **Async TAP**: `https://data.lsst.cloud/api/dp1/async` (large queries)
- **HiPS tiles**: `https://data.lsst.cloud/api/hips/`
- **Auth**: RSP token via `Authorization: Bearer <token>` header
- **DP1 catalog**: `dp02_dc2_catalogs.Object` (primary object table)

## TDD Workflow

1. Write a failing test first in `tests/unit/`
2. Implement the minimum code to pass
3. Refactor while keeping tests green
4. Run `npm run test:coverage` — must hit 100%
5. Commit with descriptive message

## Coding Standards

- Functions: descriptive names, single responsibility
- No magic numbers — use named constants
- Coordinate handling: always degrees (convert arcsec at boundary)
- Error handling: throw descriptive errors, catch at component boundary
- API clients: return typed results, never raw responses

## Key Patterns

- **TAP queries**: Use `buildConeSearch()` / `buildAdql()` helpers in `src/api/tap.ts`
- **Auth**: Call `getAuthHeader()` from `src/api/auth.ts` — never hardcode tokens
- **State**: Svelte stores for app state, local state for component UI
- **Images**: Aladin for sky maps, FITS.js for cutout rendering

## Don't

- Don't use `any` type without a comment explaining why
- Don't commit test fixtures over 1MB
- Don't bypass the auth module for API calls
- Don't use Svelte 4 patterns (use Svelte 5 runes: `$state`, `$derived`, `$effect`)
- Don't skip tests — fix them or update them
