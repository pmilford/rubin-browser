/** HiPS (Hierarchical Progressive Surveys) tile service client */

import {
  order2nside,
  ang2pix_nest,
  pix2ang_nest,
} from '@hscmap/healpix';
import { getAuthHeader } from './auth.js';
import type { HipsProperties } from '../types/image.js';

const HIPS_BASE = 'https://data.lsst.cloud/api/hips';
const DEFAULT_SURVEY = 'images/color_gri';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// --- Coordinate helpers ---------------------------------------------------

/**
 * Convert RA/Dec (degrees) to HEALPix spherical angles (radians).
 * theta = colatitude = (90 - dec) in radians (0 at north pole, pi at south).
 * phi = longitude = ra in radians, normalised to [0, 2pi).
 */
export function radecToThetaPhi(ra: number, dec: number): { theta: number; phi: number } {
  const raNorm = ((ra % 360) + 360) % 360;
  const theta = (90 - dec) * DEG2RAD;
  const phi = raNorm * DEG2RAD;
  return { theta, phi };
}

/**
 * Convert HEALPix spherical angles (radians) back to RA/Dec (degrees).
 * Inverse of radecToThetaPhi.
 */
export function thetaPhiToRadec(theta: number, phi: number): { ra: number; dec: number } {
  const dec = 90 - theta * RAD2DEG;
  let ra = phi * RAD2DEG;
  ra = ((ra % 360) + 360) % 360;
  return { ra, dec };
}

// --- HEALPix wrappers (thin, over @hscmap/healpix) ------------------------

/** Get the Nside value for a HiPS order (Nside = 2^order). */
export function orderToNside(order: number): number {
  return order2nside(order);
}

/**
 * Convert RA/Dec (degrees) to a NESTED HEALPix pixel index at the given Nside.
 * Thin wrapper over ang2pix_nest — self-consistent with getTileCenter/pix2ang_nest.
 */
export function radecToHealpixNest(ra: number, dec: number, nside: number): number {
  const { theta, phi } = radecToThetaPhi(ra, dec);
  return ang2pix_nest(nside, theta, phi);
}

/** Convert a NESTED HEALPix pixel index to RA/Dec (degrees) of the pixel center. */
export function healpixNestToRadec(pixelIndex: number, nside: number): { ra: number; dec: number } {
  const { theta, phi } = pix2ang_nest(nside, pixelIndex);
  return thetaPhiToRadec(theta, phi);
}

/** Convert RA/Dec (degrees) to HiPS tile index at a given order. */
export function radecToTileIndex(ra: number, dec: number, order: number): number {
  const nside = orderToNside(order);
  return radecToHealpixNest(ra, dec, nside);
}

/**
 * Tile center cache: "order-pixelIndex" → { ra, dec }.
 * pix2ang_nest is already O(1) and correct; the cache just avoids repeat work.
 */
const tileCenterCache = new Map<string, { ra: number; dec: number }>();

/**
 * Get the center RA/Dec (degrees) of a HiPS tile.
 *
 * Uses pix2ang_nest (the exact analytic HEALPix pixel center) — O(1) and
 * guaranteed to round-trip: radecToTileIndex(getTileCenter(p)) === p.
 */
export function getTileCenter(pixelIndex: number, order: number): { ra: number; dec: number } {
  const cacheKey = `${order}-${pixelIndex}`;
  const cached = tileCenterCache.get(cacheKey);
  if (cached) return cached;

  const nside = orderToNside(order);
  const result = healpixNestToRadec(pixelIndex, nside);
  tileCenterCache.set(cacheKey, result);
  return result;
}

/** Clear the tile center cache (call when switching surveys). */
export function clearTileCenterCache(): void {
  tileCenterCache.clear();
}

// --- HiPS service I/O -----------------------------------------------------

/** Fetch HiPS properties from the server */
export async function fetchHipsProperties(
  surveyPath: string = DEFAULT_SURVEY
): Promise<HipsProperties> {
  const resp = await fetch(`${HIPS_BASE}/${surveyPath}/properties`, {
    headers: getAuthHeader(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HiPS properties fetch failed (${resp.status}): ${text}`);
  }

  const text = await resp.text();
  return parseProperties(text);
}

/**
 * Parse Java-properties-style key=value text into HipsProperties.
 * Exported so callers with an arbitrary HiPS base URL (public surveys, etc.)
 * can fetch `{baseUrl}/properties` themselves and parse the response.
 */
export function parseHipsProperties(text: string): HipsProperties {
  return parseProperties(text);
}

/** Parse Java-properties-style key=value text into HipsProperties */
function parseProperties(text: string): HipsProperties {
  const props = new Map<string, string>();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    props.set(key, value);
  }

  return {
    title: props.get('obs_title') ?? props.get('creator_did') ?? '',
    hipsOrder: parseInt(props.get('hips_order') ?? '3', 10),
    tileFormat: props.get('hips_tile_format') ?? 'png',
    frame: props.get('hips_frame') ?? 'equatorial',
    tileWidth: parseInt(props.get('hips_tile_width') ?? '512', 10),
  };
}

/** Build tile URL for a given HiPS order and pixel index */
export function buildTileUrl(
  order: number,
  pixelIndex: number,
  format: 'png' | 'jpg' | 'fits' = 'png',
  surveyPath: string = DEFAULT_SURVEY
): string {
  const dir = Math.floor(pixelIndex / 10000) * 10000;
  return `${HIPS_BASE}/${surveyPath}/Norder${order}/Dir${dir}/Npix${pixelIndex}.${format}`;
}

/** Fetch a HiPS tile as an image blob */
export async function fetchTile(
  order: number,
  pixelIndex: number,
  format: 'png' | 'jpg' | 'fits' = 'png',
  surveyPath: string = DEFAULT_SURVEY
): Promise<Blob> {
  const url = buildTileUrl(order, pixelIndex, format, surveyPath);

  const resp = await fetch(url, {
    headers: getAuthHeader(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HiPS tile fetch failed (${resp.status}): ${text}`);
  }

  return resp.blob();
}
