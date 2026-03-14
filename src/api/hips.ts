/** HiPS (Hierarchical Progressive Surveys) tile service client */

import { getAuthHeader } from './auth.js';
import type { HipsProperties } from '../types/image.js';

const HIPS_BASE = 'https://data.lsst.cloud/api/hips';
const DEFAULT_SURVEY = 'images/color_gri';

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

/** Get the Nside value for a HiPS order */
export function orderToNside(order: number): number {
  return 2 ** order;
}

/** Convert RA/Dec (degrees) to HiPS tile index at a given order */
export function radecToTileIndex(ra: number, dec: number, order: number): number {
  const nside = orderToNside(order);
  return radecToHealpixNest(ra, dec, nside);
}

/** Calculate tile pixel index from RA/Dec using simplified HEALPix NESTED scheme */
export function radecToHealpixNest(ra: number, dec: number, nside: number): number {
  const totalPixels = 12 * nside * nside;

  // Normalize RA to [0, 360)
  const raNorm = ((ra % 360) + 360) % 360;
  const phi = (raNorm * Math.PI) / 180;
  const theta = (Math.PI / 2) - (dec * Math.PI) / 180;

  const z = Math.cos(theta);
  const za = Math.abs(z);
  const twoPi = 2 * Math.PI;

  let faceIndex: number;
  let ix: number;
  let iy: number;

  if (za <= 2 / 3) {
    // Equatorial belt
    const temp = nside * (0.5 + phi / twoPi);
    const jp = Math.floor(nside * (0.5 + phi / twoPi - z * 0.75));
    const jm = Math.floor(nside * (0.5 + phi / twoPi + z * 0.75));

    const ifp = Math.floor(jp / nside); // face column
    const ifm = Math.floor(jm / nside); // face row

    // Determine face from column/row
    faceIndex = (ifp === ifm)
      ? (ifp % 4) + 4
      : (ifp < ifm)
        ? ifp % 4
        : (ifm % 4) + 8;

    ix = jm % nside;
    iy = nside - (jp % nside) - 1;
  } else {
    // Polar caps
    const ntt = Math.min(Math.floor(phi / (Math.PI / 2)), 3);
    const tp = phi / (Math.PI / 2) - ntt;
    const tmp = nside * Math.sqrt(3 * (1 - za));

    const jp = Math.max(Math.floor(tp * tmp), 0);
    const jm = Math.max(Math.floor((1 - tp) * tmp), 0);

    const jpClamped = Math.min(jp, nside - 1);
    const jmClamped = Math.min(jm, nside - 1);

    if (z > 0) {
      // North polar cap
      faceIndex = ntt;
      ix = nside - jmClamped - 1;
      iy = nside - jpClamped - 1;
    } else {
      // South polar cap
      faceIndex = ntt + 8;
      ix = jpClamped;
      iy = jmClamped;
    }
  }

  // Convert (face, ix, iy) to NESTED pixel index
  return faceIndex * nside * nside + xy2nest(ix, iy);
}

/** Convert (x, y) within a face to NESTED sub-index using bit interleaving */
function xy2nest(ix: number, iy: number): number {
  return spreadBits(ix) | (spreadBits(iy) << 1);
}

/** Spread bits of a value: insert a 0 bit between each bit */
function spreadBits(v: number): number {
  let x = v & 0xffff;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  return x;
}
