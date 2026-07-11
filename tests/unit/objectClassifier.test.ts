import { describe, it, expect } from 'vitest';
import {
  classifyCutout,
  alwaysGalaxyClassify,
  makeRandomClassifier,
  CLASSIFIER_THRESHOLDS,
  type InferredClass,
  type ImageClassification,
} from '../../src/utils/objectClassifier.js';
import { generateLabeledPopulation, renderLabeledCutout, type LabeledCutout } from '../../src/utils/syntheticMorphology.js';
import { type Cutout } from '../../src/utils/imageFeatures.js';

/**
 * THE CENTERPIECE (PRD §5, CLAUDE.md adversarial rule).
 *
 * The classifier is scored by BALANCED ACCURACY against known truth with a printed
 * confusion matrix — never by "it produced a label". The adversarial baselines
 * ("always galaxy", seeded random) are run through the IDENTICAL ground-truth
 * subset and MUST measure at the class prior and BELOW target; if "always galaxy"
 * could pass, the test would be worthless (blocker B6). The ground-truth subset is
 * defined ONLY by render truth (trueSnr / trueSizeOverPsf), never by the
 * classifier's own gate or confidence (blocker B5).
 *
 * ANTI-OVERFIT HOLDOUT (blocker B1): an INDEPENDENT population is generated with a
 * DIFFERENT forward model (Moffat PSF, quantised 8-bit, asinh-stretched, different
 * Sérsic/size ranges — mimicking stretched HiPS tiles). The classifier's FIXED
 * thresholds must still clear a (lower) balanced-accuracy bar there. NOTE: a real
 * SIMBAD / DP1-imagery holdout remains a follow-up (§5.2); this synthetic
 * different-generator holdout only guards the generator↔classifier self-
 * consistency trap, it does not prove real-sky performance.
 */

// ── Ratchet-UP-only accuracy floors (never lower to pass; raise as we improve). ──
const TARGET_BALANCED_ACC = 0.85; // calibration, resolved/bright subset
const HOLDOUT_BALANCED_ACC = 0.75; // independent different-forward-model holdout
const BASELINE_MAX = 0.7; // adversarial baselines must sit well below this

// Ground-truth subset (render truth ONLY): bright, and — for galaxies — resolved.
const SUBSET_MIN_SNR = 30;
const SUBSET_MIN_SIZE = 1.3;

function inSubset(p: LabeledCutout): boolean {
  return p.trueSnr >= SUBSET_MIN_SNR && (p.trueClass === 'star' || p.trueSizeOverPsf >= SUBSET_MIN_SIZE);
}

interface Confusion {
  // rows = truth, cols = predicted
  matrix: Record<'star' | 'galaxy', Record<InferredClass, number>>;
  starRecall: number;
  galaxyRecall: number;
  balancedAccuracy: number;
  n: number;
}

function confusion(subset: LabeledCutout[], classify: (c: Cutout) => ImageClassification): Confusion {
  const matrix = {
    star: { star: 0, galaxy: 0, unknown: 0 },
    galaxy: { star: 0, galaxy: 0, unknown: 0 },
  };
  for (const p of subset) {
    const pred = classify(p.cutout).cls;
    matrix[p.trueClass][pred]++;
  }
  const starN = matrix.star.star + matrix.star.galaxy + matrix.star.unknown;
  const galN = matrix.galaxy.star + matrix.galaxy.galaxy + matrix.galaxy.unknown;
  const starRecall = starN ? matrix.star.star / starN : 0;
  const galaxyRecall = galN ? matrix.galaxy.galaxy / galN : 0;
  return {
    matrix,
    starRecall,
    galaxyRecall,
    balancedAccuracy: 0.5 * (starRecall + galaxyRecall),
    n: subset.length,
  };
}

function printConfusion(title: string, c: Confusion): void {
  const m = c.matrix;
  // The harness is REQUIRED to print the matrix (run with --disable-console-intercept to see it).
  console.log(
    `\n${title} (n=${c.n})\n` +
      `truth\\pred    star  galaxy  unknown\n` +
      `star          ${String(m.star.star).padStart(4)}  ${String(m.star.galaxy).padStart(6)}  ${String(m.star.unknown).padStart(7)}\n` +
      `galaxy        ${String(m.galaxy.star).padStart(4)}  ${String(m.galaxy.galaxy).padStart(6)}  ${String(m.galaxy.unknown).padStart(7)}\n` +
      `starRecall=${c.starRecall.toFixed(3)} galaxyRecall=${c.galaxyRecall.toFixed(3)} balancedAcc=${c.balancedAccuracy.toFixed(3)}`,
  );
}

/** Scale a cutout's data by k, preserving NaN gaps. */
function scaleCutout(c: Cutout, k: number): Cutout {
  const data = new Float32Array(c.data.length);
  for (let i = 0; i < c.data.length; i++) data[i] = Number.isNaN(c.data[i]!) ? NaN : c.data[i]! * k;
  return { ...c, data };
}

describe('classifyCutout — balanced accuracy vs known truth + adversarial baselines', () => {
  // Calibration population and the render-truth-defined resolved/bright subset.
  const pop = generateLabeledPopulation(42, 600);
  const subset = pop.filter(inSubset);
  const rand = makeRandomClassifier(1234);

  const real = confusion(subset, classifyCutout);
  const always = confusion(subset, alwaysGalaxyClassify);
  const random = confusion(subset, rand);

  it('prints the confusion matrices for the real classifier and both baselines', () => {
    printConfusion('REAL classifier', real);
    printConfusion('always-galaxy baseline', always);
    printConfusion('random baseline', random);
    expect(subset.length).toBeGreaterThan(150);
  });

  it('the subset is balanced (≈50/50 star vs galaxy)', () => {
    const stars = subset.filter((p) => p.trueClass === 'star').length;
    const gals = subset.length - stars;
    expect(Math.abs(stars - gals) / subset.length).toBeLessThan(0.15);
  });

  it('the real classifier meets the balanced-accuracy target on the resolved/bright subset', () => {
    expect(real.balancedAccuracy).toBeGreaterThanOrEqual(TARGET_BALANCED_ACC);
  });

  it('the task is NON-TRIVIAL: real accuracy is below 1.0 (includes near-boundary sources)', () => {
    expect(real.balancedAccuracy).toBeLessThan(1.0);
  });

  it('ALWAYS-GALAXY measures ≈ the galaxy prior (balanced ≈ 0.5) and BELOW target by a margin', () => {
    expect(always.galaxyRecall).toBeCloseTo(1, 5); // it labels everything galaxy
    expect(always.starRecall).toBe(0);
    expect(always.balancedAccuracy).toBeCloseTo(0.5, 1);
    expect(always.balancedAccuracy).toBeLessThan(BASELINE_MAX);
    expect(always.balancedAccuracy).toBeLessThan(real.balancedAccuracy - 0.2);
  });

  it('RANDOM (seeded) measures ≈ 0.5 and below target', () => {
    expect(random.balancedAccuracy).toBeGreaterThan(0.3);
    expect(random.balancedAccuracy).toBeLessThan(BASELINE_MAX);
    expect(random.balancedAccuracy).toBeLessThan(real.balancedAccuracy);
  });

  it('the real classifier beats BOTH baselines on the identical ground-truth subset', () => {
    expect(real.balancedAccuracy).toBeGreaterThan(always.balancedAccuracy);
    expect(real.balancedAccuracy).toBeGreaterThan(random.balancedAccuracy);
  });
});

describe('classifyCutout — anti-overfit holdout with a DIFFERENT forward model (blocker B1)', () => {
  // Moffat PSF, 8-bit quantised + asinh-stretched, different Sérsic/size ranges.
  const holdout = generateLabeledPopulation(9090, 600, {
    profile: 'moffat',
    quantize8bit: true,
    asinhStretch: true,
    sersicNRange: [1.5, 5],
    reArcsecRange: [0.4, 1.5],
  });
  const subset = holdout.filter(inSubset);

  it('the FIXED-threshold classifier still clears the holdout balanced-accuracy bar', () => {
    const c = confusion(subset, classifyCutout);
    printConfusion('HOLDOUT (moffat / 8-bit / asinh)', c);
    expect(subset.length).toBeGreaterThan(150);
    expect(c.balancedAccuracy).toBeGreaterThanOrEqual(HOLDOUT_BALANCED_ACC);
    // Still measurably beats always-galaxy on the same holdout subset.
    const always = confusion(subset, alwaysGalaxyClassify);
    expect(c.balancedAccuracy).toBeGreaterThan(always.balancedAccuracy + 0.15);
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
    const s = renderLabeledCutout({ trueClass: 'star', seed: 3, mag: 18 });
    const d = s.cutout.data;
    // Blank out 40% of the cells as NaN (off-tile).
    for (let i = 0; i < d.length; i++) if (i % 5 < 2) d[i] = NaN;
    const r = classifyCutout(s.cutout);
    expect(r.cls).toBe('unknown');
    expect(r.reason).toContain('gap');
  });

  it('a SATURATED clipped core does NOT classify as galaxy (blocker B9)', () => {
    // A bright STAR whose core is clipped to a flat plateau. A naive size-only
    // classifier would call the inflated core a galaxy; the gate must say unknown.
    const s = renderLabeledCutout({ trueClass: 'star', seed: 4, mag: 17 });
    const d = s.cutout.data;
    const w = s.cutout.width;
    const c0 = (w - 1) / 2;
    let mx = 0;
    for (const v of d) if (v > mx) mx = v;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) d[(c0 + dy) * w + (c0 + dx)] = mx;
    const r = classifyCutout(s.cutout);
    expect(r.features.saturatedCore).toBe(true);
    expect(r.cls).not.toBe('galaxy');
    expect(r.cls).toBe('unknown');
    expect(r.reason).toContain('saturated');
  });

  it('a too-faint source (snr < snrMin) ⇒ unknown, never false certainty', () => {
    const s = renderLabeledCutout({ trueClass: 'star', seed: 5, mag: 25.5 });
    const r = classifyCutout(s.cutout);
    expect(r.cls).toBe('unknown');
    expect(r.confidence).toBeLessThanOrEqual(0.25);
  });
});

describe('classifyCutout — an ISOLATED galaxy is measured vs the EXTERNAL PSF (blocker B3)', () => {
  it('a lone galaxy (no companion stars) with a true nominal PSF reads fwhmRatio>1 and classifies galaxy', () => {
    const g = renderLabeledCutout({ trueClass: 'galaxy', seed: 21, mag: 18, reArcsec: 1.0, sersicN: 1 });
    const r = classifyCutout(g.cutout);
    expect(r.features.fwhmRatio).toBeGreaterThan(1);
    expect(r.cls).toBe('galaxy');
  });
});

describe('classifyCutout — confidence calibration (blocker B7)', () => {
  const pop = generateLabeledPopulation(42, 600);

  it('mean confidence on CORRECT calls exceeds mean confidence on INCORRECT calls', () => {
    let correctSum = 0;
    let correctN = 0;
    let wrongSum = 0;
    let wrongN = 0;
    for (const p of pop) {
      const r = classifyCutout(p.cutout);
      if (r.cls === 'unknown') continue;
      if (r.cls === p.trueClass) {
        correctSum += r.confidence;
        correctN++;
      } else {
        wrongSum += r.confidence;
        wrongN++;
      }
    }
    expect(correctN).toBeGreaterThan(0);
    expect(wrongN).toBeGreaterThan(0);
    const meanCorrect = correctSum / correctN;
    const meanWrong = wrongSum / wrongN;
    expect(meanCorrect).toBeGreaterThan(meanWrong);
  });

  it('confidence is in [0,1] and never a constant default', () => {
    const confs = new Set<number>();
    for (const p of pop.slice(0, 60)) {
      const c = classifyCutout(p.cutout).confidence;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      confs.add(Math.round(c * 100));
    }
    expect(confs.size).toBeGreaterThan(5); // varies, not a hardcoded constant
  });

  it('low-trueSnr sources get low confidence', () => {
    const faint = renderLabeledCutout({ trueClass: 'star', seed: 5, mag: 24.5 });
    const bright = renderLabeledCutout({ trueClass: 'star', seed: 5, mag: 18 });
    expect(classifyCutout(faint.cutout).confidence).toBeLessThan(classifyCutout(bright.cutout).confidence);
  });
});

describe('classifyCutout — determinism, invariance, and result shape', () => {
  it('same cutout ⇒ identical classification (pure function)', () => {
    const g = renderLabeledCutout({ trueClass: 'galaxy', seed: 31, mag: 19 });
    const a = classifyCutout(g.cutout);
    const b = classifyCutout(g.cutout);
    expect(a).toEqual(b);
  });

  it('multiplying the cutout by any positive constant k does NOT change the class', () => {
    const star = renderLabeledCutout({ trueClass: 'star', seed: 41, mag: 18 });
    const gal = renderLabeledCutout({ trueClass: 'galaxy', seed: 42, mag: 18, reArcsec: 1.0, sersicN: 1 });
    for (const src of [star.cutout, gal.cutout]) {
      const base = classifyCutout(src).cls;
      for (const k of [0.01, 0.5, 2, 100]) {
        expect(classifyCutout(scaleCutout(src, k)).cls).toBe(base);
      }
    }
  });

  it('reports subtype null and an image-inferred provenance', () => {
    const g = renderLabeledCutout({ trueClass: 'galaxy', seed: 51, mag: 19 });
    const r = classifyCutout(g.cutout);
    expect(r.subtype).toBeNull();
    expect(r.provenance).toContain('image-inferred');
  });

  it('exposes the calibrated thresholds as named, inspectable constants', () => {
    expect(CLASSIFIER_THRESHOLDS.minPsfPx).toBeGreaterThan(0);
    expect(CLASSIFIER_THRESHOLDS.gapMax).toBeGreaterThan(0);
    expect(CLASSIFIER_THRESHOLDS.snrMin).toBeGreaterThan(0);
  });
});
