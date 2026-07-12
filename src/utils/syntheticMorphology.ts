/**
 * Deterministic synthetic morphology renderer — labelled star/galaxy cutouts for
 * MEASURING the image classifier against known truth (PRD §5.1).
 *
 * Every cutout carries its TRUE class plus render-truth labels (`trueSnr`,
 * `trueSizeOverPsf`) computed from the FORWARD-MODEL parameters — never from the
 * classifier. That is what lets the scoring harness assert a real accuracy and
 * prove the adversarial baselines ("always galaxy", random) fail on the identical
 * ground-truth subset (blockers B5/B6).
 *
 * Hard invariants (mirroring src/data/syntheticSky.ts):
 *  - PURE + DETERMINISTIC. The ONLY entropy is the seed, threaded through a
 *    mulberry32 PRNG. Noise is Box–Muller from that PRNG. NEVER Math.random / Date.
 *  - Same opts (same seed) ⇒ byte-identical LabeledCutout.
 *
 * INDEPENDENCE (blocker B2): this file shares NO helper with imageFeatures.ts /
 * objectClassifier.ts. Its second-moment size (used only to LABEL trueSizeOverPsf)
 * is computed here on the NOISE-FREE signal; the classifier re-measures size
 * independently on the noisy cutout.
 *
 * Forward model:
 *  - star   → the PSF itself (Gaussian or Moffat) of FWHM = psfFwhmArcsec.
 *  - galaxy → an elliptical Sérsic profile (index n, effective radius r_e,
 *             ellipticity, PA) CONVOLVED with that same PSF, so an extended source
 *             genuinely exists to test against.
 *  - additive sky pedestal + seeded per-pixel Gaussian noise.
 *  - optional 8-bit quantisation and asinh stretch (mimics stretched HiPS tiles),
 *    used by the independent holdout to break the generator↔classifier self-
 *    consistency trap (blocker B1).
 */

import type { Cutout } from './imageFeatures.js';

export type TrueClass = 'star' | 'galaxy';

export interface LabeledCutout {
  cutout: Cutout;
  trueClass: TrueClass;
  /** Render-truth peak SNR = noise-free peak amplitude / noise σ (NOT measured). */
  trueSnr: number;
  /** Render-truth size: noise-free second-moment FWHM / PSF FWHM (NOT measured). */
  trueSizeOverPsf: number;
}

export interface RenderOpts {
  trueClass: TrueClass;
  seed: number;
  /** Brightness; brighter (smaller mag) ⇒ higher peak ⇒ higher SNR. Default 20. */
  mag?: number;
  /** External/nominal PSF FWHM (arcsec). Default 0.7. */
  psfFwhmArcsec?: number;
  /** Pixel scale (arcsec/px). Default 0.2. */
  pixelScaleArcsec?: number;
  /** Galaxy effective radius (arcsec). Default 0.7. Ignored for stars. */
  reArcsec?: number;
  /** Galaxy Sérsic index (1 disk … 4 bulge). Default 1.5. Ignored for stars. */
  sersicN?: number;
  /** Galaxy ellipticity 1−b/a (0 round … ~0.7). Default 0.2. Ignored for stars. */
  ellipticity?: number;
  /** Galaxy major-axis position angle (deg). Default 0. Ignored for stars. */
  paDeg?: number;
  /** PSF profile family. Default 'gaussian'. */
  profile?: 'gaussian' | 'moffat';
  /** Quantise the final cutout to 8-bit [0,255]. Default false. */
  quantize8bit?: boolean;
  /** Apply an asinh display stretch before quantisation. Default false. */
  asinhStretch?: boolean;
  /**
   * Apply the SAME aggressive DSS/HiPS display transform the REAL holdout fixture
   * uses (asinh a=10 on a [black=25th-percentile, white=max] window, then 8-bit
   * quantise), so a synthetic population lands in the identical stretched regime the
   * shipped classifier is tuned for — not the gentle `asinhStretch` used by the
   * legacy anti-overfit holdout. Overrides `asinhStretch`/`quantize8bit` when set.
   */
  dssStretch?: boolean;
}

const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.LN2); // 2.354820045...
/** Photometric zero point: peak amplitude = 10^(0.4·(ZP − mag)). */
const MAG_ZERO_POINT = 25;
/** Additive sky background pedestal (counts). */
const SKY_BACKGROUND = 20;
/** Per-pixel Gaussian noise σ (counts). With ZP above, snr ≈ 10^(0.4·(25−mag)). */
const NOISE_SIGMA = 1;
/** Moffat β (power-law wing index); ~4.7 matches typical atmospheric seeing. */
const MOFFAT_BETA = 4.765;
/** Display peak target for 8-bit quantisation — below 255 to avoid false clip. */
const QUANT_PEAK = 250;

/** Deterministic PRNG (mulberry32), same family as src/data/syntheticSky.ts. */
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

/** FNV-1a mix of several ints into a 32-bit seed (for per-cutout noise streams). */
function hashSeed(...vals: number[]): number {
  let h = 0x811c9dc5;
  for (const v of vals) {
    const x = Math.floor(v * 1000003) | 0;
    for (let s = 0; s < 32; s += 8) {
      h ^= (x >>> s) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** Sérsic b_n so that r_e encloses half the light (Ciotti & Bertin approximation). */
function bn(n: number): number {
  return 2 * n - 1 / 3 + 4 / (405 * n) + 46 / (25515 * n * n);
}

/** Radial PSF value (peak 1 at r=0) for the chosen profile, r in pixels. */
function psfValue(rPx: number, fwhmPx: number, profile: 'gaussian' | 'moffat'): number {
  if (profile === 'moffat') {
    const alpha = fwhmPx / (2 * Math.sqrt(Math.pow(2, 1 / MOFFAT_BETA) - 1));
    const u = rPx / alpha;
    return Math.pow(1 + u * u, -MOFFAT_BETA);
  }
  const sigma = fwhmPx / FWHM_PER_SIGMA;
  return Math.exp(-0.5 * (rPx * rPx) / (sigma * sigma));
}

/** Build a normalised (sum=1) PSF convolution kernel; radius ~ a few FWHM. */
function psfKernel(fwhmPx: number, profile: 'gaussian' | 'moffat'): { k: Float64Array; radius: number } {
  const radius = Math.max(2, Math.ceil((profile === 'moffat' ? 4 : 3.5) * fwhmPx));
  const size = 2 * radius + 1;
  const k = new Float64Array(size * size);
  let sum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const v = psfValue(Math.sqrt(dx * dx + dy * dy), fwhmPx, profile);
      k[(dy + radius) * size + (dx + radius)] = v;
      sum += v;
    }
  }
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  return { k, radius };
}

/** Convolve a signal grid with a (square) kernel; edges use zero-padding. */
function convolve(signal: Float64Array, n: number, kernel: Float64Array, kRadius: number): Float64Array {
  const out = new Float64Array(n * n);
  const kSize = 2 * kRadius + 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let ky = -kRadius; ky <= kRadius; ky++) {
        const sy = y + ky;
        if (sy < 0 || sy >= n) continue;
        for (let kx = -kRadius; kx <= kRadius; kx++) {
          const sx = x + kx;
          if (sx < 0 || sx >= n) continue;
          acc += signal[sy * n + sx]! * kernel[(ky + kRadius) * kSize + (kx + kRadius)]!;
        }
      }
      out[y * n + x] = acc;
    }
  }
  return out;
}

/** Second-moment FWHM (px) of a noise-free signal grid about its flux centroid. */
function signalFwhmPx(signal: Float64Array, n: number): number {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = signal[y * n + x]!;
      if (v > 0) {
        sw += v;
        sx += v * x;
        sy += v * y;
      }
    }
  }
  if (sw <= 0) return 0;
  const cx = sx / sw;
  const cy = sy / sw;
  let qxx = 0;
  let qyy = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = signal[y * n + x]!;
      if (v > 0) {
        qxx += v * (x - cx) * (x - cx);
        qyy += v * (y - cy) * (y - cy);
      }
    }
  }
  const rrms = Math.sqrt(Math.max(0, (qxx + qyy) / sw));
  return FWHM_PER_SIGMA * (rrms / Math.SQRT2);
}

/** Choose an odd cutout size that contains the source + PSF wings + a clean ring. */
function cutoutSize(psfFwhmPx: number, reArcsec: number, pixelScaleArcsec: number, isGalaxy: boolean): number {
  const rePx = reArcsec / pixelScaleArcsec;
  const extent = isGalaxy
    ? Math.max(psfFwhmPx * 4, rePx * 4 + psfFwhmPx * 3)
    : psfFwhmPx * 5;
  let n = 2 * Math.ceil(extent / 2) + 1;
  if (n < 25) n = 25;
  if (n > 61) n = 61;
  return n;
}

/**
 * Render one labelled cutout. Deterministic in `opts.seed`: identical opts yield a
 * byte-identical LabeledCutout (asserted in the tests).
 */
export function renderLabeledCutout(opts: RenderOpts): LabeledCutout {
  const trueClass = opts.trueClass;
  const mag = opts.mag ?? 20;
  const psfFwhmArcsec = opts.psfFwhmArcsec ?? 0.7;
  const pixelScaleArcsec = opts.pixelScaleArcsec ?? 0.2;
  const reArcsec = opts.reArcsec ?? 0.7;
  const sersicN = opts.sersicN ?? 1.5;
  const ellipticity = opts.ellipticity ?? 0.2;
  const paDeg = opts.paDeg ?? 0;
  const profile = opts.profile ?? 'gaussian';
  const quantize8bit = opts.quantize8bit ?? false;
  const asinhStretch = opts.asinhStretch ?? false;
  const dssStretch = opts.dssStretch ?? false;

  const isGalaxy = trueClass === 'galaxy';
  const psfFwhmPx = psfFwhmArcsec / pixelScaleArcsec;
  const n = cutoutSize(psfFwhmPx, reArcsec, pixelScaleArcsec, isGalaxy);
  const cx = (n - 1) / 2;
  const cy = (n - 1) / 2;

  // ── Noise-free signal grid (peak-normalised later) ───────────────────────────
  let signal: Float64Array;
  if (!isGalaxy) {
    // Star = the PSF itself.
    const star = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        star[y * n + x] = psfValue(Math.hypot(x - cx, y - cy), psfFwhmPx, profile);
      }
    }
    signal = star;
  } else {
    // Elliptical Sérsic, then convolve with the PSF.
    const rePx = reArcsec / pixelScaleArcsec;
    const q = Math.max(0.05, 1 - ellipticity); // minor/major axis ratio
    const pa = (paDeg * Math.PI) / 180;
    const cosP = Math.cos(pa);
    const sinP = Math.sin(pa);
    const b = bn(sersicN);
    const raw = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x - cx;
        const dy = y - cy;
        // Rotate into the galaxy frame; major axis along x'.
        const xp = dx * cosP + dy * sinP;
        const yp = -dx * sinP + dy * cosP;
        const rEll = Math.sqrt(xp * xp + (yp / q) * (yp / q));
        raw[y * n + x] = Math.exp(-b * (Math.pow(rEll / rePx, 1 / sersicN) - 1));
      }
    }
    const { k, radius } = psfKernel(psfFwhmPx, profile);
    signal = convolve(raw, n, k, radius);
  }

  // Peak-normalise, then scale to the magnitude-driven peak amplitude.
  let peakSignal = 0;
  for (let i = 0; i < signal.length; i++) if (signal[i]! > peakSignal) peakSignal = signal[i]!;
  const peakAmp = Math.pow(10, 0.4 * (MAG_ZERO_POINT - mag));
  const scale = peakSignal > 0 ? peakAmp / peakSignal : 0;
  for (let i = 0; i < signal.length; i++) signal[i]! *= scale;

  // Render-truth labels from the forward model (NOT the classifier).
  const trueSnr = peakAmp / NOISE_SIGMA;
  const noiseFreeFwhmPx = signalFwhmPx(signal, n);
  const trueSizeOverPsf = psfFwhmPx > 0 ? noiseFreeFwhmPx / psfFwhmPx : 1;

  // ── Add background + seeded Gaussian noise (Box–Muller) ───────────────────────
  const rand = mulberry32(hashSeed(opts.seed, isGalaxy ? 1 : 0, Math.round(mag * 1000)));
  const raw = new Float64Array(n * n);
  for (let i = 0; i < raw.length; i++) {
    const u1 = Math.max(1e-12, rand());
    const u2 = rand();
    const gnoise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    raw[i] = SKY_BACKGROUND + signal[i]! + gnoise * NOISE_SIGMA;
  }

  // ── Optional display transform (asinh + 8-bit), monotonic in intensity ────────
  const data = new Float32Array(n * n);
  if (dssStretch) {
    // The EXACT transform the real DSS holdout fixture applies (asinh a=10 on a
    // [black=25th-pct, white=max] window → 8-bit), so a synthetic population is in the
    // identical stretched regime the shipped classifier is calibrated for.
    const A = 10;
    const denom = Math.asinh(A);
    const sorted = [...raw].sort((p, q) => p - q);
    const pctl = (fr: number): number => {
      const idx = (sorted.length - 1) * fr;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
    };
    const black = pctl(0.25);
    const white = Math.max(sorted[sorted.length - 1]!, black + 1e-9);
    for (let i = 0; i < raw.length; i++) {
      let x = (raw[i]! - black) / (white - black);
      if (x < 0) x = 0;
      if (x > 1) x = 1;
      const q = Math.round((Math.asinh(A * x) / denom) * 255);
      data[i] = q < 0 ? 0 : q > 255 ? 255 : q;
    }
  } else if (!asinhStretch && !quantize8bit) {
    for (let i = 0; i < raw.length; i++) data[i] = raw[i]!;
  } else {
    // Gentle asinh: softening ABOVE the peak so bright cores compress only mildly
    // (as real HiPS stretches do) and point-vs-extended morphology survives — an
    // over-soft stretch would broaden every star into a fake galaxy.
    const soft = Math.max(1e-6, peakAmp * 2);
    let dmin = Infinity;
    let dmax = -Infinity;
    const disp = new Float64Array(n * n);
    for (let i = 0; i < raw.length; i++) {
      const d = asinhStretch ? Math.asinh(raw[i]! / soft) : raw[i]!;
      disp[i] = d;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
    }
    const range = dmax - dmin || 1;
    for (let i = 0; i < disp.length; i++) {
      if (quantize8bit) {
        const q = Math.round(((disp[i]! - dmin) / range) * QUANT_PEAK);
        data[i] = q < 0 ? 0 : q > 255 ? 255 : q;
      } else {
        data[i] = disp[i]!;
      }
    }
  }

  const cutout: Cutout = { data, width: n, height: n, pixelScaleArcsec, psfFwhmArcsec };
  return { cutout, trueClass, trueSnr, trueSizeOverPsf };
}

export interface PopulationOpts {
  /** Brightest / faintest magnitude spanned (SNR range). Default [19, 24]. */
  magRange?: [number, number];
  /** External PSF FWHM (arcsec). Default 0.7. */
  psfFwhmArcsec?: number;
  /** Pixel scale (arcsec/px). Default 0.2. */
  pixelScaleArcsec?: number;
  /** Galaxy Sérsic index range. Default [1, 4]. */
  sersicNRange?: [number, number];
  /** Galaxy effective-radius range (arcsec). Default [0.35, 1.3]. */
  reArcsecRange?: [number, number];
  /** PSF profile family. Default 'gaussian'. */
  profile?: 'gaussian' | 'moffat';
  /** Quantise cutouts to 8-bit. Default false. */
  quantize8bit?: boolean;
  /** Apply an asinh stretch. Default false. */
  asinhStretch?: boolean;
  /** Apply the real-fixture DSS/HiPS display stretch (see RenderOpts.dssStretch). */
  dssStretch?: boolean;
}

/**
 * A balanced (≈50/50 star/galaxy) labelled population spanning an SNR range and,
 * for galaxies, a size range that INCLUDES the hard near-boundary regime
 * (trueSizeOverPsf ~1.1–1.6). Deterministic in `seed`.
 */
export function generateLabeledPopulation(seed: number, n: number, opts: PopulationOpts = {}): LabeledCutout[] {
  const magRange = opts.magRange ?? [19, 24];
  const psfFwhmArcsec = opts.psfFwhmArcsec ?? 0.7;
  const pixelScaleArcsec = opts.pixelScaleArcsec ?? 0.2;
  const sersicNRange = opts.sersicNRange ?? [1, 4];
  const reArcsecRange = opts.reArcsecRange ?? [0.35, 1.3];
  const profile = opts.profile ?? 'gaussian';
  const quantize8bit = opts.quantize8bit ?? false;
  const asinhStretch = opts.asinhStretch ?? false;
  const dssStretch = opts.dssStretch ?? false;

  const rand = mulberry32(hashSeed(seed, n, 0x5eed));
  const out: LabeledCutout[] = [];
  for (let i = 0; i < n; i++) {
    // Balanced classes: even index star, odd index galaxy.
    const trueClass: TrueClass = i % 2 === 0 ? 'star' : 'galaxy';
    const mag = magRange[0] + rand() * (magRange[1] - magRange[0]);
    const reArcsec = reArcsecRange[0] + rand() * (reArcsecRange[1] - reArcsecRange[0]);
    const sersicN = sersicNRange[0] + rand() * (sersicNRange[1] - sersicNRange[0]);
    const ellipticity = rand() * 0.5;
    const paDeg = rand() * 180;
    out.push(
      renderLabeledCutout({
        trueClass,
        seed: hashSeed(seed, i, 0xa11ce),
        mag,
        psfFwhmArcsec,
        pixelScaleArcsec,
        reArcsec,
        sersicN,
        ellipticity,
        paDeg,
        profile,
        quantize8bit,
        asinhStretch,
        dssStretch,
      }),
    );
  }
  return out;
}
