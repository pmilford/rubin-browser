/**
 * Bailer-Jones (EDR3) geometric + photogeometric DISTANCE for a star near a sky
 * position, from the CORS-enabled GAVO Heidelberg TAP mirror.
 *
 * WHY GAVO (same rationale as {@link ./gaia.ts}): the parallax→distance inversion
 * is NOT 1/parallax for faint/distant stars — Bailer-Jones et al. (2021) publish a
 * Bayesian posterior (median + 16th/84th percentile bounds) per Gaia EDR3 source.
 * GAVO's DaCHS mirror ships that catalog PRE-JOINED to the position/photometry in
 * ONE table, `gedr3dist.litewithdist`, and — unlike the ESA archive — sends an
 * `Access-Control-Allow-Origin` header, so a browser fetch works with no proxy.
 *
 * Endpoint + protocol (IVOA TAP sync, GAVO/DaCHS) — VALIDATED LIVE 2026-07 with an
 * `Origin: http://localhost:5173` header (HTTP 200; `Access-Control-Allow-Origin`
 * reflects the Origin; column descriptors under the `columns` key; `source_id`
 * datatype `char` via the text cast):
 *   POST https://dc.zah.uni-heidelberg.de/tap/sync
 *   form params: REQUEST=doQuery, LANG=ADQL, FORMAT=json, QUERY=<adql>
 *   response JSON shape: { columns: [{ name, datatype, ... }], data: [[...], ...] }
 *   (columns are addressed BY name — never by positional index.)
 *
 * `source_id` is selected as TEXT (`source_id || ''`, {@link SOURCE_ID_AS_TEXT}) so
 * the 64-bit id arrives as a JSON string and survives `JSON.parse` intact — see the
 * long note in `gaia.ts`; a bare 64-bit number is rounded at the wire boundary.
 *
 * Table + columns (validated against the LIVE GAVO `gedr3dist.litewithdist`):
 *   - `source_id` (text), `ra`, `dec` (deg, ICRS J2016.0), `phot_g_mean_mag` (mag),
 *   - distances in PARSECS: `r_med_geo` / `r_lo_geo` / `r_hi_geo` (geometric) and
 *     `r_med_photogeo` / `r_lo_photogeo` / `r_hi_photogeo` (photogeometric). The
 *     lo/hi are the 16th/84th posterior percentiles — an ASYMMETRIC interval, so
 *     they are kept separately (never collapsed to a single ± error).
 *
 * All coordinates are DEGREES throughout (ICRS). This is an OPEN service — like
 * `gaia.ts` it deliberately attaches NO Rubin RSP token.
 */

import { GAIA_TAP_SYNC_URL, SOURCE_ID_AS_TEXT } from './gaia.js';
import { angularSeparation } from '../utils/skyGeom.js';

/** The GAVO Bailer-Jones-distances table (EDR3 distances pre-joined to dr3lite). */
export const GAIA_DIST_TABLE = 'gedr3dist.litewithdist';

/** Default row cap for a distance cone query (a click-scale cone is tiny). */
export const GAIA_DIST_DEFAULT_MAX_ROWS = 64;

export interface GaiaDistanceConeParams {
  /** Right ascension of the cone centre, degrees (ICRS). */
  ra: number;
  /** Declination of the cone centre, degrees (ICRS). */
  dec: number;
  /** Cone-search radius in DEGREES (convert arcsec→deg at the API boundary). */
  radiusDeg: number;
  /** Row cap for the query. Default {@link GAIA_DIST_DEFAULT_MAX_ROWS}. */
  maxRows?: number;
}

/**
 * A Bailer-Jones distance posterior summary in PARSECS: the posterior median plus
 * the 16th (`lo`) and 84th (`hi`) percentile bounds. The interval is ASYMMETRIC —
 * `med - lo` need not equal `hi - med`. Any component may be NaN when the catalog
 * did not publish that estimate for the source (photogeometric is absent more
 * often than geometric).
 */
export interface DistancePosteriorPc {
  /** Posterior median distance, parsecs (NaN if not published). */
  med: number;
  /** 16th-percentile lower bound, parsecs (NaN if not published). */
  lo: number;
  /** 84th-percentile upper bound, parsecs (NaN if not published). */
  hi: number;
}

/** One row of the distance catalog: position, G magnitude, and both posteriors. */
export interface GaiaDistanceRow {
  /** Gaia (E)DR3 source id, preserved as an exact decimal string (64-bit safe). */
  sourceId: string;
  /** ICRS right ascension, degrees, normalised to [0,360). */
  ra: number;
  /** ICRS declination, degrees. */
  dec: number;
  /** Mean G-band magnitude (NaN if missing). */
  gMag: number;
  /** Geometric distance posterior (uses parallax + sky position only). */
  distGeoPc: DistancePosteriorPc;
  /** Photogeometric distance posterior (also folds in G mag + colour prior). */
  distPhotoGeoPc: DistancePosteriorPc;
}

/**
 * The single NEAREST source to a query position, with its angular offset and both
 * distance posteriors. Returned by {@link fetchNearestGaiaDistance}; `null` there
 * means the cone was empty (a legitimate answer, not an error).
 */
export interface NearestGaiaDistance {
  sourceId: string;
  ra: number;
  dec: number;
  /** Angular separation from the QUERY position to this source, ARCSECONDS. */
  separationArcsec: number;
  gMag: number;
  distGeoPc: DistancePosteriorPc;
  distPhotoGeoPc: DistancePosteriorPc;
}

export interface FetchNearestGaiaDistanceParams {
  /** Right ascension of the query position, degrees (ICRS). */
  ra: number;
  /** Declination of the query position, degrees (ICRS). */
  dec: number;
  /** Search radius in ARCSECONDS (a click-scale match; converted to deg internally). */
  radiusArcsec: number;
  /** Row cap for the underlying cone query. Default {@link GAIA_DIST_DEFAULT_MAX_ROWS}. */
  maxRows?: number;
}

/* -------------------------------------------------------------------------- */
/* ADQL construction                                                          */
/* -------------------------------------------------------------------------- */

/** Guard a coordinate/number: reject NaN/Infinity so nothing unsafe is interpolated. */
function finiteNumber(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected a finite number, got ${String(value)}`);
  }
  return value;
}

/**
 * Format a number for ADQL without scientific notation (some ADQL parsers reject
 * `1e-7`). Normal magnitudes stringify cleanly; only extreme values are expanded.
 */
function formatNum(value: number): string {
  const s = String(value);
  if (!/e/i.test(s)) return s;
  return value.toFixed(12);
}

/**
 * Build a cone-search ADQL query for Bailer-Jones distances around a sky position.
 *
 * Selects `source_id` (as TEXT via {@link SOURCE_ID_AS_TEXT}), `ra`, `dec`,
 * `phot_g_mean_mag`, and the six distance columns (geometric + photogeometric med/
 * lo/hi, in parsecs) from `gedr3dist.litewithdist`. Radius is DEGREES (TAP CIRCLE
 * wants degrees) and ra/dec/radius are finite-checked, so nothing user-controlled
 * is interpolated as an un-vetted string. No ORDER BY — the caller ranks by real
 * angular separation ({@link fetchNearestGaiaDistance}) rather than trusting a
 * server sort.
 */
export function buildGaiaDistanceConeAdql(params: GaiaDistanceConeParams): string {
  const raDeg = finiteNumber(params.ra, 'ra');
  const decDeg = finiteNumber(params.dec, 'dec');
  const radius = finiteNumber(params.radiusDeg, 'radiusDeg');
  if (radius <= 0) {
    throw new Error(`Invalid radiusDeg: must be > 0, got ${radius}`);
  }
  const top = Math.max(
    1,
    Math.floor(finiteNumber(params.maxRows ?? GAIA_DIST_DEFAULT_MAX_ROWS, 'maxRows'))
  );

  const raStr = formatNum(raDeg);
  const decStr = formatNum(decDeg);
  const radiusStr = formatNum(radius);

  return `SELECT TOP ${top}
  ${SOURCE_ID_AS_TEXT}, ra, dec,
  phot_g_mean_mag,
  r_med_geo, r_lo_geo, r_hi_geo,
  r_med_photogeo, r_lo_photogeo, r_hi_photogeo
FROM ${GAIA_DIST_TABLE}
WHERE CONTAINS(
  POINT('ICRS', ra, dec),
  CIRCLE('ICRS', ${raStr}, ${decStr}, ${radiusStr})
) = 1`;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/** Coerce a raw cell to a finite float, mapping null/missing/non-numeric → NaN. */
function toFloat(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return NaN;
}

/** Normalise RA into [0,360) — matches the overlay/index convention. */
function normalizeRa(ra: number): number {
  if (!Number.isFinite(ra)) return ra;
  return ((ra % 360) + 360) % 360;
}

/**
 * Parse a GAVO `gedr3dist.litewithdist` TAP JSON response
 * ({ columns:[{name}], data:[[...]] }) into typed {@link GaiaDistanceRow}s.
 * Columns are located BY name (the SELECT order is NOT assumed), so a re-ordered
 * descriptor array still maps every value to the right field.
 *
 * Honesty / failure modes:
 *   - Missing/empty/non-array column descriptors → THROWS (a real result always
 *     describes its columns; an empty-descriptor body is malformed, not empty).
 *   - Missing `ra`/`dec` descriptor → THROWS (a positional catalog with no position
 *     is a schema mismatch, not something to silently fill with NaN).
 *   - `data: []` with valid descriptors → a VALID empty array, NOT a throw.
 *   - null / missing numeric cells → NaN (Bailer-Jones leaves photogeometric null
 *     for some sources — that is real, not an error, and must never read as 0).
 *   - `source_id` preserved as the exact decimal STRING received (64-bit safe).
 */
export function parseGaiaDistances(raw: unknown): GaiaDistanceRow[] {
  if (!raw || typeof raw !== 'object') {
    throw new Error('parseGaiaDistances: expected a Gaia TAP JSON object with columns/data');
  }
  const obj = raw as Record<string, unknown>;
  // GAVO/DaCHS puts descriptors under `columns`; ESA VOTable-JSON uses `metadata`.
  // Accept either so the parser survives a mirror swap (verified: GAVO → `columns`).
  const descriptors = Array.isArray(obj.columns) ? obj.columns : obj.metadata;
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    throw new Error(
      'parseGaiaDistances: malformed response — missing or empty column descriptors ' +
        '(`columns`/`metadata`; cannot map columns by name)'
    );
  }

  const colIndex = new Map<string, number>();
  descriptors.forEach((field, i) => {
    const name =
      field && typeof field === 'object'
        ? ((field as Record<string, unknown>).name ?? (field as Record<string, unknown>).ID)
        : undefined;
    if (typeof name === 'string') colIndex.set(name.toLowerCase(), i);
  });

  const raIdx = colIndex.get('ra');
  const decIdx = colIndex.get('dec');
  if (raIdx === undefined || decIdx === undefined) {
    throw new Error(
      'parseGaiaDistances: malformed response — descriptors have no `ra`/`dec` ' +
        `column. Got: [${[...colIndex.keys()].join(', ')}]`
    );
  }

  const idIdx = colIndex.get('source_id');
  const gIdx = colIndex.get('phot_g_mean_mag');
  const medGeoIdx = colIndex.get('r_med_geo');
  const loGeoIdx = colIndex.get('r_lo_geo');
  const hiGeoIdx = colIndex.get('r_hi_geo');
  const medPhotoIdx = colIndex.get('r_med_photogeo');
  const loPhotoIdx = colIndex.get('r_lo_photogeo');
  const hiPhotoIdx = colIndex.get('r_hi_photogeo');

  const cell = (row: unknown[], idx: number | undefined): unknown =>
    idx === undefined ? undefined : row[idx];

  const data = Array.isArray(obj.data) ? (obj.data as unknown[][]) : [];
  const rows: GaiaDistanceRow[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!Array.isArray(row)) {
      throw new Error(`parseGaiaDistances: data row ${i} is not an array`);
    }
    // source_id: keep the exact decimal representation. The query casts it to text
    // (SOURCE_ID_AS_TEXT) so the server emits a JSON string (no JSON.parse rounding).
    const rawId = cell(row, idIdx);
    const sourceId =
      rawId === null || rawId === undefined ? '' : typeof rawId === 'string' ? rawId : String(rawId);

    rows.push({
      sourceId,
      ra: normalizeRa(toFloat(row[raIdx])),
      dec: toFloat(row[decIdx]),
      gMag: toFloat(cell(row, gIdx)),
      distGeoPc: {
        med: toFloat(cell(row, medGeoIdx)),
        lo: toFloat(cell(row, loGeoIdx)),
        hi: toFloat(cell(row, hiGeoIdx)),
      },
      distPhotoGeoPc: {
        med: toFloat(cell(row, medPhotoIdx)),
        lo: toFloat(cell(row, loPhotoIdx)),
        hi: toFloat(cell(row, hiPhotoIdx)),
      },
    });
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/* Fetch (network)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the NEAREST Bailer-Jones distance source to a sky position from the public
 * GAVO mirror. Runs a small cone (radiusArcsec→deg at the boundary), parses every
 * candidate, and returns the one with the SMALLEST true angular separation (ranked
 * by {@link angularSeparation}, not a server ORDER BY). No auth — Gaia is open.
 *
 * Failure modes (visible, never silent, never fake rows):
 *   - network / CORS rejection → descriptive throw ("could not reach ... GAVO").
 *   - non-2xx HTTP status      → thrown with the status code and body text.
 *   - malformed body           → thrown by {@link parseGaiaDistances}.
 *   - EMPTY cone               → `null` (a legitimate "no source here", NOT an error).
 */
export async function fetchNearestGaiaDistance(
  params: FetchNearestGaiaDistanceParams
): Promise<NearestGaiaDistance | null> {
  const ra = finiteNumber(params.ra, 'ra');
  const dec = finiteNumber(params.dec, 'dec');
  const radiusArcsec = finiteNumber(params.radiusArcsec, 'radiusArcsec');
  if (radiusArcsec <= 0) {
    throw new Error(`Invalid radiusArcsec: must be > 0, got ${radiusArcsec}`);
  }

  const adql = buildGaiaDistanceConeAdql({
    ra,
    dec,
    radiusDeg: radiusArcsec / 3600,
    ...(params.maxRows !== undefined ? { maxRows: params.maxRows } : {}),
  });

  const body = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'json',
    QUERY: adql,
  });

  let resp: Response;
  try {
    // Public service: intentionally NO Authorization header.
    resp = await fetch(GAIA_TAP_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach the GAVO Gaia-distance TAP service at ${GAIA_TAP_SYNC_URL} ` +
        `(network or CORS error): ${message}`,
      { cause: err }
    );
  }

  if (!resp.ok) {
    let detail = '';
    try {
      detail = await resp.text();
    } catch {
      /* body may be unreadable; the status is the signal */
    }
    throw new Error(
      `Gaia-distance TAP query failed (${resp.status}) at RA=${ra}, Dec=${dec}: ${detail}`
    );
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Gaia-distance TAP returned an unparseable JSON body: ${message}`, {
      cause: err,
    });
  }

  const rows = parseGaiaDistances(json);
  if (rows.length === 0) return null; // empty cone → honest null, not an error.

  // Rank by REAL angular separation (degrees), not a trusted server order.
  let nearest = rows[0]!;
  let nearestSepDeg = angularSeparation(ra, dec, nearest.ra, nearest.dec);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const sepDeg = angularSeparation(ra, dec, r.ra, r.dec);
    if (sepDeg < nearestSepDeg) {
      nearest = r;
      nearestSepDeg = sepDeg;
    }
  }

  return {
    sourceId: nearest.sourceId,
    ra: nearest.ra,
    dec: nearest.dec,
    separationArcsec: nearestSepDeg * 3600,
    gMag: nearest.gMag,
    distGeoPc: nearest.distGeoPc,
    distPhotoGeoPc: nearest.distPhotoGeoPc,
  };
}
