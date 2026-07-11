import { describe, it, expect } from 'vitest';
import {
  renderLabeledCutout,
  generateLabeledPopulation,
  type LabeledCutout,
} from '../../src/utils/syntheticMorphology.js';
import { computeFeatures } from '../../src/utils/imageFeatures.js';

/**
 * Tests for the ground-truth substrate. These assert the FORWARD MODEL is
 * deterministic, labelled from render truth (not the classifier), and produces
 * genuinely point-like stars vs genuinely extended galaxies — the properties the
 * scoring harness relies on.
 */

function bytesEqual(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // Compare raw bits so NaN==NaN and -0/+0 distinctions are exact.
    if (Object.is(a[i], b[i])) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe('renderLabeledCutout — determinism (no Math.random / Date)', () => {
  it('same opts ⇒ byte-identical cutout and identical labels', () => {
    const opts = { trueClass: 'galaxy' as const, seed: 123, mag: 20.5, reArcsec: 0.8, sersicN: 2, ellipticity: 0.3, paDeg: 40 };
    const a = renderLabeledCutout(opts);
    const b = renderLabeledCutout(opts);
    expect(bytesEqual(a.cutout.data, b.cutout.data)).toBe(true);
    expect(a.trueSnr).toBe(b.trueSnr);
    expect(a.trueSizeOverPsf).toBe(b.trueSizeOverPsf);
  });

  it('a different seed changes the noise realisation but NOT the true SNR (same mag)', () => {
    const base = { trueClass: 'star' as const, mag: 20 };
    const a = renderLabeledCutout({ ...base, seed: 1 });
    const b = renderLabeledCutout({ ...base, seed: 2 });
    expect(bytesEqual(a.cutout.data, b.cutout.data)).toBe(false); // noise differs
    expect(a.trueSnr).toBe(b.trueSnr); // truth from render params, not noise
  });

  it('the cutout carries the EXTERNAL nominal PSF (blocker B3 substrate), not a fitted one', () => {
    const c = renderLabeledCutout({ trueClass: 'galaxy', seed: 5, psfFwhmArcsec: 0.9, pixelScaleArcsec: 0.25 });
    expect(c.cutout.psfFwhmArcsec).toBe(0.9);
    expect(c.cutout.pixelScaleArcsec).toBe(0.25);
  });
});

describe('renderLabeledCutout — stars are point-like, galaxies are extended', () => {
  it('a star renders at the PSF size (measured fwhmRatio ≈ 1, trueSizeOverPsf ≈ 1)', () => {
    const s = renderLabeledCutout({ trueClass: 'star', seed: 7, mag: 18 });
    expect(s.trueSizeOverPsf).toBeCloseTo(1, 1);
    expect(computeFeatures(s.cutout).fwhmRatio).toBeCloseTo(1, 1);
  });

  it('a resolved galaxy is larger than the PSF (trueSizeOverPsf > 1 AND measured fwhmRatio > 1)', () => {
    const g = renderLabeledCutout({ trueClass: 'galaxy', seed: 8, mag: 18, reArcsec: 1.0, sersicN: 1 });
    expect(g.trueSizeOverPsf).toBeGreaterThan(1.2);
    expect(computeFeatures(g.cutout).fwhmRatio).toBeGreaterThan(1.2);
  });

  it('brighter magnitude ⇒ higher true SNR', () => {
    const bright = renderLabeledCutout({ trueClass: 'star', seed: 3, mag: 18 });
    const faint = renderLabeledCutout({ trueClass: 'star', seed: 3, mag: 23 });
    expect(bright.trueSnr).toBeGreaterThan(faint.trueSnr);
    expect(faint.trueSnr).toBeGreaterThan(0);
  });

  it('the render carries real per-pixel noise (a low-signal cutout is NOT constant)', () => {
    const c = renderLabeledCutout({ trueClass: 'star', seed: 11, mag: 24 });
    const d = c.cutout.data;
    let min = Infinity;
    let max = -Infinity;
    for (const v of d) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(max - min).toBeGreaterThan(0);
  });
});

describe('renderLabeledCutout — display transforms', () => {
  it('quantize8bit yields integer values within [0,255]', () => {
    const c = renderLabeledCutout({ trueClass: 'galaxy', seed: 4, mag: 19, quantize8bit: true });
    for (const v of c.cutout.data) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('asinhStretch changes the pixels vs the linear render', () => {
    const linear = renderLabeledCutout({ trueClass: 'galaxy', seed: 4, mag: 19 });
    const stretched = renderLabeledCutout({ trueClass: 'galaxy', seed: 4, mag: 19, asinhStretch: true });
    expect(bytesEqual(linear.cutout.data, stretched.cutout.data)).toBe(false);
  });

  it('the moffat PSF still produces a point-like star (fwhmRatio ≈ 1)', () => {
    const s = renderLabeledCutout({ trueClass: 'star', seed: 6, mag: 18, profile: 'moffat' });
    expect(computeFeatures(s.cutout).fwhmRatio).toBeLessThan(1.25);
  });
});

describe('generateLabeledPopulation — balanced, spans SNR + the HARD size regime', () => {
  const pop = generateLabeledPopulation(42, 400);

  it('is ≈50/50 star vs galaxy', () => {
    const stars = pop.filter((p) => p.trueClass === 'star').length;
    expect(stars).toBe(pop.length / 2); // balanced by construction
  });

  it('spans a wide SNR range (bright and faint sources both present)', () => {
    const snrs = pop.map((p) => p.trueSnr);
    expect(Math.min(...snrs)).toBeLessThan(10);
    expect(Math.max(...snrs)).toBeGreaterThan(80);
  });

  it('includes near-boundary galaxies in the hard regime (trueSizeOverPsf ~1.1–1.6)', () => {
    const hard = pop.filter((p) => p.trueClass === 'galaxy' && p.trueSizeOverPsf >= 1.1 && p.trueSizeOverPsf <= 1.6);
    expect(hard.length).toBeGreaterThan(10);
  });

  it('is deterministic in the seed', () => {
    const a = generateLabeledPopulation(99, 20);
    const b = generateLabeledPopulation(99, 20);
    for (let i = 0; i < a.length; i++) {
      expect(bytesEqual(a[i]!.cutout.data, b[i]!.cutout.data)).toBe(true);
      expect(a[i]!.trueClass).toBe(b[i]!.trueClass);
    }
  });

  it('every labelled cutout exposes render-truth labels, not classifier outputs', () => {
    for (const p of pop as LabeledCutout[]) {
      expect(p.trueSnr).toBeGreaterThan(0);
      expect(p.trueSizeOverPsf).toBeGreaterThan(0);
      expect(['star', 'galaxy']).toContain(p.trueClass);
    }
  });
});
