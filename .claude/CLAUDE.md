# Rubin Browser — Claude Code Instructions

## Project Overview

A custom, canvas-based HiPS sky viewer for Vera Rubin Observatory (LSST) public
data. It renders progressive HiPS survey imagery directly to an HTML canvas with
DS9-style post-processing, survey overlays, an object browser, and a token-gated
path to Rubin Science Platform (RSP) data. Catalog search, cutouts, and light
curves are planned, not yet built.

## Build & Test

```bash
npm install            # Install dependencies
npm run dev            # Dev server (localhost:5173)
npm test               # Unit tests (Vitest)
npm run test:geometry  # Pure projection/tiling invariants (fast, no DOM)
npm run test:coverage  # Unit tests with coverage report
npm run test:ui        # Full Playwright browser suite
npm run test:visual    # Visual-regression + seam + interaction-outcome specs
npm run test:visual:update  # Regenerate committed screenshot baselines
npm run lint           # ESLint (flat config)
npm run build          # Production build
```

## Architecture (actual stack)

- **Svelte 5** — runes mode only (`$state`, `$derived`, `$effect`, `$props`). No
  Svelte 4 reactivity.
- **Vite** — build tool and dev server.
- **TypeScript** — strict; prefer no `any` without a justifying comment.
- **@hscmap/healpix** — HEALPix NESTED indexing + tile-corner geometry. Do not
  reimplement HEALPix.
- **HTML Canvas 2D** — custom HiPS tile rendering. **No Aladin Lite, no
  OpenSeadragon, no D3, no FITS.js** (those were never real dependencies).
- **Vitest** — unit / geometry tests. **Playwright** — browser / visual tests.

Runtime dependencies are only `@hscmap/healpix` and `svelte`; everything else is
dev tooling. Check `package.json` before claiming a library is available.

## Code Organization

```
src/
├── api/          # Rubin API clients: auth.ts, hips.ts, tap.ts (no SODA yet)
├── components/   # Reusable Svelte components (ImageViewer, Toolbar, etc.)
├── views/        # Page-level components (TileViewer.svelte, mounted by main.ts)
├── types/        # TypeScript interfaces and types
├── utils/        # Pure functions: projection.ts, scaling, colormap, interpolation
├── data/         # Bundled local object catalog (objects.ts)
└── constants.ts  # Survey defs + MOCK epoch generation
```

`src/utils/projection.ts` holds the pure gnomonic-projection + FOV/order math
(`skyToCanvas`, `canvasToSky`, `zoomToFov`, `fovToOrder`). It was extracted from
`ImageViewer.svelte` specifically so pan/zoom/tiling geometry is unit-testable.
Keep this math here — do not re-inline it into the component.

## Rubin Data Access

> **Read the docs before coding against these.** The endpoints, quotas, scopes,
> the *recommended* access patterns, and documented anti-patterns for every RSP/
> IVOA API are captured in `docs/rubin-api-usage.md` (with source URLs). Consult
> it — and the primary docs (dp1.lsst.io, the IVOA standards, the service source)
> — before touching `src/api/*`. Guessing an endpoint/query/auth model from
> naming was the root cause of this project's biggest bug cluster. See the root
> CLAUDE.md "MANDATORY: Research the API/tool BEFORE coding against it."

- **TAP (sync)**: `https://data.lsst.cloud/api/tap/sync` (POST, ADQL). NOTE: `dp1`
  is the SCHEMA (`FROM dp1.Object`), NOT a URL path — the old `/api/dp1/sync` is an
  unregistered route and returned the RSP portal SPA HTML. Verified: dp1.lsst.io.
- **TAP (async)**: `https://data.lsst.cloud/api/tap/async`
- **HiPS tiles**: `https://data.lsst.cloud/api/hips/` (default `images/color_gri`)
- **Auth**: RSP token, `Authorization: Bearer <token>`, held in `sessionStorage`.
- **Public fallback**: with no/invalid token the viewer degrades to public CDS
  DSS imagery (`https://alasky.cds.unistra.fr/DSS/DSSColor`) — no login. Survey
  overlays (Gaia DR3, DSS2, 2MASS, WISE, PanSTARRS) are public CDS HiPS.

Target data is **DP1** (requires an RSP account with data rights; the developer
may not have it — never make DP1 access a hard requirement). KNOWN CODE SMELL:
`tap.ts` builds table names as `dp02_dc2_catalogs.*` (DP0.2) while endpoints are
`/api/dp1/*`, and `auth.validateToken` hits `/api/dp1/query` (vs `/sync`).
Reconcile the catalog namespace + endpoint when catalog search is actually wired.

## Process: design review before coding (MANDATORY)

Non-trivial features start with a short spec (intent · data flow · failure modes ·
falsifiable tests) reviewed by the `design-review` subagent BEFORE any code — it
catches the "obvious" class (hardcoded/placeholder values, unwired components,
silent failures, tests that can't fail). Then apply the failure-mode checklist
("what does the user SEE when this fails?") and the adversarial test rule ("what
broken version still passes this test?"). See the root CLAUDE.md for the full
process. Trivial one-liners skip the spec.

## Testing Philosophy (MANDATORY)

The mandate is **meaningful visual/interaction coverage, not a line-count
target.** Do not pad coverage with mocks that assert nothing about outcomes. The
project CLAUDE.md (repo root) documents the four test layers — read it before
touching rendering.

- Rendering/geometry changes REQUIRE a passing `npm run test:geometry` AND a
  Playwright visual/interaction test that asserts an outcome (pixels, direction,
  center-preservation), not just "the label changed."
- Coverage floor lives in `vitest.config` (recalibrated for @vitest/coverage-v8
  v4: ~statements 80, lines 79, functions 78, branches 71). Pure `src/*.ts` files
  are 90–100%; the gap is untested Svelte event handlers. Keep coverage AT OR
  ABOVE the configured thresholds and ratchet them UP as real coverage improves —
  never lower them to sneak a commit past.
- A green unit suite does NOT certify the viewer works. See "Live UI Testing".

## Coding Standards

- Descriptive names, single responsibility, no magic numbers.
- Coordinates: always degrees internally (RA 0–360, Dec −90..+90); convert
  arcsec → degrees at the API boundary.
- API clients: return typed results, never raw `Response`; throw descriptive
  errors and let component boundaries catch them.
- Never bypass the auth module; never hardcode tokens.

## Key Patterns

- **Projection/tiling geometry**: import from `src/utils/projection.ts`; it is
  pure and invariant-tested. `ImageViewer` passes `currentView()`.
- **HEALPix**: use the `hips.ts` wrappers over `@hscmap/healpix`; invertible, O(1).
- **TAP queries**: use `buildConeSearch()` / helpers in `src/api/tap.ts`.
- **Auth**: call `getAuthHeader()` from `src/api/auth.ts`.
- **State**: Svelte 5 runes for component state; stores for shared app state.

## Documentation

When adding features or changing subsystems, keep current: `README.md`,
`docs/architecture/`, component prop/event JSDoc, and type docstrings.

## Don't

- Don't claim/import libraries not in `package.json` (no Aladin/D3/FITS.js).
- Don't reimplement HEALPix — use `@hscmap/healpix` via `hips.ts`.
- Don't re-inline the projection math into the component.
- Don't use `any` without a justifying comment; don't use Svelte 4 patterns.
- Don't lower coverage thresholds to pass; write real outcome tests.
- Don't ship a rendering change without passing geometry + visual tests.
- Don't make DP1 access a hard requirement — always keep the public DSS fallback.

## Live UI Testing (CRITICAL LESSON)

**Unit tests with mocks CANNOT catch visual/rendering failures.** We learned
this repeatedly (black canvas, wrong tile URLs, dead controls, backwards pan).

### What got through unit tests but broke live
- Image loading failed (wrong tile URLs) — mock returned fake data, never hit
  real network (e.g. `.jpeg` vs `.jpg` extension 404s).
- Controls did nothing (scaling/colormap) — mock accepted props, never checked
  the canvas changed.
- Pan/zoom broken — mock verified handlers existed, never verified tiles loaded
  or that pan went the right direction (e.g. `query_disc_inclusive_nest` throwing
  at wide FOV → black screen).

### Why mocks fail here
Mocks verify *implementation* (function called, prop set). Visual apps need
verification of *outcomes* (canvas has pixels, image changed the right way, no
errors). Network failures, CORS, canvas rendering — invisible to mocks.

### Required test architecture
1. **Unit / geometry** (`npm test`, `npm run test:geometry`): pure functions,
   type guards, projection invariants. Fast, every save.
2. **Live UI** (`npm run test:ui` / `npm run test:visual`): real browser, server,
   network, pixels. Catches what mocks miss.

### Mandatory protocol
1. `npm run test:geometry` then `npm run test:visual` before EVERY commit that
   touches viewer/UI/projection code.
2. If a visual/geometry test fails, THE CODE IS BROKEN — fix it regardless of
   unit results.
3. Add an outcome test for every new user-facing behavior.

## Visual Testing Checkpoint (bugs that slipped past all tests before)
- **Pan direction/magnitude**: drag right → center RA decreases by ~(dx·fov/W)/cos(dec).
- **Zoom centering**: zoom in → center sky point unchanged.
- **Scaling/colormap change pixels**: fingerprint `getImageData()` before/after.
- **No black frame mid-drag**: old tiles stay painted while the pointer is down.
- **Tile winding**: all visible tile quads wind the same way, non-degenerate area.
- **Seams/gaps**: gap-pixel ratio and dark seam-line ratio stay below threshold.
- **Name navigation**: search "M31"/"M42" → resolves and position changes.
