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

describe('computeFeatures — saturated core (blocker B9 + retune TODO 138 robustness)', () => {
  it('a LARGE flat plateau (≥16 px) at the max value sets saturatedCore=true', () => {
    const W = 25;
    const data = new Float32Array(W * W);
    const g = ellipticalGaussian(W, 3, 3, 0, 200);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) data[y * W + x] = g(x, y);
    // Clip a 5×5 (25-px) core to a common plateau value = the array max (real detector
    // /photographic saturation is a SIZEABLE flat region, not a 2-px quantisation dab).
    const c = (W - 1) / 2;
    let mx = 0;
    for (const v of data) if (v > mx) mx = v;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) data[(c + dy) * W + (c + dx)] = mx;
    const f = computeFeatures({ data, width: W, height: W, pixelScaleArcsec: 1, psfFwhmArcsec: 3 });
    expect(f.saturatedCore).toBe(true);
  });

  it('a SMALL max-value plateau (a 2×2 quantisation dab) does NOT flag saturation (TODO 138)', () => {
    // The killer bug on real 8-bit asinh-stretched HiPS pixels: quantising a smooth
    // bright core rounds a few neighbours to the same top value, faking a "saturated"
    // core on essentially every source. A 2×2 (or 3×3) plateau must NOT trigger.
    const W = 25;
    const data = new Float32Array(W * W);
    const g = ellipticalGaussian(W, 3, 3, 0, 200);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) data[y * W + x] = g(x, y);
    const c = (W - 1) / 2;
    let mx = 0;
    for (const v of data) if (v > mx) mx = v;
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) data[(c + dy) * W + (c + dx)] = mx; // 2×2 only
    const f = computeFeatures({ data, width: W, height: W, pixelScaleArcsec: 1, psfFwhmArcsec: 3 });
    expect(f.saturatedCore).toBe(false);
  });

  it('a clean single-peak Gaussian is NOT flagged saturated', () => {
    const f = computeFeatures(grid(21, ellipticalGaussian(21, 3, 3, 0, 137.5), 6));
    expect(f.saturatedCore).toBe(false);
  });
});

describe('computeFeatures — scale/stretch-robust concentration features (retune TODO 138)', () => {
  // psfFwhmArcsec = 2.5·pixelScale ⇒ psfFwhmPx = 2.5 (the app's undersampled floor).
  const W = 64;
  const cx = (W - 1) / 2;
  const psfArcsec = 2.5;
  const pixScale = 1;

  it('a COMPACT point packs its light into the inner aperture ⇒ HIGH concentrationRatio', () => {
    // A tight Gaussian (σ≈1 px, i.e. ~PSF-sized) on a flat sky.
    const data = new Float32Array(W * W).fill(5);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
      data[y * W + x] = 5 + 250 * Math.exp(-0.5 * ((x - cx) ** 2 + (y - cx) ** 2) / (1.1 * 1.1));
    const f = computeFeatures({ data, width: W, height: W, pixelScaleArcsec: pixScale, psfFwhmArcsec: psfArcsec });
    expect(f.concentrationRatio).toBeGreaterThan(0.6);
    expect(f.coreFluxFraction).toBeGreaterThan(0.5);
  });

  it('a BROAD extended blob spreads light to large radii ⇒ LOW concentrationRatio', () => {
    // An exponential disk many PSF-FWHM across (scale length ≈ 10 px ≈ 4·PSF).
    const data = new Float32Array(W * W).fill(5);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - cx, y - cx);
      data[y * W + x] = 5 + 250 * Math.exp(-r / 10);
    }
    const f = computeFeatures({ data, width: W, height: W, pixelScaleArcsec: pixScale, psfFwhmArcsec: psfArcsec });
    expect(f.concentrationRatio).toBeLessThan(0.3);
    // And the ordering is what matters: extended ≪ compact.
    const pt = new Float32Array(W * W).fill(5);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
      pt[y * W + x] = 5 + 250 * Math.exp(-0.5 * ((x - cx) ** 2 + (y - cx) ** 2) / (1.1 * 1.1));
    const fp = computeFeatures({ data: pt, width: W, height: W, pixelScaleArcsec: pixScale, psfFwhmArcsec: psfArcsec });
    expect(f.concentrationRatio).toBeLessThan(fp.concentrationRatio);
  });

  it('concentrationRatio is INVARIANT to a positive intensity rescale (no absolute calibration)', () => {
    const base = new Float32Array(W * W).fill(5);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
      base[y * W + x] = 5 + 200 * Math.exp(-Math.hypot(x - cx, y - cx) / 8);
    const scaled = new Float32Array(W * W);
    for (let i = 0; i < base.length; i++) scaled[i] = base[i]! * 3.7;
    const a = computeFeatures({ data: base, width: W, height: W, pixelScaleArcsec: pixScale, psfFwhmArcsec: psfArcsec });
    const b = computeFeatures({ data: scaled, width: W, height: W, pixelScaleArcsec: pixScale, psfFwhmArcsec: psfArcsec });
    expect(b.concentrationRatio).toBeCloseTo(a.concentrationRatio, 5);
  });

  it('flux reaching the FOV edge raises fillFraction above a centred compact source (degeneracy §8)', () => {
    // A source whose light reaches the border ring flags an untrustworthy curve of
    // growth; a centred compact point puts essentially nothing there. fillFraction ∈ [0,1].
    const edge = new Float32Array(W * W).fill(5);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      // Bright band along the left edge (flux on the border ring) plus a centred core.
      const dEdge = x; // distance from left edge
      edge[y * W + x] = 5 + 250 * Math.exp(-0.5 * (dEdge * dEdge) / (3 * 3));
    }
    const fe = computeFeatures({ data: edge, width: W, height: W, pixelScaleArcsec: pixScale, psfFwhmArcsec: psfArcsec });

    const point = new Float32Array(W * W).fill(5);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
      point[y * W + x] = 5 + 250 * Math.exp(-0.5 * ((x - cx) ** 2 + (y - cx) ** 2) / (1.1 * 1.1));
    const fp = computeFeatures({ data: point, width: W, height: W, pixelScaleArcsec: pixScale, psfFwhmArcsec: psfArcsec });

    expect(fe.fillFraction).toBeGreaterThanOrEqual(0);
    expect(fe.fillFraction).toBeLessThanOrEqual(1);
    expect(fe.fillFraction).toBeGreaterThan(fp.fillFraction + 0.05);
  });

  it('coreConcentration (1·PSF ÷ 3·PSF) is HIGH for a sub-PSF point, LOW for a resolved blob', () => {
    // Well-sampled geometry: a real many-pixel PSF (psfFwhmPx = 12). A point source
    // sits inside 1·PSF (ratio→1); an exponential blob several PSF across leaks past it.
    const bigW = 96;
    const c0 = (bigW - 1) / 2;
    const psfArc = 12;
    const ptData = new Float32Array(bigW * bigW).fill(5);
    for (let y = 0; y < bigW; y++) for (let x = 0; x < bigW; x++)
      ptData[y * bigW + x] = 5 + 240 * Math.exp(-0.5 * ((x - c0) ** 2 + (y - c0) ** 2) / (5 * 5));
    const pt = computeFeatures({ data: ptData, width: bigW, height: bigW, pixelScaleArcsec: 1, psfFwhmArcsec: psfArc });

    const gxData = new Float32Array(bigW * bigW).fill(5);
    for (let y = 0; y < bigW; y++) for (let x = 0; x < bigW; x++)
      gxData[y * bigW + x] = 5 + 240 * Math.exp(-Math.hypot(x - c0, y - c0) / 18);
    const gx = computeFeatures({ data: gxData, width: bigW, height: bigW, pixelScaleArcsec: 1, psfFwhmArcsec: psfArc });

    expect(pt.coreConcentration).toBeGreaterThan(0.5);
    expect(gx.coreConcentration).toBeLessThan(0.5);
    expect(pt.coreConcentration).toBeGreaterThan(gx.coreConcentration);
  });

  it('degenerate inputs yield ZERO concentration features (guards), never NaN', () => {
    // All-NaN patch (no finite pixels) and a perfectly constant patch (no peak above
    // sky) must both return 0 for the concentration features rather than NaN/Inf.
    const allNaN = new Float32Array(16 * 16).fill(NaN);
    const fN = computeFeatures({ data: allNaN, width: 16, height: 16, pixelScaleArcsec: 1, psfFwhmArcsec: 2.5 });
    expect(fN.concentrationRatio).toBe(0);
    expect(fN.coreConcentration).toBe(0);
    expect(fN.coreFluxFraction).toBe(0);
    expect(fN.fillFraction).toBe(0);

    const flat = new Float32Array(16 * 16).fill(42);
    const fF = computeFeatures({ data: flat, width: 16, height: 16, pixelScaleArcsec: 1, psfFwhmArcsec: 2.5 });
    expect(fF.concentrationRatio).toBe(0);
    expect(Number.isFinite(fF.coreFluxFraction)).toBe(true);
  });

  it('flux confined to the FOV border drives fillFraction above 0.3 (strong degeneracy)', () => {
    // A bright frame with a dark centre: almost all flux sits on the border ring.
    const W = 64;
    const data = new Float32Array(W * W).fill(5);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const dEdge = Math.min(x, y, W - 1 - x, W - 1 - y);
      if (dEdge < 4) data[y * W + x] = 250;
    }
    const f = computeFeatures({ data, width: W, height: W, pixelScaleArcsec: 1.4, psfFwhmArcsec: 3.5 });
    expect(f.fillFraction).toBeGreaterThan(0.3);
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
