/**
 * Ground-truth test for the offline image-differencing pipeline (feature 108):
 * offlineIntensityFrame → differenceImages → detectTransients on the synthetic
 * cube, whose brightest transient's position + bright/faint epochs are KNOWN
 * (brightestOfflineVariable). A broken differencer (returns B, flags everything,
 * or cancels a saturating source) FAILS these assertions.
 */

import { describe, it, expect } from 'vitest';
import {
  offlineIntensityFrame,
  OFFLINE_TILE_SIZE as TS,
  OFFLINE_EPOCHS,
  brightestOfflineVariable,
} from '../../src/data/offlineDataset.js';
import { differenceImages, detectTransients } from '../../src/utils/imageDiff.js';
import { radecToTileIndex } from '../../src/api/hips.js';

const ORDER = 6;

function argmax(data: Float64Array): { x: number; y: number; v: number } {
  let bi = 0;
  for (let i = 1; i < data.length; i++) if (data[i]! > data[bi]!) bi = i;
  return { x: bi % TS, y: Math.floor(bi / TS), v: data[bi]! };
}

describe('offline image-differencing pipeline', () => {
  // Noisy frames (as the panel differences): noise-free frames cancel exactly, so
  // the diff has zero spread and nothing is "significant" (a correct no-op).
  const NOISE = 1.5;
  const t = brightestOfflineVariable('r');
  const pix = radecToTileIndex(t.ra, t.dec, ORDER);
  const faint = offlineIntensityFrame(ORDER, pix, 'r', OFFLINE_EPOCHS[t.faintEpochIndex]!, NOISE);
  const bright = offlineIntensityFrame(ORDER, pix, 'r', OFFLINE_EPOCHS[t.brightEpochIndex]!, NOISE);

  it('detects the transient near its true position, with positive (appeared) polarity', () => {
    const { diff } = differenceImages(faint, bright, TS, TS, { method: 'median' }); // B(bright) − A(faint) > 0 at the source
    const peak = argmax(diff);
    const dets = detectTransients(diff, TS, TS, { nSigma: 5, maxDetections: 20 });

    expect(dets.length).toBeGreaterThan(0);
    // The strongest detection sits on the brightest diff pixel (the transient),
    // not on a static source (which cancels to ~0).
    const top = dets[0]!;
    expect(Math.hypot(top.x - peak.x, top.y - peak.y)).toBeLessThan(8);
    expect(top.peak).toBeGreaterThan(0); // appeared/brightened, not faded
    expect(top.significance).toBeGreaterThan(5);
  });

  it('finds ZERO transients when differencing an epoch against itself', () => {
    const { diff } = differenceImages(bright, bright, TS, TS, { method: 'median' });
    const dets = detectTransients(diff, TS, TS, { nSigma: 5 });
    expect(dets.length).toBe(0); // identical epochs → no change → no detection
  });

  it('reverses polarity when A and B are swapped (faded, not appeared)', () => {
    // Bright(A) − faint(B) < 0 at the source; default sign:'positive' drops it.
    const { diff } = differenceImages(bright, faint, TS, TS, { method: 'median' });
    const positive = detectTransients(diff, TS, TS, { nSigma: 5, sign: 'positive' });
    const negative = detectTransients(diff, TS, TS, { nSigma: 5, sign: 'negative' });
    expect(positive.length).toBe(0);
    expect(negative.length).toBeGreaterThan(0);
    expect(negative[0]!.peak).toBeLessThan(0);
  });
});
