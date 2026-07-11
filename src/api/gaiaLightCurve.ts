/**
 * Gaia DR2 epoch photometry (variable-star light curves) from the CORS-enabled
 * GAVO mirror — the ONE Gaia light-curve source reachable from the browser.
 *
 * VALIDATED LIVE (dc.zah.uni-heidelberg.de, anonymous, 2026-07): the DR3 epoch
 * photometry at ESA returns data but sends NO Access-Control-Allow-Origin (browser-
 * blocked); GAVO's `gaia.dr2epochflux` is CORS-enabled and holds the ~550k
 * DR2-published variables. It is ONE ROW PER SOURCE with ARRAY-valued columns
 * (`g_transit_time[]`, `g_transit_flux[]`, `bp_obs_time[]`, `bp_flux[]`,
 * `rp_obs_time[]`, `rp_flux[]`), and carries NO position — so we cone-search by
 * JOINing `gaia.dr2light` (which has ra/dec). A small (arcsec) cone runs in ~1 s.
 *
 * IMPORTANT: DR2 `source_id`s are NOT the DR3 ids in the overlay (dr3lite) — the
 * catalogs are cross-matched by POSITION here, never by id. Fluxes are e-/s;
 * magnitude = ZP − 2.5·log10(flux) with the DR2 VEGAMAG zero points below.
 */

import { GAIA_TAP_SYNC_URL } from './gaia.js';

/** DR2 VEGAMAG zero points (mag = ZP − 2.5·log10(flux[e-/s])). Gaia DR2 docs. */
export const GAIA_DR2_ZERO_POINT = { g: 25.6884, bp: 25.3514, rp: 24.7619 } as const;

/** Gaia epoch time is JD−2455197.5; MJD = JD − 2400000.5 = time + 55197.0. */
const GAIA_TIME_TO_MJD = 55197.0;

export type GaiaBand = 'g' | 'bp' | 'rp';

/** One epoch of a Gaia light curve. `intensity` = flux (e-/s) for LightCurvePlot. */
export interface GaiaLcPoint {
  mjd: number;
  intensity: number;
  mag: number;
}

/** A single Gaia DR2 variable source's multi-band epoch photometry. */
export interface GaiaVariable {
  /** DR2 source id as a string label (NOT a DR3 id). */
  sourceId: string;
  g: GaiaLcPoint[];
  bp: GaiaLcPoint[];
  rp: GaiaLcPoint[];
  /** Total transit count across bands — a quick "how variable-rich" indicator. */
  nEpochs: number;
}

export interface GaiaLightCurveParams {
  ra: number;
  dec: number;
  /** Cone radius in ARCSECONDS (a click-scale match; the join is O(cone)). */
  radiusArcsec: number;
  /** Cap on sources returned (default 3 — usually 0 or 1 near a click). */
  maxSources?: number;
}

function finite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected a finite number, got ${String(value)}`);
  }
  return value;
}

/**
 * Cone-search ADQL for DR2 epoch photometry near a sky position, joining
 * `gaia.dr2light` for the position `gaia.dr2epochflux` lacks. Radius arcsec→deg at
 * the boundary; keep it SMALL (a full-catalog join over a wide cone is slow).
 */
export function buildGaiaEpochPhotometryAdql(params: GaiaLightCurveParams): string {
  const ra = finite(params.ra, 'ra');
  const dec = finite(params.dec, 'dec');
  const radius = finite(params.radiusArcsec, 'radiusArcsec');
  if (radius <= 0) throw new Error(`Invalid radiusArcsec: must be > 0, got ${radius}`);
  const radiusDeg = radius / 3600;
  const top = Math.max(1, Math.floor(params.maxSources ?? 3));
  return `SELECT TOP ${top}
  ef.source_id,
  ef.g_transit_time, ef.g_transit_flux,
  ef.bp_obs_time, ef.bp_flux,
  ef.rp_obs_time, ef.rp_flux
FROM gaia.dr2epochflux AS ef
JOIN gaia.dr2light AS l ON l.source_id = ef.source_id
WHERE 1 = CONTAINS(POINT('ICRS', l.ra, l.dec), CIRCLE('ICRS', ${ra}, ${dec}, ${radiusDeg}))`;
}

/** Build a band's point list from parallel time/flux arrays, dropping nulls. */
function bandPoints(times: unknown, fluxes: unknown, zp: number): GaiaLcPoint[] {
  if (!Array.isArray(times) || !Array.isArray(fluxes)) return [];
  const pts: GaiaLcPoint[] = [];
  const n = Math.min(times.length, fluxes.length);
  for (let i = 0; i < n; i++) {
    const t = times[i];
    const f = fluxes[i];
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    if (typeof f !== 'number' || !Number.isFinite(f) || f <= 0) continue;
    pts.push({ mjd: t + GAIA_TIME_TO_MJD, intensity: f, mag: zp - 2.5 * Math.log10(f) });
  }
  pts.sort((a, b) => a.mjd - b.mjd);
  return pts;
}

/**
 * Parse a GAVO `gaia.dr2epochflux` response (columns addressed BY NAME, array
 * cells are nested arrays) into per-source multi-band light curves. Tolerates the
 * `columns` (GAVO) or `metadata` (ESA) descriptor key. Empty data → [].
 */
export function parseGaiaEpochPhotometry(raw: unknown): GaiaVariable[] {
  if (!raw || typeof raw !== 'object') {
    throw new Error('parseGaiaEpochPhotometry: expected a Gaia TAP JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const descriptors = Array.isArray(obj.columns) ? obj.columns : obj.metadata;
  if (!Array.isArray(descriptors)) {
    throw new Error('parseGaiaEpochPhotometry: missing column descriptors (columns/metadata)');
  }
  const col = new Map<string, number>();
  descriptors.forEach((d, i) => {
    const name = d && typeof d === 'object' ? (d as Record<string, unknown>).name : undefined;
    if (typeof name === 'string') col.set(name.toLowerCase(), i);
  });
  const at = (row: unknown[], name: string): unknown => {
    const i = col.get(name);
    return i === undefined ? undefined : row[i];
  };

  const data = Array.isArray(obj.data) ? (obj.data as unknown[][]) : [];
  const out: GaiaVariable[] = [];
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const g = bandPoints(at(row, 'g_transit_time'), at(row, 'g_transit_flux'), GAIA_DR2_ZERO_POINT.g);
    const bp = bandPoints(at(row, 'bp_obs_time'), at(row, 'bp_flux'), GAIA_DR2_ZERO_POINT.bp);
    const rp = bandPoints(at(row, 'rp_obs_time'), at(row, 'rp_flux'), GAIA_DR2_ZERO_POINT.rp);
    const rawId = at(row, 'source_id');
    out.push({
      sourceId: rawId === null || rawId === undefined ? '' : String(rawId),
      g,
      bp,
      rp,
      nEpochs: g.length + bp.length + rp.length,
    });
  }
  return out;
}

/**
 * Fetch Gaia DR2 variable-star light curves near a sky position from GAVO (no
 * auth — Gaia is open). Returns the sources found (usually 0 or 1 near a click);
 * an empty array means "no DR2 variable here" (only ~550k sources are published),
 * which the caller surfaces honestly. Throws on network/CORS/HTTP failure.
 */
export async function fetchGaiaLightCurves(params: GaiaLightCurveParams): Promise<GaiaVariable[]> {
  const adql = buildGaiaEpochPhotometryAdql(params);
  const body = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'json',
    QUERY: adql,
  });

  let resp: Response;
  try {
    resp = await fetch(GAIA_TAP_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach the Gaia TAP service (network or CORS): ${message}`, { cause: err });
  }
  if (!resp.ok) {
    let detail = '';
    try {
      detail = await resp.text();
    } catch {
      /* status is the signal */
    }
    throw new Error(`Gaia epoch-photometry query failed (${resp.status}): ${detail}`);
  }
  let json: unknown;
  try {
    json = await resp.json();
  } catch (err) {
    throw new Error('Gaia epoch-photometry returned an unparseable JSON body', { cause: err });
  }
  return parseGaiaEpochPhotometry(json);
}
