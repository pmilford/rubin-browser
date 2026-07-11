/** TAP (Table Access Protocol) client for Rubin Observatory DP1 */

import { getAuthHeader } from './auth.js';
import { toRequestUrl } from './rspProxy.js';
import { fetchWithRetry } from './rateLimit.js';
import { parseVotable } from './votable.js';
import type { TapQueryResult, ColumnDef } from '../types/catalog.js';

// The Rubin RSP TAP service (DP1 catalogs live in the `dp1` SCHEMA, queried via
// ADQL — `dp1` is NOT a URL path segment). Verified against the DP1 docs
// (dp1.lsst.io TAP tutorials) and rsp.lsst.io: the sync endpoint is /api/tap/sync.
// The earlier /api/dp1 path is an unregistered route, so data.lsst.cloud served
// the RSP portal SPA HTML back — which surfaced as a light-curve/TAP "error".
const TAP_BASE = 'https://data.lsst.cloud/api/tap';

export interface TapOptions {
  maxRec?: number;
  asyncTimeout?: number; // ms, for async queries
}

/**
 * Execute a synchronous TAP query and return name-keyed rows.
 *
 * VALIDATED AGAINST THE LIVE SERVICE (data.lsst.cloud, an authenticated DP1
 * account, 2026-07): the RSP `/api/tap/sync` endpoint ALWAYS responds with a
 * VOTable (`application/x-votable+xml; serialization=binary2`) and returns an
 * EMPTY body for `FORMAT=json` — JSON output is not supported. We therefore parse
 * VOTable (see votable.ts), never JSON. `RESPONSEFORMAT` is honoured over the
 * legacy `FORMAT`; we send both, but the service returns binary2 regardless.
 */
export async function query(
  adql: string,
  options: TapOptions = {}
): Promise<TapQueryResult> {
  const { maxRec = 10000 } = options;

  const body = new URLSearchParams({
    REQUEST: 'doQuery',
    QUERY: adql,
    LANG: 'ADQL',
    // The RSP always serialises binary2; send the standard params for correctness.
    RESPONSEFORMAT: 'votable',
    FORMAT: 'votable',
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

  const text = await resp.text();
  // An empty body (the classic symptom of an unauthenticated / no-data-rights
  // session, or a wrong endpoint) is surfaced honestly rather than as a cryptic
  // XML-parse failure.
  if (!text.trim()) {
    throw new Error(
      'TAP returned an empty response body (HTTP 200). This usually means the ' +
        'session lacks DP1 data rights or the request hit the wrong endpoint — ' +
        'sign in with an RSP token that has DP1 access.'
    );
  }
  // If the RSP portal SPA HTML came back (wrong route / not authenticated), say so.
  const head = text.slice(0, 200).toLowerCase();
  if (head.includes('<!doctype html') || head.includes('<html')) {
    throw new Error(
      'TAP returned HTML instead of a VOTable — the request likely hit the wrong ' +
        'endpoint or was not authenticated (check the RSP token).'
    );
  }

  const vot = parseVotable(text);
  return {
    status: vot.status === 'OVERFLOW' ? 'overflow' : 'completed',
    rowCount: vot.rows.length,
    columns: vot.fields.map(
      (f): ColumnDef => ({ name: f.name, datatype: f.datatype, unit: f.unit })
    ),
    rows: vot.rows,
  };
}

/**
 * Submit an async TAP query (for large result sets) and return name-keyed rows.
 * The async result is likewise a VOTable (see {@link query}); parsed via votable.ts.
 */
export async function queryAsync(
  adql: string,
  options: TapOptions = {}
): Promise<TapQueryResult> {
  // Submit job
  const submitResp = await fetch(toRequestUrl(`${TAP_BASE}/async`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...getAuthHeader(),
    },
    body: new URLSearchParams({
      REQUEST: 'doQuery',
      QUERY: adql,
      LANG: 'ADQL',
      RESPONSEFORMAT: 'votable',
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
      const vot = parseVotable(await resultResp.text());
      return {
        status: vot.status === 'OVERFLOW' ? 'overflow' : 'completed',
        rowCount: vot.rows.length,
        columns: vot.fields.map((f): ColumnDef => ({ name: f.name, datatype: f.datatype, unit: f.unit })),
        rows: vot.rows,
      };
    }

    if (phase === 'ERROR') {
      throw new Error('Async TAP query failed');
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error('Async TAP query timed out');
}
