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
  magAt,
  BANDS,
  type Band,
  type SyntheticSky,
} from './syntheticSky.js';

/**
 * The offline sky is a multi-EPOCH, multi-BAND cube. Epochs are a fixed,
 * deterministic time axis (MJD); the generator anchors transient/supernova peaks
 * WITHIN this window (see generateSyntheticSky), so blinking through epochs shows
 * sources visibly rise and fade. Time and band are independent browsing axes.
 */
const OFFLINE_EPOCH_COUNT = 12;
const OFFLINE_EPOCH_START = 60000;
const OFFLINE_EPOCH_STEP_DAYS = 30;

/** Deterministic epoch (MJD) time axis: 12 epochs, 30 days apart. */
export const OFFLINE_EPOCHS: readonly number[] = Array.from(
  { length: OFFLINE_EPOCH_COUNT },
  (_unused, i) => OFFLINE_EPOCH_START + i * OFFLINE_EPOCH_STEP_DAYS
);

/** The bands available in the offline cube (Rubin g,r,i,z,y — no u). */
export const OFFLINE_BANDS: readonly Band[] = BANDS;

/** Default/first epoch used when a caller does not specify one (back-compat). */
export const OFFLINE_MJD = OFFLINE_EPOCHS[0]!;
/** Offline tiles are rendered at this size (smaller than 512 to keep synth cheap). */
export const OFFLINE_TILE_SIZE = 256;
const OFFLINE_NOISE_SIGMA = 1.5;

let sky: SyntheticSky | null = null;

/** The bundled synthetic sky (full sphere, all epochs+bands, generated once, lazily). */
export function offlineSky(): SyntheticSky {
  if (!sky) {
    sky = generateSyntheticSky({
      seed: 1,
      nSources: 8000,
      raRange: [0, 360],
      decRange: [-90, 90],
      epochsMjd: [...OFFLINE_EPOCHS],
      // Wide beam so point sources actually cover a browsing-order tile pixel
      // (12–80″ across at orders 4–6). At native ~1″ seeing they point-sample to
      // nothing between pixel centres — the sky would look like flat noise and a
      // transient blink would be invisible. See SyntheticSkyConfig.fwhmArcsecRange.
      fwhmArcsecRange: [45, 90],
    });
  }
  return sky;
}

/**
 * RGBA raster (OFFLINE_TILE_SIZE²) for one HEALPix tile of the offline sky at a
 * given band and epoch. `band` and `mjd` are independent: `band` selects
 * wavelength, `mjd` selects time (drives per-source light curves + per-epoch
 * noise). Defaults reproduce the original single-epoch r-band still.
 */
export function offlineTileRGBA(
  order: number,
  pixelIndex: number,
  band: Band = 'r',
  mjd: number = OFFLINE_MJD
): Uint8ClampedArray {
  return renderSyntheticTile(offlineSky(), order, pixelIndex, band, mjd, OFFLINE_TILE_SIZE, OFFLINE_NOISE_SIGMA);
}

/**
 * The brightest transient/supernova event in the offline cube (the variable
 * source whose flux peaks highest over the epoch axis), with the epoch indices at
 * which it is brightest and faintest in `band`. Computed from the deterministic
 * sky — NOT hardcoded — so it stays correct if generation params change. Used to
 * point tests (and a "jump to demo transient" affordance) at a source that is
 * guaranteed to visibly rise and fade when blinking through epochs.
 */
export function brightestOfflineVariable(band: Band = 'r'): {
  ra: number;
  dec: number;
  brightEpochIndex: number;
  faintEpochIndex: number;
} {
  let best: SyntheticSky['sources'][number] | null = null;
  let bestMinMag = Infinity;
  for (const s of offlineSky().sources) {
    if (s.variability.kind !== 'transient' && s.variability.kind !== 'supernova') continue;
    let minMag = Infinity;
    for (const e of OFFLINE_EPOCHS) minMag = Math.min(minMag, magAt(s, band, e));
    if (minMag < bestMinMag) { bestMinMag = minMag; best = s; }
  }
  if (!best) throw new Error('offline sky has no transient/supernova sources');
  let brightIdx = 0, faintIdx = 0, bMag = Infinity, fMag = -Infinity;
  OFFLINE_EPOCHS.forEach((e, i) => {
    const m = magAt(best!, band, e);
    if (m < bMag) { bMag = m; brightIdx = i; }
    if (m > fMag) { fMag = m; faintIdx = i; }
  });
  return { ra: best.ra, dec: best.dec, brightEpochIndex: brightIdx, faintEpochIndex: faintIdx };
}
