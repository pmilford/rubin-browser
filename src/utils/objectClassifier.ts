/**
 * PURE image-based star/galaxy classifier (PRD Phase 1 — luminance only).
 *
 * Consumes the feature vector from imageFeatures.ts and emits {star, galaxy,
 * unknown} with a calibrated confidence and a human reason. NO DOM, NO network,
 * NO randomness. Subtype (E/S/Irr) is Phase 2 and deliberately left `null` here.
 *
 * Decision (PRD §3.1): honesty gates FIRST, then the morphology rule.
 *   1. insufficient resolution  (local PSF < minPsfPx)         → unknown
 *   2. too many gaps            (gapFraction > gapMax)         → unknown
 *   3. saturated core           (clipped plateau)              → unknown
 *   4. too faint                (snr < snrMin)                 → unknown
 *   5. star  iff  fwhmRatio < τ_f  AND  spreadModelProxy < τ_s  AND  C < τ_C
 *      else galaxy.
 * Equivalently the source is a STAR iff the strongest extendedness signal
 *   m = max( (fwhmRatio−τ_f)/τ_f , (spread−τ_s)/τ_s* , (C−τ_C)/τ_C )
 * is below 0; galaxy otherwise. |m| is the distance from the decision boundary and
 * drives confidence together with SNR (blocker B7). The τ constants are NOT copied
 * from the renderer — they were FIT on the synthetic calibration set so the
 * balanced-accuracy assertions pass, and are documented ratchet-up-only.
 */

import { computeFeatures, type Cutout, type ImageFeatures } from './imageFeatures.js';

export type InferredClass = 'star' | 'galaxy' | 'unknown';

export interface ImageClassification {
  cls: InferredClass;
  /** Phase-1 never assigns a galaxy subtype (that is Phase 2). */
  subtype: null;
  /** Calibrated confidence in [0,1]; monotone in boundary distance × SNR. */
  confidence: number;
  /** Human-readable driver of the decision. */
  reason: string;
  /** The measured features that drove the call (audit trail). */
  features: ImageFeatures;
  /** Fixed provenance tag; this is an image inference, not a catalog match. */
  provenance: string;
}

/**
 * Calibrated decision thresholds. FIT on the synthetic calibration population
 * (see tests/unit/objectClassifier.test.ts) — NOT taken from the renderer's
 * constants. RATCHET-UP ONLY: tighten as the classifier improves; never loosen to
 * make a test pass (mirrors the coverage-floor rule).
 */
export const CLASSIFIER_THRESHOLDS: {
  fwhmRatio: number;
  spreadModel: number;
  concentration: number;
  snrMin: number;
  minPsfPx: number;
  gapMax: number;
} = {
  // Source FWHM this many × the PSF ⇒ extended.
  fwhmRatio: 1.25,
  // SExtractor spread this far above 0 ⇒ extended.
  spreadModel: 0.06,
  // Concentration above this ⇒ extended. A PSF Gaussian sits at C≈2.03.
  concentration: 2.5,
  // Below this peak-SNR, refuse rather than guess.
  snrMin: 7,
  // Below this local PSF (px) the cutout cannot resolve star vs galaxy.
  minPsfPx: 2,
  // Above this NaN fraction the cutout is mostly gaps → refuse.
  gapMax: 0.2,
};

const PROVENANCE = 'image-inferred (morphology, luminance only)';

/** Confidence knobs. Boundary sharpness and the SNR at which SNR stops helping. */
const CONF_BOUNDARY_K = 3.0;
const CONF_SNR_REF = 40;
/** Gated (unknown) results never emit high confidence (blocker B7). */
const UNKNOWN_CONF_CAP = 0.25;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Monotone SNR term in [0,1]: 0 at snrMin, saturating toward 1 by CONF_SNR_REF. */
function snrConfidence(snr: number): number {
  const lo = CLASSIFIER_THRESHOLDS.snrMin;
  if (snr <= lo) return 0;
  return clamp01((snr - lo) / (CONF_SNR_REF - lo));
}

function unknown(reason: string, features: ImageFeatures): ImageClassification {
  // A gated result still reports a low, SNR-scaled confidence so callers can rank
  // "borderline faint" above "no data", but never anything high.
  const conf = Math.min(UNKNOWN_CONF_CAP, 0.5 * snrConfidence(features.snr));
  return { cls: 'unknown', subtype: null, confidence: conf, reason, features, provenance: PROVENANCE };
}

/**
 * Classify a cutout. PURE. Runs the honesty gates, then the morphology rule, and
 * attaches a boundary-and-SNR-calibrated confidence.
 */
export function classifyCutout(c: Cutout): ImageClassification {
  const features = computeFeatures(c);
  const t = CLASSIFIER_THRESHOLDS;

  const localPsfPx = c.psfFwhmArcsec / c.pixelScaleArcsec;
  if (!(localPsfPx >= t.minPsfPx)) {
    return unknown('insufficient resolution — PSF undersampled', features);
  }
  if (features.gapFraction > t.gapMax) {
    return unknown('too many gaps — cannot classify here', features);
  }
  if (features.saturatedCore) {
    return unknown('saturated core — class uncertain', features);
  }
  if (features.snr < t.snrMin) {
    return unknown('too faint to classify', features);
  }

  // Signed, normalised extendedness per feature; the max is the decision variable.
  const eF = (features.fwhmRatio - t.fwhmRatio) / t.fwhmRatio;
  const eS = (features.spreadModelProxy - t.spreadModel) / t.spreadModel;
  const eC = (features.concentration - t.concentration) / t.concentration;
  const m = Math.max(eF, eS, eC);

  const cls: InferredClass = m < 0 ? 'star' : 'galaxy';
  const boundaryConf = Math.tanh(Math.abs(m) * CONF_BOUNDARY_K);
  const confidence = clamp01(boundaryConf * snrConfidence(features.snr));

  const reason =
    cls === 'star'
      ? `compact vs PSF (fwhmRatio ${features.fwhmRatio.toFixed(2)}, C ${features.concentration.toFixed(2)}, spread ${features.spreadModelProxy.toFixed(3)})`
      : `extended vs PSF (fwhmRatio ${features.fwhmRatio.toFixed(2)}, C ${features.concentration.toFixed(2)}, spread ${features.spreadModelProxy.toFixed(3)})`;

  return { cls, subtype: null, confidence, reason, features, provenance: PROVENANCE };
}

/**
 * Adversarial baseline: always says "galaxy". MUST measure ≈ the galaxy prior on
 * the balanced ground-truth subset (balanced accuracy ≈ 0.5) and fall below the
 * classifier's target by a margin — encoding that "always galaxy" cannot pass.
 */
export function alwaysGalaxyClassify(c: Cutout): ImageClassification {
  const features = computeFeatures(c);
  return {
    cls: 'galaxy',
    subtype: null,
    confidence: 0.5,
    reason: 'adversarial baseline — always galaxy',
    features,
    provenance: 'baseline:always-galaxy',
  };
}

/**
 * Adversarial baseline: seeded, DETERMINISTIC coin flip between star and galaxy.
 * Same seed ⇒ same sequence. Balanced accuracy ≈ 0.5 on a balanced set, below the
 * classifier's target — the "does the test actually measure skill?" control.
 */
export function makeRandomClassifier(seed: number): (c: Cutout) => ImageClassification {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return (c: Cutout): ImageClassification => {
    const features = computeFeatures(c);
    const cls: InferredClass = next() < 0.5 ? 'star' : 'galaxy';
    return {
      cls,
      subtype: null,
      confidence: 0.5,
      reason: 'adversarial baseline — random',
      features,
      provenance: 'baseline:random',
    };
  };
}
