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
 *   4. no coherent structure    (undersampled: Moran's I < τ)  → unknown  (TODO 147)
 *   5. too faint                (snr < snrMin)                 → unknown
 *   6. star iff concentrationRatio ≥ τ_c ; else galaxy.
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
  coreConcentrationStar: number;
  wellSampledPsfPx: number;
  fillMax: number;
  snrMin: number;
  snrMinWellSampled: number;
  minPsfPx: number;
  gapMax: number;
  coherenceMin: number;
} = {
  // ── UNDERSAMPLED / asinh-stretched HiPS regime (DSS, browse-zoom Rubin) ──────────
  // localPsfPx ≈ 2.5 (the display-resolution floor dominates). Sources are haloed by
  // the plate/atmosphere and the aggressive stretch, so light spreads well past the
  // PSF core. concentrationRatio (2·PSF ÷ 6·PSF) AT OR ABOVE this ⇒ star; below ⇒
  // galaxy. FIT on the real DSS/SIMBAD holdout (tests/regression/): galaxy recall 1.0,
  // accuracy ~0.84, well clear of the 0.5 baselines. Ratchet up.
  concentrationRatioStar: 0.18,
  // ── WELL-SAMPLED regime (offline big-beam cube, high-res imagery) ────────────────
  // localPsfPx ≫ 2.5 (a real, many-pixel PSF; sources are NOT undersampled). There the
  // asinh-stretched concentrationRatio saturates (both classes ~0.65), so the tight-core
  // ratio coreConcentration (1·PSF ÷ 3·PSF) carries the call: a point source packs its
  // light inside 1·PSF (HIGH) while a resolved galaxy leaks past it (LOW). Star iff ≥ τ.
  coreConcentrationStar: 0.5,
  // localPsfPx AT OR ABOVE this selects the well-sampled branch. The DSS holdout sits at
  // 2.5 (floored) and the offline cube at ~11; 5 is a safe divider between them.
  wellSampledPsfPx: 5,
  // fillFraction above this ⇒ the source (or a saturated stellar halo) overruns the
  // FOV: the curve-of-growth is untrustworthy, so cap confidence (degeneracy, §8).
  fillMax: 0.3,
  // Peak-SNR floor for the UNDERSAMPLED/stretched regime. On 8-bit asinh-stretched pixels
  // the robust sky lands INSIDE a patch-filling galaxy, so a real diffuse galaxy's
  // peak-SNR is only ~1.2–2.5 (peak-SNR is a linear-flux concept that degrades under a
  // stretch). This floor sits far below the old value of 7 so real faint DSS galaxies
  // are not gated; the concentrationRatio, not peak-SNR, carries the call there.
  snrMin: 1.1,
  // Peak-SNR floor for the WELL-SAMPLED/linear regime, where peak-SNR IS meaningful:
  // a genuine linear source stands many σ above sky (offline sources ~25σ) while empty
  // sky is only a few σ (~2.7σ). This restores honest empty-sky rejection there.
  snrMinWellSampled: 7,
  // Below this local PSF (px) the cutout cannot resolve star vs galaxy.
  minPsfPx: 2,
  // Above this NaN fraction the cutout is mostly gaps → refuse.
  gapMax: 0.2,
  // ── STRUCTURE / spatial-coherence floor for the UNDERSAMPLED/stretched regime (TODO
  // 147). Lag-1 Moran's I (features.spatialCoherence) at or above this ⇒ a genuine,
  // spatially-coherent light concentration (a real source) is present; below it the
  // patch is spatially-incoherent (empty/noise-dominated sky) and is honestly gated to
  // `unknown` — the DSS-regime analogue of the well-sampled branch's SNR floor, which
  // peak-SNR CANNOT provide here (a diffuse ~1.2σ galaxy and empty sky share the same
  // peak-SNR on asinh-stretched 8-bit pixels). FIT with wide margin: on the real
  // DSS/SIMBAD holdout every star AND galaxy measures I ≥ 0.65, while white sky noise
  // measures I ≈ 0; 0.35 sits well below all real sources and well above noise. Applied
  // ONLY in the undersampled branch, so the well-sampled offline cube is untouched.
  // Ratchet UP as more real empty-sky data is captured.
  coherenceMin: 0.35,
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

  // REGIME SPLIT (retune TODO 138): the same absolute concentration means different
  // things on an undersampled, asinh-stretched HiPS patch (DSS: haloed sources, PSF
  // floored to ~2.5 px) versus a well-sampled LINEAR patch (offline big-beam cube: a
  // real many-pixel PSF, sharp sources). localPsfPx = PSF-FWHM ÷ pixel-scale cleanly
  // separates them (DSS ≈ 2.5, offline ≈ 11), so each regime uses the discriminant and
  // SNR floor that actually work there. This is NOT reading the display — localPsfPx is
  // a geometry ratio the caller already supplies.
  const wellSampled = localPsfPx >= t.wellSampledPsfPx;

  // STRUCTURE / spatial-coherence gate (TODO 147) — UNDERSAMPLED regime ONLY. On 8-bit
  // asinh-stretched HiPS pixels peak-SNR cannot tell a diffuse ~1.2σ galaxy from empty
  // sky (both spread flux, both a few σ), so the previous branch returned a low-confidence
  // star/galaxy for a structureless patch. A real source — compact star OR patch-filling
  // galaxy — is a SMOOTH, spatially-COHERENT light concentration (Moran's I ≥ ~0.65 on the
  // real holdout); white sky noise is spatially incoherent (I ≈ 0). Gating on coherence
  // makes empty stretched sky honestly `unknown`, exactly like the well-sampled empty-sky
  // case, WITHOUT touching that branch (it is `wellSampled` and already SNR-gated) and
  // without swallowing real faint structure (which clears the floor by a wide margin).
  if (!wellSampled && features.spatialCoherence < t.coherenceMin) {
    return unknown('no coherent structure — empty or noise-dominated sky', features);
  }

  // Faint/empty-sky gate. In the well-sampled LINEAR regime peak-SNR is meaningful, so a
  // higher floor honestly rejects empty sky (a few σ) while passing real sources (≫σ). In
  // the stretched regime peak-SNR collapses for diffuse galaxies, so the floor is low.
  const snrFloor = wellSampled ? t.snrMinWellSampled : t.snrMin;
  if (features.snr < snrFloor) {
    return unknown('too faint to classify', features);
  }

  // The discriminant (and its boundary τ) is regime-specific.
  const value = wellSampled ? features.coreConcentration : features.concentrationRatio;
  const tau = wellSampled ? t.coreConcentrationStar : t.concentrationRatioStar;
  // A degenerate discriminant (no measurable curve of growth — no real source above sky)
  // cannot be classified honestly.
  if (!(value > 0)) {
    return unknown('no measurable source — class uncertain', features);
  }

  // Signed distance from the star/galaxy boundary: ≥0 ⇒ light packed in the core
  // (compact ⇒ star); <0 ⇒ spread to large radii (extended ⇒ galaxy).
  const margin = value - tau;
  const cls: InferredClass = margin >= 0 ? 'star' : 'galaxy';

  const boundaryConf = Math.tanh((Math.abs(margin) / tau) * CONF_BOUNDARY_K);
  let confidence = clamp01(boundaryConf * snrConfidence(features.snr));
  // A source that overruns the FOV (or a saturated stellar halo reaching the border)
  // has an untrustworthy curve of growth — honest low confidence (degeneracy §8).
  let degenerate = '';
  if (features.fillFraction > t.fillMax) {
    confidence = Math.min(confidence, UNKNOWN_CONF_CAP);
    degenerate = ' — source overruns FOV, low confidence';
  }

  const drv = wellSampled
    ? `coreConcentration ${features.coreConcentration.toFixed(3)} vs τ ${tau}`
    : `concentrationRatio ${features.concentrationRatio.toFixed(3)} vs τ ${tau}`;
  const shape = `${drv}, coreFlux ${features.coreFluxFraction.toFixed(3)}, fill ${features.fillFraction.toFixed(2)}`;
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
