/**
 * Rubin DP1 `dp1.Object` cone-search adapter — the token-gated sibling of the
 * public Gaia overlay (`src/api/gaia.ts`).
 *
 * The `dp1.Object` catalog is the deep-coadd measurement catalog: one row per
 * detected astrophysical object with forced multi-band photometry. This module
 * cone-searches it around a sky position and maps the result into the SAME generic
 * `CatalogSet` (`src/data/catalog.ts`) the Gaia overlay + linked `CatalogTable`
 * consume, so the existing overlay renderer, spatial index, and table all work
 * unchanged. It is a drop-in, auth-gated Rubin catalog source alongside Gaia.
 *
 * Authoritative DP1 schema — VERIFIED against the published sdm_schemas `dp1.yaml`
 * (the source behind https://sdm-schemas.lsst.io/dp1.html; see also
 * https://dp1.lsst.io/products/catalogs/object.html). Columns confirmed present in
 * the real `dp1.Object` table (NOT guessed):
 *   - `objectId`                       — unique object id (a 64-bit `long`; kept as
 *     a decimal STRING here to avoid JS-number precision loss, exactly like Gaia's
 *     `source_id`).
 *   - `coord_ra`, `coord_dec`          — "Fiducial ICRS Right Ascension/Declination
 *     of centroid used for database indexing" (`double`, degrees,
 *     `pos.eq.ra;meta.main`). This is the canonical position column the DP1 ADQL
 *     guidance cone-searches on — NOT the per-band `z_ra`/`z_dec` centroids that
 *     also exist in the table, and NOT `ra`/`dec` (which DiaObject/DiaSource use).
 *   - `refBand`                        — the reference band the object was detected
 *     in.
 *   - `{u,g,r,i,z,y}_psfMag`           — "AB magnitude of the {band}-band psfFlux"
 *     (`float`, mag). Per-band point-source photometry — the useful marker/table
 *     brightness. Each also has `_psfMagErr`, `_psfFlux(Err)`, `_cModelMag(Err)`,
 *     `_cModelFlux(Err)` counterparts in the schema.
 *   - `r_cModelMag`                    — "AB magnitude of cModelFlux. Forced on
 *     r-band." The extended-source (galaxy) model magnitude, included as a compact
 *     galaxy/star discriminator alongside the r psf mag.
 *
 * NOT `dp02_dc2_catalogs.*` (that is DP0.2, a different data release and the
 * long-standing smell that this work reconciles). Endpoint is
 * `https://data.lsst.cloud/api/tap/sync` (via the `/rsp` dev proxy), through the
 * shared `tap.query()` client which attaches the RSP bearer token.
 */

import { query } from './tap.js';
import { isAuthenticated } from './auth.js';
import {
  CATALOG_NO_DATA,
  type CatalogSet,
} from '../data/catalog.js';
import type { TapQueryResult } from '../types/catalog.js';

/** LSST photometric bands, in wavelength order — the per-band psfMag columns selected. */
export const RUBIN_OBJECT_BANDS = ['u', 'g', 'r', 'i', 'z', 'y'] as const;
export type RubinObjectBand = (typeof RUBIN_OBJECT_BANDS)[number];

/** Default row cap for a Rubin Object cone query (TOP N in the ADQL). */
export const RUBIN_OBJECT_DEFAULT_MAX_ROWS = 2000;

/**
 * Default cone radius in DEGREES for the overlay. The deep-coadd Object catalog is
 * dense, so a small cone (0.05° = 3′) keeps the returned set — and the per-frame
 * marker sweep — bounded while still covering the visible field at typical zoom.
 */
export const RUBIN_OBJECT_DEFAULT_RADIUS_DEG = 0.05;

export interface RubinObjectConeParams {
  /** Right ascension of the cone centre, degrees (ICRS). */
  ra: number;
  /** Declination of the cone centre, degrees (ICRS). */
  dec: number;
  /** Cone-search radius in DEGREES (TAP CIRCLE wants degrees, not arcsec). */
  radiusDeg: number;
  /** Row cap for the query. Default {@link RUBIN_OBJECT_DEFAULT_MAX_ROWS}. */
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
 * `1e-7`). Normal coordinates stringify cleanly; only extreme values are expanded.
 */
function formatNum(value: number): string {
  const s = String(value);
  if (!/e/i.test(s)) return s;
  return value.toFixed(12);
}

/**
 * The explicit column list SELECTed from `dp1.Object`. Named columns only — never
 * `SELECT *` (the Object table has ~1,300 columns; the DP1 ADQL guidance forbids
 * `SELECT *`). Every name here is verified against the published dp1 schema.
 */
export const RUBIN_OBJECT_COLUMNS: readonly string[] = [
  'objectId',
  'coord_ra',
  'coord_dec',
  'refBand',
  ...RUBIN_OBJECT_BANDS.map((b) => `${b}_psfMag`),
  'r_cModelMag',
];

/**
 * Build a cone-search ADQL query for `dp1.Object` around a sky position.
 *
 * Emits the Rubin-recommended spatial predicate — `CONTAINS(POINT('ICRS',
 * coord_ra, coord_dec), CIRCLE('ICRS', ra, dec, radiusDeg)) = 1` — with EXPLICIT,
 * schema-verified columns and NO `ORDER BY` (Rubin flags `ORDER BY` + `TOP` as
 * dangerous — it sorts the whole matched set before truncating). Radius is in
 * DEGREES at the boundary (no arcsec→degree division here); ra/dec/radius are
 * finite-checked so nothing user-controlled is interpolated as an un-vetted string.
 *
 * See https://dp1.lsst.io/products/adql_queries.html and the schema at
 * https://sdm-schemas.lsst.io/dp1.html.
 */
export function buildObjectConeSearch(params: RubinObjectConeParams): string {
  const raDeg = finiteNumber(params.ra, 'ra');
  const decDeg = finiteNumber(params.dec, 'dec');
  const radius = finiteNumber(params.radiusDeg, 'radiusDeg');
  if (radius <= 0) {
    throw new Error(`Invalid radiusDeg: must be > 0, got ${radius}`);
  }
  const top = Math.max(
    1,
    Math.floor(finiteNumber(params.maxRows ?? RUBIN_OBJECT_DEFAULT_MAX_ROWS, 'maxRows'))
  );

  return `SELECT TOP ${top}
  ${RUBIN_OBJECT_COLUMNS.join(', ')}
FROM dp1.Object
WHERE CONTAINS(
  POINT('ICRS', coord_ra, coord_dec),
  CIRCLE('ICRS', ${formatNum(raDeg)}, ${formatNum(decDeg)}, ${formatNum(radius)})
) = 1`;
}

/* -------------------------------------------------------------------------- */
/* Parsing → CatalogSet                                                       */
/* -------------------------------------------------------------------------- */

/** Candidate keys for the object position (canonical DP1 Object columns first). */
const RA_KEYS = ['coord_ra', 'ra'];
const DEC_KEYS = ['coord_dec', 'dec'];
const ID_KEYS = ['objectId', 'objectid', 'id'];

/** First finite numeric value among candidate keys, else null. */
function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

/** First present value among candidate keys as an exact decimal string, else ''. */
function pickIdString(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

/** Normalise RA into [0,360) — matches the overlay/index convention. */
function normalizeRa(ra: number): number {
  return ((ra % 360) + 360) % 360;
}

/** Add `key` = finite `value`, else the {@link CATALOG_NO_DATA} dash. */
function numField(rec: Record<string, string | number>, key: string, value: number | null): void {
  rec[key] = value !== null && Number.isFinite(value) ? value : CATALOG_NO_DATA;
}

/**
 * Parse a TAP result (the columns+rows shape `query()` returns, rows keyed by
 * column name) into a generic {@link CatalogSet} — the SAME shape
 * {@link gaiaToCatalogSet} produces, so the overlay + linked table render it
 * unchanged.
 *
 * Honesty / failure modes:
 *   - Empty rows → a VALID empty catalog (count 0), NOT a throw (DP1 covers only a
 *     few small fields, so most positions legitimately have no objects).
 *   - A row missing BOTH `coord_ra`/`coord_dec` (and their fallbacks) → throws an
 *     "unexpected columns" error rather than silently emitting NaN coordinates the
 *     renderer would draw at (0,0).
 *   - A null/absent magnitude cell → the {@link CATALOG_NO_DATA} dash in the table,
 *     never a raw `NaN` (DP1 leaves a band's mag null where the object wasn't
 *     measured in that band — that is real, not an error).
 *   - `objectId` is preserved as a decimal STRING exactly as received (a 64-bit id
 *     loses its low digits if coerced through a JS number).
 */
export function parseRubinObjects(raw: TapQueryResult): CatalogSet {
  if (!raw || !Array.isArray(raw.rows)) {
    throw new Error('parseRubinObjects: expected a TapQueryResult with a rows array');
  }

  const n = raw.rows.length;
  const ra = new Float32Array(n);
  const dec = new Float32Array(n);
  const label: string[] = new Array<string>(n);
  const records: Record<string, string | number>[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const row = raw.rows[i];
    if (!row || typeof row !== 'object') {
      throw new Error(`parseRubinObjects: row ${i} is not an object`);
    }
    const r = row as Record<string, unknown>;

    const raVal = pickNumber(r, RA_KEYS);
    const decVal = pickNumber(r, DEC_KEYS);
    // Structural check: a real dp1.Object row MUST carry a position. Missing
    // coord_ra/coord_dec is a schema/aliasing mistake — fail loudly instead of
    // writing NaNs the overlay would silently draw at the origin.
    if (raVal === null || decVal === null) {
      throw new Error(
        `parseRubinObjects: unexpected columns in dp1.Object result at row ${i}. ` +
          `Expected coord_ra and coord_dec; got keys: [${Object.keys(r).join(', ')}]`
      );
    }

    ra[i] = normalizeRa(raVal);
    dec[i] = decVal;

    const objectId = pickIdString(r, ID_KEYS);
    label[i] = objectId;

    const refBand = typeof r['refBand'] === 'string' ? (r['refBand'] as string) : CATALOG_NO_DATA;
    const rec: Record<string, string | number> = {
      Catalog: 'Rubin DP1 Object',
      'Object ID': objectId || CATALOG_NO_DATA,
      'Ref band': refBand,
    };
    for (const b of RUBIN_OBJECT_BANDS) {
      numField(rec, `${b} (psf mag)`, pickNumber(r, [`${b}_psfMag`]));
    }
    numField(rec, 'r (cModel mag)', pickNumber(r, ['r_cModelMag']));
    records[i] = rec;
  }

  return { count: n, ra, dec, label, records };
}

/* -------------------------------------------------------------------------- */
/* Fetch (network)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Fetch `dp1.Object` sources in a cone as a {@link CatalogSet}, via the TAP
 * `query()` client (which attaches the RSP bearer token from the auth module).
 *
 * Honesty / failure modes are made VISIBLE, never fake data:
 *   - Unauthenticated → throws a "sign-in required" error and does NOT hit the
 *     network (the live DP1 Object source is auth-gated; the UI keeps the public
 *     Gaia overlay as the un-gated alternative).
 *   - 401 / 404 / network rejection → distinct, descriptive throws.
 *   - Empty field → a VALID empty CatalogSet (count 0), NOT an error, so the table
 *     can say "no Rubin objects in this cone" honestly.
 */
export async function fetchRubinObjects(params: RubinObjectConeParams): Promise<CatalogSet> {
  if (!isAuthenticated()) {
    throw new Error(
      'Sign-in required: the live DP1 Object catalog requires an RSP token with ' +
        'DP1 data rights. Sign in with an RSP token that has DP1 data rights, or use ' +
        'the public Gaia overlay instead.'
    );
  }

  const adql = buildObjectConeSearch(params);

  let result: TapQueryResult;
  try {
    result = await query(adql, { maxRec: params.maxRows ?? RUBIN_OBJECT_DEFAULT_MAX_ROWS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\b401\b/.test(message)) {
      throw new Error(
        `Not authorized (401) fetching DP1 Objects: your RSP token is missing DP1 ` +
          `data rights or has expired. (${message})`,
        { cause: err }
      );
    }
    if (/\b404\b/.test(message)) {
      throw new Error(`DP1 Object table not found (404) at the TAP endpoint: ${message}`, {
        cause: err,
      });
    }
    throw new Error(
      `Network error fetching DP1 Objects at RA=${params.ra}, Dec=${params.dec}: ${message}`,
      { cause: err }
    );
  }

  // Empty result is a legitimate answer (DP1 covers only a few small fields), not
  // an error — return a valid empty CatalogSet so the UI shows an honest "none here".
  return parseRubinObjects(result);
}
