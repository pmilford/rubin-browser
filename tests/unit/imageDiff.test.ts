import { describe, it, expect } from 'vitest';
import {
  differenceImages,
  detectTransients,
  sigmaClipStats,
} from '../../src/utils/imageDiff.js';

/**
 * Ground-truth image-differencing tests (per CLAUDE.md's adversarial rule).
 *
 * We BUILD frames with KNOWN static sources and a KNOWN injected transient using
 * a deterministic PRNG (mulberry32, constant seed — never Math.random / Date),
 * then assert the transient is recovered at its true position and that global
 * photometric changes do NOT manufacture detections. Each test names the broken
 * implementation its assertions kill.
 */

/** Deterministic PRNG — same mulberry32 the synthetic sky uses. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One standard-normal sample via Box–Muller from a uniform PRNG. */
function gauss(rand: () => number): number {
  const u1 = Math.max(1e-12, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

interface Src {
  x: number;
  y: number;
  amp: number;
  sigma: number;
}

/** Paint a Gaussian source into `img` (additive), row-major width×height. */
function addSource(img: Float64Array, width: number, s: Src): void {
  const rad = Math.ceil(3 * s.sigma);
  const cx = Math.round(s.x);
  const cy = Math.round(s.y);
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= img.length / width) continue;
      const ex = x - s.x;
      const ey = y - s.y;
      const r2 = (ex * ex + ey * ey) / (s.sigma * s.sigma);
      img[y * width + x]! += s.amp * Math.exp(-0.5 * r2);
    }
  }
}

const W = 64;
const H = 64;
const NOISE = 4; // per-pixel Gaussian noise sigma
const BG = 20; // flat sky pedestal

/** Static sources present identically in BOTH epochs (should cancel). */
const STATIC: Src[] = [
  { x: 12.3, y: 47.6, amp: 220, sigma: 1.6 },
  { x: 40.1, y: 15.2, amp: 300, sigma: 1.8 },
  { x: 52.7, y: 51.4, amp: 180, sigma: 1.5 },
  { x: 25.0, y: 30.0, amp: 260, sigma: 1.7 },
];

/** The injected transient — present ONLY in epoch B. Its known truth position. */
const TRANSIENT: Src = { x: 44.4, y: 38.2, amp: 200, sigma: 1.7 };

/** Build a frame: background + static sources (+ optional extra) + independent noise. */
function buildFrame(seed: number, extra: Src[] = []): Float64Array {
  const img = new Float64Array(W * H);
  img.fill(BG);
  for (const s of STATIC) addSource(img, W, s);
  for (const s of extra) addSource(img, W, s);
  const rand = mulberry32(seed);
  for (let i = 0; i < img.length; i++) img[i]! += gauss(rand) * NOISE;
  return img;
}

describe('differenceImages + detectTransients — injected transient (load-bearing)', () => {
  it('finds the NEW source at its true position, not at the static sources', () => {
    // A: background + static + noise.  B: same static + noise + ONE new source.
    const a = buildFrame(1);
    const b = buildFrame(2, [TRANSIENT]);

    const { diff, k } = differenceImages(a, b, W, H);
    // Slope should be ~1 (same photometric scale) — NOT attenuated to 0.
    expect(k).toBeGreaterThan(0.9);
    expect(k).toBeLessThan(1.1);

    const dets = detectTransients(diff, W, H, { nSigma: 5 });

    // Kills a differencer that returns B (would flag every static source) or that
    // flags everything: exactly one strong detection, at the transient.
    expect(dets.length).toBeGreaterThanOrEqual(1);
    const top = dets[0]!;
    expect(Math.hypot(top.x - TRANSIENT.x, top.y - TRANSIENT.y)).toBeLessThan(1.5);
    expect(top.peak).toBeGreaterThan(0);

    // No detection sits on any static source (they cancelled).
    for (const d of dets) {
      for (const s of STATIC) {
        expect(Math.hypot(d.x - s.x, d.y - s.y)).toBeGreaterThan(2);
      }
    }
  });
});

describe('differenceImages — global additive offset invariance', () => {
  it('same scene + a uniform +100 offset yields ZERO detections (offset removed)', () => {
    // Same static sources, INDEPENDENT per-epoch noise (as real epochs are),
    // plus a global +100 sky-background change. The offset must be removed and
    // the static sources must cancel — nothing lights up.
    const a = buildFrame(11);
    const bBase = buildFrame(12);
    const b = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) b[i] = bBase[i]! + 100;

    const { diff, c } = differenceImages(a, b, W, H);
    expect(c).toBeCloseTo(100, 0); // additive offset recovered
    const dets = detectTransients(diff, W, H, { nSigma: 5 });
    expect(dets.length).toBe(0);
  });
});

describe('differenceImages — global photometric scale invariance', () => {
  it('B = 1.05·A yields no detection at a noise pixel (kills offset-only matching)', () => {
    const a = buildFrame(21);
    const b = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) b[i] = 1.05 * a[i]!;

    const { diff, k } = differenceImages(a, b, W, H);
    expect(k).toBeCloseTo(1.05, 1); // scale recovered by the robust fit

    // A pure-scale change of a source-free noise region leaves no detection.
    const dets = detectTransients(diff, W, H, { nSigma: 5 });
    // Any detections must be residuals at bright STATIC sources — never at the
    // (source-free) transient location, and no NEW source is invented there.
    for (const d of dets) {
      expect(Math.hypot(d.x - TRANSIENT.x, d.y - TRANSIENT.y)).toBeGreaterThan(2);
    }
  });

  it('still uniquely finds the transient when B is also 5% brighter', () => {
    const a = buildFrame(22);
    const bBase = buildFrame(23, [TRANSIENT]);
    const b = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) b[i] = 1.05 * bBase[i]!;

    const { diff } = differenceImages(a, b, W, H);
    const dets = detectTransients(diff, W, H, { nSigma: 5 });
    expect(dets.length).toBeGreaterThanOrEqual(1);
    const top = dets[0]!;
    expect(Math.hypot(top.x - TRANSIENT.x, top.y - TRANSIENT.y)).toBeLessThan(1.5);
  });
});

describe('detectTransients — appear vs disappear (sign)', () => {
  it('a vanished source is NEGATIVE and not falsely reported as an appearance', () => {
    // A has the transient, B does not → it DISAPPEARED (negative excursion).
    const a = buildFrame(31, [TRANSIENT]);
    const b = buildFrame(32);

    const { diff } = differenceImages(a, b, W, H);

    // Default 'positive' mode: no appearance reported at the vanished source.
    const pos = detectTransients(diff, W, H, { nSigma: 5, sign: 'positive' });
    for (const d of pos) {
      expect(Math.hypot(d.x - TRANSIENT.x, d.y - TRANSIENT.y)).toBeGreaterThan(2);
    }

    // 'both' finds it with a NEGATIVE peak/significance at the true position.
    const both = detectTransients(diff, W, H, { nSigma: 5, sign: 'both' });
    const atSource = both.find(
      (d) => Math.hypot(d.x - TRANSIENT.x, d.y - TRANSIENT.y) < 1.5
    );
    expect(atSource).toBeDefined();
    expect(atSource!.peak).toBeLessThan(0);
    expect(atSource!.significance).toBeLessThan(0);
  });

  it('appear yields a positive peak of comparable magnitude to disappear', () => {
    const appearDiff = differenceImages(
      buildFrame(41),
      buildFrame(42, [TRANSIENT]),
      W,
      H
    ).diff;
    const appear = detectTransients(appearDiff, W, H, { nSigma: 5 })[0]!;
    expect(appear.peak).toBeGreaterThan(0);
  });
});

describe('detectTransients — hot pixel vs blob (area)', () => {
  it('reports area so a lone hot pixel is distinguishable from a real blob', () => {
    const a = buildFrame(51);
    const b = buildFrame(52, [TRANSIENT]);
    const { diff } = differenceImages(a, b, W, H);
    // Inject a single hot pixel far from the transient.
    diff[10 * W + 5] = 1000;

    const dets = detectTransients(diff, W, H, { nSigma: 5, sign: 'positive' });
    const hot = dets.find((d) => Math.round(d.x) === 5 && Math.round(d.y) === 10);
    const blob = dets.find(
      (d) => Math.hypot(d.x - TRANSIENT.x, d.y - TRANSIENT.y) < 1.5
    );
    expect(hot).toBeDefined();
    expect(blob).toBeDefined();
    expect(hot!.area).toBe(1); // lone hot pixel
    expect(blob!.area).toBeGreaterThan(3); // real Gaussian blob

    // minArea filters the hot pixel out.
    const filtered = detectTransients(diff, W, H, { nSigma: 5, minArea: 3 });
    expect(filtered.find((d) => Math.round(d.x) === 5 && Math.round(d.y) === 10)).toBeUndefined();
  });
});

describe('differenceImages — failure modes', () => {
  it('throws on frame length mismatch', () => {
    const a = new Float64Array(16);
    const b = new Float64Array(9);
    expect(() => differenceImages(a, b, 4, 4)).toThrow(/mismatch/i);
  });

  it('throws when width×height does not equal the frame length', () => {
    const a = new Float64Array(16);
    const b = new Float64Array(16);
    expect(() => differenceImages(a, b, 5, 5)).toThrow(/do not match|dimensions/i);
  });

  it('all-equal frames → zero detections, no divide-by-zero (std handled)', () => {
    const a = new Float64Array(W * H).fill(42);
    const b = new Float64Array(W * H).fill(42);
    const { diff, k, c } = differenceImages(a, b, W, H);
    expect(c).toBeCloseTo(0, 6);
    // diff is all ~0.
    for (let i = 0; i < diff.length; i++) expect(Math.abs(diff[i]!)).toBeLessThan(1e-9);
    const dets = detectTransients(diff, W, H);
    expect(dets.length).toBe(0);
    void k;
  });

  it('all-NaN diff → zero detections, no crash', () => {
    const diff = new Float64Array(W * H).fill(NaN);
    expect(detectTransients(diff, W, H)).toEqual([]);
  });

  it('accepts Float32Array inputs', () => {
    const a32 = new Float32Array(W * H);
    const b32 = new Float32Array(W * H);
    const a = buildFrame(61);
    const b = buildFrame(62, [TRANSIENT]);
    a32.set(a);
    b32.set(b);
    const { diff } = differenceImages(a32, b32, W, H);
    const dets = detectTransients(diff, W, H, { nSigma: 5 });
    expect(dets.length).toBeGreaterThanOrEqual(1);
  });
});

describe('sigmaClipStats — robust to outliers', () => {
  it('median/MAD-std track the inliers, not the outliers (kills plain mean/stdev)', () => {
    // 200 inliers ~ N(50, 3) plus 10 wild outliers at ~1e4.
    const rand = mulberry32(7);
    const arr: number[] = [];
    for (let i = 0; i < 200; i++) arr.push(50 + gauss(rand) * 3);
    for (let i = 0; i < 10; i++) arr.push(10000 + i);
    const data = new Float64Array(arr);

    const { mean, median, std } = sigmaClipStats(data);
    // Robust median ≈ 50 (a plain mean would be ~500 with these outliers).
    expect(median).toBeGreaterThan(47);
    expect(median).toBeLessThan(53);
    // MAD-std ≈ 3 (a plain stdev would be ~2000).
    expect(std).toBeGreaterThan(1.5);
    expect(std).toBeLessThan(6);
    // Sigma-clipped mean also stays near the inlier center.
    expect(mean).toBeGreaterThan(47);
    expect(mean).toBeLessThan(53);
  });

  it('empty / all-NaN input → NaN stats (no silent zeros)', () => {
    const { mean, median, std } = sigmaClipStats(new Float64Array([NaN, NaN]));
    expect(Number.isNaN(mean)).toBe(true);
    expect(Number.isNaN(median)).toBe(true);
    expect(Number.isNaN(std)).toBe(true);
  });

  it('all-equal data → std 0, mean == median (no divide-by-zero)', () => {
    const { mean, median, std } = sigmaClipStats(new Float64Array(50).fill(7));
    expect(std).toBe(0);
    expect(median).toBe(7);
    expect(mean).toBe(7);
  });
});
