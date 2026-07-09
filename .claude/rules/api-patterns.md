# API Layer Rules

## Location

All Rubin API clients live in `src/api/`. One file per service:
- `auth.ts` — RSP token management (single source of truth for auth)
- `hips.ts` — HiPS image tiles + HEALPix helpers (wrappers over @hscmap/healpix)
- `tap.ts`  — TAP catalog queries (sync + async)

Planned, not yet present: a SODA cutout client (`soda.ts`). Do not import it
until it exists.

## Authentication

Always use the auth module:

```typescript
import { getAuthHeader } from './auth.js';

const resp = await fetch(url, {
  headers: { ...getAuthHeader() },
});
```

Never hardcode tokens. Never pass tokens as function parameters — the auth module is the single source of truth.

## Error Handling

API functions should throw descriptive errors:

```typescript
if (!resp.ok) {
  const text = await resp.text();
  throw new Error(`TAP query failed (${resp.status}): ${text}`);
}
```

Let callers catch and handle. Don't return error objects.

## Return Types

Always return typed results, never raw responses:

```typescript
// Good
export async function query(adql: string): Promise<TapQueryResult> { ... }

// Bad
export async function query(adql: string): Promise<Response> { ... }
```

## Coordinate Convention

- Internal: always degrees (RA 0-360, Dec -90 to +90)
- Convert arcsec → degrees at API boundary (e.g., cone search radius)
- Store and display using degrees

## ADQL Query Building

Use helper functions — don't build ADQL with string concatenation in components:

```typescript
// Good
const adql = buildConeSearch({ ra: 62, dec: -37, radius: 10, catalog: 'Object' });

// Bad
const adql = `SELECT * FROM Object WHERE CONTAINS(...)`;
```

This prevents SQL injection and keeps query logic testable.

> Note: `buildConeSearch` currently prefixes tables as `dp02_dc2_catalogs.*`
> (DP0.2) while the endpoint is `/api/dp1`. Reconcile the catalog namespace with
> the intended DP1 tables when wiring up real catalog search.
