/**
 * Rubin DP1 light-curve TAP adapter.
 *
 * DP1's HiPS imagery is a single deep coadd (no time axis), but the DP1 TAP
 * catalog holds per-source, multi-epoch forced photometry. This module builds a
 * cone-search ADQL query against the DP1 forced-source tables, parses the TAP
 * result into a typed, per-band light curve, and adapts a band series into the
 * `LightCurvePoint[]` shape the existing `LightCurvePlot.svelte` renders.
 *
 * Authoritative DP1 schema (sdm_schemas `dp1.yaml`, browsable at
 * https://sdm-schemas.lsst.io/dp1.html; see also https://dp1.lsst.io/products/catalogs/):
 *   - `dp1.ForcedSource`            — forced PSF photometry on visit + difference
 *     images at every `dp1.Object` position. Columns used: `objectId`,
 *     `coord_ra`, `coord_dec`, `visit`, `band`, `psfFlux`, `psfFluxErr`,
 *     `psfDiffFlux`, `psfDiffFluxErr` (fluxes in nJy). It has NO time column.
 *   - `dp1.ForcedSourceOnDiaObject` — the DIA analogue at every `dp1.DiaObject`
 *     position (same flux/band columns; `diaObjectId` instead of `objectId`).
 *   - `dp1.Visit`                   — per-visit metadata. `expMidptMJD` is the
 *     visit mid-point in MJD (TAI). ForcedSource carries no MJD of its own, so
 *     the epoch comes from joining `dp1.Visit` on `visit`.
 *
 * NOT `dp02_dc2_catalogs.*` (that is DP0.2, a different data release and the
 * long-standing smell in `tap.ts`). Endpoint is `https://data.lsst.cloud/api/tap/sync`.
 */

import { query } from './tap.js';
import type { TapQueryResult } from '../types/catalog.js';
import type { LightCurvePoint } from '../data/offlineDataset.js';

/** LSST photometric bands (u,g,r,i,z,y). Used to allowlist the `band` filter. */
export const LIGHTCURVE_BANDS = ['u', 'g', 'r', 'i', 'z', 'y'] as const;
export type LightCurveBand = (typeof LIGHTCURVE_BANDS)[number];

/**
 * AB-magnitude zeropoint for fluxes in nanojansky (nJy):
 *   m_AB = -2.5·log10(f / 3631 Jy);  1 Jy = 1e9 nJy
 *   ⇒ m_AB = -2.5·log10(f_nJy) + 31.4
 */
export const AB_MAG_ZEROPOINT_NJY = 31.4;

/** 2.5 / ln(10) — converts a fractional flux error to a magnitude error. */
const MAG_ERR_FACTOR = 2.5 / Math.LN10;

/** Which DP1 forced-photometry table to cone-search. */
export type LightCurveSourceTable = 'forced' | 'dia';

const LIGHTCURVE_TABLES: Record<LightCurveSourceTable, { table: string }> = {
  // Forced photometry at Object positions.
  forced: { table: 'ForcedSource' },
  // Forced photometry at DiaObject positions (recommended for transients).
  dia: { table: 'ForcedSourceOnDiaObject' },
};

export interface LightCurveQueryParams {
  /** Right ascension, degrees (ICRS). */
  ra: number;
  /** Declination, degrees (ICRS). */
  dec: number;
  /** Cone-search radius in ARCSECONDS (converted to degrees at the boundary). */
  radiusArcsec: number;
  /** Optional single-band filter (one of u,g,r,i,z,y). Omit for all bands. */
  band?: string;
  /** Which DP1 forced table to query. Default `'forced'` (dp1.ForcedSource). */
  table?: LightCurveSourceTable;
  /** Row cap for the query. Default 10000. */
  maxRecords?: number;
}

/** One parsed forced-photometry epoch. Fluxes are in nJy; mags are AB. */
export interface LightCurveSample {
  /** Visit mid-point, MJD (TAI) — from dp1.Visit.expMidptMJD. */
  mjd: number;
  /** Photometric band (u,g,r,i,z,y). */
  band: string;
  /** PSF flux on the visit image, nJy (dp1.*.psfFlux). May be negative. */
  flux: number;
  /** 1σ flux error, nJy (dp1.*.psfFluxErr). */
  fluxErr?: number;
  /** AB magnitude derived from `flux` (undefined when flux ≤ 0). */
  mag?: number;
  /** AB magnitude 1σ error derived from `flux`/`fluxErr` (undefined when flux ≤ 0). */
  magErr?: number;
}

/** A parsed light curve: all samples (time-ordered) plus a per-band grouping. */
export interface ParsedLightCurve {
  /** All samples, sorted ascending by MJD. */
  samples: LightCurveSample[];
  /** Samples grouped by band; each group is sorted ascending by MJD. */
  byBand: Record<string, LightCurveSample[]>;
  /** Bands present, in first-seen order. */
  bands: string[];
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
 * Format a degree value for ADQL without scientific notation (some ADQL parsers
 * reject `1e-7`). Normal magnitudes stringify cleanly; only extreme values are
 * expanded via toFixed.
 */
function formatDeg(value: number): string {
  const s = String(value);
  if (!/e/i.test(s)) return s;
  return value.toFixed(12);
}

/**
 * Validate a band against the LSST allowlist. `band` is the ONLY string
 * interpolated into the ADQL literal, so allowlisting it is the injection guard
 * (ra/dec/radius are numeric and finite-checked).
 */
function validateBand(band: string): LightCurveBand {
  if ((LIGHTCURVE_BANDS as readonly string[]).includes(band)) {
    return band as LightCurveBand;
  }
  throw new Error(
    `Invalid band '${band}'. Expected one of: ${LIGHTCURVE_BANDS.join(', ')}`
  );
}

/**
 * Build a cone-search ADQL query for a DP1 forced-source light curve at a sky
 * position. Selects epoch (MJD from dp1.Visit), band, and PSF flux/error, joined
 * to dp1.Visit for the time axis, ordered by MJD.
 *
 * Radius is converted arcsec→degrees at this boundary (TAP CIRCLE wants degrees).
 */
export function buildLightCurveAdql(params: LightCurveQueryParams): string {
  const { ra, dec, radiusArcsec, band, table = 'forced', maxRecords = 10000 } = params;

  const raDeg = finiteNumber(ra, 'ra');
  const decDeg = finiteNumber(dec, 'dec');
  const radiusArcsecChecked = finiteNumber(radiusArcsec, 'radiusArcsec');
  if (radiusArcsecChecked <= 0) {
    throw new Error(`Invalid radiusArcsec: must be > 0, got ${radiusArcsecChecked}`);
  }
  const radiusDeg = radiusArcsecChecked / 3600; // arcsec → degrees at the boundary
  const top = Math.max(1, Math.floor(finiteNumber(maxRecords, 'maxRecords')));

  const spec = LIGHTCURVE_TABLES[table];
  if (!spec) throw new Error(`Unknown source table: ${String(table)}`);

  const bandClause = band !== undefined ? `\n  AND fs.band = '${validateBand(band)}'` : '';

  return `SELECT TOP ${top}
  fs.coord_ra AS ra, fs.coord_dec AS dec, fs.band AS band,
  v.expMidptMJD AS mjd,
  fs.psfFlux AS flux, fs.psfFluxErr AS fluxErr,
  fs.psfDiffFlux AS diffFlux, fs.psfDiffFluxErr AS diffFluxErr
FROM dp1.${spec.table} AS fs
JOIN dp1.Visit AS v ON fs.visit = v.visit
WHERE CONTAINS(
  POINT('ICRS', fs.coord_ra, fs.coord_dec),
  CIRCLE('ICRS', ${formatDeg(raDeg)}, ${formatDeg(decDeg)}, ${formatDeg(radiusDeg)})
) = 1${bandClause}
ORDER BY mjd`;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

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

/** First non-empty string value among candidate keys, else null. */
function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** Convert an nJy flux to an AB magnitude, or null when flux ≤ 0 / non-finite. */
export function fluxToAbMag(fluxNjy: number): number | null {
  if (!Number.isFinite(fluxNjy) || fluxNjy <= 0) return null;
  return -2.5 * Math.log10(fluxNjy) + AB_MAG_ZEROPOINT_NJY;
}

/**
 * Parse a TAP result (the columns+rows shape `query()` returns) into a typed,
 * time-ordered, per-band light curve. Reads the query's aliased columns
 * (`mjd`, `band`, `flux`, `fluxErr`) but also falls back to the raw DP1 column
 * names (`expMidptMJD`/`midpointMjdTai`, `psfFlux`/`psfDiffFlux`, …) so a raw
 * un-aliased result parses too. Rows missing mjd/band/flux are skipped.
 */
export function parseLightCurveResult(raw: TapQueryResult): ParsedLightCurve {
  if (!raw || !Array.isArray(raw.rows)) {
    throw new Error('parseLightCurveResult: expected a TapQueryResult with a rows array');
  }

  const samples: LightCurveSample[] = [];
  for (const row of raw.rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;

    const mjd = pickNumber(r, ['mjd', 'expMidptMJD', 'midpointMjdTai', 'obsStartMJD']);
    const band = pickString(r, ['band']);
    const flux = pickNumber(r, ['flux', 'psfFlux', 'psfDiffFlux']);
    if (mjd === null || band === null || flux === null) continue;

    const fluxErr = pickNumber(r, ['fluxErr', 'psfFluxErr', 'psfDiffFluxErr']);
    const sample: LightCurveSample = { mjd, band, flux };
    if (fluxErr !== null) sample.fluxErr = fluxErr;

    const mag = fluxToAbMag(flux);
    if (mag !== null) {
      sample.mag = mag;
      if (fluxErr !== null && flux > 0) {
        sample.magErr = MAG_ERR_FACTOR * (fluxErr / flux);
      }
    }
    samples.push(sample);
  }

  // Defensive sort — never trust the server ORDER BY for a time-ordered series.
  samples.sort((a, b) => a.mjd - b.mjd);

  const byBand: Record<string, LightCurveSample[]> = {};
  const bands: string[] = [];
  for (const s of samples) {
    if (!byBand[s.band]) {
      byBand[s.band] = [];
      bands.push(s.band);
    }
    byBand[s.band]!.push(s);
  }

  return { samples, byBand, bands };
}

/* -------------------------------------------------------------------------- */
/* Adapter to the existing LightCurvePlot shape                               */
/* -------------------------------------------------------------------------- */

export interface ToLightCurvePointsOptions {
  /** Restrict to one band's series. Omit to use all samples. */
  band?: string;
  /**
   * How to derive `intensity`:
   *   - `'flux'` (default): intensity = flux (nJy), falling back to 10^(-0.4·mag).
   *   - `'mag'`: intensity = 10^(-0.4·mag).
   * Both are monotonic in brightness (higher flux / lower mag ⇒ higher intensity).
   */
  source?: 'flux' | 'mag';
}

/** intensity ∝ brightness from a magnitude: 10^(-0.4·mag). */
function magToIntensity(mag: number | undefined): number | null {
  if (mag === undefined || !Number.isFinite(mag)) return null;
  return Math.pow(10, -0.4 * mag);
}

/**
 * Adapt a parsed light curve into the `LightCurvePoint[]` (`{mjd, intensity}`)
 * shape that `LightCurvePlot.svelte` renders. Intensity is the flux directly
 * (an intensity-like nJy quantity) or, in `'mag'` mode, 10^(-0.4·mag) — both
 * monotonically increasing with brightness. Samples with no usable value are
 * dropped; MJD order is preserved from the parsed (already time-sorted) series.
 */
export function toLightCurvePoints(
  curve: ParsedLightCurve,
  options: ToLightCurvePointsOptions = {}
): LightCurvePoint[] {
  const { band, source = 'flux' } = options;
  const series = band !== undefined ? (curve.byBand[band] ?? []) : curve.samples;

  const points: LightCurvePoint[] = [];
  for (const s of series) {
    let intensity: number | null;
    if (source === 'mag') {
      intensity = magToIntensity(s.mag);
    } else {
      intensity =
        Number.isFinite(s.flux) ? s.flux : magToIntensity(s.mag);
    }
    if (intensity === null || !Number.isFinite(intensity)) continue;
    points.push({ mjd: s.mjd, intensity });
  }
  return points;
}

/* -------------------------------------------------------------------------- */
/* Fetch (network)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Fetch a DP1 forced-source light curve at a sky position via the TAP `query()`
 * client (which attaches the RSP bearer token from the auth module). Throws
 * descriptive, honest errors — never returns fake/placeholder data — so the UI
 * can surface "requires an RSP token with DP1 data rights" or "no epochs here".
 */
export async function fetchLightCurve(
  params: LightCurveQueryParams
): Promise<ParsedLightCurve> {
  const adql = buildLightCurveAdql(params);

  let result: TapQueryResult;
  try {
    result = await query(adql, { maxRec: params.maxRecords ?? 10000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fetch DP1 light curve at RA=${params.ra}, Dec=${params.dec}: ${message}. ` +
        `This requires an RSP token with DP1 data rights.`,
      { cause: err }
    );
  }

  const parsed = parseLightCurveResult(result);
  if (parsed.samples.length === 0) {
    throw new Error(
      `No DP1 forced-source photometry within ${params.radiusArcsec}" of ` +
        `RA=${params.ra}, Dec=${params.dec}. DP1 covers only a few small fields, ` +
        `and access requires an RSP token with DP1 data rights.`
    );
  }
  return parsed;
}
