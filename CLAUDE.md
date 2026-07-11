# CLAUDE.md — Rubin Browser

## MANDATORY: Research the API/tool BEFORE coding against it

A whole cluster of bugs here shared ONE root cause — **guessing an external API
instead of reading its docs**: the wrong TAP endpoint (`/api/dp1` vs
`/api/tap/sync`), the UWS 303-redirect CORS failure, a guessed SODA cutout
endpoint, `ForcedSource` cone-searched by coordinates (Rubin requires querying by
`objectId`), a "dangerous" `ORDER BY … TOP` on `DiaSource`, opaque `gt-` tokens
treated as JWTs, no `429`/`Retry-After` handling, and — the biggest — **the whole
TAP client requesting `FORMAT=json` and calling `resp.json()` when the RSP TAP
service only ever returns VOTable `binary2` (and an EMPTY body for `FORMAT=json`)**,
which broke Rubin Objects, light curves, DIA alerts, and cutout discovery at once.
Every one was avoidable by reading the docs / probing the real endpoint first.
**The process, not the individual bug, is what matters.**

Before writing (or substantially changing) any client for an external API,
service, library, or tool:

1. **Read the authoritative docs first** — official tutorials, the schema /
   reference, IVOA/format standards, and where limits live, the service's own
   source or deployed config. Do NOT infer an endpoint, query pattern, or auth
   model from naming conventions or from "what parses."
2. **VALIDATE against the REAL endpoint from the app's origin — a MOCK IS NOT
   VALIDATION.** A mocked test proves your parser handles the shape *you invented*;
   it proves NOTHING about reachability, CORS, redirects, auth, or whether the real
   response shape matches. The Gaia overlay shipped fully broken in the browser for
   ages because every test mocked the ESA endpoint: (a) ESA sends no
   `Access-Control-Allow-Origin` → CORS-blocked ("Failed to fetch"); (b) the CORS
   mirror returns column descriptors under `columns`, not ESA's `metadata`. Both
   were invisible to the mock. So before wiring: `curl -H "Origin: <app-origin>"`
   the endpoint and confirm the status, the `Access-Control-Allow-Origin` header,
   any redirect `Location`, the auth behaviour, and the ACTUAL response field/column
   names. Prefer a CORS-enabled endpoint (or a proxy) over a browser-blocked host.
3. **Capture** the correct endpoint, auth scopes, the *recommended* access pattern
   (not merely one that returns data), rate limits + backoff, redirect/async
   behaviour, and any documented **anti-patterns**.
4. **Fold those findings into the spec's data-flow + failure-modes** (below), and
   **encode the REAL response shape as a regression fixture** (a verbatim slice of
   the live response, not a hand-invented mock), then code.

### A path you CANNOT validate against the real service is NOT done — it is PROVISIONAL

This is the rule that was missing. Every Rubin TAP feature (Objects, light curves,
DIA, cutout discovery) shipped "DONE (CI-unverified, token-gated)" and was in fact
**broken end-to-end** — because it was only ever run against a hand-invented JSON
mock. "Done with a caveat" let a wrong response-shape assumption ride for a whole
session. So:

- **Never mark a real-service path DONE, and never write a mock that INVENTS a
  response shape, without a captured real response.** If you cannot obtain one
  (no token / no access), the client is **PROVISIONAL/UNVALIDATED** — say so plainly
  in the status and the code, do NOT claim it works, and prefer a shape derived from
  the service's published schema/spec over an imagined one. A hand-invented mock is
  worse than no test: it manufactures false confidence.
- **When access DOES become available (e.g. the user provides a token), the FIRST
  action is to run the real path and reconcile — before any new work.** Probe the
  endpoint (`curl` with the token: status, content-type, the ACTUAL body), capture a
  verbatim fixture, and fix whatever the mock hid. `npm run test:live`
  (`RSP_TOKEN=… `, see `tests/ui/live-dp1-token.spec.ts`) is the standing gate for
  the token-gated DP1 UI paths; run it whenever a token is in hand.
- **Assume nothing about a response format from a sibling service.** JSON output is
  common (Gaia/GAVO) but is NOT universal: the RSP CADC TAP returns **VOTable
  `binary2` only** and an empty body for `FORMAT=json`. Confirm content-type + the
  first bytes of the REAL body before choosing `resp.json()` vs `resp.text()`.

Rubin/IVOA specifics and per-API limits are recorded in `docs/rubin-api-usage.md`
— read it before touching `src/api/*`, and keep it current when you learn more.

## MANDATORY: Design review before coding (non-trivial features)

Most bugs caught by the user here were "obvious in hindsight" — a reflected tile,
a readout wired to zeros, a swallowed error, a redundant dropdown. They share one
cause: **intent/failure-mode gaps that tests missed because the tests checked
self-consistency, not correctness.** To stop that class, before writing code for
anything beyond a trivial fix:

1. Write a short **spec**: intent · data flow (input → output) · failure modes ·
   verification plan (the falsifiable tests). A few lines, not a document.
2. Run the **`design-review` subagent** (Agent tool, `subagent_type: design-review`)
   on that spec + the relevant files. It hunts placeholder/hardcoded values,
   unwired components, silent failures, and tests that cannot fail.
3. Resolve its BLOCKERS, fold its MUST-TEST assertions into the plan, THEN code.

Trivial one-liners skip the spec. When in doubt, spec it.

### Failure-mode checklist (apply to every user-facing change)
For each external dependency, ask **"what does the user SEE when this fails?"** —
failure must be visible, never silent:
- Network 404 / timeout   - Invalid / expired / missing auth token
- Empty or zero result     - Saturated / clipped source data (8-bit JPEG!)
- Off-screen / degenerate geometry   - Default/unset value mistaken for real data

### Adversarial test rule
For every test you write, answer: **"what broken version of this feature still
passes this test?"** If a reflected / hardcoded / silent / backwards
implementation passes, the test is worthless — assert an OUTCOME against ground
truth or a known-correct reference, not existence or self-consistency. Then
actually drive the running app and LOOK — proactively, not only when a bug is
reported.

## MANDATORY: Test rendering by its OUTCOME, never by mocks

**After ANY change to rendering, tiles, canvas, projection, or coordinate
transforms you MUST verify the actual pixels — unit tests with mocks CANNOT
catch rendering failures.** A fully green unit suite means nothing if the canvas
is black, warped, seamed, or panning backwards. `tests/setup.ts` replaces the
canvas 2D context with a no-op mock, so no unit test can ever observe a pixel.

### The four test layers (use the right one)

1. **Geometric invariants** — `tests/unit/projection.test.ts`, pure, no DOM/mocks.
   Round-trip (`canvasToSky(skyToCanvas(p)) === p`), zoom-centering, pan
   direction+magnitude, FOV↔order monotonicity, tile-quad winding. Fast; run on
   every save. `npm run test:geometry`.
2. **Seam / coverage metrics** — `tests/ui/visual-regression.spec.ts`. Quantifies
   uncovered "gap" pixels and thin dark seam-lines; catches the diamond-quilt
   artifact and coverage holes that `percentNonBlack > 5` could not.
3. **Screenshot baseline** — `toHaveScreenshot('viewer-default.png', …)` in the
   same spec. Committed under `tests/ui/__snapshots__/`; fails on any structural
   pixel regression. Regenerate deliberately with `npm run test:visual:update`.
4. **Interaction outcomes** — `tests/ui/interaction-outcomes.spec.ts`. Reads real
   center RA/Dec and samples real canvas pixels: drag direction/magnitude, zoom
   center-preservation, no-black-frame mid-drag, scaling/colormap actually
   repaint. `npm run test:visual` runs layers 2–4.

### Required workflow after ANY rendering change
1. `npm run test:geometry` — must pass (pure, instant).
2. `npm run dev`, then `npm run test:visual` (or `npx playwright test tests/ui/`).
3. If you changed geometry/appearance intentionally, review then update the
   baseline with `npm run test:visual:update` and commit the new snapshot.
4. If a visual/geometric test doesn't exist for what you changed, **write one.**

### What a real visual test asserts (outcomes, not existence)
- ❌ `expect(canvas).toBeAttached()` / `expect(box.width).toBeGreaterThan(100)` —
  DOM/size only.
- ❌ `expect(fovLabel).toContain('22.50')` — a tautology; the label reads the same
  `$state` the test reads, so a black/warped canvas still passes.
- ✅ `getImageData()` shows expected content (gaps below threshold, pixels change
  when a control changes).
- ✅ Read center RA/Dec after a drag and assert the correct **direction and
  magnitude** — not merely "the text changed."
- ✅ Screenshot comparison against the committed baseline.

## Architecture Notes

- Custom canvas-based HiPS viewer — **no Aladin Lite, no OpenSeadragon, no D3,
  no FITS.js** (never real dependencies). Runtime deps are only
  `@hscmap/healpix` and `svelte`.
- `src/api/hips.ts` — HiPS tile URLs/fetch + HEALPix index/center helpers (thin
  wrappers over `@hscmap/healpix`).
- `src/utils/projection.ts` — **pure** gnomonic projection + FOV/order math
  (`skyToCanvas`, `canvasToSky`, `zoomToFov`, `fovToOrder`). Extracted from the
  component so it is unit-testable. Do NOT re-inline this math into the
  component; keep it here with its invariant tests.
- `src/components/ImageViewer.svelte` — canvas rendering; imports `projection.ts`
  and projects each tile's `corners_nest` unit-vectors via triangle affine
  texture mapping. `currentView()` snapshots view `$state` for the pure funcs.
- `src/views/TileViewer.svelte` — page-level view mounted by `src/main.ts`.
- `src/utils/scaling.ts` / `colormap.ts` / `interpolation.ts` — DS9-style
  post-processing.

## HEALPix Notes

HEALPix math comes from the **`@hscmap/healpix`** library — do NOT reimplement
it. The old homegrown, non-invertible implementation was removed; any doc or
comment mentioning "grid search" or "buildTileCenterMap()" is stale.

- `Nside = 2^order` via `order2nside` (wrapped as `orderToNside`).
- `radecToHealpixNest()` wraps `ang2pix_nest` — RA/Dec → NESTED pixel index,
  invertible and O(1).
- `getTileCenter()` wraps `pix2ang_nest` — exact analytic pixel center, O(1). It
  round-trips: `radecToTileIndex(getTileCenter(p), order) === p`. The
  `tileCenterCache` Map is only a memo, not a search.
- Tile corner geometry for drawing comes from `corners_nest(nside, pix)` (in
  `ImageViewer.svelte`), returning corners **[North, West, South, East]**. Do not
  assume a different winding.
- Gotcha: `query_disc_inclusive_nest` requires radius < π/2; at wide FOV enumerate
  pixels at the (low) order instead of calling it.
