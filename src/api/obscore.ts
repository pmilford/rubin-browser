/**
 * Rubin DP1 image discovery via ObsTAP (`ivoa.ObsCore`) + DataLink.
 *
 * A SODA image cutout (see `soda.ts`) needs an `ID` naming WHICH image to cut
 * from. DP1 is a set of per-band `deep_coadd` images tiled by tract/patch, so
 * that ID is not known a-priori — it is DISCOVERED. The documented Rubin recipe
 * (dp1.lsst.io tutorial 103.4 "Small image cutouts"; the DP0.2 image-cutout
 * notebook uses the identical RSP flow) is:
 *
 *   1. Query the ObsTAP table `ivoa.ObsCore` for the image whose footprint
 *      (`s_region`) contains the sky position, in the requested band:
 *        obs_collection      = 'LSST.DP1'
 *        dataproduct_type    = 'image'
 *        dataproduct_subtype = 'lsst.deep_coadd'
 *        lsst_band           = '<u|g|r|i|z|y>'
 *        CONTAINS(POINT('ICRS', ra, dec), s_region) = 1
 *      Each row's `access_url` is a DataLink URL of the form
 *        https://data.lsst.cloud/api/datalink/links?ID=<datasetId>
 *      and `access_format` is `application/x-votable+xml;content=datalink`.
 *   2. That `ID` is the dataset identifier the cutout service consumes — DataLink
 *      advertises the `cutout-sync` SODA service (at `.../api/cutout`) and passes
 *      the SAME `ID` through to it. Because the cutout endpoint is stable and
 *      documented (see `soda.ts` `SODA_SYNC_URL`), we extract the `ID` from the
 *      ObsCore `access_url` and hand it to `buildCutoutUrl`, rather than round-
 *      tripping the DataLink VOTable (which would need an XML parser). If Rubin
 *      ever moves the cutout endpoint, the correct fallback is to fetch the
 *      DataLink VOTable and read the `cutout-sync` service's accessURL — noted
 *      here so the shortcut's single assumption is explicit.
 *
 * Confirmed against: dp1.lsst.io tutorials 103.4 / portal-103-5; sdm-schemas.lsst.io
 * ObsTAP (ivoa_obscore) page; lsst-sqre/vo-cutouts + lsst-sqre/datalinker.
 * Endpoint is `https://data.lsst.cloud/api/tap/sync` (ObsTAP shares the TAP
 * service in `tap.ts` — NOT `dp02_dc2_catalogs.*`, which is DP0.2).
 */

import { query } from './tap.js';
import { LIGHTCURVE_BANDS } from './lightcurve.js';
import type { TapQueryResult } from '../types/catalog.js';

/** ObsTAP image-metadata table shared by all RSP data releases. */
export const OBSCORE_TABLE = 'ivoa.ObsCore';

/** DP1's ObsCore `obs_collection` value. */
export const DP1_OBS_COLLECTION = 'LSST.DP1';

/** ObsCore `dataproduct_subtype` for a DP1 deep-coadd image (the cutout source). */
export const DP1_DEEP_COADD_SUBTYPE = 'lsst.deep_coadd';

export interface ObsCoreImageQueryParams {
  /** Right ascension, degrees (ICRS). */
  ra: number;
  /** Declination, degrees (ICRS). */
  dec: number;
  /** LSST band (u,g,r,i,z,y) — selects which per-band coadd to find. */
  band: string;
  /** ObsCore dataproduct_subtype. Default {@link DP1_DEEP_COADD_SUBTYPE}. */
  subtype?: string;
  /** Row cap. Default 100 (a point falls in at most a couple of overlapping patches). */
  maxRecords?: number;
}

/** One discovered ObsCore image row (the subset the cutout flow needs). */
export interface ObsCoreImage {
  /** DataLink URL carrying the dataset `ID` (`.../api/datalink/links?ID=...`). */
  accessUrl: string;
  /** ObsCore `access_format` (expected: the DataLink VOTable content-type). */
  accessFormat?: string;
  /** `dataproduct_subtype` (e.g. `lsst.deep_coadd`). */
  subtype?: string;
  /** LSST tract number. */
  tract?: number;
  /** LSST patch number. */
  patch?: number;
  /** LSST band. */
  band?: string;
  /** Image footprint centre RA, degrees (ObsCore `s_ra`). */
  sRa?: number;
  /** Image footprint centre Dec, degrees (ObsCore `s_dec`). */
  sDec?: number;
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
 * Validate a band against the LSST allowlist. `band` and `subtype` are the only
 * strings interpolated into ADQL literals, so allowlisting the band (and quote-
 * rejecting the subtype below) is the injection guard; ra/dec are numeric.
 */
function validateBand(band: string): string {
  if ((LIGHTCURVE_BANDS as readonly string[]).includes(band)) return band;
  throw new Error(
    `Invalid band '${band}'. Expected one of: ${LIGHTCURVE_BANDS.join(', ')}`
  );
}

/** Reject a subtype containing a single quote (the ADQL string delimiter). */
function safeSubtype(subtype: string): string {
  if (subtype.includes("'")) {
    throw new Error(`Invalid dataproduct_subtype '${subtype}': must not contain a quote`);
  }
  return subtype;
}

/**
 * Build the ObsCore ADQL that finds the DP1 image covering a sky position in a
 * band. PURE and testable. Uses `CONTAINS(POINT, s_region)` so it returns the
 * coadd whose FOOTPRINT actually contains the point (not merely a nearby centre).
 */
export function buildObsCoreImageQuery(params: ObsCoreImageQueryParams): string {
  const ra = formatDeg(finiteNumber(params.ra, 'ra'));
  const dec = formatDeg(finiteNumber(params.dec, 'dec'));
  const band = validateBand(params.band);
  const subtype = safeSubtype(params.subtype ?? DP1_DEEP_COADD_SUBTYPE);
  const top = Math.max(1, Math.floor(params.maxRecords ?? 100));

  return `SELECT TOP ${top}
  access_format, access_url, dataproduct_subtype,
  lsst_tract, lsst_patch, lsst_band, s_ra, s_dec
FROM ${OBSCORE_TABLE}
WHERE dataproduct_type = 'image'
  AND obs_collection = '${DP1_OBS_COLLECTION}'
  AND dataproduct_subtype = '${subtype}'
  AND lsst_band = '${band}'
  AND CONTAINS(POINT('ICRS', ${ra}, ${dec}), s_region) = 1`;
}

/* -------------------------------------------------------------------------- */
/* Parsing + ID extraction                                                    */
/* -------------------------------------------------------------------------- */

/** First finite numeric value among candidate keys, else undefined. */
function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

/** First non-empty string value among candidate keys, else undefined. */
function pickString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Parse an ObsTAP result into typed image rows. Rows without an `access_url`
 * (the DataLink pointer we cannot use) are dropped — we never fabricate one.
 */
export function parseObsCoreImages(raw: TapQueryResult): ObsCoreImage[] {
  if (!raw || !Array.isArray(raw.rows)) {
    throw new Error('parseObsCoreImages: expected a TapQueryResult with a rows array');
  }
  const images: ObsCoreImage[] = [];
  for (const row of raw.rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const accessUrl = pickString(r, ['access_url', 'accessUrl', 'ACCESS_URL']);
    if (!accessUrl) continue;
    const image: ObsCoreImage = { accessUrl };
    const accessFormat = pickString(r, ['access_format', 'accessFormat']);
    if (accessFormat) image.accessFormat = accessFormat;
    const subtype = pickString(r, ['dataproduct_subtype', 'dataproductSubtype']);
    if (subtype) image.subtype = subtype;
    const tract = pickNumber(r, ['lsst_tract', 'lsstTract']);
    if (tract !== undefined) image.tract = tract;
    const patch = pickNumber(r, ['lsst_patch', 'lsstPatch']);
    if (patch !== undefined) image.patch = patch;
    const band = pickString(r, ['lsst_band', 'lsstBand', 'band']);
    if (band) image.band = band;
    const sRa = pickNumber(r, ['s_ra', 'sRa']);
    if (sRa !== undefined) image.sRa = sRa;
    const sDec = pickNumber(r, ['s_dec', 'sDec']);
    if (sDec !== undefined) image.sDec = sDec;
    images.push(image);
  }
  return images;
}

/**
 * Extract the SODA dataset `ID` from an ObsCore DataLink `access_url` — the value
 * of the `ID` query parameter of `.../api/datalink/links?ID=<datasetId>`. PURE.
 * Throws (never returns a placeholder) when the URL carries no `ID`, so a bad
 * discovery surfaces honestly instead of building a cutout request for nothing.
 */
export function extractCutoutId(accessUrl: string): string {
  if (typeof accessUrl !== 'string' || accessUrl.length === 0) {
    throw new Error('extractCutoutId: empty access_url');
  }
  // Parse the query string whether or not the URL has a scheme/host.
  const q = accessUrl.indexOf('?');
  const search = q >= 0 ? accessUrl.slice(q + 1) : accessUrl;
  const params = new URLSearchParams(search);
  // ObsCore/DataLink uses `ID`; accept a few casings defensively.
  const id = params.get('ID') ?? params.get('id') ?? params.get('Id');
  if (!id) {
    throw new Error(
      `Could not extract a cutout ID from the ObsCore access_url (no ID parameter): ${accessUrl}`
    );
  }
  return id;
}

/* -------------------------------------------------------------------------- */
/* Discovery (network)                                                        */
/* -------------------------------------------------------------------------- */

/** A resolved cutout target: the dataset ID plus the ObsCore row it came from. */
export interface CutoutTarget {
  /** SODA `ID` to pass to `buildCutoutUrl` / `fetchCutout`. */
  id: string;
  /** The ObsCore image row the ID was discovered from. */
  image: ObsCoreImage;
}

/**
 * Discover the SODA cutout `ID` for the DP1 deep-coadd covering (ra,dec) in a
 * band, by querying ObsTAP via the shared TAP `query()` client (which attaches
 * the RSP bearer token). Throws descriptive, honest errors — never fake data:
 *   - the ObsCore query fails (auth/CORS/endpoint) → wrapped with context;
 *   - zero rows → "no DP1 deep_coadd covers this position" (DP1 is a few fields);
 *   - a row with no resolvable ID → surfaced by `extractCutoutId`.
 * When several patches overlap the point, picks the one whose footprint centre
 * (`s_ra`,`s_dec`) is nearest the requested position.
 */
export async function discoverCutoutId(
  params: ObsCoreImageQueryParams
): Promise<CutoutTarget> {
  const adql = buildObsCoreImageQuery(params);

  let result: TapQueryResult;
  try {
    result = await query(adql, { maxRec: params.maxRecords ?? 100 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to discover a DP1 image at RA=${params.ra}, Dec=${params.dec} ` +
        `(band ${params.band}): ${message}. This requires an RSP token with DP1 data rights.`,
      { cause: err }
    );
  }

  const images = parseObsCoreImages(result);
  if (images.length === 0) {
    throw new Error(
      `No DP1 ${params.subtype ?? DP1_DEEP_COADD_SUBTYPE} image covers RA=${params.ra}, ` +
        `Dec=${params.dec} in band ${params.band}. DP1 covers only a few small fields.`
    );
  }

  const chosen = nearestImage(images, params.ra, params.dec);
  return { id: extractCutoutId(chosen.accessUrl), image: chosen };
}

/** Pick the image whose footprint centre is nearest (ra,dec); first if no centres. */
function nearestImage(images: ObsCoreImage[], ra: number, dec: number): ObsCoreImage {
  let best = images[0]!;
  let bestD = Infinity;
  for (const img of images) {
    if (img.sRa === undefined || img.sDec === undefined) continue;
    const dRa = ((img.sRa - ra + 540) % 360) - 180; // shortest angular RA delta
    const dDec = img.sDec - dec;
    const d = dRa * dRa + dDec * dDec; // planar proxy is fine for tie-breaking
    if (d < bestD) {
      bestD = d;
      best = img;
    }
  }
  return best;
}
