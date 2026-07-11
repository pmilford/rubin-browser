/**
 * Adversarial ground-truth tests for multi-epoch VARIABILITY analysis (TODO 124).
 *
 * The offline synthetic cube exposes each source's true position and closed-form
 * light curve, so tests assert an OUTCOME against ground truth — not
 * self-consistency. A stack built from the cube has a KNOWN transient
 * (brightestOfflineVariable) and KNOWN constant sources; the tests prove the
 * variability map scores the transient strictly above a bright constant source
 * AND background, that detection finds the transient and NOT the flat field, and
 * that a purpose-built stack distinguishes fine- vs coarse-scale variability.
 *
 * Each assertion is chosen so a BROKEN implementation fails:
 *  - returns the temporal MEAN → bright constant source outscores the transient.
 *  - constant / random map → detection misses the known transient or fires on flat.
 *  - transposed (x↔y) → the map value at the true (x,y) reads background.
 *  - NaN→0 → a bright series' std jumps and the NaN-gap test fails.
 *  - no-op downsample → the multi-scale maps do not differ.
 */

import { describe, it, expect } from 'vitest';
import { order2nside, pixcoord2vec_nest, type V3 } from '@hscmap/healpix';
import {
  variabilityStats,
  variabilityMap,
  multiScaleVariability,
  detectVariableSources,
} from '../../src/utils/variability.js';
import {
  offlineIntensityFrame,
  offlineSky,
  OFFLINE_EPOCHS,
  OFFLINE_TILE_SIZE as TS,
  brightestOfflineVariable,
} from '../../src/data/offlineDataset.js';
import { radecToTileIndex } from '../../src/api/hips.js';
import { type SyntheticSource } from '../../src/data/syntheticSky.js';

const ORDER = 6;
const NSIDE = order2nside(ORDER);
// A POSITIVE noise floor is required: a noise-free stack has zero spatial spread
// on the background, so detection would (correctly) find nothing to threshold
// against. This matches how the viewer actually differences noisy frames.
const NOISE = 1.5;

const DEG2RAD = Math.PI / 180;
function radecToVec(raDeg: number, decDeg: number): V3 {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Locate a catalog source's tile pixel (col,row) by the SAME mapping the renderer
 * uses (pixcoord2vec_nest, col→nw, row→ne): the pixel whose center is nearest the
 * source's sky vector. Ground truth, no approximation.
 */
function locateSourcePixel(pix: number, ra: number, dec: number): { col: number; row: number } {
  const target = radecToVec(ra, dec);
  let best = -Infinity;
  let bc = 0;
  let br = 0;
  for (let row = 0; row < TS; row++) {
    const ne = (row + 0.5) / TS;
    for (let col = 0; col < TS; col++) {
      const nw = (col + 0.5) / TS;
      const d = dot(pixcoord2vec_nest(NSIDE, pix, ne, nw), target);
      if (d > best) {
        best = d;
        bc = col;
        br = row;
      }
    }
  }
  return { col: bc, row: br };
}

/** Build the full epoch stack for a tile in a band. */
function epochStack(pix: number, band: 'r', noise: number): Float64Array[] {
  return OFFLINE_EPOCHS.map((mjd) => offlineIntensityFrame(ORDER, pix, band, mjd, noise));
}

// ─────────────────────────── variabilityStats ───────────────────────────

describe('variabilityStats — temporal statistics vs ground truth', () => {
  it('constant series → ~0 spread; constant+noise → rms ≈ the noise (not 0)', () => {
    const flat = new Float64Array([50, 50, 50, 50, 50]);
    const s = variabilityStats(flat);
    expect(s.rms).toBeCloseTo(0, 10);
    expect(s.mad).toBeCloseTo(0, 10);
    expect(s.amplitude).toBeCloseTo(0, 10);
    expect(s.mean).toBeCloseTo(50, 10);

    // A `return 0` rms impl would pass the flat case; a noisy constant catches it.
    const noisy = new Float64Array([100.9, 99.1, 100.7, 99.3, 100.5, 99.5]);
    const ns = variabilityStats(noisy);
    expect(ns.rms).toBeGreaterThan(0.3);
    expect(ns.mean).toBeCloseTo(100, 1);
  });

  it('sinusoid sampled to its extrema → amplitude ≈ A and rms ≈ A/√2', () => {
    const A = 7;
    const base = 20;
    // 24 samples over a full period: hits ±A, so (max−min)/2 == A.
    const N = 24;
    const series = new Float64Array(N);
    for (let i = 0; i < N; i++) series[i] = base + A * Math.sin((2 * Math.PI * i) / N);
    const s = variabilityStats(series);
    expect(s.amplitude).toBeCloseTo(A, 1);
    expect(s.rms).toBeCloseTo(A / Math.SQRT2, 1);
    expect(s.mean).toBeCloseTo(base, 6);
  });

  it('peakIndex is the brightest epoch (argMAX, not argmin or 0)', () => {
    // Brightest is at index 3 — a `return 0` or argmin impl (index 5) fails.
    const series = [10, 12, 11, 99, 13, 5];
    const s = variabilityStats(series);
    expect(s.peakIndex).toBe(3);
  });

  it('reduced chi-square: ~0 noise-free constant, ≈1 constant+noise, ≫1 for a variable', () => {
    // Use σ = 2 (NOT 1) so dividing by σ² is not a no-op — a "forgot to divide by
    // σ²" impl would report ≈4 for the noise-consistent case and FAIL the ≈1 bound.
    const sigma = 2.0;
    // Noise-free constant with errors → residuals 0 → χ²_red = 0.
    const flat = variabilityStats(new Float64Array([5, 5, 5, 5, 5]), { errors: sigma });
    expect(flat.chi2Reduced).toBeCloseTo(0, 10);

    // Constant scattered by exactly ±σ → χ²_red ≈ 1 (catches a "forgot σ²" impl,
    // which would give ≈ σ² = 4 here).
    const noisyConst = [5 + 2, 5 - 2, 5 + 2, 5 - 2, 5 + 2, 5 - 2, 5 + 2, 5 - 2];
    const nc = variabilityStats(noisyConst, { errors: sigma });
    expect(nc.chi2Reduced!).toBeGreaterThan(0.5);
    expect(nc.chi2Reduced!).toBeLessThan(2);

    // A genuine large-amplitude variable → χ²_red ≫ 1.
    const variable = [5, 5, 5, 40, 20, 5, 5];
    const vv = variabilityStats(variable, { errors: sigma });
    expect(vv.chi2Reduced!).toBeGreaterThan(10);
  });

  it('per-epoch error array weights points; too few usable points → NaN', () => {
    const single = variabilityStats([7], { errors: 1 });
    expect(single.chi2Reduced).toBeNaN(); // dof 0
    const arr = variabilityStats([5, 25, 5], { errors: [1, 1, 1] });
    expect(arr.chi2Reduced!).toBeGreaterThan(10);
  });

  it('NaN epochs are EXCLUDED, never treated as 0 (bright baseline unchanged)', () => {
    const finiteOnly = variabilityStats(new Float64Array([100, 101, 99, 100]));
    const withGaps = variabilityStats(new Float64Array([100, NaN, 101, 99, NaN, 100]));
    expect(withGaps.mean).toBeCloseTo(finiteOnly.mean, 10);
    expect(withGaps.rms).toBeCloseTo(finiteOnly.rms, 10);
    // A NaN→0 impl would drop the mean toward 66 and inflate rms hugely.
    expect(withGaps.mean).toBeGreaterThan(95);
  });

  it('empty / all-NaN series → NaN stats and peakIndex −1', () => {
    const s = variabilityStats(new Float64Array([NaN, NaN]), { errors: 1 });
    expect(s.mean).toBeNaN();
    expect(s.rms).toBeNaN();
    expect(s.amplitude).toBeNaN();
    expect(s.peakIndex).toBe(-1);
    expect(s.chi2Reduced).toBeNaN();
    // No `errors` → the field is absent entirely.
    expect(variabilityStats([]).chi2Reduced).toBeUndefined();
  });
});

// ─────────────────── variabilityMap on the offline cube ───────────────────

// Shared ground-truth fixtures: the transient in its tile, and (separately) the
// brightest CONSTANT source in ITS tile. Both maps use the same NOISE, so their
// background std is comparable — a constant source's temporal std is ≈ noise no
// matter which tile it sits in, so cross-tile comparison of the variability
// index is valid (and avoids relying on both landing in one sparse order-6 tile).
const T = brightestOfflineVariable('r');
const PIX_T = radecToTileIndex(T.ra, T.dec, ORDER);
const STACK_T = epochStack(PIX_T, 'r', NOISE);
const MAP_T = variabilityMap(STACK_T, TS, TS, { metric: 'std' });
const TP = locateSourcePixel(PIX_T, T.ra, T.dec);

const CONST_SRC = brightestConstantSource();
const PIX_C = radecToTileIndex(CONST_SRC.ra, CONST_SRC.dec, ORDER);
const STACK_C = epochStack(PIX_C, 'r', NOISE);
const MAP_C = variabilityMap(STACK_C, TS, TS, { metric: 'std' });
const CP = locateSourcePixel(PIX_C, CONST_SRC.ra, CONST_SRC.dec);

describe('variabilityMap — the KNOWN transient outscores constant & background', () => {
  const bgIdx = backgroundPixel(MAP_T, TP, TP);

  function mapAt(m: Float64Array, col: number, row: number): number {
    return m[row * TS + col]!;
  }

  it('transient pixel variability > bright CONSTANT-source pixel variability', () => {
    // The constant source is genuinely bright (its temporal mean is high) — an
    // impl that mistakenly returns the temporal MEAN would score this bright but
    // STATIC pixel ABOVE the transient. On the VARIABILITY map the transient wins.
    const constMean = tileMeanAt(STACK_C, CP.col, CP.row);
    const transientVar = mapAt(MAP_T, TP.col, TP.row);
    const constVar = mapAt(MAP_C, CP.col, CP.row);
    expect(constMean).toBeGreaterThan(20); // it really is a bright source
    expect(transientVar).toBeGreaterThan(constVar * 3);
    // A "returns the mean" impl fails: the constant's mean ≫ the transient's std.
    expect(constMean).toBeGreaterThan(transientVar);
  });

  it('transient pixel variability > background pixel variability', () => {
    expect(mapAt(MAP_T, TP.col, TP.row)).toBeGreaterThan(MAP_T[bgIdx]! * 3);
  });

  it('transposed lookup reads background — proves the map is not uniform', () => {
    // If x and y were swapped the sampled value would collapse toward background.
    const swapped = mapAt(MAP_T, TP.row, TP.col); // deliberately (row,col)
    if (TP.col !== TP.row) {
      expect(mapAt(MAP_T, TP.col, TP.row)).toBeGreaterThan(swapped);
    }
  });
});

describe('detectVariableSources — finds the transient, not the flat field', () => {
  const pix = PIX_T;
  const map = MAP_T;
  const tp = TP;

  it('the top detection sits on the transient (within tolerance)', () => {
    const dets = detectVariableSources(map, TS, TS, { nSigma: 5, minSeparation: 4 });
    expect(dets.length).toBeGreaterThan(0);
    const top = dets[0]!;
    expect(Math.hypot(top.x - tp.col, top.y - tp.row)).toBeLessThan(6);
    expect(top.significance).toBeGreaterThan(5);
  });

  it('does NOT flag the bright CONSTANT source in its own tile', () => {
    // MAP_C's tile contains a genuinely bright but STATIC source; detection must
    // not report anything at its pixel (a "returns mean" impl WOULD fire here).
    const dets = detectVariableSources(MAP_C, TS, TS, { nSigma: 5, minSeparation: 4 });
    for (const d of dets) {
      expect(Math.hypot(d.x - CP.col, d.y - CP.row)).toBeGreaterThan(4);
    }
  });

  it('a truly flat field (constant sources only, no variables) yields ZERO detections', () => {
    // Reuse the same tile but with a map whose spread is pure noise everywhere:
    // difference the stack against its own mean is not needed — instead detect on
    // a map computed from a stack where every epoch is identical (no time change).
    const oneFrame = offlineIntensityFrame(ORDER, pix, 'r', OFFLINE_EPOCHS[0]!, NOISE);
    const staticStack = OFFLINE_EPOCHS.map(() => oneFrame); // same bytes each epoch
    const staticMap = variabilityMap(staticStack, TS, TS, { metric: 'std' });
    const dets = detectVariableSources(staticMap, TS, TS, { nSigma: 5 });
    expect(dets.length).toBe(0); // no temporal change anywhere → nothing variable
  });

  it('degenerate maps (all-NaN, zero-spread) → [] with no divide-by-zero', () => {
    const allNaN = new Float64Array(16).fill(NaN);
    expect(detectVariableSources(allNaN, 4, 4)).toEqual([]);
    const flat = new Float64Array(16).fill(7);
    expect(detectVariableSources(flat, 4, 4)).toEqual([]);
  });

  it('throws on a dimension mismatch', () => {
    expect(() => detectVariableSources(new Float64Array(15), 4, 4)).toThrow(/do not match/);
  });
});

// ─────────────────── multi-scale (purpose-built controlled stack) ───────────────────

describe('multiScaleVariability — fine vs coarse scales genuinely differ', () => {
  // A deterministic 32×32 stack we fully control, so the scale behaviour is not
  // an accident of the offline cube. Two injected variables:
  //  (A) a COMPACT spike: one pixel varies with large amplitude → best at scale 1,
  //      washed out by coarse binning.
  //  (B) a BROAD coherent variation: a large block where every pixel varies by a
  //      SMALL amplitude (below the per-pixel noise) in phase → invisible at
  //      scale 1 (buried in noise) but survives box-averaging → best at a coarse
  //      scale (independent noise averages as σ/scale, coherent signal persists).
  const W = 32;
  const H = 32;
  const E = 10;
  const NOISE_STD = 4;
  const SPIKE = { x: 6, y: 6, amp: 60 };
  const BLOCK = { x0: 18, y0: 18, x1: 30, y1: 30, amp: 1.5 }; // amp < NOISE_STD

  // mulberry32 (matches syntheticSky.ts) — deterministic, no Math.random.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rand: () => number): number {
    const u1 = Math.max(1e-12, rand());
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  const rand = mulberry32(12345);
  const frames: Float64Array[] = [];
  for (let e = 0; e < E; e++) {
    const f = new Float64Array(W * H);
    // Time modulation: +1 on even epochs, −1 on odd (in phase for the broad block).
    const phase = e % 2 === 0 ? 1 : -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = 100 + gauss(rand) * NOISE_STD; // flat background + noise
        if (x === SPIKE.x && y === SPIKE.y) v += phase * SPIKE.amp;
        if (x >= BLOCK.x0 && x < BLOCK.x1 && y >= BLOCK.y0 && y < BLOCK.y1) {
          v += phase * BLOCK.amp;
        }
        f[y * W + x] = v;
      }
    }
    frames.push(f);
  }

  const scales = [1, 4];
  const ms = multiScaleVariability(frames, W, H, scales, { metric: 'std' });

  it('returns one map per scale with correct binned dimensions', () => {
    expect(ms.map((m) => m.scale)).toEqual(scales);
    expect(ms[0]!.width).toBe(W);
    expect(ms[1]!.width).toBe(Math.ceil(W / 4)); // 8
    expect(ms[1]!.map.length).toBe(8 * 8);
  });

  it('the COMPACT spike is detected at the finest scale but washed out when coarse', () => {
    const fine = ms[0]!;
    const detFine = detectVariableSources(fine.map, fine.width, fine.height, { nSigma: 5 });
    // Found near the spike at scale 1.
    const hitFine = detFine.some((d) => Math.hypot(d.x - SPIKE.x, d.y - SPIKE.y) < 2);
    expect(hitFine).toBe(true);

    // At scale 4 the spike is averaged over 16 pixels: amplitude/16 ≈ 3.75 ≈ noise,
    // so its variability is NOT elevated above background — its bin value falls.
    const coarse = ms[1]!;
    const spikeBin = coarse.map[Math.floor(SPIKE.y / 4) * coarse.width + Math.floor(SPIKE.x / 4)]!;
    const fineSpike = fine.map[SPIKE.y * W + SPIKE.x]!;
    expect(fineSpike).toBeGreaterThan(spikeBin * 3);
  });

  it('the BROAD low-amplitude variation is MISSED at scale 1 but caught when coarse', () => {
    const fine = ms[0]!;
    const coarse = ms[1]!;

    // Scale 1: the block pixels vary by amp 1.2 ≪ noise 4, so they do NOT stand
    // out — no detection lands inside the block at the finest scale.
    const detFine = detectVariableSources(fine.map, fine.width, fine.height, { nSigma: 5 });
    const fineInBlock = detFine.some(
      (d) => d.x >= BLOCK.x0 && d.x < BLOCK.x1 && d.y >= BLOCK.y0 && d.y < BLOCK.y1
    );
    expect(fineInBlock).toBe(false);

    // Scale 4: binning averages the noise down (σ/4 = 1) while the coherent 1.2
    // signal survives, so the block's binned variability rises ABOVE a lone
    // pixel's. Compare a block bin to a background bin at the same coarse scale.
    const blockBin =
      coarse.map[Math.floor(22 / 4) * coarse.width + Math.floor(22 / 4)]!; // inside block
    // Coarse (0,0) covers fine (0..3,0..3) — clear of BOTH the spike (6,6) and
    // the block (18..30): a true background bin whose noise averaged down to σ/4.
    const bgBin = coarse.map[0]!;
    expect(blockBin).toBeGreaterThan(bgBin * 1.5);

    // And a no-op downsample (coarse map === fine map subsample) could not show
    // this: at scale 1 the block pixel is NOT elevated over background.
    const blockPxFine = fine.map[22 * W + 22]!;
    const bgPxFine = fine.map[4 * W + 4]!;
    expect(blockPxFine).toBeLessThan(bgPxFine * 2.0); // buried in noise at scale 1
  });

  it('validates scales and stack shape', () => {
    expect(() => multiScaleVariability(frames, W, H, [])).toThrow(/no scales/);
    expect(() => multiScaleVariability(frames, W, H, [0])).toThrow(/positive integer/);
    expect(() => multiScaleVariability(frames, W, H, [1.5])).toThrow(/positive integer/);
    expect(() => multiScaleVariability([], W, H, [1])).toThrow(/empty/);
    expect(() => variabilityMap([new Float64Array(3)], W, H)).toThrow(/≠|length/);
  });
});

// ─────────────────── metric-specific + chi2 map coverage ───────────────────

describe('variabilityMap metrics + guards', () => {
  it('metric chi2 requires a positive noise; other metrics compute without it', () => {
    const frames = [new Float64Array([1, 5, 1, 5]), new Float64Array([1, 5, 1, 5])];
    expect(() => variabilityMap(frames, 2, 2, { metric: 'chi2' })).toThrow(/chi2/);
    const chi = variabilityMap(frames, 2, 2, { metric: 'chi2', noise: 1 });
    expect(chi.length).toBe(4);
    // 'range' / 'amplitude' / 'mad' all run.
    expect(variabilityMap(frames, 2, 2, { metric: 'range' }).length).toBe(4);
    expect(variabilityMap(frames, 2, 2, { metric: 'amplitude' })[0]).toBeCloseTo(0, 10);
    expect(variabilityMap(frames, 2, 2, { metric: 'mad' }).length).toBe(4);
  });

  it('pixels with <2 finite epochs are NaN (a gap, not 0)', () => {
    const frames = [
      new Float64Array([10, NaN]),
      new Float64Array([12, NaN]),
    ];
    const map = variabilityMap(frames, 2, 1, { metric: 'std' });
    expect(map[0]).toBeGreaterThan(0); // 2 finite epochs
    expect(map[1]).toBeNaN(); // 0 finite epochs
  });
});

// ─────────────────── ground-truth helpers on the offline cube ───────────────────

/** The globally brightest CONSTANT-kind catalog source (smallest baseMag.r). */
function brightestConstantSource(): SyntheticSource {
  let best: SyntheticSource | null = null;
  for (const s of offlineSky().sources) {
    if (s.variability.kind !== 'constant') continue;
    if (!best || s.baseMag.r < best.baseMag.r) best = s;
  }
  if (!best) throw new Error('no constant source in the offline cube — fixture assumption broken');
  return best;
}

/** Mean of a pixel's series across the stack (for the mean-vs-variability contrast). */
function tileMeanAt(stack: Float64Array[], col: number, row: number): number {
  const p = row * TS + col;
  let sum = 0;
  for (const f of stack) sum += f[p]!;
  return sum / stack.length;
}

/** Pick a background pixel far from the transient and constant source. */
function backgroundPixel(
  map: Float64Array,
  tp: { col: number; row: number },
  cp: { col: number; row: number }
): number {
  for (let row = 4; row < TS; row += 17) {
    for (let col = 4; col < TS; col += 17) {
      if (Math.hypot(col - tp.col, row - tp.row) < 12) continue;
      if (Math.hypot(col - cp.col, row - cp.row) < 12) continue;
      const idx = row * TS + col;
      if (Number.isFinite(map[idx]!)) return idx;
    }
  }
  return 0;
}
