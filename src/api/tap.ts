/** TAP (Table Access Protocol) client for Rubin Observatory DP1 */

import { getAuthHeader } from './auth.js';
import type { TapQueryResult, ColumnDef, ConeSearchParams } from '../types/catalog.js';

const TAP_BASE = 'https://data.lsst.cloud/api/dp1';

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

  const resp = await fetch(`${TAP_BASE}/sync`, {
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
    return parseJsonResponse(await resp.json());
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
  const submitResp = await fetch(`${TAP_BASE}/async`, {
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
    const statusResp = await fetch(`${jobUrl}/phase`, {
      headers: getAuthHeader(),
    });
    const phase = (await statusResp.text()).trim();

    if (phase === 'COMPLETED') {
      const resultResp = await fetch(`${jobUrl}/results/result`, {
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

/** Build a cone search ADQL query */
export function buildConeSearch(params: ConeSearchParams): string {
  const { ra, dec, radius, catalog, maxRecords = 1000 } = params;
  const table = `dp02_dc2_catalogs.${catalog}`;
  const radiusDeg = radius / 3600; // arcsec to degrees

  return `
    SELECT TOP ${maxRecords} *
    FROM ${table}
    WHERE CONTAINS(
      POINT('ICRS', coord_ra, coord_dec),
      CIRCLE('ICRS', ${ra}, ${dec}, ${radiusDeg})
    ) = 1
    ORDER BY dist
  `.trim();
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
