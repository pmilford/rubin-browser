import { describe, it, expect } from 'vitest';
import { computeFeatures, type Cutout } from '../../src/utils/imageFeatures.js';

/**
 * CLOSED-FORM feature tests (design-review blocker B2 — INDEPENDENCE).
 *
 * This file imports ONLY imageFeatures.ts and hand-constructs its inputs from
 * analytic profiles. It NEVER imports syntheticMorphology.ts, so it cannot pass by
 * round-tripping the renderer's parameters. Every assertion pins a HAND-COMPUTED
 * published value: a Gaussian of known σ measures FWHM = 2.3548·σ; Gini of a
 * single non-zero pixel ≈1 and of a uniform patch ≈0; concentration of a point <
 * an n=1 disk < an n=4 bulge; asymmetry of a lopsided source > 0 and of a
 * symmetric blob ≈0; a 2:1 elongated Gaussian at an oblique PA measures e≈0.5.
 */

const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.LN2); // 2.354820045

/** A W×W grid holding f(x,y); NaN cells where `nan` returns true. */
function grid(
  W: number,
  f: (x: number, y: number) => number,
  psfFwhmArcsec = 3,
  pixelScaleArcsec = 1,
  nan: (x: number, y: number) => boolean = () => false,
): Cutout {
  const data = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      data[y * W + x] = nan(x, y) ? NaN : f(x, y);
    }
  }
  return { data, width: W, height: W, pixelScaleArcsec, psfFwhmArcsec };
}

/** A small separable Gaussian blur — regularises singular profiles (a PSF stand-in
 *  applied EQUALLY to every profile, so an intrinsic-shape ordering is preserved). */
function blur(cut: Cutout, sigma: number): Cutout {
  const { width: W, height: H } = cut;
  const rad = Math.ceil(3 * sigma);
  const k: number[] = [];
  let s = 0;
  for (let i = -rad; i <= rad; i++) {
    const w = Math.exp(-0.5 * (i * i) / (sigma * sigma));
    k.push(w);
    s += w;
  }
  for (let i = 0; i < k.length; i++) k[i]! /= s;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let i = -rad; i <= rad; i++) {
      const xx = Math.min(W - 1, Math.max(0, x + i));
      acc += cut.data[y * W + xx]! * k[i + rad]!;
    }
    tmp[y * W + x] = acc;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let i = -rad; i <= rad; i++) {
      const yy = Math.min(H - 1, Math.max(0, y + i));
      acc += tmp[yy * W + x]! * k[i + rad]!;
    }
    out[y * W + x] = acc;
  }
  return { ...cut, data: out };
}

/** Rotated elliptical Gaussian centred on the grid. */
function ellipticalGaussian(W: number, sigmaX: number, sigmaY: number, paDeg: number, amp: number) {
  const c = (W - 1) / 2;
  const pa = (paDeg * Math.PI) / 180;
  const cosP = Math.cos(pa);
  const sinP = Math.sin(pa);
  return (x: number, y: number): number => {
    const dx = x - c;
    const dy = y - c;
    const xp = dx * cosP + dy * sinP;
    const yp = -dx * sinP + dy * cosP;
    return amp * Math.exp(-0.5 * ((xp * xp) / (sigmaX * sigmaX) + (yp * yp) / (sigmaY * sigmaY)));
  };
}

describe('computeFeatures — FWHM measured against the EXTERNAL PSF (blocker B3)', () => {
  it('a Gaussian of known σ measures source FWHM = 2.3548·σ (pins the constant)', () => {
    // pixelScale=1, psfFwhmArcsec=1 ⇒ psfFwhmPx=1, so fwhmRatio == measured source
    // FWHM in px, which for σ=5 must equal 2.3548·5 = 11.774.
    const sigma = 5;
    const f = computeFeatures(grid(41, ellipticalGaussian(41, sigma, sigma, 0, 100), 1, 1));
    expect(f.fwhmRatio).toBeCloseTo(FWHM_PER_SIGMA * sigma, 0);
  });

  it('a source equal to the PSF reads fwhmRatio ≈ 1; twice the PSF reads ≈ 2', () => {
    const sigma = 4;
    const same = computeFeatures(grid(41, ellipticalGaussian(41, sigma, sigma, 0, 100), FWHM_PER_SIGMA * sigma, 1));
    expect(same.fwhmRatio).toBeCloseTo(1, 1);
    // Same source, but the EXTERNAL PSF is declared half as wide ⇒ ratio doubles.
    const twice = computeFeatures(grid(41, ellipticalGaussian(41, sigma, sigma, 0, 100), FWHM_PER_SIGMA * (sigma / 2), 1));
    expect(twice.fwhmRatio).toBeCloseTo(2, 1);
  });

  it('an ISOLATED wide source (no companion "stars") still reads extended — the PSF is external, not self-referenced', () => {
    // A source 3× the nominal PSF, alone in the frame. If the PSF were estimated
    // from the target itself, fwhmRatio would collapse to ~1. It must not.
    const sigma = 6;
    const psfSigma = 2;
    const f = computeFeatures(grid(41, ellipticalGaussian(41, sigma, sigma, 0, 100), FWHM_PER_SIGMA * psfSigma, 1));
    expect(f.fwhmRatio).toBeGreaterThan(2.5);
  });
});

describe('computeFeatures — Gini (hand-pinned extremes)', () => {
  it('a single non-zero pixel ⇒ Gini ≈ 1 (all light in one cell)', () => {
    const data = new Float32Array(25 * 25);
    data[12 * 25 + 12] = 100;
    const f = computeFeatures({ data, width: 25, height: 25, pixelScaleArcsec: 1, psfFwhmArcsec: 3 });
    expect(f.gini).toBeCloseTo(1, 2);
  });

  it('a uniform illuminated patch ⇒ Gini ≈ 0 (light shared equally)', () => {
    const data = new Float32Array(41 * 41);
    for (let y = 15; y < 26; y++) for (let x = 15; x < 26; x++) data[y * 41 + x] = 100;
    const f = computeFeatures({ data, width: 41, height: 41, pixelScaleArcsec: 1, psfFwhmArcsec: 5 });
    expect(f.gini).toBeCloseTo(0, 2);
  });
});

describe('computeFeatures — concentration ordering (point < n=1 disk < n=4 bulge)', () => {
  // Analytic profiles sampled directly (NO renderer). b_n so r_e is the half-light
  // radius: b_1 ≈ 1.678, b_4 ≈ 7.669.
  const W = 61;
  const c = (W - 1) / 2;
  const re = 9;
  const radius = (x: number, y: number) => Math.hypot(x - c, y - c);
  // Peak-normalised profiles (centre = 100), then a common small PSF blur so the
  // singular de Vaucouleurs core is properly sampled (as a real image would be).
  const point = blur(grid(W, (x, y) => 100 * Math.exp(-0.5 * (radius(x, y) ** 2) / 9)), 1.5); // σ=3 PSF-like
  const disk = blur(grid(W, (x, y) => 100 * Math.exp(-1.678 * (radius(x, y) / re))), 1.5);
  const bulge = blur(grid(W, (x, y) => 100 * Math.exp(-7.669 * Math.pow(radius(x, y) / re, 0.25))), 1.5);

  it('C increases monotonically with Sérsic index', () => {
    const cp = computeFeatures(point).concentration;
    const cd = computeFeatures(disk).concentration;
    const cb = computeFeatures(bulge).concentration;
    expect(cp).toBeLessThan(cd);
    expect(cd).toBeLessThan(cb);
  });

  it('M20 is negative and MORE negative for the concentrated bulge', () => {
    const md = computeFeatures(disk).m20;
    const mb = computeFeatures(bulge).m20;
    expect(md).toBeLessThan(0);
    expect(mb).toBeLessThan(0);
    expect(mb).toBeLessThan(md); // bulge nucleus is more concentrated ⇒ more negative
  });
});

describe('computeFeatures — asymmetry (lopsided > 0, symmetric ≈ 0)', () => {
  const W = 41;
  const main = ellipticalGaussian(W, 4, 4, 0, 100);
  const sym = grid(W, main, 9.4);
  const lopsided = grid(W, (x, y) => main(x, y) + 80 * Math.exp(-0.5 * ((x - 30) ** 2 + (y - 20) ** 2) / 9), 9.4);

  it('a symmetric blob has A ≈ 0', () => {
    expect(computeFeatures(sym).asymmetry).toBeCloseTo(0, 2);
  });

  it('a main blob + one-sided companion has A clearly > 0', () => {
    expect(computeFeatures(lopsided).asymmetry).toBeGreaterThan(0.1);
  });
});

describe('computeFeatures — ellipticity catches an oblique axis (not just round vs not)', () => {
  it('a 2:1 elongated Gaussian at PA=30° measures e ≈ 0.5 (requires the Qxy cross term)', () => {
    // b/a = 3/6 = 0.5 ⇒ e = 1 − b/a = 0.5. The oblique PA means a classifier that
    // dropped the Qxy cross-moment would UNDER-estimate e — this pins that it is not.
    const f = computeFeatures(grid(61, ellipticalGaussian(61, 6, 3, 30, 100), 9.4));
    expect(f.ellipticity).toBeGreaterThan(0.42);
    expect(f.ellipticity).toBeLessThan(0.58);
  });

  it('a round Gaussian measures e ≈ 0', () => {
    const f = computeFeatures(grid(41, ellipticalGaussian(41, 4, 4, 0, 100), 9.4));
    expect(f.ellipticity).toBeCloseTo(0, 1);
  });
});

describe('computeFeatures — gaps count NaN ONLY, never low luminance (blocker B8)', () => {
  it('a low-signal cutout with ZERO NaN has gapFraction 0', () => {
    // Uniformly faint (near-zero) but fully COVERED background — must not be a gap.
    const f = computeFeatures(grid(30, () => 0.001, 3));
    expect(f.gapFraction).toBe(0);
  });

  it('gapFraction equals the NaN fraction and NaN cells never poison a feature', () => {
    // Right third is NaN (off-tile); a Gaussian sits in the left portion.
    const W = 30;
    const cut = grid(W, ellipticalGaussian(W, 3, 3, 0, 100), 6, 1, (x) => x >= 20);
    const f = computeFeatures(cut);
    expect(f.gapFraction).toBeCloseTo((10 * W) / (W * W), 6);
    for (const v of [f.snr, f.fwhmRatio, f.concentration, f.spreadModelProxy, f.gini, f.m20, f.asymmetry, f.ellipticity]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('an all-NaN border falls back to a global noise estimate — snr is finite, not NaN', () => {
    const W = 24;
    const cut = grid(W, ellipticalGaussian(W, 3, 3, 0, 100), 6, 1, (x, y) => x < 2 || y < 2 || x >= W - 2 || y >= W - 2);
    const f = computeFeatures(cut);
    expect(Number.isFinite(f.snr)).toBe(true);
    expect(f.snr).toBeGreaterThan(0);
  });
});

describe('computeFeatures — saturated core (blocker B9)', () => {
  it('a ≥2×2 plateau at the max value sets saturatedCore=true', () => {
    const W = 21;
    const data = new Float32Array(W * W);
    const g = ellipticalGaussian(W, 3, 3, 0, 200);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) data[y * W + x] = g(x, y);
    // Clip a 3×3 core to a common plateau value = the array max (8-bit-style clip).
    const c = (W - 1) / 2;
    let mx = 0;
    for (const v of data) if (v > mx) mx = v;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) data[(c + dy) * W + (c + dx)] = mx;
    const f = computeFeatures({ data, width: W, height: W, pixelScaleArcsec: 1, psfFwhmArcsec: 3 });
    expect(f.saturatedCore).toBe(true);
  });

  it('a clean single-peak Gaussian is NOT flagged saturated', () => {
    const f = computeFeatures(grid(21, ellipticalGaussian(21, 3, 3, 0, 137.5), 6));
    expect(f.saturatedCore).toBe(false);
  });
});

describe('computeFeatures — SNR & peakSharpness', () => {
  it('snr ≈ peak/σ for a known peak on known Gaussian noise-free background', () => {
    // Flat background 10 with a single bright pixel of +100; border σ is ~0 so the
    // global fallback keeps snr finite and large (peak dominates).
    const W = 20;
    const data = new Float32Array(W * W).fill(10);
    data[10 * W + 10] = 110;
    const f = computeFeatures({ data, width: W, height: W, pixelScaleArcsec: 1, psfFwhmArcsec: 3 });
    expect(f.snr).toBeGreaterThan(50);
    expect(Number.isFinite(f.snr)).toBe(true);
  });

  it('peakSharpness is higher for a point-like core than an extended flat one', () => {
    const point = computeFeatures(grid(31, ellipticalGaussian(31, 2, 2, 0, 100), 2 * FWHM_PER_SIGMA));
    const extended = computeFeatures(grid(31, ellipticalGaussian(31, 8, 8, 0, 100), 2 * FWHM_PER_SIGMA));
    expect(point.peakSharpness).toBeGreaterThan(extended.peakSharpness);
  });
});
