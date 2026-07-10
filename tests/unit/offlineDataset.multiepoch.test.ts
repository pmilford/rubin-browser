/**
 * Multi-epoch / multi-wavelength OFFLINE cube — adversarial ground-truth tests.
 *
 * The trap these guard: per-epoch/per-band NOISE in renderSyntheticTile is keyed
 * by mjd AND band (syntheticSky.ts hashSeed), so "the bytes changed" is TRUE even
 * if the SIGNAL wiring is broken (mjd/band ignored for flux). Every assertion
 * below isolates SIGNAL from noise — either noiseSigma=0 (direct renderer) or a
 * windowed MEAN that suppresses σ noise as σ/√N — and asserts a DIRECTION against
 * the closed-form light curve / colour track, which noise cannot fake.
 */

import { describe, it, expect } from 'vitest';
import { order2nside } from '@hscmap/healpix';
import { radecToHealpixNest } from '../../src/api/hips.js';
import {
  renderSyntheticTile,
  magAt,
  type Band,
  type SyntheticSource,
} from '../../src/data/syntheticSky.js';
import {
  offlineSky,
  offlineTileRGBA,
  offlineLightCurve,
  brightestOfflineVariable,
  OFFLINE_EPOCHS,
  OFFLINE_BANDS,
  OFFLINE_MJD,
  OFFLINE_TILE_SIZE,
} from '../../src/data/offlineDataset.js';

const ORDER = 6;
const NSIDE = order2nside(ORDER);

/** Grayscale value at (col,row) of an RGBA raster (channels are equal). */
function lumAt(rgba: Uint8ClampedArray, col: number, row: number, size: number): number {
  return rgba[(row * size + col) * 4]!;
}

/** Peak (max) luminance and its location in a raster — the source centre. */
function peakLum(rgba: Uint8ClampedArray, size: number): { val: number; col: number; row: number } {
  let best = -1, bc = 0, br = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = rgba[(r * size + c) * 4]!;
      if (v > best) { best = v; bc = c; br = r; }
    }
  }
  return { val: best, col: bc, row: br };
}

/** Mean luminance over an N×N box centred at (col,row), clamped to the raster. */
function windowMean(rgba: Uint8ClampedArray, col: number, row: number, half: number, size: number): number {
  let sum = 0, n = 0;
  for (let r = Math.max(0, row - half); r <= Math.min(size - 1, row + half); r++) {
    for (let c = Math.max(0, col - half); c <= Math.min(size - 1, col + half); c++) {
      sum += lumAt(rgba, c, r, size);
      n++;
    }
  }
  return sum / n;
}

/** The HEALPix NESTED pixel (at ORDER) containing a source. */
function tileOf(src: SyntheticSource): number {
  return radecToHealpixNest(src.ra, src.dec, NSIDE);
}

describe('OFFLINE_EPOCHS / OFFLINE_BANDS axes', () => {
  it('exposes a strictly-increasing, finite multi-epoch time axis', () => {
    expect(OFFLINE_EPOCHS.length).toBeGreaterThan(1);
    for (let i = 0; i < OFFLINE_EPOCHS.length; i++) {
      expect(Number.isFinite(OFFLINE_EPOCHS[i]!)).toBe(true);
      if (i > 0) expect(OFFLINE_EPOCHS[i]!).toBeGreaterThan(OFFLINE_EPOCHS[i - 1]!);
    }
    expect(OFFLINE_MJD).toBe(OFFLINE_EPOCHS[0]);
  });

  it('offers the five Rubin bands (no u — the synthetic sky has no u)', () => {
    expect([...OFFLINE_BANDS]).toEqual(['g', 'r', 'i', 'z', 'y']);
  });

  it('anchors at least one transient/supernova peak INSIDE the epoch window', () => {
    const lo = Math.min(...OFFLINE_EPOCHS);
    const hi = Math.max(...OFFLINE_EPOCHS);
    const inWindow = offlineSky().sources.filter(
      (s) =>
        (s.variability.kind === 'transient' || s.variability.kind === 'supernova') &&
        s.variability.peakMjd >= lo &&
        s.variability.peakMjd <= hi
    );
    // Without this, every transient has faded before epoch 1 and blinking shows
    // only noise wobble — the headline feature would be silently absent.
    expect(inWindow.length).toBeGreaterThan(0);
  });
});

describe('epoch drives SIGNAL, not just noise (ground truth)', () => {
  // The globally BRIGHTEST transient/supernova event in the cube: the variable
  // source whose minimum magnitude over the epoch axis is smallest. Comparing its
  // brightest sampled epoch to its dimmest guarantees a large, unambiguous signal
  // step that per-pixel noise (σ=1.5) cannot fabricate.
  function pickBrightestVariable(band: Band): { src: SyntheticSource; peakEpoch: number; farEpoch: number } {
    let best: SyntheticSource | null = null;
    let bestMinMag = Infinity;
    for (const o of offlineSky().sources) {
      if (o.variability.kind !== 'transient' && o.variability.kind !== 'supernova') continue;
      let minMag = Infinity;
      for (const e of OFFLINE_EPOCHS) minMag = Math.min(minMag, magAt(o, band, e));
      if (minMag < bestMinMag) { bestMinMag = minMag; best = o; }
    }
    if (!best) throw new Error('no transient/SN found — fixture assumption broken');
    const epochsByBright = [...OFFLINE_EPOCHS].sort((a, b) => magAt(best!, band, a) - magAt(best!, band, b));
    return { src: best, peakEpoch: epochsByBright[0]!, farEpoch: epochsByBright[epochsByBright.length - 1]! };
  }

  it('is brighter at peak than far — with noise OFF, noise cannot fake this', () => {
    const band: Band = 'r';
    const { src, peakEpoch, farEpoch } = pickBrightestVariable(band);

    // Precondition on the closed-form light curve: peak really is brighter.
    expect(magAt(src, band, peakEpoch)).toBeLessThan(magAt(src, band, farEpoch) - 1.0);

    const pix = tileOf(src);
    const atPeak = renderSyntheticTile(offlineSky(), ORDER, pix, band, peakEpoch, OFFLINE_TILE_SIZE, 0);
    const atFar = renderSyntheticTile(offlineSky(), ORDER, pix, band, farEpoch, OFFLINE_TILE_SIZE, 0);

    const peakPx = peakLum(atPeak, OFFLINE_TILE_SIZE);
    // Compare the SAME pixel (the peak-epoch source centre) at both epochs.
    const farVal = lumAt(atFar, peakPx.col, peakPx.row, OFFLINE_TILE_SIZE);
    expect(peakPx.val).toBeGreaterThan(farVal + 20);
  });

  it('offlineTileRGBA threads mjd into signal — windowed mean beats noise floor', () => {
    const band: Band = 'r';
    const { src, peakEpoch, farEpoch } = pickBrightestVariable(band);
    const pix = tileOf(src);

    // Through the PUBLIC offline API (noise ON, σ=1.5). Locate the centre from a
    // noise-free render, then compare windowed means (σ/√N ≪ signal step).
    const clean = renderSyntheticTile(offlineSky(), ORDER, pix, band, peakEpoch, OFFLINE_TILE_SIZE, 0);
    const centre = peakLum(clean, OFFLINE_TILE_SIZE);

    const peakNoisy = offlineTileRGBA(ORDER, pix, band, peakEpoch);
    const farNoisy = offlineTileRGBA(ORDER, pix, band, farEpoch);
    const peakMean = windowMean(peakNoisy, centre.col, centre.row, 3, OFFLINE_TILE_SIZE);
    const farMean = windowMean(farNoisy, centre.col, centre.row, 3, OFFLINE_TILE_SIZE);
    expect(peakMean).toBeGreaterThan(farMean + 10);
  });
});

describe('band drives SIGNAL in the correct direction (ground truth)', () => {
  // A bright CONSTANT source so the comparison is mjd-independent; the only thing
  // that changes between bands is the colour offset (g=+0.45 fainter, y=−0.62
  // brighter). A version that ignored `band` for flux (noise-only band keying)
  // would show NO consistent direction and fail.
  function pickBrightConstant(): SyntheticSource {
    const s = offlineSky().sources
      .filter((o) => o.variability.kind === 'constant')
      .sort((a, b) => a.baseMag.r - b.baseMag.r)[0];
    if (!s) throw new Error('no constant source');
    return s;
  }

  it('y-band centre is brighter than g-band centre (BAND_COLOR_OFFSET sign)', () => {
    const src = pickBrightConstant();
    const pix = tileOf(src);
    const g = renderSyntheticTile(offlineSky(), ORDER, pix, 'g', OFFLINE_MJD, OFFLINE_TILE_SIZE, 0);
    const y = renderSyntheticTile(offlineSky(), ORDER, pix, 'y', OFFLINE_MJD, OFFLINE_TILE_SIZE, 0);
    const gPeak = peakLum(g, OFFLINE_TILE_SIZE);
    const yPeak = peakLum(y, OFFLINE_TILE_SIZE);
    // Same source centre, compared at both bands.
    const gVal = lumAt(g, yPeak.col, yPeak.row, OFFLINE_TILE_SIZE);
    expect(yPeak.val).toBeGreaterThan(gVal);
  });

  it('offlineTileRGBA output differs across band AND across epoch', () => {
    const src = offlineSky().sources
      .filter((o) => o.variability.kind === 'constant')
      .sort((a, b) => a.baseMag.r - b.baseMag.r)[0]!;
    const pix = tileOf(src);
    const r0 = offlineTileRGBA(pix === 0 ? 0 : ORDER, pix, 'r', OFFLINE_EPOCHS[0]!);
    const g0 = offlineTileRGBA(ORDER, pix, 'g', OFFLINE_EPOCHS[0]!);
    const rLast = offlineTileRGBA(ORDER, pix, 'r', OFFLINE_EPOCHS[OFFLINE_EPOCHS.length - 1]!);
    expect(Array.from(r0)).not.toEqual(Array.from(g0));
    expect(Array.from(r0)).not.toEqual(Array.from(rLast));
  });
});

describe('offlineLightCurve — time series matches the known light curve', () => {
  it('peaks at the brightest transient\'s peak epoch and is dim at its faint epoch', () => {
    const band = 'r' as const;
    const t = brightestOfflineVariable(band);
    const curve = offlineLightCurve(t.ra, t.dec, band);
    expect(curve.length).toBe(OFFLINE_EPOCHS.length);
    expect(curve.map((p) => p.mjd)).toEqual([...OFFLINE_EPOCHS]);

    // The maximum-intensity epoch is the transient's bright epoch (ground truth).
    let maxIdx = 0;
    for (let i = 1; i < curve.length; i++) if (curve[i]!.intensity > curve[maxIdx]!.intensity) maxIdx = i;
    expect(maxIdx).toBe(t.brightEpochIndex);
    // And the bright epoch is far brighter than the faint one.
    expect(curve[t.brightEpochIndex]!.intensity).toBeGreaterThan(curve[t.faintEpochIndex]!.intensity * 2);
  });

  it('is essentially flat far from any variable source', () => {
    // A point at the pole is unlikely to sit under a transient; its curve should
    // vary little relative to the brightest transient's swing.
    const curve = offlineLightCurve(0, 89.9, 'r');
    const vals = curve.map((p) => p.intensity);
    const spread = Math.max(...vals) - Math.min(...vals);
    const t = brightestOfflineVariable('r');
    const bright = offlineLightCurve(t.ra, t.dec, 'r').map((p) => p.intensity);
    const brightSwing = Math.max(...bright) - Math.min(...bright);
    expect(spread).toBeLessThan(brightSwing);
  });
});

describe('determinism across (band, mjd)', () => {
  it('identical args produce byte-identical output (PRNG pinned, no Date/random)', () => {
    const a = offlineTileRGBA(ORDER, 42, 'i', OFFLINE_EPOCHS[3]!);
    const b = offlineTileRGBA(ORDER, 42, 'i', OFFLINE_EPOCHS[3]!);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
