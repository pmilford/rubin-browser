import { describe, it, expect } from 'vitest';
import {
  sampleProfile,
  luminance,
  profilePath,
  type PixelGetter,
} from '../../src/utils/crossSection.js';

/** A W×H buffer whose pixel value is a pure function of (x,y), for ground truth. */
function makeGetter(w: number, h: number, fn: (x: number, y: number) => [number, number, number] | null): PixelGetter {
  return (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : fn(x, y));
}

describe('luminance', () => {
  it('uses the Rec.601 weights normalised to 0..1', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 6);
    expect(luminance(0, 0, 0)).toBe(0);
    // A known pixel — kills wrong/placeholder weights.
    expect(luminance(100, 150, 200)).toBeCloseTo((0.299 * 100 + 0.587 * 150 + 0.114 * 200) / 255, 6);
  });
});

describe('sampleProfile — gradient direction (kills axis-swap / all-zero)', () => {
  const W = 100;
  const H = 100;
  // Intensity increases with x, constant in y.
  const getter = makeGetter(W, H, (x) => {
    const v = Math.round((x / (W - 1)) * 255);
    return [v, v, v];
  });

  it('a horizontal cut is STRICTLY monotonic increasing', () => {
    const p = sampleProfile(getter, 2, 50, 97, 50, 10, 0, 10.1, 0, 40);
    for (let i = 1; i < p.lum.length; i++) {
      expect(p.gap[i]).toBe(false);
      expect(p.lum[i]!).toBeGreaterThan(p.lum[i - 1]!);
    }
  });

  it('a vertical cut is CONSTANT (intensity does not depend on y)', () => {
    const p = sampleProfile(getter, 50, 2, 50, 97, 10, 0, 10, 0.1, 40);
    const first = p.lum[0]!;
    for (const v of p.lum) expect(v).toBeCloseTo(first, 6);
  });
});

describe('sampleProfile — gaps are never silent zeros', () => {
  const W = 40;
  const H = 40;
  // Left half has data; right half returns null (no tile).
  const getter = makeGetter(W, H, (x) => (x < 20 ? [128, 128, 128] : null));

  it('flags no-data samples as gaps with NaN, not 0', () => {
    const p = sampleProfile(getter, 2, 20, 38, 20, 10, 0, 10.1, 0, 30);
    const gapCount = p.gap.filter(Boolean).length;
    expect(gapCount).toBeGreaterThan(0);
    for (let i = 0; i < p.lum.length; i++) {
      if (p.gap[i]) expect(Number.isNaN(p.lum[i]!)).toBe(true);
      else expect(p.lum[i]!).toBeCloseTo(128 / 255, 6);
    }
    // A gap must NEVER read as a real 0 intensity.
    for (let i = 0; i < p.lum.length; i++) if (p.gap[i]) expect(p.lum[i]).not.toBe(0);
  });

  it('off-canvas endpoints are gaps, no throw, no NaN coords', () => {
    const p = sampleProfile(getter, -50, -50, -10, -10, 10, 0, 10, 0.1, 10);
    expect(p.gap.every(Boolean)).toBe(true);
    expect(p.lum.length).toBe(10);
  });
});

describe('sampleProfile — degenerate + distance axis', () => {
  const getter = makeGetter(50, 50, () => [200, 200, 200]);

  it('a zero-length line is finite (no NaN, length ≥ 1)', () => {
    const p = sampleProfile(getter, 25, 25, 25, 25, 10, 0, 10, 0, 8);
    expect(p.lum.length).toBeGreaterThanOrEqual(2);
    for (const v of p.lum) expect(Number.isFinite(v)).toBe(true);
    expect(p.distanceArcmin[p.distanceArcmin.length - 1]).toBe(0);
  });

  it('distance axis is great-circle arcmin between endpoints (not pixels)', () => {
    // 0.1° apart on the equator → 6 arcmin at the far end.
    const p = sampleProfile(getter, 0, 25, 49, 25, 10, 0, 10.1, 0, 20);
    expect(p.distanceArcmin[p.distanceArcmin.length - 1]).toBeCloseTo(6, 3);
    expect(p.distanceArcmin[0]).toBe(0);
  });
});

describe('profilePath', () => {
  it('breaks the trace across gap runs (no line drawn through no-data)', () => {
    const profile = {
      t: [0, 0.25, 0.5, 0.75, 1],
      distanceArcmin: [0, 1, 2, 3, 4],
      lum: [0.2, NaN, NaN, 0.8, 0.9],
      gap: [false, true, true, false, false],
    };
    const d = profilePath(profile, 100, 50, false);
    // Two subpaths → two 'M' move commands (one before the gap, one after).
    expect((d.match(/M/g) || []).length).toBe(2);
  });

  it('returns empty string when fully gapped', () => {
    const profile = { t: [0, 1], distanceArcmin: [0, 1], lum: [NaN, NaN], gap: [true, true] };
    expect(profilePath(profile, 100, 50, false)).toBe('');
  });

  it('log scale changes the mapped shape vs linear', () => {
    const profile = {
      t: [0, 0.5, 1],
      distanceArcmin: [0, 1, 2],
      lum: [0.01, 0.1, 1],
      gap: [false, false, false],
    };
    const lin = profilePath(profile, 100, 50, false);
    const log = profilePath(profile, 100, 50, true);
    expect(lin).not.toBe(log);
  });
});
