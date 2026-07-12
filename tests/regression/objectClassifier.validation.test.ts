import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { type Cutout } from '../../src/utils/imageFeatures.js';
import { classifyCutout, alwaysGalaxyClassify, type InferredClass } from '../../src/utils/objectClassifier.js';

/**
 * INDEPENDENT validation of the image classifier (TODO 147).
 *
 * The tuning holdout (objectClassifier.regression.test.ts, TODO 138) scores ~0.84 —
 * but it is the SAME data the thresholds were fit on. This spec scores the classifier
 * on a SEPARATE, never-tuned-on holdout of fresh textbook objects
 * (objectClassifier-holdout-val.json; rebuild via scripts/build-holdout-val.mts),
 * built with the identical DSS2-red + asinh-a=10 pipeline (feature-verified against a
 * committed tuning sample). It deliberately over-samples VERY BRIGHT stars
 * (Sirius/Vega/Aldebaran/Regulus/Pollux) and irregular/edge-on galaxies (M82, NGC 891,
 * Cen A) to probe the two hardest failure modes.
 *
 * FINDING (the reason this file exists): the 138 retune OVERFITS the tuning set. On
 * this independent set the classifier lands at ~0.36 accuracy / ~0.06 star recall —
 * BELOW the 0.50 always-galaxy baseline. Root cause: the undersampled discriminant
 * `concentrationRatio ≥ 0.18` learned "compact ⇒ star" from the tuning set's FAINT
 * stars, but a BRIGHT star saturates + blooms in DSS to a large low-concentration
 * blob that is morphologically indistinguishable from a galaxy in luminance only.
 * There is no luminance-morphology feature that separates them (asymmetry catches a
 * few but would wreck galaxy recall on irregular galaxies). This spec scores the PURE
 * `classifyCutout` (morphology only), so these numbers stand as a documented ceiling.
 *
 * DEPLOYED fix (TODO 151, `src/utils/catalogClassify.ts`, wired in TileViewer): a
 * catalog cross-match OVERRIDES the morphology call when the click identifies a typed
 * catalogue object at the cursor — a bundled bright star (Sirius/Vega) now classifies
 * "Star (catalog)" in the app even though its pixels read galaxy here. That override
 * is a UI-layer wrap, NOT part of `classifyCutout`, so it does not move these
 * pure-morphology numbers; extending the cross-match to a live SIMBAD/Gaia cone (full
 * coverage beyond the bundled catalogue) remains open. This spec locks the pure
 * finding in as a ratchet-up gate so the overfit can never hide behind the tuning number.
 */

interface S { name: string; label: 'star' | 'galaxy'; fovDeg: number; pixelScaleArcsec: number; psfFwhmArcsec: number; width: number; height: number; pixels: number[]; }
const fx: { samples: S[] } = JSON.parse(readFileSync('tests/fixtures/objectClassifier-holdout-val.json', 'utf-8'));

function toCutout(s: S): Cutout {
  const d = new Float32Array(s.pixels.length);
  for (let i = 0; i < s.pixels.length; i++) d[i] = s.pixels[i] === -1 ? NaN : s.pixels[i]! / 255;
  return { data: d, width: s.width, height: s.height, pixelScaleArcsec: s.pixelScaleArcsec, psfFwhmArcsec: s.psfFwhmArcsec };
}

interface Score { acc: number; balAcc: number; starRecall: number; galaxyRecall: number; matrix: Record<'star' | 'galaxy', Record<InferredClass, number>>; }
function score(classify: (c: Cutout) => { cls: InferredClass }): Score {
  const matrix = { star: { star: 0, galaxy: 0, unknown: 0 }, galaxy: { star: 0, galaxy: 0, unknown: 0 } };
  let correct = 0;
  for (const s of fx.samples) {
    const pred = classify(toCutout(s)).cls;
    matrix[s.label][pred]++;
    if (pred === s.label) correct++;
  }
  const sN = matrix.star.star + matrix.star.galaxy + matrix.star.unknown;
  const gN = matrix.galaxy.star + matrix.galaxy.galaxy + matrix.galaxy.unknown;
  const starRecall = sN ? matrix.star.star / sN : 0;
  const galaxyRecall = gN ? matrix.galaxy.galaxy / gN : 0;
  return { acc: correct / fx.samples.length, balAcc: 0.5 * (starRecall + galaxyRecall), starRecall, galaxyRecall, matrix };
}

// ── Ratchet-UP-only floors. RAISE these as the classifier is fixed; NEVER lower. ──
// balAcc currently ~0.36 (BELOW the 0.5 always-galaxy baseline — the overfit). This
// floor exists to (a) make the gap a tested fact and (b) force any future change to
// move it UP, not silently regress further. galaxies DO generalise (recall ~0.67).
const VAL_BAL_ACC_FLOOR = 0.30;
const VAL_GALAXY_RECALL_FLOOR = 0.6;

describe('classifyCutout — INDEPENDENT validation holdout (TODO 147, overfit guard)', () => {
  const real = score(classifyCutout);
  const alwaysGalaxy = score(alwaysGalaxyClassify);

  it('prints the independent-validation confusion matrix', () => {
    console.log(
      `\nINDEPENDENT VAL (n=${fx.samples.length})\n` +
        `truth\\pred   star galaxy unknown\n` +
        `star         ${String(real.matrix.star.star).padStart(4)} ${String(real.matrix.star.galaxy).padStart(6)} ${String(real.matrix.star.unknown).padStart(7)}\n` +
        `galaxy       ${String(real.matrix.galaxy.star).padStart(4)} ${String(real.matrix.galaxy.galaxy).padStart(6)} ${String(real.matrix.galaxy.unknown).padStart(7)}\n` +
        `REAL acc=${real.acc.toFixed(3)} bal=${real.balAcc.toFixed(3)} starRec=${real.starRecall.toFixed(2)} galRec=${real.galaxyRecall.toFixed(2)}  ` +
        `always-galaxy acc=${alwaysGalaxy.acc.toFixed(3)}`,
    );
    expect(fx.samples.length).toBeGreaterThanOrEqual(30);
  });

  it('the validation set is real and ≈balanced (fresh objects, both classes)', () => {
    const stars = fx.samples.filter((s) => s.label === 'star').length;
    expect(stars).toBeGreaterThanOrEqual(12);
    expect(fx.samples.length - stars).toBeGreaterThanOrEqual(12);
    // Confirm it shares NO object name with the tuning holdout (truly independent).
    const tuning: { samples: { name: string }[] } = JSON.parse(readFileSync('tests/fixtures/objectClassifier-holdout.json', 'utf-8'));
    const tuningNames = new Set(tuning.samples.map((t) => t.name));
    expect(fx.samples.every((s) => !tuningNames.has(s.name))).toBe(true);
  });

  it('galaxies GENERALISE — galaxy recall clears the floor on independent data', () => {
    expect(real.galaxyRecall).toBeGreaterThanOrEqual(VAL_GALAXY_RECALL_FLOOR);
  });

  it('DOCUMENTED GAP (TODO 147): star recall does NOT yet generalise to bright saturated stars', () => {
    // The balanced-accuracy floor is a RATCHET target, not a success bar — it sits
    // below the 0.5 always-galaxy baseline. This assertion pins the current reality so
    // the overfit stays visible; when the colour/cross-match fix lands, raise the floor.
    expect(real.balAcc).toBeGreaterThanOrEqual(VAL_BAL_ACC_FLOOR);
    // The failure is specifically bright stars read as galaxies (not a random error).
    expect(real.matrix.star.galaxy + real.matrix.star.unknown).toBeGreaterThan(real.matrix.star.star);
  });
});
