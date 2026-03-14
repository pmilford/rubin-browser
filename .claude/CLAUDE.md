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

## Visual Testing (MANDATORY)

Unit tests with mocks CANNOT catch rendering failures. We learned this the hard way.

**Required test layers:**
1. **Unit tests** (Vitest) — logic, pure functions, type guards, component structure
2. **UI smoke tests** (Playwright against live dev server) — MUST verify:
   - No error overlays visible during normal operation
   - Canvas/image elements have non-zero rendered content
   - Controls actually change the display (not just that buttons exist)
   - Navigation (search, object browser) works without errors
   - No console errors during typical user flows

**Key lesson:** Tests that only check `element exists` are nearly useless for visual apps. Tests must verify *outcomes* (image rendered, no error overlay, content changed).

## Testing Philosophy (CRITICAL LESSON)

**Unit tests with mocks CANNOT catch visual/rendering failures.** We learned this the hard way multiple times.

The ONLY way to verify a visual application works is to:
1. Start the actual dev server
2. Open a real browser (Playwright)
3. Verify actual rendered content (canvas pixels, visible elements, computed styles)
4. Interact with the UI and verify OUTCOMES change

**Every bug that made it to production passed unit tests.** The unit tests verified:
- DOM elements exist ✓
- Event handlers are registered ✓
- Functions return correct values ✓

But they did NOT verify:
- Images actually render ✗
- Tiles load from the network ✗
- Canvas has non-zero pixel content ✗
- Controls change the display ✗
- No error overlays appear ✗

### Mandatory Testing Protocol

Before ANY commit that changes viewer/UI code:
1. `npm run dev` — start the server
2. `npm run test:ui` — run Playwright visual tests (auto-starts server)
3. Verify: no error overlays, canvas renders, controls work

If Playwright tests fail, THE CODE IS BROKEN regardless of what unit tests say.
