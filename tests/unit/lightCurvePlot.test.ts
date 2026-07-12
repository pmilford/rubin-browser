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
  uniqueSorted,
  buildCompressedSegments,
  compressedCoord,
  isInCollapsedGap,
  foldPhase,
  foldSeriesPoints,
  type LcSeries,
  type LcSeriesPoint,
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

describe('time-axis compression', () => {
  const clusters = [0, 1, 2, 100, 101, 102]; // two dense clusters, one 98-day void

  it('uniqueSorted dedups + sorts + drops non-finite', () => {
    expect(uniqueSorted([3, 1, 2, 1, NaN, 3])).toEqual([1, 2, 3]);
  });

  it('collapses a large gap to ONE median cadence, keeping clusters proportional', () => {
    const { segments, totalC } = buildCompressedSegments(clusters);
    const gapSeg = segments.find((s) => s.gap)!;
    expect(gapSeg.t0).toBe(2);
    expect(gapSeg.t1).toBe(100);
    // The 98-day void is compressed to the median cadence (1), not its true width.
    expect(gapSeg.c1 - gapSeg.c0).toBe(1);
    // total = 2 intra-cluster steps ×2 clusters + 1 collapsed gap = 5 (not 102).
    expect(totalC).toBe(5);
  });

  it('makes the collapsed gap the SAME on-screen size as one normal step', () => {
    const { segments, totalC } = buildCompressedSegments(clusters);
    const step = compressedCoord(1, segments, totalC) - compressedCoord(0, segments, totalC);
    const across = compressedCoord(100, segments, totalC) - compressedCoord(2, segments, totalC);
    expect(step).toBe(1);
    expect(across).toBe(1); // full-time mode would give 98 — this is the whole point
  });

  it('flags MJDs strictly inside a collapsed gap (for tick hiding), not the endpoints', () => {
    const { segments } = buildCompressedSegments(clusters);
    expect(isInCollapsedGap(50, segments)).toBe(true);
    expect(isInCollapsedGap(2, segments)).toBe(false);
    expect(isInCollapsedGap(1, segments)).toBe(false);
  });

  it('is a no-op shape for a uniformly-sampled series (no gap segments)', () => {
    const { segments, totalC } = buildCompressedSegments([0, 10, 20, 30]);
    expect(segments.every((s) => !s.gap)).toBe(true);
    expect(totalC).toBe(30);
  });

  it('handles <2 unique times without dividing by zero', () => {
    expect(buildCompressedSegments([5])).toEqual({ segments: [], totalC: 0 });
    expect(compressedCoord(5, [], 0)).toBe(0);
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

describe('phase folding (TODO 155)', () => {
  it('folds a time onto [0,1) at the period, and points one full period apart map to the SAME phase', () => {
    // Period 2.5 d, epoch 0. t=0 → 0; t=1.25 → 0.5; t=2.5 → 0 (one full period later).
    expect(foldPhase(0, 2.5)).toBeCloseTo(0, 10);
    expect(foldPhase(1.25, 2.5)).toBeCloseTo(0.5, 10);
    expect(foldPhase(2.5, 2.5)).toBeCloseTo(0, 10);
    // The defining property: any integer number of periods apart → identical phase.
    expect(foldPhase(100.7, 2.5)).toBeCloseTo(foldPhase(100.7 + 5 * 2.5, 2.5), 10);
  });

  it('always returns a phase in [0,1), including for a negative time offset', () => {
    for (const t of [-3.3, -0.1, 0, 0.4, 7.9, 123.456]) {
      const ph = foldPhase(t, 1.7, 0.5);
      expect(ph).toBeGreaterThanOrEqual(0);
      expect(ph).toBeLessThan(1);
    }
  });

  it('returns NaN for a non-positive or non-finite period (caller falls back to time axis)', () => {
    expect(Number.isNaN(foldPhase(1, 0))).toBe(true);
    expect(Number.isNaN(foldPhase(1, -2))).toBe(true);
    expect(Number.isNaN(foldPhase(1, NaN))).toBe(true);
    expect(Number.isNaN(foldPhase(NaN, 2))).toBe(true);
  });

  it('foldSeriesPoints collapses many cycles onto one, preserves value/err, and sorts by phase', () => {
    // A period-2 sinusoid-like set sampled over 3 cycles: values depend only on phase,
    // so after folding, equal-phase points share a value — a NON-folding (identity) or
    // wrong-period impl would leave them scattered across the baseline.
    const period = 2;
    const pts: LcSeriesPoint[] = [0, 1, 2, 3, 4, 5].map((t) => ({
      mjd: t,
      intensity: t % 2 === 0 ? 10 : 20, // even t → phase 0 → 10; odd t → phase 0.5 → 20
      err: 1.5,
    }));
    const folded = foldSeriesPoints(pts, period);
    expect(folded).toHaveLength(6);
    // sorted by phase
    for (let i = 1; i < folded.length; i++) {
      expect(folded[i]!.mjd).toBeGreaterThanOrEqual(folded[i - 1]!.mjd);
    }
    // phase-0 group all value 10, phase-0.5 group all value 20 (period-collapsed)
    const atPhase0 = folded.filter((p) => Math.abs(p.mjd) < 1e-9);
    const atPhaseHalf = folded.filter((p) => Math.abs(p.mjd - 0.5) < 1e-9);
    expect(atPhase0.every((p) => p.intensity === 10)).toBe(true);
    expect(atPhaseHalf.every((p) => p.intensity === 20)).toBe(true);
    expect(atPhase0.length).toBe(3);
    expect(atPhaseHalf.length).toBe(3);
    // err carried through
    expect(folded.every((p) => p.err === 1.5)).toBe(true);
  });

  it('drops points that fold to NaN (bad period) rather than emitting NaN phases', () => {
    const pts: LcSeriesPoint[] = [{ mjd: 1, intensity: 5 }, { mjd: 2, intensity: 6 }];
    expect(foldSeriesPoints(pts, 0)).toEqual([]);
    expect(foldSeriesPoints(pts, -1)).toEqual([]);
  });
});
