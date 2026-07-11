/**
 * Falsifiable geometric tests for the REAL graticule / compass / scale-bar.
 *
 * These run with NO DOM and NO mocks — they project through the actual
 * src/utils/projection.ts gnomonic math, exactly as the overlay canvas will.
 * Each test states which broken/placeholder implementation it kills. The prior
 * WcsOverlay.svelte was decorative (a text list of RA/Dec numbers, hardcoded
 * ↑/← arrows, a scale bar from an "assume ~400px" constant); every assertion
 * here fails against that class of fake.
 */

import { describe, it, expect } from 'vitest';
import {
  graticuleLines,
  compassRose,
  scaleBar,
  gridSpacingForFov,
  formatRa,
  formatDec,
  formatScaleLabel,
  type GraticuleView,
  type GraticuleLine,
} from '../../src/utils/graticule.js';
import { skyToCanvas } from '../../src/utils/projection.js';

const view = (over: Partial<GraticuleView> = {}): GraticuleView => ({
  ra: 62,
  dec: -37,
  fov: 22.5,
  canvasWidth: 800,
  canvasHeight: 600,
  panOffsetX: 0,
  panOffsetY: 0,
  ...over,
});

/** Max perpendicular deviation (px) of a polyline's points from the straight
 * chord joining its first and last point. Zero ⟺ perfectly collinear. */
function maxChordDeviation(points: { x: number; y: number }[]): number {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  let maxDev = 0;
  for (const p of points) {
    // distance from p to line ab
    const dev = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
}

/** Chord length (endpoint separation, px) of a polyline. */
function chordLength(points: { x: number; y: number }[]): number {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The polyline of the requested kind whose endpoints are farthest apart — a
 * spanning arc, not a near-closed loop (whose chord collapses to ~0). */
function widestSpanningLine(lines: GraticuleLine[], kind: 'ra' | 'dec'): GraticuleLine {
  const of = lines.filter((l) => l.kind === kind && l.points.length > 4);
  expect(of.length).toBeGreaterThan(0);
  return of.reduce((best, l) => (chordLength(l.points) > chordLength(best.points) ? l : best));
}

describe('graticuleLines: curvature under gnomonic projection', () => {
  it('KILLS a straight-line grid: a parallel at high Dec / wide FOV visibly CURVES', () => {
    // A constant-Dec circle is NOT a great circle → it must project to a curve.
    const lines = graticuleLines(view({ dec: 70, fov: 60 }));
    const parallel = widestSpanningLine(lines, 'dec');
    expect(parallel.points.length).toBeGreaterThan(10);
    // A rectangular (straight-chord) approximation would give ~0 deviation.
    expect(maxChordDeviation(parallel.points)).toBeGreaterThan(5);
  });

  it('sanity bound: near the equator at narrow FOV, parallels are nearly straight', () => {
    const lines = graticuleLines(view({ ra: 40, dec: 0, fov: 0.2 }));
    const parallel = widestSpanningLine(lines, 'dec');
    // Locally flat: deviation must be sub-pixel-ish, proving the curvature in the
    // previous test is real geometry, not a sampling artifact.
    expect(maxChordDeviation(parallel.points)).toBeLessThan(1);
  });
});

describe('compassRose: real projected N/E directions', () => {
  it('KILLS the hardcoded ↑/← arrows: N points up, E points right, ~90° apart', () => {
    const { northAngleRad, eastAngleRad, handedness } = compassRose(view());
    // Screen space: +x right, +y DOWN. North (+Dec) must point UP → unit dy < 0.
    const nvx = Math.cos(northAngleRad);
    const nvy = Math.sin(northAngleRad);
    expect(nvy).toBeLessThan(-0.98); // essentially straight up
    expect(Math.abs(nvx)).toBeLessThan(0.05);

    // East (+RA) is what skyToCanvas ACTUALLY produces: increasing RA moves
    // RIGHT in this projection (asserted in projection.test.ts), so evx > 0.
    const evx = Math.cos(eastAngleRad);
    const evy = Math.sin(eastAngleRad);
    expect(evx).toBeGreaterThan(0.98); // essentially straight right
    expect(Math.abs(evy)).toBeLessThan(0.05);

    // N and E are ~90° apart, and the handedness is the one the projection makes
    // (North-up × East-right → negative cross product), not an assumed CCW.
    const dot = nvx * evx + nvy * evy;
    expect(Math.abs(dot)).toBeLessThan(0.05);
    // Screen +y points DOWN: North(0,−1) × East(1,0) → +1. Asserts the sign the
    // projection ACTUALLY makes, not an assumed CCW orientation.
    expect(handedness).toBe(1);
  });

  it('the compass tracks the view center: at a different center N still points up', () => {
    // With no rotation field in ViewParams, north stays up at any center; this
    // guards that the direction is computed from the projection, not fixed to a
    // corner of the screen.
    for (const dec of [-60, -10, 20, 55]) {
      const { northAngleRad } = compassRose(view({ dec }));
      expect(Math.sin(northAngleRad)).toBeLessThan(-0.9);
    }
  });
});

describe('scaleBar: length from REAL pixels-per-degree, not an assumed width', () => {
  it('KILLS "assume 400px": projected px stays in a sane band across the FOV ladder', () => {
    for (const fov of [0.1, 0.5, 2, 5, 22.5, 45, 60]) {
      const bar = scaleBar(view({ fov }));
      expect(bar.lengthPx).toBeGreaterThan(40);
      // Upper bound is now the relevant-sizing cap: length ≤ 1/5 of the FOV, and
      // pxPerDeg ≈ canvasWidth/fov, so lengthPx ≤ 0.2·800 = 160 (fov=5 hits it).
      expect(bar.lengthPx).toBeLessThanOrEqual(160 + 1e-3);
    }
  });

  it('doubling the FOV halves the projected px for a FIXED label length', () => {
    // Same nice length at two zooms → px must scale as 1/fov (real projected scale).
    const pxAt = (fov: number, deg: number) => {
      const c = scaleBar(view({ fov }));
      // reconstruct pixels-per-degree from the bar and apply to a fixed length
      return (c.lengthPx / c.labelDeg) * deg;
    };
    const a = pxAt(5, 1);
    const b = pxAt(10, 1);
    expect(a / b).toBeGreaterThan(1.8);
    expect(a / b).toBeLessThan(2.2);
  });

  it('labelDeg grows monotonically as the FOV widens', () => {
    let prev = 0;
    for (const fov of [0.1, 1, 5, 22.5, 60]) {
      const deg = scaleBar(view({ fov })).labelDeg;
      expect(deg).toBeGreaterThanOrEqual(prev);
      prev = deg;
    }
  });
});

describe('scaleBar relevant sizing (TODO 137: largest 1/2/5×10ⁿ ≤ 1/5 FOV)', () => {
  const ARCSEC = 1 / 3600;
  const ARCMIN = 1 / 60;
  // Mirror the module's ascending nice ladder so the test has an INDEPENDENT
  // ground truth for "the largest nice value under the bound" (an impl that
  // hardcodes or picks the closest-px value cannot satisfy this).
  const NICE: number[] = [
    1 * ARCSEC, 2 * ARCSEC, 5 * ARCSEC, 10 * ARCSEC, 15 * ARCSEC, 30 * ARCSEC,
    1 * ARCMIN, 2 * ARCMIN, 5 * ARCMIN, 10 * ARCMIN, 15 * ARCMIN, 30 * ARCMIN,
    1, 2, 5, 10, 20, 30, 45,
  ];
  const EPS = 1e-9;

  it('picks the LARGEST nice value ≤ 1/5·FOV — kills closest-px and too-small impls', () => {
    for (const fov of [0.02, 0.05, 0.1, 0.5, 1, 5, 22.5, 45, 90, 180]) {
      const { labelDeg } = scaleBar(view({ fov }));
      const bound = 0.2 * fov;
      // (a) never exceeds 1/5 of the FOV (unless the fallback for tiny FOV kicked
      //     in — handled separately below; here every FOV ≥ smallest/0.2).
      const smallest = NICE[0]!;
      if (bound >= smallest - EPS) {
        expect(labelDeg).toBeLessThanOrEqual(bound + EPS);
        // (b) it is the LARGEST such nice value: no bigger nice value also fits.
        const expected = NICE.filter((n) => n <= bound + EPS).reduce((a, b) => Math.max(a, b));
        expect(labelDeg).toBeCloseTo(expected, 12);
        // Adversarial: assert nothing strictly larger in the ladder would have fit.
        const larger = NICE.filter((n) => n > labelDeg + EPS);
        for (const n of larger) expect(n).toBeGreaterThan(bound + EPS);
      }
    }
  });

  it('matches the exact worked examples', () => {
    // FOV 1°: 1/5 = 0.2°; largest nice ≤ 0.2° is 10′ (15′ = 0.25° too big).
    expect(scaleBar(view({ fov: 1 })).labelDeg).toBeCloseTo(10 * ARCMIN, 12);
    expect(scaleBar(view({ fov: 1 })).label).toBe('10′');
    // FOV 22.5°: 1/5 = 4.5°; largest nice ≤ 4.5° is 2° (5° too big).
    expect(scaleBar(view({ fov: 22.5 })).labelDeg).toBeCloseTo(2, 12);
    expect(scaleBar(view({ fov: 22.5 })).label).toBe('2°');
    // FOV 0.05° (3′): 1/5 = 36″; largest nice ≤ 36″ is 30″.
    expect(scaleBar(view({ fov: 0.05 })).labelDeg).toBeCloseTo(30 * ARCSEC, 12);
    expect(scaleBar(view({ fov: 0.05 })).label).toBe('30″');
    // FOV 180°: 1/5 = 36°; largest nice ≤ 36° is 30°.
    expect(scaleBar(view({ fov: 180 })).labelDeg).toBeCloseTo(30, 12);
    expect(scaleBar(view({ fov: 180 })).label).toBe('30°');
  });

  it('lengthPx is finite, > 0, and equals labelDeg × the SAME measured pxPerDeg', () => {
    // Construct a view where we can measure pxPerDeg independently by probing the
    // projection the way the impl does, then assert lengthPx = labelDeg·pxPerDeg.
    // This kills a hardcoded/constant lengthPx: the ratio must equal pxPerDeg AND
    // be identical across two different chosen bar lengths (proportional to angle).
    const measurePxPerDeg = (fov: number): number => {
      const v = view({ fov });
      const c = skyToCanvas(v, v.ra, v.dec);
      const dProbe = Math.max(v.fov * 1e-3, 1e-6);
      let d2 = v.dec + dProbe;
      if (d2 > 90) d2 = v.dec - dProbe;
      const p = skyToCanvas(v, v.ra, d2);
      return Math.hypot(p[0] - c[0], p[1] - c[1]) / dProbe;
    };
    for (const fov of [0.05, 0.5, 5, 45, 180]) {
      const bar = scaleBar(view({ fov }));
      const pxPerDeg = measurePxPerDeg(fov);
      expect(Number.isFinite(bar.lengthPx)).toBe(true);
      expect(bar.lengthPx).toBeGreaterThan(0);
      expect(bar.lengthPx).toBeCloseTo(bar.labelDeg * pxPerDeg, 6);
      // px-per-degree recovered from the bar equals the real measured scale — not
      // a fixed 80px target or an "assume 400px" constant.
      expect(bar.lengthPx / bar.labelDeg).toBeCloseTo(pxPerDeg, 6);
    }
  });

  it('labels in the natural unit: ″ below 1′, ′ below 1°, ° at/above 1°', () => {
    // FOV 0.03° → bound 21.6″ → 15″ → arcsec label.
    expect(scaleBar(view({ fov: 0.03 })).label.endsWith('″')).toBe(true);
    // FOV 3° → bound 0.6° = 36′ → 30′ → arcmin label.
    expect(scaleBar(view({ fov: 3 })).label.endsWith('′')).toBe(true);
    // FOV 30° → bound 6° → 5° → degree label.
    expect(scaleBar(view({ fov: 30 })).label.endsWith('°')).toBe(true);
    // Boundary: labelDeg < 1/60 must be arcsec, < 1 arcmin, ≥ 1 degree.
    for (const fov of [0.01, 0.05, 0.5, 3, 30, 180]) {
      const { labelDeg, label } = scaleBar(view({ fov }));
      if (labelDeg < ARCMIN - EPS) expect(label.endsWith('″')).toBe(true);
      else if (labelDeg < 1 - EPS) expect(label.endsWith('′')).toBe(true);
      else expect(label.endsWith('°')).toBe(true);
    }
  });

  it('a degenerate / tiny FOV never returns an empty or NaN bar (falls back to smallest nice)', () => {
    // 1/5·FOV below the smallest nice angle (1″ = 1/3600°) → fallback to 1″, not
    // empty/NaN. Fallback triggers for FOV < 1″/0.2 ≈ 0.00139°.
    for (const fov of [1e-6, 1e-4, 0.001, 0.0012]) {
      const bar = scaleBar(view({ fov }));
      expect(Number.isFinite(bar.labelDeg)).toBe(true);
      expect(bar.labelDeg).toBeGreaterThan(0);
      expect(bar.labelDeg).toBeCloseTo(NICE[0]!, 12); // 1″ fallback
      expect(bar.label).toBe('1″');
      expect(Number.isFinite(bar.lengthPx)).toBe(true);
      expect(bar.lengthPx).toBeGreaterThan(0);
    }
  });

  it('maxFovFraction param is honoured (a smaller fraction never picks a larger bar)', () => {
    // Independent lever: tightening the fraction can only keep or shrink the bar.
    for (const fov of [0.5, 5, 45]) {
      const wide = scaleBar(view({ fov }), 80, 0.2).labelDeg;
      const tight = scaleBar(view({ fov }), 80, 0.1).labelDeg;
      expect(tight).toBeLessThanOrEqual(wide + EPS);
      // And 0.1 fraction stays within its own bound.
      expect(tight).toBeLessThanOrEqual(0.1 * fov + EPS);
    }
  });
});

describe('graticuleLines: off-screen splitting (no chord across the gap)', () => {
  it('KILLS a chord across the behind-viewer gap: no giant jumps within a run', () => {
    // A wide FOV where many isolines exit the canvas / pass behind the horizon.
    const lines = graticuleLines(view({ dec: 10, fov: 80 }), { maxSegmentPx: 200 });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (let i = 1; i < line.points.length; i++) {
        const a = line.points[i - 1]!;
        const b = line.points[i]!;
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(200 + 1e-6);
      }
      // Every emitted run is a real polyline, never a single stray point.
      expect(line.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('all projected points are non-NaN and near the canvas', () => {
    const lines = graticuleLines(view({ fov: 30 }));
    for (const line of lines) {
      for (const p of line.points) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThan(-200);
        expect(p.x).toBeLessThan(1000);
      }
    }
  });
});

describe('graticuleLines: bounded line count (no O(1/fov) explosion)', () => {
  it('KILLS unbounded spacing: fewer than 40 lines of each kind across the FOV ladder', () => {
    for (const fov of [0.02, 0.1, 0.5, 2, 5, 10, 22.5, 45, 90]) {
      for (const dec of [0, 45, 70, -37]) {
        const lines = graticuleLines(view({ dec, fov }));
        const nRa = new Set(lines.filter((l) => l.kind === 'ra').map((l) => l.value)).size;
        const nDec = new Set(lines.filter((l) => l.kind === 'dec').map((l) => l.value)).size;
        expect(nRa).toBeLessThan(40);
        expect(nDec).toBeLessThan(40);
      }
    }
  });

  it('produces a usable grid: at a typical FOV there are several lines of each kind', () => {
    const lines = graticuleLines(view({ fov: 5 }));
    const nRa = new Set(lines.filter((l) => l.kind === 'ra').map((l) => l.value)).size;
    const nDec = new Set(lines.filter((l) => l.kind === 'dec').map((l) => l.value)).size;
    expect(nRa).toBeGreaterThanOrEqual(2);
    expect(nDec).toBeGreaterThanOrEqual(2);
  });
});

describe('spacing ladder + label formatters', () => {
  it('gridSpacingForFov is monotonic non-decreasing in FOV and always positive', () => {
    let prev = 0;
    for (const fov of [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 40, 90]) {
      const s = gridSpacingForFov(fov);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('formatRa renders hours+minutes and normalizes/​wraps correctly', () => {
    expect(formatRa(0)).toBe('0h 00m');
    expect(formatRa(180)).toBe('12h 00m');
    expect(formatRa(-15)).toBe('23h 00m'); // −15° → 345° → 23h
    expect(formatRa(15 * 6.5)).toBe('6h 30m');
  });

  it('formatDec renders signed degrees+arcminutes with a correct sign', () => {
    expect(formatDec(0)).toBe('+0° 00′');
    expect(formatDec(41.25)).toBe('+41° 15′');
    expect(formatDec(-5.5)).toBe('-5° 30′');
  });

  it('formatScaleLabel chooses °/′/″ by magnitude', () => {
    expect(formatScaleLabel(5)).toBe('5°');
    expect(formatScaleLabel(10 / 60)).toBe('10′');
    expect(formatScaleLabel(30 / 3600)).toBe('30″');
  });
});
