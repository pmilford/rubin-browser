/**
 * Bundled OFFLINE demo dataset — a fixed, seeded synthetic sky rendered entirely
 * in-browser so the viewer shows real-ish imagery with NO network and NO Rubin
 * token. Selected explicitly as the "Offline demo" base layer (never auto-shown,
 * and always labelled SYNTHETIC, so it is not mistaken for a real survey).
 *
 * Built on the deterministic generator in syntheticSky.ts: known source
 * positions, a faint-heavy magnitude distribution, and per-pixel seeded noise.
 * Tiles are cached by the viewer, so each is synthesized at most once.
 */

import {
  generateSyntheticSky,
  renderSyntheticTile,
  type Band,
  type SyntheticSky,
} from './syntheticSky.js';

/** Single epoch used for the offline still image (MJD is arbitrary but fixed). */
export const OFFLINE_MJD = 60000;
/** Offline tiles are rendered at this size (smaller than 512 to keep synth cheap). */
export const OFFLINE_TILE_SIZE = 256;
const OFFLINE_NOISE_SIGMA = 1.5;

let sky: SyntheticSky | null = null;

/** The bundled synthetic sky (full sphere, generated once, lazily). */
export function offlineSky(): SyntheticSky {
  if (!sky) {
    sky = generateSyntheticSky({
      seed: 1,
      nSources: 8000,
      raRange: [0, 360],
      decRange: [-90, 90],
      epochsMjd: [OFFLINE_MJD],
    });
  }
  return sky;
}

/** RGBA raster (OFFLINE_TILE_SIZE²) for one HEALPix tile of the offline sky. */
export function offlineTileRGBA(order: number, pixelIndex: number, band: Band = 'r'): Uint8ClampedArray {
  return renderSyntheticTile(offlineSky(), order, pixelIndex, band, OFFLINE_MJD, OFFLINE_TILE_SIZE, OFFLINE_NOISE_SIGMA);
}
