/**
 * Rubin DP1 DIASource / alert adapter.
 *
 * Rubin's difference-image analysis (DIA) emits a transient/variable *source*
 * detection for every above-threshold blob on a difference image. This module
 * fetches those REAL detections from DP1's `dp1.DiaSource` catalog around a sky
 * position (and optional time window) and converts them into the SAME columnar
 * `AlertSet` that `src/data/alerts.ts` produces synthetically — so the existing
 * overlay renderer, spatial index, hit-test, and time slider all work unchanged
 * on real data. It is a drop-in alternate alert source behind the synthetic
 * generator, gated on an RSP token with DP1 data rights.
 *
 * Authoritative DP1 schema (sdm_schemas `dp1.yaml`,
 * https://sdm-schemas.lsst.io/dp1.html; https://dp1.lsst.io/products/catalogs/):
 *   - `dp1.DiaSource` — per-visit difference-image detections. Columns used:
 *     `diaSourceId`, `ra`, `dec` (ICRS degrees — DiaSource exposes `ra`/`dec`,
 *     NOT `coord_ra`/`coord_dec`), `midpointMjdTai` (the visit mid-point MJD;
 *     unlike ForcedSource, DiaSource carries its OWN time column so no Visit
 *     join is needed), `psfFlux`/`psfFluxErr` (difference-image PSF flux in nJy),
 *     and `band`. DP1 DiaSource does NOT ship a transient CLASSIFICATION, so we
 *     do not fabricate one — every detection maps to a single honest class
 *     (`AlertType.Unknown`, legend "unknown"), not an invented taxonomy.
 *
 * NOT `dp02_dc2_catalogs.*` (that is DP0.2, a different data release and the
 * long-standing smell in `tap.ts`). Endpoint is `https://data.lsst.cloud/api/tap/sync`.
 */

import { query } from './tap.js';
import { isAuthenticated } from './auth.js';
import { fluxToAbMag } from './lightcurve.js';
import { AlertType } from '../data/alerts.js';
import type { AlertSet } from '../data/alerts.js';
import type { TapQueryResult } from '../types/catalog.js';

/**
 * Honest default class for a DP1 DIA detection. The DiaSource table gives us a
 * position, time, and flux but NO transient classification, so every detection
 * is `Unknown` (legend "unknown") rather than a fabricated asteroid/nova/etc.
 */
export const DIA_DEFAULT_ALERT_TYPE: AlertType = AlertType.Unknown;

/** Default row cap for a DIA cone query. */
export const DIA_DEFAULT_MAX_ROWS = 20000;

export interface DiaSourceQueryParams {
  /** Right ascension of the cone centre, degrees (ICRS). */
  ra: number;
  /** Declination of the cone centre, degrees (ICRS). */
  dec: number;
  /** Cone-search radius in DEGREES (DIA overlays query fields, not arcsec discs). */
  radiusDeg: number;
  /** Optional inclusive lower bound on detection epoch, MJD (TAI). */
  tMinMjd?: number;
  /** Optional inclusive upper bound on detection epoch, MJD (TAI). */
  tMaxMjd?: number;
  /** Row cap for the query. Default {@link DIA_DEFAULT_MAX_ROWS}. */
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
 * Build a cone-search ADQL query for DP1 DIA source detections around a sky
 * position, optionally restricted to a [tMinMjd, tMaxMjd] epoch window. Selects
 * id, position, epoch (`midpointMjdTai`), and difference-image PSF flux; there
 * is NO Visit join because DiaSource carries its own MJD.
 *
 * There is deliberately NO `ORDER BY`: Rubin flags `ORDER BY` + `TOP` as dangerous
 * (it sorts the full matched set before truncating). The resulting AlertSet is
 * consumed order-independently — `alertTimeRange` scans for min/max and
 * `timeWindowPredicate`/`alertsInWindow` are per-index predicates — so no
 * client-side MJD sort is needed. See
 * https://dp1.lsst.io/products/adql_queries.html.
 *
 * Radius is degrees (TAP CIRCLE wants degrees); ra/dec/radius/time are numeric
 * and finite-checked, so nothing user-controlled is interpolated as a string.
 */
export function buildDiaSourceAdql(params: DiaSourceQueryParams): string {
  const { ra, dec, radiusDeg, tMinMjd, tMaxMjd, maxRows = DIA_DEFAULT_MAX_ROWS } = params;

  const raDeg = finiteNumber(ra, 'ra');
  const decDeg = finiteNumber(dec, 'dec');
  const radius = finiteNumber(radiusDeg, 'radiusDeg');
  if (radius <= 0) {
    throw new Error(`Invalid radiusDeg: must be > 0, got ${radius}`);
  }
  const top = Math.max(1, Math.floor(finiteNumber(maxRows, 'maxRows')));

  // Time-window predicates: emitted ONLY for the bounds actually supplied, so an
  // unbounded query has no time filter and a partly-bounded one has just one.
  const timeClauses: string[] = [];
  if (tMinMjd !== undefined) {
    timeClauses.push(`\n  AND ds.midpointMjdTai >= ${formatNum(finiteNumber(tMinMjd, 'tMinMjd'))}`);
  }
  if (tMaxMjd !== undefined) {
    timeClauses.push(`\n  AND ds.midpointMjdTai <= ${formatNum(finiteNumber(tMaxMjd, 'tMaxMjd'))}`);
  }

  return `SELECT TOP ${top}
  ds.diaSourceId AS id,
  ds.ra AS ra, ds.dec AS dec,
  ds.midpointMjdTai AS mjd,
  ds.psfFlux AS flux, ds.band AS band
FROM dp1.DiaSource AS ds
WHERE CONTAINS(
  POINT('ICRS', ds.ra, ds.dec),
  CIRCLE('ICRS', ${formatNum(raDeg)}, ${formatNum(decDeg)}, ${formatNum(radius)})
) = 1${timeClauses.join('')}`;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

const RA_KEYS = ['ra', 'coord_ra'];
const DEC_KEYS = ['dec', 'coord_dec'];
const MJD_KEYS = ['mjd', 'midpointMjdTai', 'midPointTai', 'expMidptMJD'];
const MAG_KEYS = ['mag', 'magnitude'];
const FLUX_KEYS = ['flux', 'psfFlux', 'psfDiffFlux', 'scienceFlux'];

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

/** Normalise RA into [0,360) — matches the synthetic generator's convention. */
function normalizeRa(ra: number): number {
  return ((ra % 360) + 360) % 360;
}

/**
 * Parse a TAP result (the columns+rows shape `query()` returns) into an
 * `AlertSet` with the EXACT columnar layout the synthetic generator produces
 * (`{count, ra, dec, type, mag, time, id}` as parallel TypedArrays). Magnitude
 * comes from a `mag` column if present, otherwise from `psfFlux` via the SAME
 * nJy→AB conversion `lightcurve.ts` uses (`fluxToAbMag`); a non-positive flux
 * (a faded difference-image detection) yields a NaN magnitude but the detection
 * is kept, since its position/time are still real.
 *
 * Honesty/failure modes:
 *   - Empty rows → a VALID empty AlertSet (count 0, zero-length arrays), NOT a throw.
 *   - A row missing ra/dec/MJD or any brightness column → throws an "unexpected
 *     columns" error rather than silently emitting NaN coordinates/epochs.
 *
 * `id` is the 0-based row index (matching the synthetic generator's `id[i]=i`).
 * The 64-bit `diaSourceId` does not fit the AlertSet's Uint32Array id column, so
 * it is intentionally not truncated into it.
 */
export function parseDiaSources(raw: TapQueryResult): AlertSet {
  if (!raw || !Array.isArray(raw.rows)) {
    throw new Error('parseDiaSources: expected a TapQueryResult with a rows array');
  }

  const n = raw.rows.length;
  const ra = new Float32Array(n);
  const dec = new Float32Array(n);
  const type = new Uint8Array(n);
  const mag = new Float32Array(n);
  const time = new Float32Array(n);
  const id = new Uint32Array(n);

  for (let i = 0; i < n; i++) {
    const row = raw.rows[i];
    if (!row || typeof row !== 'object') {
      throw new Error(`parseDiaSources: row ${i} is not an object`);
    }
    const r = row as Record<string, unknown>;

    const raVal = pickNumber(r, RA_KEYS);
    const decVal = pickNumber(r, DEC_KEYS);
    const mjdVal = pickNumber(r, MJD_KEYS);
    const magDirect = pickNumber(r, MAG_KEYS);
    const fluxVal = pickNumber(r, FLUX_KEYS);

    // Structural check: a real DiaSource row MUST carry position, epoch, and a
    // brightness (mag or flux). Missing columns are a schema/aliasing mistake —
    // fail loudly instead of writing NaNs the renderer would silently draw.
    if (
      raVal === null ||
      decVal === null ||
      mjdVal === null ||
      (magDirect === null && fluxVal === null)
    ) {
      throw new Error(
        `parseDiaSources: unexpected columns in DIA result at row ${i}. Expected ` +
          `ra, dec, an MJD (midpointMjdTai), and a magnitude or psfFlux; got keys: ` +
          `[${Object.keys(r).join(', ')}]`
      );
    }

    ra[i] = normalizeRa(raVal);
    dec[i] = decVal;
    time[i] = mjdVal;
    type[i] = DIA_DEFAULT_ALERT_TYPE;
    id[i] = i;

    // Magnitude: prefer a direct mag column; else convert nJy flux with the same
    // zeropoint lightcurve.ts uses. A non-positive flux has no AB mag → NaN.
    const m = magDirect !== null ? magDirect : fluxToAbMag(fluxVal!);
    mag[i] = m === null ? NaN : m;
  }

  // Every row that survives is written, so count === n and length === count.
  return { count: n, ra, dec, type, mag, time, id };
}

/* -------------------------------------------------------------------------- */
/* Fetch (network)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Fetch real DP1 DIA source detections around a position (and optional time
 * window) as an `AlertSet`, via the TAP `query()` client (which attaches the RSP
 * bearer token from the auth module).
 *
 * Honesty/failure modes are made VISIBLE, never fake data:
 *   - Unauthenticated → throws a "sign-in required" error and does NOT hit the
 *     network (the live DIA source is auth-gated; the UI falls back to synthetic).
 *   - Empty field/window → returns a VALID empty AlertSet (count 0), NOT an error,
 *     so the overlay can say "no DIA sources in this field/time" honestly.
 *   - 401 / 404 / network rejection → distinct, descriptive throws.
 */
export async function fetchDiaAlerts(params: DiaSourceQueryParams): Promise<AlertSet> {
  if (!isAuthenticated()) {
    throw new Error(
      'Sign-in required: live DP1 DIA sources require an RSP token with DP1 data ' +
        'rights. Sign in, or switch the alert overlay to the synthetic source.'
    );
  }

  const adql = buildDiaSourceAdql(params);

  let result: TapQueryResult;
  try {
    result = await query(adql, { maxRec: params.maxRows ?? DIA_DEFAULT_MAX_ROWS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\b401\b/.test(message)) {
      throw new Error(
        `Not authorized (401) fetching DP1 DIA sources: your RSP token is missing ` +
          `DP1 data rights or has expired. (${message})`,
        { cause: err }
      );
    }
    if (/\b404\b/.test(message)) {
      throw new Error(
        `DP1 DIA source table not found (404) at the TAP endpoint: ${message}`,
        { cause: err }
      );
    }
    throw new Error(
      `Network error fetching DP1 DIA sources at RA=${params.ra}, Dec=${params.dec}: ` +
        `${message}`,
      { cause: err }
    );
  }

  // Empty result is a legitimate answer (DP1 covers only a few small fields), not
  // an error — return a valid empty AlertSet so the UI shows an honest "none here".
  return parseDiaSources(result);
}
