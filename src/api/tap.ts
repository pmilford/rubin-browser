/** TAP (Table Access Protocol) client for Rubin Observatory DP1 */

import { getAuthHeader } from './auth.js';
import { toRequestUrl } from './rspProxy.js';
import { fetchWithRetry } from './rateLimit.js';
import type { TapQueryResult, ColumnDef } from '../types/catalog.js';

// The Rubin RSP TAP service (DP1 catalogs live in the `dp1` SCHEMA, queried via
// ADQL — `dp1` is NOT a URL path segment). Verified against the DP1 docs
// (dp1.lsst.io TAP tutorials) and rsp.lsst.io: the sync endpoint is /api/tap/sync.
// The earlier /api/dp1 path is an unregistered route, so data.lsst.cloud served
// the RSP portal SPA HTML back — which surfaced as a light-curve/TAP "error".
const TAP_BASE = 'https://data.lsst.cloud/api/tap';

export interface TapOptions {
  format?: 'json' | 'votable' | 'csv';
  maxRec?: number;
  asyncTimeout?: number; // ms, for async queries
}

/** Execute a synchronous TAP query */
export async function query(
  adql: string,
  options: TapOptions = {}
): Promise<TapQueryResult> {
  const { format = 'json', maxRec = 10000 } = options;

  const body = new URLSearchParams({
    QUERY: adql,
    LANG: 'ADQL',
    FORMAT: format,
    MAXREC: String(maxRec),
  });

  // Retry on 429 (rate limited) / 503, honouring Retry-After — the RSP enforces
  // per-user quotas and replies 429 rather than failing outright.
  const resp = await fetchWithRetry(toRequestUrl(`${TAP_BASE}/sync`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...getAuthHeader(),
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`TAP query failed (${resp.status}): ${text}`);
  }

  if (format === 'json') {
    // A 200 that isn't JSON means we hit the wrong route (the RSP portal SPA
    // returns HTML for unregistered paths) or the session isn't authenticated —
    // surface that honestly instead of a cryptic JSON.parse "Unexpected token <".
    const contentType = resp.headers?.get?.('content-type') ?? '';
    if (contentType && !contentType.includes('json')) {
      const text = await resp.text();
      throw new Error(
        `TAP returned a non-JSON response (content-type: ${contentType || 'unknown'}). ` +
          'The request likely hit the wrong endpoint or was not authenticated. ' +
          `First bytes: ${text.slice(0, 100).replace(/\s+/g, ' ').trim()}…`
      );
    }
    // A 200 with an EMPTY body makes resp.json() throw "Unexpected end of JSON
    // input" — surfaced live on the light-curve path. Turn that (and any
    // unparseable body) into an honest, actionable message instead.
    let json: unknown;
    try {
      json = await resp.json();
    } catch (err) {
      throw new Error(
        `TAP returned an empty or unparseable JSON body (HTTP ${resp.status}). ` +
          'This usually means the query returned nothing or the session lacks ' +
          'DP1 data rights — sign in with an RSP token that has DP1 access.',
        { cause: err }
      );
    }
    return parseJsonResponse(json);
  }

  // For VOTable/CSV, return raw text as single column
  const text = await resp.text();
  return {
    status: 'completed',
    rowCount: 0,
    columns: [{ name: 'raw', datatype: 'string' }],
    rows: [{ raw: text }],
  };
}

/** Submit an async TAP query (for large result sets) */
export async function queryAsync(
  adql: string,
  options: TapOptions = {}
): Promise<TapQueryResult> {
  const { format = 'json' } = options;

  // Submit job
  const submitResp = await fetch(toRequestUrl(`${TAP_BASE}/async`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...getAuthHeader(),
    },
    body: new URLSearchParams({
      QUERY: adql,
      LANG: 'ADQL',
      FORMAT: format,
      MAXREC: '0', // no limit for async
    }).toString(),
  });

  if (!submitResp.ok) {
    throw new Error(`Async TAP submit failed (${submitResp.status})`);
  }

  const jobUrl = submitResp.headers.get('Location');
  if (!jobUrl) throw new Error('No job location returned');

  // Poll for completion
  const timeout = options.asyncTimeout ?? 300000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const statusResp = await fetch(toRequestUrl(`${jobUrl}/phase`), {
      headers: getAuthHeader(),
    });
    const phase = (await statusResp.text()).trim();

    if (phase === 'COMPLETED') {
      const resultResp = await fetch(toRequestUrl(`${jobUrl}/results/result`), {
        headers: getAuthHeader(),
      });
      if (format === 'json') {
        return parseJsonResponse(await resultResp.json());
      }
      const text = await resultResp.text();
      return {
        status: 'completed',
        rowCount: 0,
        columns: [{ name: 'raw', datatype: 'string' }],
        rows: [{ raw: text }],
      };
    }

    if (phase === 'ERROR') {
      throw new Error('Async TAP query failed');
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error('Async TAP query timed out');
}

/** Parse VOTable JSON response into TapQueryResult */
function parseJsonResponse(data: unknown): TapQueryResult {
  // Rubin TAP returns VOTable-like JSON
  const obj = data as Record<string, unknown>;
  const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
  const rawColumns = (metadata.fields ?? []) as Record<string, string>[];
  const rawRows = (obj.data ?? obj.rows ?? []) as Record<string, unknown>[];

  const columns: ColumnDef[] = rawColumns.map((f) => ({
    name: f.name ?? f.ID ?? 'unknown',
    datatype: f.datatype ?? 'string',
    unit: f.unit,
    description: f.description,
  }));

  return {
    status: 'completed',
    rowCount: rawRows.length,
    columns,
    rows: rawRows,
  };
}
