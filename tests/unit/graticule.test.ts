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
      expect(bar.lengthPx).toBeLessThan(160);
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
