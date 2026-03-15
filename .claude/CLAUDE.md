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

## Coverage Requirements (MANDATORY)

Every code change MUST maintain or improve test coverage:
- **Statements**: ≥ 95%
- **Branches**: ≥ 95%
- **Functions**: ≥ 95%
- **Lines**: ≥ 95%

When adding new code:
1. Write unit tests alongside the implementation
2. Add UI tests (Playwright) for any user-visible behavior
3. Add interface tests for any new TypeScript types/guards
4. Run `npm run test:coverage` and verify thresholds are met before committing
5. Do NOT lower coverage thresholds to pass — write more tests instead

## Documentation Requirements (MANDATORY)

When adding new features or making significant changes:
1. Update `README.md` — keep the feature list, quick start, and architecture sections current
2. Update `docs/architecture/` — add or update design docs for new subsystems
3. Update component JSDoc comments — document props, events, and public methods
4. Update type docstrings — explain fields and constraints
5. If adding a new API endpoint integration, document it in `docs/architecture/`

## Don't

- Don't use `any` type without a comment explaining why
- Don't commit test fixtures over 1MB
- Don't bypass the auth module for API calls
- Don't use Svelte 4 patterns (use Svelte 5 runes: `$state`, `$derived`, `$effect`)
- Don't skip tests — fix them or update them
- Don't merge code below 95% coverage
- Don't add features without updating documentation

## Live UI Testing (MANDATORY — CRITICAL LESSON)

**Unit tests with mocks CANNOT catch visual/rendering failures.** We learned this multiple times.

### What Got Through Unit Tests But Broke in Production
- Image loading failed (wrong tile URLs) — mock returned fake data, never hit real network
- Controls did nothing (scaling/colormap) — mock accepted props but never verified canvas changed
- Pan/zoom broken — mock verified handlers existed, never verified tiles loaded
- Error overlays shown — mock never triggered real error conditions

### Why Mocks Fail Here
- Mocks verify *implementation* (function called, prop set)
- Visual apps need verification of *outcomes* (canvas has pixels, image changed, no errors)
- Network failures, WASM loading, CORS, canvas rendering — all invisible to mocks

### Required Test Architecture
1. **Unit tests** (Vitest, `npm test`): Pure functions, type guards, component structure. Fast, run on every save.
2. **Full live UI tests** (Playwright, `npm run test:ui`): Real browser, real server, real network. Catches everything mocks miss.

### What Playwright Tests MUST Verify (Outcomes, Not Existence)
- Canvas has non-zero dimensions AND rendered pixel content
- No error overlays (`[role="alert"]`) during normal operation
- Changing a control (scaling, colormap) actually changes canvas pixels
- Navigating to new coordinates loads different tiles
- Zoom in/out changes the FOV value display
- Pan/drag keeps image visible (no black screen during drag)
- Survey overlays render on top of base image
- Fullscreen mode works without layout breakage
- No critical console errors during typical user flows

### Playwright Test Pattern
```typescript
// ❌ WRONG — only checks element exists
await expect(page.locator('canvas')).toBeAttached();

// ✅ RIGHT — checks actual rendered dimensions
const box = await canvas.boundingBox();
expect(box!.width).toBeGreaterThan(200);

// ❌ WRONG — only clicks a button
await page.locator('#scaling-select').selectOption('log');

// ✅ RIGHT — verifies outcome after click
await page.locator('#scaling-select').selectOption('log');
await page.waitForTimeout(500);
const errorOverlay = page.locator('[role="alert"]');
expect(await errorOverlay.isVisible()).toBe(false);
```

### Mandatory Protocol
1. `npm run test:ui` before EVERY commit that touches viewer/UI code
2. If Playwright tests fail, THE CODE IS BROKEN — fix it, regardless of unit test results
3. Add new Playwright tests for every new user-facing feature
4. Run `npm run test:ui` against the live dev server (Playwright auto-starts it)

## Visual Testing Checkpoint (What Missed)

These bugs made it past all tests. Add these checks to Playwright:

- **Pan direction**: Drag right → RA should increase. Verify with `canvasToSky()` before/after drag
- **Zoom centering**: Zoom in → center sky point unchanged. Test with `expect(centerRa).toBeCloseTo(beforeRa)`
- **Scaling changes pixels**: Change scaling → canvas ImageData should differ. Compare `getImageData()` before/after
- **Minimap interactive**: Click minimap → view should pan. Test with position change assertion
- **Side panel position**: Verify `getComputedStyle(el).left` is small, not `right`
- **Survey selector nesting**: Verify dropdown is directly accessible, not nested 3 levels deep
- **Real target navigation**: Search "M31" → should resolve and navigate. Verify position changes.
