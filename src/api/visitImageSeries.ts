/**
 * Rubin DP1 multi-epoch VISIT-IMAGE time series (feature 136 — real blink).
 *
 * A `deep_coadd` is a single stacked image of a field (one frame per band). To
 * BLINK a position through time we instead need the individual per-visit science
 * images that overlap it — DP1's `lsst.visit_image` products in the ObsTAP table
 * `ivoa.ObsCore`. Unlike a coadd there are MANY of these per sky position, each a
 * distinct exposure at its own epoch (`t_min`, MJD), each with its own DataLink
 * `access_url` and footprint centre (`s_ra`/`s_dec`). This module:
 *
 *   1. builds the ObsCore ADQL that finds every visit-image whose footprint
 *      CONTAINS a sky position (mirroring the verified pattern in `obscore.ts` —
 *      `dataproduct_type='image'`, `obs_collection='LSST.DP1'`,
 *      `dataproduct_subtype='lsst.visit_image'`, `CONTAINS(POINT, s_region)=1`);
 *   2. parses the TAP result into epochs sorted ascending by MJD, extracting the
 *      SODA dataset `ID` straight from each `access_url` (the same DataLink
 *      shortcut `obscore.extractCutoutId` uses — no VOTable round-trip); and
 *   3. orchestrates a per-epoch SODA cutout (`soda.fetchCutout` →
 *      `fitsCompressed.readFitsImageAsync`) so the UI can play the frames as a
 *      light-curve movie.
 *
 * QUOTA NOTE: the tightest RSP quota is vo-cutouts at 35 requests / 15 min. Each
 * epoch is ONE cutout request, so the series is CAPPED (default
 * {@link DEFAULT_MAX_EPOCHS} = 12) to stay well under that ceiling. When more
 * epochs exist than the cap, the result flags `truncated` and reports
 * `totalEpochs` rather than silently dropping the rest.
 *
 * Endpoint + response format are the shared TAP service in `tap.ts` (VOTable
 * binary2, 64-bit ids as decimal strings) and the SODA service in `soda.ts`.
 * Auth is attached ONLY by those reused clients (the `auth.ts` module) — never a
 * hardcoded or passed-in token. Verified against dp1.lsst.io ObsTAP + the DP1
 * cutout recipe; `docs/rubin-api-usage.md`.
 */

import { query } from './tap.js';
import { isAuthenticated } from './auth.js';
import { extractCutoutId, OBSCORE_TABLE, DP1_OBS_COLLECTION } from './obscore.js';
import { fetchCutout } from './soda.js';
import { readFitsImageAsync } from '../utils/fitsCompressed.js';
import type { FitsImage } from '../utils/fits.js';
import type { TapQueryResult } from '../types/catalog.js';

/** ObsCore `dataproduct_subtype` for a DP1 per-visit science image (a blink frame). */
export const DP1_VISIT_IMAGE_SUBTYPE = 'lsst.visit_image';

/**
 * Default cap on the number of epochs (= cutout requests) fetched for a blink.
 * 12 keeps a comfortable margin under the vo-cutouts quota of 35 / 15 min while
 * giving a useful movie. Raise cautiously — every epoch is one cutout request.
 */
export const DEFAULT_MAX_EPOCHS = 12;

/**
 * Default DISCOVERY row cap for the ObsCore query (the ADQL `TOP`). Larger than
 * {@link DEFAULT_MAX_EPOCHS} on purpose: we fetch the full list of epochs so we
 * can report an HONEST `totalEpochs` and set `truncated` when the display cap
 * drops some — a `TOP` equal to the display cap could never see the overflow.
 */
export const DEFAULT_DISCOVERY_CAP = 200;

/** Default cutout radius (arcsec) per epoch frame — a small postage stamp. */
export const DEFAULT_RADIUS_ARCSEC = 10;

/** One discovered visit-image epoch (metadata only; the pixels are fetched later). */
export interface VisitImageEpoch {
  /** Exposure epoch, MJD (ObsCore `t_min`). */
  mjd: number;
  /** LSST band (ObsCore `lsst_band`), or null when the row carries none. */
  band: string | null;
  /** DataLink `access_url` carrying the dataset `ID` (`…/links?ID=…`). */
  accessUrl: string;
  /** SODA dataset `ID` extracted from {@link accessUrl}. Kept as a STRING (64-bit). */
  id: string;
  /** Image footprint centre RA, degrees (ObsCore `s_ra`); NaN if absent. */
  ra: number;
  /** Image footprint centre Dec, degrees (ObsCore `s_dec`); NaN if absent. */
  dec: number;
}

/** An epoch with its decoded cutout pixels (one blink frame). */
export interface EpochImage extends VisitImageEpoch {
  /** Decoded per-epoch cutout (linear-float pixels + WCS). */
  image: FitsImage;
}

/** The fetched blink series: capped frames plus honest completeness metadata. */
export interface VisitImageSeries {
  /** Decoded frames, ascending by MJD, at most `maxEpochs` long. */
  epochs: EpochImage[];
  /** True when more epochs existed than were fetched (cap hit or server overflow). */
  truncated: boolean;
  /** Total number of epochs DISCOVERED for the position (before the display cap). */
  totalEpochs: number;
  /** How many capped epochs failed their per-epoch cutout and were skipped. */
  failedEpochs: number;
}

export interface VisitImageSeriesAdqlParams {
  /** Right ascension of the position, degrees (ICRS). */
  ra: number;
  /** Declination of the position, degrees (ICRS). */
  dec: number;
  /**
   * Maximum number of epoch rows to fetch (the ADQL `TOP` safety cap). This is a
   * DISCOVERY bound, not the display cap — see {@link DEFAULT_DISCOVERY_CAP}.
   */
  maxEpochs?: number;
}

export interface FetchVisitImageSeriesParams {
  /** Right ascension of the blink centre, degrees (ICRS). */
  ra: number;
  /** Declination of the blink centre, degrees (ICRS). */
  dec: number;
  /** Per-epoch cutout RADIUS in arcsec. Default {@link DEFAULT_RADIUS_ARCSEC}. */
  radiusArcsec?: number;
  /** Cap on how many epochs (cutout requests) to fetch. Default {@link DEFAULT_MAX_EPOCHS}. */
  maxEpochs?: number;
}

/* -------------------------------------------------------------------------- */
/* ADQL construction                                                          */
/* -------------------------------------------------------------------------- */

/** Reject NaN/Infinity so nothing unsafe is interpolated into the ADQL. */
function finiteNumber(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected a finite number, got ${String(value)}`);
  }
  return value;
}

/** Format a degree value without scientific notation (some ADQL parsers reject `1e-7`). */
function formatDeg(value: number): string {
  const s = String(value);
  if (!/e/i.test(s)) return s;
  return value.toFixed(12);
}

/**
 * Build the ObsCore ADQL that finds every DP1 visit-image whose footprint
 * contains a sky position. PURE and testable. Uses `CONTAINS(POINT, s_region)`
 * (the verified `obscore.ts` pattern) so it returns the images that ACTUALLY
 * overlap the point across all epochs, not merely nearby centres. Selects the
 * DataLink `access_url`, the epoch (`t_min`), the band (`lsst_band`), and the
 * footprint centre (`s_ra`/`s_dec`).
 *
 * There is deliberately NO `ORDER BY`: Rubin flags `ORDER BY` + `TOP` as
 * dangerous (it sorts the whole matched set before truncating). Epochs are sorted
 * client-side by `t_min` in {@link parseVisitImageEpochs}. ra/dec are numeric and
 * finite-checked, so nothing user-controlled is interpolated as a string.
 */
export function buildVisitImageSeriesAdql(params: VisitImageSeriesAdqlParams): string {
  const ra = formatDeg(finiteNumber(params.ra, 'ra'));
  const dec = formatDeg(finiteNumber(params.dec, 'dec'));
  const top = Math.max(1, Math.floor(params.maxEpochs ?? DEFAULT_DISCOVERY_CAP));

  return `SELECT TOP ${top}
  access_url, dataproduct_subtype, t_min, lsst_band, s_ra, s_dec
FROM ${OBSCORE_TABLE}
WHERE dataproduct_type = 'image'
  AND obs_collection = '${DP1_OBS_COLLECTION}'
  AND dataproduct_subtype = '${DP1_VISIT_IMAGE_SUBTYPE}'
  AND CONTAINS(POINT('ICRS', ${ra}, ${dec}), s_region) = 1`;
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

const ACCESS_URL_KEYS = ['access_url', 'accessUrl', 'ACCESS_URL'];
const MJD_KEYS = ['t_min', 'tMin', 'T_MIN', 'mjd'];
const BAND_KEYS = ['lsst_band', 'lsstBand', 'band'];
const SRA_KEYS = ['s_ra', 'sRa', 'S_RA'];
const SDEC_KEYS = ['s_dec', 'sDec', 'S_DEC'];

/**
 * Parse an ObsTAP result into visit-image epochs, SORTED ASCENDING by `t_min`.
 *
 * Honesty/failure modes (mirroring `diaSource.parseDiaSources` / `obscore`):
 *   - A malformed shape (no rows array) → throws.
 *   - Empty rows → a VALID empty array (a position with no visit-images is real).
 *   - A row missing an `access_url`, a resolvable dataset `ID`, or a finite
 *     `t_min` is DROPPED (never fabricated) — we can neither cut it nor place it
 *     in time. The remaining well-formed epochs are returned.
 *
 * The 64-bit dataset `ID` is kept as a STRING (it exceeds 2^53). `s_ra`/`s_dec`
 * are informational footprint centres; when absent they are left NaN (the cutout
 * is taken at the REQUESTED position, not the footprint centre) rather than
 * dropping an otherwise-usable epoch.
 */
export function parseVisitImageEpochs(raw: TapQueryResult): VisitImageEpoch[] {
  if (!raw || !Array.isArray(raw.rows)) {
    throw new Error('parseVisitImageEpochs: expected a TapQueryResult with a rows array');
  }

  const epochs: VisitImageEpoch[] = [];
  for (const row of raw.rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;

    const accessUrl = pickString(r, ACCESS_URL_KEYS);
    const mjd = pickNumber(r, MJD_KEYS);
    // A row with no access_url or no epoch is unusable — drop it, don't invent.
    if (accessUrl === null || mjd === null) continue;

    // Extract the SODA dataset ID from the DataLink access_url. A URL that
    // carries no ID cannot be cut, so drop the row instead of throwing.
    let id: string;
    try {
      id = extractCutoutId(accessUrl);
    } catch {
      continue;
    }

    const sRa = pickNumber(r, SRA_KEYS);
    const sDec = pickNumber(r, SDEC_KEYS);
    epochs.push({
      mjd,
      band: pickString(r, BAND_KEYS),
      accessUrl,
      id,
      ra: sRa ?? NaN,
      dec: sDec ?? NaN,
    });
  }

  // Ascending by epoch — the blink plays oldest → newest. No ORDER BY in the
  // ADQL (dangerous with TOP), so the sort happens here.
  epochs.sort((a, b) => a.mjd - b.mjd);
  return epochs;
}

/* -------------------------------------------------------------------------- */
/* Fetch (network)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Fetch a real DP1 visit-image time series around a position: discover the epochs
 * via ObsCore, then fetch + decode a per-epoch cutout for each (capped).
 *
 * Honesty/failure modes are made VISIBLE, never fake data:
 *   - Unauthenticated → throws a "sign-in required" error and does NOT hit the
 *     network (visit images are DP1 data, auth-gated).
 *   - 401 / 404 / network rejection on the ObsCore query → DISTINCT descriptive throws.
 *   - Empty field → a VALID empty series (epochs [], totalEpochs 0), NOT an error.
 *   - More epochs than `maxEpochs` (or a server MAXREC overflow) → the extra
 *     epochs are dropped but `truncated` is set and `totalEpochs` reported, so the
 *     UI never presents a partial movie as the whole history.
 *   - A per-epoch cutout failing (a 404 gap, a decode error) → that epoch is
 *     SKIPPED and counted in `failedEpochs`; the remaining frames still return.
 *
 * Auth is attached ONLY by the reused `query` / `fetchCutout` clients (the auth
 * module) — no token is hardcoded or passed in here.
 */
export async function fetchVisitImageSeries(
  params: FetchVisitImageSeriesParams
): Promise<VisitImageSeries> {
  const {
    ra,
    dec,
    radiusArcsec = DEFAULT_RADIUS_ARCSEC,
    maxEpochs = DEFAULT_MAX_EPOCHS,
  } = params;

  if (!isAuthenticated()) {
    throw new Error(
      'Sign-in required: live DP1 visit-image time series require an RSP token ' +
        'with DP1 data rights (read:tap + read:image). Sign in to blink real epochs.'
    );
  }

  const cap = Math.max(1, Math.floor(maxEpochs));
  // Discover MORE rows than we will display so `totalEpochs`/`truncated` are honest.
  const discoveryCap = Math.max(cap, DEFAULT_DISCOVERY_CAP);
  const adql = buildVisitImageSeriesAdql({ ra, dec, maxEpochs: discoveryCap });

  let result: TapQueryResult;
  try {
    result = await query(adql, { maxRec: discoveryCap });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\b401\b/.test(message)) {
      throw new Error(
        `Not authorized (401) discovering DP1 visit images: your RSP token is ` +
          `missing DP1 data rights or has expired. (${message})`,
        { cause: err }
      );
    }
    if (/\b404\b/.test(message)) {
      throw new Error(
        `DP1 ObsCore table not found (404) at the TAP endpoint: ${message}`,
        { cause: err }
      );
    }
    throw new Error(
      `Network error discovering DP1 visit images at RA=${ra}, Dec=${dec}: ${message}`,
      { cause: err }
    );
  }

  const allEpochs = parseVisitImageEpochs(result);
  const totalEpochs = allEpochs.length;

  // Empty field is a legitimate answer (DP1 covers only a few small fields).
  if (totalEpochs === 0) {
    return { epochs: [], truncated: false, totalEpochs: 0, failedEpochs: 0 };
  }

  // Cap to the display limit. Truncated when the cap dropped epochs OR the server
  // overflowed the discovery MAXREC (so there may be still more beyond what we saw).
  const capped = allEpochs.slice(0, cap);
  const truncated = totalEpochs > cap || result.status === 'overflow';

  // Per-epoch cutout RADIUS (arcsec) → SODA full-side SIZE (arcsec): the SODA
  // client takes a diameter and halves it internally, so size = 2 * radius.
  const sizeArcsec = finiteNumber(radiusArcsec, 'radiusArcsec') * 2;

  const frames: EpochImage[] = [];
  let failedEpochs = 0;
  for (const epoch of capped) {
    try {
      const fits = await fetchCutout({
        ra,
        dec,
        sizeArcsec,
        id: epoch.id,
        band: epoch.band ?? undefined,
      });
      const image = await readFitsImageAsync(fits);
      frames.push({ ...epoch, image });
    } catch {
      // A single epoch failing (a gap at this position, a decode error) must not
      // sink the whole movie — skip it, count it, keep the rest.
      failedEpochs++;
    }
  }

  return { epochs: frames, truncated, totalEpochs, failedEpochs };
}
