/**
 * SODA image-cutout client for Rubin DP1.
 *
 * SODA (IVOA Server-side Operations for Data Access) is the standard way to ask
 * an archive for a *cutout* of an image around a sky position. This module builds
 * a SODA "sync" request against Rubin's cutout service and returns the raw FITS
 * bytes, which pair with `src/utils/fits.ts` (`readFits` → `percentileClip` →
 * scaling → canvas) so the viewer can display honest *linear-float* pixels rather
 * than pre-stretched 8-bit HiPS JPEGs.
 *
 * Endpoint (assumption, documented honestly): Rubin's Data Access Center exposes
 * the image cutout service under `https://data.lsst.cloud/api/cutout` (the RSP
 * `vo-cutouts`/`soda` app), alongside the TAP endpoint `.../api/dp1` used by
 * `tap.ts`/`lightcurve.ts`. The DP1 docs / RSP DataLink point at the same host.
 * The exact sync path is not pinned down in this repo, so it is exported as the
 * single const `SODA_SYNC_URL` — change it in ONE place if the deployed path
 * differs, and every URL/test tracks it. We build the request with the IVOA
 * `POS=CIRCLE <ra> <dec> <radiusDeg>` parameter (degrees, ICRS), which is the
 * trivially-correct, testable spatial form.
 *
 * Auth: cutouts are DP1 data and require an RSP token with the `read:image`
 * scope. Like every client here, auth comes ONLY from `./auth.js`
 * (`getAuthHeader()` / `isAuthenticated()`) — never a hardcoded or passed-in
 * token. When not signed in, `fetchCutout` throws BEFORE any network call.
 *
 * Failure modes are made VISIBLE via thrown, descriptive errors (never silent,
 * never fake bytes): not-signed-in, 401/403 (token rejected / no data rights),
 * 404 (no cutout here — DP1 covers only a few small fields), network/CORS
 * (service unreachable), and an empty body.
 */

import { getAuthHeader, isAuthenticated } from './auth.js';
import { toRequestUrl } from './rspProxy.js';

/**
 * Base host for Rubin Data Access services (same host as the DP1 TAP endpoint in
 * `tap.ts`: `https://data.lsst.cloud/api/dp1`). Cutouts live under `/api/cutout`.
 */
export const SODA_BASE = 'https://data.lsst.cloud/api/cutout';

/**
 * The SODA synchronous cutout endpoint. Single source of truth for the cutout
 * URL — see the file header for why the path is an explicit, documented
 * assumption. A sync request returns the cutout bytes directly in the response
 * (no UWS job polling), which is all the viewer needs for a single postage stamp.
 */
export const SODA_SYNC_URL = `${SODA_BASE}/sync`;

export interface CutoutParams {
  /** Right ascension of the cutout centre, degrees (ICRS). */
  ra: number;
  /** Declination of the cutout centre, degrees (ICRS). */
  dec: number;
  /**
   * Full side/diameter of the cutout in ARCSECONDS. Converted to a CIRCLE
   * *radius* in DEGREES at the API boundary: radiusDeg = sizeArcsec / 2 / 3600.
   */
  sizeArcsec: number;
  /**
   * SODA dataset identifier (`ID`) selecting WHICH image to cut from — normally
   * obtained from a DataLink discovery step. DP1 is a set of per-band deep
   * coadds, so the band is encoded in this ID, not in the spatial parameters.
   * Optional here so `buildCutoutUrl` stays testable without a live discovery.
   */
  id?: string;
  /**
   * Optional LSST band (u,g,r,i,z,y). DP1 selects band via the dataset `ID`
   * (above) during DataLink discovery, NOT via the SODA spatial request, so this
   * is carried for a discovery step and deliberately not injected as a spectral
   * SODA `BAND` param (which is a wavelength range in metres, a different thing).
   */
  band?: string;
}

/** Guard a coordinate/size: reject NaN/Infinity so nothing unsafe is emitted. */
function finiteNumber(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected a finite number, got ${String(value)}`);
  }
  return value;
}

/**
 * Format a degree value for the SODA query without scientific notation (some
 * VO parsers reject `1e-7`). Normal magnitudes stringify cleanly; only extreme
 * values are expanded via toFixed.
 */
function formatDeg(value: number): string {
  const s = String(value);
  if (!/e/i.test(s)) return s;
  return value.toFixed(12);
}

/**
 * Build the SODA sync cutout URL for a sky position — PURE and testable.
 *
 * Emits `POS=CIRCLE <ra> <dec> <radiusDeg>` (ICRS, degrees) and, when supplied,
 * the dataset `ID`. The arcsec→degrees conversion happens HERE, at the boundary:
 * radiusDeg = sizeArcsec / 2 / 3600 (sizeArcsec is a full width/diameter, SODA
 * CIRCLE wants a radius).
 */
export function buildCutoutUrl(params: CutoutParams): string {
  const ra = finiteNumber(params.ra, 'ra');
  const dec = finiteNumber(params.dec, 'dec');
  const sizeArcsec = finiteNumber(params.sizeArcsec, 'sizeArcsec');
  if (sizeArcsec <= 0) {
    throw new Error(`Invalid sizeArcsec: must be > 0, got ${sizeArcsec}`);
  }

  // arcsec (full size) → degrees (radius), at the boundary.
  const radiusDeg = sizeArcsec / 2 / 3600;

  const query = new URLSearchParams();
  if (params.id !== undefined) {
    query.set('ID', params.id);
  }
  query.set(
    'POS',
    `CIRCLE ${formatDeg(ra)} ${formatDeg(dec)} ${formatDeg(radiusDeg)}`
  );

  return `${SODA_SYNC_URL}?${query.toString()}`;
}

/**
 * Fetch a FITS image cutout around a sky position from Rubin's SODA service.
 *
 * Returns the raw FITS bytes as an `ArrayBuffer` (feed straight into
 * `readFits`). Cutouts require an RSP token with `read:image`:
 *   - Not signed in → throws BEFORE any network call (does not "try anyway").
 *   - 401/403       → token rejected / lacks DP1 data rights.
 *   - 404           → no cutout at this position (DP1 covers only a few fields).
 *   - network/CORS  → could not reach the cutout service.
 *   - empty body    → empty cutout.
 *
 * Auth is attached via `getAuthHeader()` — the single source of truth. No token
 * is ever hardcoded or accepted as a parameter.
 */
export async function fetchCutout(params: CutoutParams): Promise<ArrayBuffer> {
  // Gate on auth FIRST — do not fire a request that is guaranteed to fail with a
  // confusing 401. Surface the honest "sign in" instruction instead.
  if (!isAuthenticated()) {
    throw new Error(
      'Rubin cutouts require sign-in (read:image): set an RSP token with DP1 ' +
        'data rights before requesting an image cutout.'
    );
  }

  const url = buildCutoutUrl(params);

  let resp: Response;
  try {
    resp = await fetch(toRequestUrl(url), {
      headers: { ...getAuthHeader() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach the cutout service at ${SODA_SYNC_URL} ` +
        `(network or CORS error): ${message}`,
      { cause: err }
    );
  }

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        `Cutout request rejected (${resp.status}): the RSP token was rejected or ` +
          'lacks DP1 data rights (read:image) for this image.'
      );
    }
    if (resp.status === 404) {
      throw new Error(
        `No cutout at this position (${resp.status}) for RA=${params.ra}, ` +
          `Dec=${params.dec}. DP1 covers only a few small fields.`
      );
    }
    let detail = '';
    try {
      detail = await resp.text();
    } catch {
      /* body may be unreadable; the status is the signal */
    }
    throw new Error(`Cutout request failed (${resp.status}): ${detail}`);
  }

  const buffer = await resp.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error(
      `Empty cutout: the service returned no bytes for RA=${params.ra}, ` +
        `Dec=${params.dec} (size ${params.sizeArcsec}").`
    );
  }

  return buffer;
}
