/**
 * Pure light-curve plot geometry/scale helpers. These pin the OUTCOMES that a
 * broken plot (index-based x, hardcoded axes, non-negative-only y) would get
 * wrong — see the design-review blockers. No DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  cleanPoints,
  seriesDomain,
  medianGap,
  niceTicks,
  gapSegments,
  normalizeIntensities,
  bandColor,
  formatValue,
  type LcSeries,
} from '../../src/utils/lightCurvePlot.js';

describe('cleanPoints', () => {
  it('drops non-finite points and sorts by mjd', () => {
    const out = cleanPoints([
      { mjd: 60020, intensity: 2 },
      { mjd: NaN, intensity: 1 },
      { mjd: 60000, intensity: Infinity },
      { mjd: 60010, intensity: 3 },
    ]);
    expect(out.map((p) => p.mjd)).toEqual([60010, 60020]);
  });
});

describe('seriesDomain', () => {
  it('spans time and intensity over all series', () => {
    const s: LcSeries[] = [
      { band: 'g', points: [{ mjd: 60000, intensity: 5 }, { mjd: 60050, intensity: 9 }] },
      { band: 'r', points: [{ mjd: 59990, intensity: 2 }, { mjd: 60040, intensity: 7 }] },
    ];
    expect(seriesDomain(s)).toEqual({ mjdMin: 59990, mjdMax: 60050, vMin: 2, vMax: 9 });
  });

  it('allows a NEGATIVE vMin (difference-image flux) — B5', () => {
    const d = seriesDomain([{ band: 'r', points: [{ mjd: 1, intensity: -50 }, { mjd: 2, intensity: 100 }] }]);
    expect(d).toEqual({ mjdMin: 1, mjdMax: 2, vMin: -50, vMax: 100 });
  });

  it('returns null when there are no finite points', () => {
    expect(seriesDomain([{ band: 'r', points: [] }])).toBeNull();
  });
});

describe('medianGap', () => {
  it('is the median consecutive spacing', () => {
    expect(medianGap([0, 10, 20, 90])).toBe(10); // diffs 10,10,70 → median 10
    expect(medianGap([0, 10])).toBe(10);
  });
  it('is 0 for <2 points', () => {
    expect(medianGap([5])).toBe(0);
    expect(medianGap([])).toBe(0);
  });
});

describe('niceTicks', () => {
  it('produces round ticks strictly inside a range (not just endpoints)', () => {
    const t = niceTicks(59990, 60050, 4);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.every((v) => v >= 59990 && v <= 60050)).toBe(true);
    // at least one tick strictly interior — a min/max-only axis fails this
    expect(t.some((v) => v > 59990 && v < 60050)).toBe(true);
  });
  it('handles a single value and non-finite input', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(NaN, 3)).toEqual([]);
  });
  it('works for a tiny sub-unit range', () => {
    const t = niceTicks(0, 1, 4);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(t.some((v) => v > 0 && v < 1)).toBe(true);
  });
});

describe('gapSegments', () => {
  it('flags only the segment whose delta exceeds 3× the median cadence', () => {
    // deltas 10,70,10,10 → median 10, threshold 30 → only the 10→80 segment is a gap
    const pts = [0, 10, 80, 90, 100].map((mjd) => ({ mjd, intensity: 1 }));
    expect(gapSegments(pts)).toEqual([false, true, false, false]);
  });
  it('never flags a uniformly-sampled series (offline 30-day cadence)', () => {
    const pts = [0, 30, 60, 90].map((mjd) => ({ mjd, intensity: 1 }));
    expect(gapSegments(pts)).toEqual([false, false, false]);
  });
  it('returns empty for <2 points', () => {
    expect(gapSegments([{ mjd: 1, intensity: 1 }])).toEqual([]);
  });
});

describe('normalizeIntensities', () => {
  it('rescales to [0,1] over the series min..max', () => {
    expect(normalizeIntensities([{ mjd: 1, intensity: 10 }, { mjd: 2, intensity: 20 }, { mjd: 3, intensity: 30 }])).toEqual([0, 0.5, 1]);
  });
  it('maps a flat series to 0.5 (no divide-by-zero)', () => {
    expect(normalizeIntensities([{ mjd: 1, intensity: 7 }, { mjd: 2, intensity: 7 }])).toEqual([0.5, 0.5]);
  });
});

describe('bandColor', () => {
  it('gives the standard colour for known bands and is deterministic for unknowns', () => {
    expect(bandColor('g', 0)).toBe(bandColor('g', 5)); // known → index-independent
    expect(bandColor('g', 0)).not.toBe(bandColor('r', 0));
    expect(bandColor('weird', 0)).toBe(bandColor('weird', 6)); // palette wraps by 6
  });
});

describe('formatValue', () => {
  it('is compact for normal magnitudes and exponential at extremes', () => {
    expect(formatValue(0)).toBe('0');
    expect(formatValue(123)).toBe('123');
    expect(formatValue(50000)).toMatch(/e/);
    expect(formatValue(0.0001)).toMatch(/e/);
  });
});
