import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeFeatures, type Cutout } from '../../src/utils/imageFeatures.js';
import {
  classifyCutout,
  alwaysGalaxyClassify,
  makeRandomClassifier,
  type InferredClass,
  type ImageClassification,
} from '../../src/utils/objectClassifier.js';

/**
 * REAL-DATA regression (TODO 138) — the retune centrepiece.
 *
 * The classifier is scored against a REAL labelled holdout, NOT the synthetic
 * generator it could self-consistently overfit. Each sample is a genuine DSS2-red
 * cutout fetched from CDS hips2fits at a SIMBAD-typed object (ground-truth label
 * derived from the SIMBAD otype), asinh-stretched + 8-bit quantised to mimic the
 * stretched HiPS JPEG luminance the app actually classifies (see the fixture's
 * `_comment`; built by scratchpad/build_holdout.mjs, not committed). It spans stars
 * (V≈7–13, several fovs) and galaxies (elliptical/spiral/LSB/Seyfert, incl. NGC 1494
 * at 3 zooms), 43 samples, ≈balanced.
 *
 * ADVERSARIAL RULE (CLAUDE.md): the real classifier is compared on the IDENTICAL
 * holdout to always-galaxy, always-star and a seeded-random baseline, and MUST beat
 * every one of them by a clear margin. A test that a constant classifier passes is
 * worthless — so these baselines are computed here and asserted below the real
 * classifier, not merely assumed. NGC 1494 (the user's reported failure) must read
 * "galaxy", and at MORE THAN ONE zoom.
 */

interface Sample {
  name: string;
  label: 'star' | 'galaxy';
  fovDeg: number;
  pixelScaleArcsec: number;
  psfFwhmArcsec: number;
  width: number;
  height: number;
  pixels: number[];
}
const fx: { samples: Sample[] } = JSON.parse(
  readFileSync('tests/fixtures/objectClassifier-holdout.json', 'utf-8'),
);

function toCutout(s: Sample): Cutout {
  const data = new Float32Array(s.pixels.length);
  for (let i = 0; i < s.pixels.length; i++) data[i] = s.pixels[i] === -1 ? NaN : s.pixels[i]! / 255;
  return { data, width: s.width, height: s.height, pixelScaleArcsec: s.pixelScaleArcsec, psfFwhmArcsec: s.psfFwhmArcsec };
}

interface Score {
  accuracy: number;
  balancedAccuracy: number;
  starRecall: number;
  galaxyRecall: number;
  matrix: Record<'star' | 'galaxy', Record<InferredClass, number>>;
}
function score(classify: (c: Cutout) => ImageClassification): Score {
  const matrix = {
    star: { star: 0, galaxy: 0, unknown: 0 },
    galaxy: { star: 0, galaxy: 0, unknown: 0 },
  };
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
  return {
    accuracy: correct / fx.samples.length,
    balancedAccuracy: 0.5 * (starRecall + galaxyRecall),
    starRecall,
    galaxyRecall,
    matrix,
  };
}

// ── Ratchet-UP-only floors (never lower to pass; raise as the classifier improves). ──
const REAL_ACC_FLOOR = 0.78; // measured ~0.84 at this commit
const BASELINE_MARGIN = 0.2; // real must beat every baseline by at least this

describe('classifyCutout — REAL DSS/SIMBAD holdout vs adversarial baselines (TODO 138)', () => {
  const real = score(classifyCutout);
  const alwaysGalaxy = score(alwaysGalaxyClassify);
  const alwaysStar = score((c) => ({ ...classifyCutout(c), cls: 'star' as const }));
  const random = score(makeRandomClassifier(1234));

  it('prints the confusion matrix and every baseline score', () => {
    console.log(
      `\nREAL holdout (n=${fx.samples.length})\n` +
        `truth\\pred   star galaxy unknown\n` +
        `star         ${String(real.matrix.star.star).padStart(4)} ${String(real.matrix.star.galaxy).padStart(6)} ${String(real.matrix.star.unknown).padStart(7)}\n` +
        `galaxy       ${String(real.matrix.galaxy.star).padStart(4)} ${String(real.matrix.galaxy.galaxy).padStart(6)} ${String(real.matrix.galaxy.unknown).padStart(7)}\n` +
        `REAL     acc=${real.accuracy.toFixed(3)} bal=${real.balancedAccuracy.toFixed(3)} starRec=${real.starRecall.toFixed(2)} galRec=${real.galaxyRecall.toFixed(2)}\n` +
        `always-galaxy acc=${alwaysGalaxy.accuracy.toFixed(3)}  always-star acc=${alwaysStar.accuracy.toFixed(3)}  random acc=${random.accuracy.toFixed(3)}`,
    );
    expect(fx.samples.length).toBeGreaterThanOrEqual(40);
  });

  it('the holdout is real and ≈balanced (both classes well represented)', () => {
    const stars = fx.samples.filter((s) => s.label === 'star').length;
    const gals = fx.samples.length - stars;
    expect(stars).toBeGreaterThan(15);
    expect(gals).toBeGreaterThan(15);
  });

  it('real-holdout accuracy clears the floor and is well above 0.5', () => {
    expect(real.accuracy).toBeGreaterThanOrEqual(REAL_ACC_FLOOR);
    expect(real.balancedAccuracy).toBeGreaterThanOrEqual(REAL_ACC_FLOOR);
  });

  it('the real classifier BEATS always-galaxy, always-star AND random by a clear margin', () => {
    // Baselines sit near the class prior (~0.5); each must lose by ≥ BASELINE_MARGIN.
    expect(alwaysGalaxy.accuracy).toBeLessThan(0.6);
    expect(alwaysStar.accuracy).toBeLessThan(0.6);
    expect(real.accuracy).toBeGreaterThan(alwaysGalaxy.accuracy + BASELINE_MARGIN);
    expect(real.accuracy).toBeGreaterThan(alwaysStar.accuracy + BASELINE_MARGIN);
    expect(real.accuracy).toBeGreaterThan(random.accuracy + BASELINE_MARGIN);
  });

  it('every galaxy in the holdout is recovered at high recall (the reported failure was galaxies)', () => {
    expect(real.galaxyRecall).toBeGreaterThanOrEqual(0.9);
  });

  it('NGC 1494 (RA 59.42736 Dec −48.91136) classifies as GALAXY at every captured zoom', () => {
    const samples = fx.samples.filter((s) => s.name === 'NGC 1494');
    expect(samples.length).toBeGreaterThanOrEqual(2); // multiple fovs captured
    for (const s of samples) {
      const r = classifyCutout(toCutout(s));
      expect(r.cls, `NGC 1494 @ fov ${s.fovDeg}`).toBe('galaxy');
      expect(r.features.concentrationRatio).toBeLessThan(0.18);
    }
  });

  it('concentrationRatio is STABLE across NGC 1494 zoom levels (the old features swung wildly)', () => {
    const crs = fx.samples
      .filter((s) => s.name === 'NGC 1494')
      .map((s) => computeFeatures(toCutout(s)).concentrationRatio);
    const min = Math.min(...crs);
    const max = Math.max(...crs);
    // Old fwhmRatio swung 0.47→5.24 (>10×) across zoom; the new driver stays within ~30%.
    expect(max / min).toBeLessThan(1.6);
  });
});
