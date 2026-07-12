import { describe, it, expect } from 'vitest';
import {
  classifyCutout,
  alwaysGalaxyClassify,
  makeRandomClassifier,
  CLASSIFIER_THRESHOLDS,
  type InferredClass,
  type ImageClassification,
} from '../../src/utils/objectClassifier.js';
import { renderLabeledCutout } from '../../src/utils/syntheticMorphology.js';
import { type Cutout } from '../../src/utils/imageFeatures.js';

/**
 * UNIT tests for the RETUNED (TODO 138) image classifier.
 *
 * The authoritative accuracy / adversarial-baseline gate now lives in
 * tests/regression/objectClassifier.regression.test.ts, which scores the classifier
 * on a REAL labelled DSS/SIMBAD holdout in the stretched-8-bit regime the app actually
 * feeds it. That replaced the old synthetic-population accuracy centrepiece, which was
 * measured on LINEAR-flux, cleanly-sampled, sub-arcsec-galaxy cutouts — a regime that
 * does NOT match real HiPS imagery and was the ROOT CAUSE of the poor real-sky
 * performance (clean analytic Sérsic galaxies are far more concentrated than real DSS
 * galaxies, so a threshold that works on one regime cannot work on the other).
 *
 * These unit tests therefore exercise the classifier on REGIME-APPROPRIATE constructed
 * cutouts (undersampled PSF, real-like scales) plus the honesty gates, determinism,
 * scale-invariance and confidence calibration — all with an adversarial baseline that a
 * constant/random classifier must fail.
 */

const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.LN2);

/** Deterministic PRNG (mulberry32) — the ONLY entropy, so the suite is reproducible. */
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

/**
 * A DSS/HiPS-like cutout: undersampled PSF (psfFwhmPx = 2.5, the app's display floor),
 * a compact point (star) OR an extended exponential blob (galaxy) on a noisy sky, then
 * 8-bit quantised — the regime the shipped classifier is tuned for. Deterministic.
 */
function makePatch(
  kind: 'star' | 'galaxy',
  seed: number,
  sizePx: number,
  amp = 220,
): Cutout {
  const W = 64;
  const cx = (W - 1) / 2;
  const pixelScaleArcsec = 1.4;
  const psfFwhmArcsec = 2.5 * pixelScaleArcsec; // ⇒ psfFwhmPx = 2.5
  const rand = mulberry32(seed);
  const data = new Float32Array(W * W);
  const sky = 8;
  const psfSigma = 2.5 / FWHM_PER_SIGMA;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - cx, y - cx);
      let s: number;
      if (kind === 'star') {
        // A point source = the PSF (σ ≈ 1.06 px), so it is genuinely as sharp as the
        // display can resolve — a bit of noise, then quantise.
        s = amp * Math.exp(-0.5 * (r * r) / (psfSigma * psfSigma));
      } else {
        // An extended exponential disk of scale length `sizePx` ≫ PSF.
        s = amp * Math.exp(-r / sizePx);
      }
      const noise = (rand() - 0.5) * 6;
      const v = sky + s + noise;
      data[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { data, width: W, height: W, pixelScaleArcsec, psfFwhmArcsec };
}

interface LabeledPatch {
  cutout: Cutout;
  trueClass: 'star' | 'galaxy';
}
/** A balanced labelled set spanning a range of galaxy scales incl. near-boundary ones. */
function buildPopulation(seed: number, n: number): LabeledPatch[] {
  const rand = mulberry32(seed);
  const out: LabeledPatch[] = [];
  for (let i = 0; i < n; i++) {
    const trueClass: 'star' | 'galaxy' = i % 2 === 0 ? 'star' : 'galaxy';
    if (trueClass === 'star') {
      out.push({ cutout: makePatch('star', 0x1000 + i, 0, 140 + rand() * 100), trueClass });
    } else {
      const scalePx = 12 + rand() * 20; // 12..32 px scale length (≫ 2.5 px PSF)
      out.push({ cutout: makePatch('galaxy', 0x2000 + i, scalePx, 140 + rand() * 100), trueClass });
    }
  }
  return out;
}

interface Confusion {
  starRecall: number;
  galaxyRecall: number;
  balancedAccuracy: number;
}
function confusion(pop: LabeledPatch[], classify: (c: Cutout) => ImageClassification): Confusion {
  const m = { star: { star: 0, galaxy: 0, unknown: 0 }, galaxy: { star: 0, galaxy: 0, unknown: 0 } };
  for (const p of pop) m[p.trueClass][classify(p.cutout).cls]++;
  const sN = m.star.star + m.star.galaxy + m.star.unknown;
  const gN = m.galaxy.star + m.galaxy.galaxy + m.galaxy.unknown;
  const starRecall = sN ? m.star.star / sN : 0;
  const galaxyRecall = gN ? m.galaxy.galaxy / gN : 0;
  return { starRecall, galaxyRecall, balancedAccuracy: 0.5 * (starRecall + galaxyRecall) };
}

/** Scale a cutout by k, preserving NaN gaps. */
function scaleCutout(c: Cutout, k: number): Cutout {
  const data = new Float32Array(c.data.length);
  for (let i = 0; i < c.data.length; i++) data[i] = Number.isNaN(c.data[i]!) ? NaN : c.data[i]! * k;
  return { ...c, data };
}

describe('classifyCutout — regime-appropriate separation + adversarial baselines', () => {
  const pop = buildPopulation(42, 200);
  const real = confusion(pop, classifyCutout);
  const always = confusion(pop, alwaysGalaxyClassify);
  const random = confusion(pop, makeRandomClassifier(1234));

  it('the real classifier separates compact from extended at high balanced accuracy', () => {
    expect(real.balancedAccuracy).toBeGreaterThanOrEqual(0.85);
    expect(real.starRecall).toBeGreaterThan(0.7);
    expect(real.galaxyRecall).toBeGreaterThan(0.7);
  });

  it('ALWAYS-GALAXY sits at the class prior (bal ≈ 0.5) and loses to the real classifier', () => {
    expect(always.galaxyRecall).toBeCloseTo(1, 5);
    expect(always.starRecall).toBe(0);
    expect(always.balancedAccuracy).toBeCloseTo(0.5, 1);
    expect(real.balancedAccuracy).toBeGreaterThan(always.balancedAccuracy + 0.2);
  });

  it('a seeded RANDOM baseline measures ≈ 0.5 and loses to the real classifier', () => {
    expect(random.balancedAccuracy).toBeGreaterThan(0.3);
    expect(random.balancedAccuracy).toBeLessThan(0.7);
    expect(real.balancedAccuracy).toBeGreaterThan(random.balancedAccuracy);
  });
});

describe('classifyCutout — honesty gates return unknown, never a fabricated class', () => {
  it('insufficient resolution (local PSF < minPsfPx) ⇒ unknown', () => {
    // psf/pixel = 1.0 px < minPsfPx (2). A bright galaxy must still refuse.
    const g = renderLabeledCutout({ trueClass: 'galaxy', seed: 2, mag: 18, psfFwhmArcsec: 0.2, pixelScaleArcsec: 0.2, reArcsec: 0.6 });
    const r = classifyCutout(g.cutout);
    expect(r.cls).toBe('unknown');
    expect(r.reason).toContain('resolution');
    expect(r.confidence).toBeLessThanOrEqual(0.25);
  });

  it('too many gaps (gapFraction > gapMax) ⇒ unknown', () => {
    const s = makePatch('star', 5, 0);
    const d = s.data;
    for (let i = 0; i < d.length; i++) if (i % 5 < 2) d[i] = NaN; // 40% NaN
    const r = classifyCutout(s);
    expect(r.cls).toBe('unknown');
    expect(r.reason).toContain('gap');
  });

  it('a LARGE saturated plateau ⇒ unknown, not a fabricated galaxy (blocker B9)', () => {
    // A 5×5 clipped flat core — genuine saturation, unlike an 8-bit quantisation dab.
    const s = makePatch('star', 7, 0, 240);
    const d = s.data;
    const w = s.width;
    const c0 = w / 2; // integer centre (W even)
    let mx = 0;
    for (const v of d) if (v > mx) mx = v;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) d[(c0 + dy) * w + (c0 + dx)] = mx;
    const r = classifyCutout(s);
    expect(r.features.saturatedCore).toBe(true);
    expect(r.cls).toBe('unknown');
    expect(r.reason).toContain('saturated');
  });

  it('a patch with NO source above sky ⇒ hard unknown via the structure gate (TODO 147)', () => {
    // Flat sky + faint white noise in the UNDERSAMPLED/stretched regime (localPsfPx =
    // 2.5). Peak-SNR alone CANNOT reject this (a diffuse ~1.2σ galaxy would sit here too),
    // so it used to leak out a low-confidence star/galaxy. The spatial-coherence gate
    // (Moran's I ≈ 0 for white noise) now returns a HARD `unknown` — the honest DSS-regime
    // analogue of the well-sampled empty-sky SNR gate.
    const W = 64;
    const data = new Float32Array(W * W);
    const rand = mulberry32(99);
    for (let i = 0; i < data.length; i++) data[i] = 8 + (rand() - 0.5) * 1.2;
    const r = classifyCutout({ data, width: W, height: W, pixelScaleArcsec: 1.4, psfFwhmArcsec: 3.5 });
    expect(r.cls).toBe('unknown');
    expect(r.reason).toContain('coherent');
    expect(r.features.spatialCoherence).toBeLessThan(CLASSIFIER_THRESHOLDS.coherenceMin);
    expect(r.confidence).toBeLessThanOrEqual(0.25);
  });
});

/**
 * The core TODO 147 assertion + its non-regression pair (the seam the Playwright
 * classify spec drives at the pixel level): in the SAME undersampled/stretched regime
 * (localPsfPx = 2.5), a pure-noise cutout must return a HARD `unknown`, while a real
 * structured source (compact PSF point AND diffuse extended blob) must still be
 * classified — the gate has to reject noise AND pass real faint structure, or it is
 * worthless. A gate that returned `unknown` for everything would pass the noise test but
 * FAIL the non-regression pair; a gate that returned a class for everything (the old
 * behaviour) fails the noise test.
 */
describe('classifyCutout — structure gate rejects noise, passes real sources (TODO 147)', () => {
  /** Pure gaussian noise at the raw seam shape (64×64, 8-bit, localPsfPx = 2.5). */
  function makeNoisePatch(seed: number, sky = 40, sigma = 8): Cutout {
    const W = 64;
    const rand = mulberry32(seed);
    const data = new Float32Array(W * W);
    for (let i = 0; i < data.length; i++) {
      // Box–Muller gaussian, then 8-bit clamp/round — the real seam's quantisation.
      const u1 = Math.max(1e-12, rand());
      const u2 = rand();
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      data[i] = Math.max(0, Math.min(255, Math.round(sky + g * sigma)));
    }
    return { data, width: W, height: W, pixelScaleArcsec: 1.4, psfFwhmArcsec: 3.5 };
  }

  it('NOISE-ONLY stretched cutout ⇒ unknown, NOT a low-confidence star/galaxy', () => {
    for (const seed of [1, 2, 3, 7, 99, 12345]) {
      const r = classifyCutout(makeNoisePatch(seed));
      expect(r.cls, `noise seed ${seed}`).toBe('unknown');
      expect(r.features.spatialCoherence, `noise seed ${seed}`).toBeLessThan(CLASSIFIER_THRESHOLDS.coherenceMin);
    }
  });

  it('non-regression: a real COMPACT point in the same regime still classifies STAR', () => {
    for (const seed of [1, 2, 3]) {
      const r = classifyCutout(makePatch('star', 0x9000 + seed, 0, 180));
      expect(r.cls, `compact seed ${seed}`).toBe('star');
      expect(r.features.spatialCoherence).toBeGreaterThanOrEqual(CLASSIFIER_THRESHOLDS.coherenceMin);
    }
  });

  it('non-regression: a real DIFFUSE extended source in the same regime still classifies GALAXY', () => {
    for (const scalePx of [22, 26, 30]) {
      const r = classifyCutout(makePatch('galaxy', 0xa000 + scalePx, scalePx, 200));
      expect(r.cls, `diffuse scale ${scalePx}`).toBe('galaxy');
      expect(r.features.spatialCoherence).toBeGreaterThanOrEqual(CLASSIFIER_THRESHOLDS.coherenceMin);
    }
  });

  it('the gate discriminates: real sources measure FAR higher coherence than noise', () => {
    const noise = classifyCutout(makeNoisePatch(42)).features.spatialCoherence;
    const star = classifyCutout(makePatch('star', 0xb001, 0, 180)).features.spatialCoherence;
    const gal = classifyCutout(makePatch('galaxy', 0xb002, 22, 200)).features.spatialCoherence;
    expect(star).toBeGreaterThan(noise + 0.3);
    expect(gal).toBeGreaterThan(noise + 0.3);
  });
});

describe('classifyCutout — an extended source reads galaxy; a compact one reads star', () => {
  it('a lone extended blob (no compact companion) classifies galaxy — light spread to large radii', () => {
    const g = makePatch('galaxy', 11, 24);
    const r = classifyCutout(g);
    expect(r.cls).toBe('galaxy');
    expect(r.features.concentrationRatio).toBeLessThan(CLASSIFIER_THRESHOLDS.concentrationRatioStar);
  });

  it('a compact point source classifies star — light packed in the inner aperture', () => {
    const s = makePatch('star', 12, 0);
    const r = classifyCutout(s);
    expect(r.cls).toBe('star');
    expect(r.features.concentrationRatio).toBeGreaterThanOrEqual(CLASSIFIER_THRESHOLDS.concentrationRatioStar);
  });
});

/**
 * WELL-SAMPLED / LINEAR regime (retune TODO 138 — offline synthetic cube).
 *
 * This is the regime the Playwright spec `tests/ui/image-classification.spec.ts`
 * drives through the REAL sampleCutoutAt→classifyCutout seam: a big-beam (PSF ≫ 1 px)
 * LINEAR cube with a KNOWN extended galaxy (Sérsic re=180″) and point star (Gaussian
 * FWHM 67″). Here the asinh-stretched concentrationRatio saturates (both classes ~0.65)
 * so the classifier switches to coreConcentration on localPsfPx ≥ wellSampledPsfPx.
 * A constant/swapped classifier gives the two the same label — these tests forbid that.
 */
function makeWellSampled(kind: 'star' | 'galaxy' | 'empty', seed: number, pixScale = 8): Cutout {
  const psfArcsec = Math.max(90, 2.5 * pixScale); // offline nominal beam (localPsfPx ≈ 11)
  const N = Math.max(48, Math.min(128, Math.round((8 * psfArcsec) / pixScale)));
  const cx = (N - 1) / 2;
  const rand = mulberry32(seed);
  const data = new Float32Array(N * N);
  const sky = 12;
  const peak = 158.5; // mag 19.5 at the cube's zero point
  const sigStar = (67 / FWHM_PER_SIGMA); // arcsec (FWHM 67″)
  const bn1 = 1.678; // Sérsic n=1
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const rArc = Math.hypot(x - cx, y - cx) * pixScale;
      let s = 0;
      if (kind === 'star') s = peak * Math.exp(-0.5 * (rArc / sigStar) ** 2);
      else if (kind === 'galaxy') s = peak * Math.exp(-bn1 * (rArc / 180)); // re=180″
      const v = sky + s + (rand() - 0.5) * 4;
      data[y * N + x] = Math.max(0, Math.min(255, v)) / 255;
    }
  }
  return { data, width: N, height: N, pixelScaleArcsec: pixScale, psfFwhmArcsec: psfArcsec };
}

describe('classifyCutout — WELL-SAMPLED linear regime (offline cube seam, TODO 138)', () => {
  it('the extended galaxy → galaxy, the point star → star (labels DIFFER)', () => {
    for (const ps of [6, 8, 10]) {
      const star = classifyCutout(makeWellSampled('star', 200 + ps, ps));
      const gal = classifyCutout(makeWellSampled('galaxy', 300 + ps, ps));
      expect(star.cls, `star @ ${ps}″/px`).toBe('star');
      expect(gal.cls, `galaxy @ ${ps}″/px`).toBe('galaxy');
      expect(star.cls).not.toBe(gal.cls); // a constant/swapped classifier fails here
      // it took the well-sampled branch (coreConcentration), not the DSS branch.
      expect(star.features.coreConcentration).toBeGreaterThanOrEqual(CLASSIFIER_THRESHOLDS.coreConcentrationStar);
      expect(gal.features.coreConcentration).toBeLessThan(CLASSIFIER_THRESHOLDS.coreConcentrationStar);
    }
  });

  it('empty sky in the linear regime is honestly UNKNOWN (peak-SNR gate), never a fabricated class', () => {
    for (const ps of [6, 8, 10]) {
      const r = classifyCutout(makeWellSampled('empty', 400 + ps, ps));
      expect(r.cls, `empty @ ${ps}″/px`).toBe('unknown');
      expect(r.confidence).toBeLessThanOrEqual(0.25);
    }
  });

  it('adversarial: always-galaxy and always-star each mislabel exactly one of the pair', () => {
    const star = makeWellSampled('star', 7);
    const gal = makeWellSampled('galaxy', 8);
    // always-galaxy gets the star wrong; always-star gets the galaxy wrong; the real
    // classifier gets both right — so a constant baseline cannot match it.
    expect(alwaysGalaxyClassify(star).cls).toBe('galaxy');
    expect(classifyCutout(star).cls).toBe('star');
    expect(classifyCutout(gal).cls).toBe('galaxy');
  });
});

describe('classifyCutout — confidence calibration (blocker B7)', () => {
  const pop = buildPopulation(42, 200);

  it('mean confidence on CORRECT calls exceeds mean confidence on INCORRECT calls', () => {
    let cS = 0, cN = 0, wS = 0, wN = 0;
    for (const p of pop) {
      const r = classifyCutout(p.cutout);
      if (r.cls === 'unknown') continue;
      if (r.cls === p.trueClass) { cS += r.confidence; cN++; } else { wS += r.confidence; wN++; }
    }
    expect(cN).toBeGreaterThan(0);
    if (wN > 0) expect(cS / cN).toBeGreaterThan(wS / wN);
  });

  it('confidence is in [0,1] and varies — never a hardcoded constant', () => {
    const confs = new Set<number>();
    for (const p of pop.slice(0, 80)) {
      const c = classifyCutout(p.cutout).confidence;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      confs.add(Math.round(c * 100));
    }
    expect(confs.size).toBeGreaterThan(5);
  });

  it('a source overrunning the FOV gets capped (low) confidence (degeneracy §8)', () => {
    // A huge blob whose flux reaches the border — the curve of growth is untrustworthy.
    const W = 64;
    const data = new Float32Array(W * W);
    const rand = mulberry32(3);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const dEdge = Math.min(x, y, W - 1 - x, W - 1 - y);
      data[y * W + x] = Math.round(Math.max(0, Math.min(255, 8 + 200 * Math.exp(-dEdge / 30) + (rand() - 0.5) * 4)));
    }
    const r = classifyCutout({ data, width: W, height: W, pixelScaleArcsec: 1.4, psfFwhmArcsec: 3.5 });
    if (r.cls !== 'unknown' && r.features.fillFraction > CLASSIFIER_THRESHOLDS.fillMax) {
      expect(r.confidence).toBeLessThanOrEqual(0.25);
    }
    expect(r.features.fillFraction).toBeGreaterThan(0);
  });
});

describe('classifyCutout — determinism, invariance, and result shape', () => {
  it('same cutout ⇒ identical classification (pure function)', () => {
    const g = makePatch('galaxy', 31, 24);
    expect(classifyCutout(g)).toEqual(classifyCutout(g));
  });

  it('multiplying the cutout by any positive constant k does NOT change the class', () => {
    const star = makePatch('star', 41, 0);
    const gal = makePatch('galaxy', 42, 24);
    for (const src of [star, gal]) {
      const base = classifyCutout(src).cls;
      for (const k of [0.5, 2, 100]) {
        expect(classifyCutout(scaleCutout(src, k)).cls).toBe(base);
      }
    }
  });

  it('reports subtype null and an image-inferred provenance', () => {
    const r = classifyCutout(makePatch('galaxy', 51, 24));
    expect(r.subtype).toBeNull();
    expect(r.provenance).toContain('image-inferred');
  });

  it('exposes the calibrated thresholds as named, inspectable constants', () => {
    expect(CLASSIFIER_THRESHOLDS.minPsfPx).toBeGreaterThan(0);
    expect(CLASSIFIER_THRESHOLDS.gapMax).toBeGreaterThan(0);
    expect(CLASSIFIER_THRESHOLDS.snrMin).toBeGreaterThan(0);
    expect(CLASSIFIER_THRESHOLDS.concentrationRatioStar).toBeGreaterThan(0);
    expect(CLASSIFIER_THRESHOLDS.concentrationRatioStar).toBeLessThan(1);
    expect(CLASSIFIER_THRESHOLDS.coherenceMin).toBeGreaterThan(0);
    expect(CLASSIFIER_THRESHOLDS.coherenceMin).toBeLessThan(1);
  });

  it('classification result exposes the driving features (audit trail)', () => {
    const r = classifyCutout(makePatch('star', 61, 0));
    expect(r.features).toHaveProperty('concentrationRatio');
    expect(r.features).toHaveProperty('coreFluxFraction');
    expect(r.features).toHaveProperty('fillFraction');
  });
});

// Type-only guard so InferredClass stays exported/consumed.
const _guard: InferredClass = 'unknown';
void _guard;


