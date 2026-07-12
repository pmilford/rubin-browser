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
 *   3. saturated core           (large clipped plateau)        → unknown
 *   4. too faint                (snr < snrMin)                 → unknown
 *   5. star iff concentrationRatio ≥ τ_c ; else galaxy.
 *
 * RETUNE (TODO 138): the previous rule keyed off fwhmRatio / spread_model / the
 * curve-of-growth concentration C — features FIT on LINEAR-flux, well-sampled Gaussian
 * synthetic cutouts. On the REAL sky the classifier sees 8-bit, asinh-STRETCHED,
 * often-undersampled HiPS luminance, and there those features collapse: the second-
 * moment FWHM and C are dominated by the stretch-lifted faint wings and swing wildly
 * with zoom (a 12-mag galaxy, NGC 1494, flipped star↔galaxy↔unknown across zoom
 * levels), and every source — star or galaxy — reads "extended" against the too-sharp
 * nominal PSF. The rule now keys off `concentrationRatio` = enclosed-flux(2·PSF) /
 * enclosed-flux(6·PSF): a dimensionless ratio of two PSF-scaled apertures measured
 * against a ROBUST low-percentile sky. It is patch-size- and zoom-independent, and on
 * a real labelled DSS/SIMBAD holdout (tests/regression/) it separates stars (light
 * packed in the inner aperture ⇒ HIGH ratio) from galaxies (light spread to large
 * radii ⇒ LOW ratio) at ~0.84 accuracy, versus ~0.5 for the always-galaxy /
 * always-star / random baselines. τ_c was FIT on that real holdout; ratchet-up-only.
 * The distance |concentrationRatio − τ_c| is the boundary distance that, with SNR,
 * drives confidence (blocker B7).
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
  concentrationRatioStar: number;
  fillMax: number;
  snrMin: number;
  minPsfPx: number;
  gapMax: number;
} = {
  // concentrationRatio (enclosed flux 2·PSF ÷ 6·PSF) AT OR ABOVE this ⇒ compact ⇒ star;
  // below ⇒ light spread to large radii ⇒ galaxy. FIT on the real DSS/SIMBAD holdout
  // (tests/regression/objectClassifier.regression.test.ts): galaxy recall 1.0 and
  // overall accuracy ~0.84 at this value, well clear of the 0.5 baselines. Ratchet up.
  concentrationRatioStar: 0.18,
  // fillFraction above this ⇒ the source (or a saturated stellar halo) overruns the
  // FOV: the curve-of-growth is untrustworthy, so cap confidence (degeneracy, §8).
  fillMax: 0.3,
  // Below this peak-SNR, refuse rather than guess. On 8-bit asinh-stretched pixels the
  // robust sky lands INSIDE a patch-filling galaxy, so a real diffuse galaxy's peak-SNR
  // is only ~1.2–2.5 (peak-SNR is a linear-flux concept that degrades under a stretch);
  // this floor therefore sits far below the old value of 7 — just high enough to still
  // gate a genuinely blank/near-noise-floor synthetic patch, without gating real
  // galaxies. The concentrationRatio, not peak-SNR, carries the star/galaxy call.
  snrMin: 1.1,
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
  // A degenerate concentrationRatio (no measurable curve of growth — e.g. a patch with
  // no real source above sky) cannot be classified. concentrationRatio is 0 only when
  // there is effectively no flux to integrate.
  if (!(features.concentrationRatio > 0)) {
    return unknown('no measurable source — class uncertain', features);
  }

  // Signed distance from the star/galaxy boundary: >0 ⇒ light packed inside the inner
  // aperture (compact ⇒ star); <0 ⇒ spread to large radii (extended ⇒ galaxy).
  const margin = features.concentrationRatio - t.concentrationRatioStar;
  const cls: InferredClass = margin >= 0 ? 'star' : 'galaxy';

  const boundaryConf = Math.tanh((Math.abs(margin) / t.concentrationRatioStar) * CONF_BOUNDARY_K);
  let confidence = clamp01(boundaryConf * snrConfidence(features.snr));
  // A source that overruns the FOV (or a saturated stellar halo reaching the border)
  // has an untrustworthy curve of growth — honest low confidence (degeneracy §8).
  let degenerate = '';
  if (features.fillFraction > t.fillMax) {
    confidence = Math.min(confidence, UNKNOWN_CONF_CAP);
    degenerate = ' — source overruns FOV, low confidence';
  }

  const shape = `concentrationRatio ${features.concentrationRatio.toFixed(3)} vs τ ${t.concentrationRatioStar}, coreFlux ${features.coreFluxFraction.toFixed(3)}, fill ${features.fillFraction.toFixed(2)}`;
  const reason = (cls === 'star' ? `compact core (${shape})` : `extended — light spread to large radii (${shape})`) + degenerate;

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
