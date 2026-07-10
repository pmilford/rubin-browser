import { describe, it, expect } from 'vitest';
import {
  DP1_FIELD_RADIUS_DEG,
  dp1CoverageCircles,
  isInDp1Coverage,
  nearestDp1Field,
  coverageCirclePoints,
  type CoverageCircle,
} from '../../src/data/footprint.js';
import { DP1_FIELDS } from '../../src/data/dp1Fields.js';
import { angularSeparation } from '../../src/utils/skyGeom.js';

describe('DP1_FIELD_RADIUS_DEG', () => {
  it('is the documented ~0.82° coverage-disc radius (√(15/7/π))', () => {
    // Equal-area disc: √(A/π) with A = 15/7 deg²/field ≈ 0.826°.
    expect(DP1_FIELD_RADIUS_DEG).toBeGreaterThan(0.8);
    expect(DP1_FIELD_RADIUS_DEG).toBeLessThan(0.85);
    expect(DP1_FIELD_RADIUS_DEG).toBeCloseTo(0.826, 3);
  });
});

describe('dp1CoverageCircles', () => {
  it('produces one disc per DP1 field', () => {
    expect(dp1CoverageCircles().length).toBe(DP1_FIELDS.length);
  });

  it('carries each field id at the shared radius', () => {
    for (const c of dp1CoverageCircles()) {
      expect(c.radiusDeg).toBe(DP1_FIELD_RADIUS_DEG);
      expect(DP1_FIELDS.some((f) => f.id === c.id)).toBe(true);
    }
  });
});

describe('isInDp1Coverage', () => {
  it('is true at every field CENTRE', () => {
    for (const f of DP1_FIELDS) {
      expect(isInDp1Coverage(f.ra, f.dec)).toBe(true);
    }
  });

  it('is false 10° away from every field', () => {
    // A point far from all seven fields: 10° north of ECDFS, and >10° from all.
    const ra = 200;
    const dec = 60;
    for (const f of DP1_FIELDS) {
      expect(angularSeparation(ra, dec, f.ra, f.dec)).toBeGreaterThan(10);
    }
    expect(isInDp1Coverage(ra, dec)).toBe(false);
  });

  it('includes a point exactly at DP1_FIELD_RADIUS_DEG from a centre (boundary is inside)', () => {
    const f = DP1_FIELDS[0]!; // ecdfs
    // Walk due north by exactly the radius so separation == DP1_FIELD_RADIUS_DEG.
    const edge = { ra: f.ra, dec: f.dec + DP1_FIELD_RADIUS_DEG };
    expect(angularSeparation(edge.ra, edge.dec, f.ra, f.dec)).toBeCloseTo(
      DP1_FIELD_RADIUS_DEG,
      6,
    );
    expect(isInDp1Coverage(edge.ra, edge.dec)).toBe(true);
  });
});

describe('nearestDp1Field', () => {
  it('returns ecdfs with ~0 separation from a point near ECDFS', () => {
    const { field, separationDeg } = nearestDp1Field(53.13, -28.1);
    expect(field.id).toBe('ecdfs');
    expect(separationDeg).toBeCloseTo(0, 6);
  });

  it('returns the geometrically closest field for an off-field point', () => {
    // Just north of 47 Tuc (dec −72.08); it must win over all others.
    const { field } = nearestDp1Field(6.02, -70);
    expect(field.id).toBe('47tuc');
  });
});

describe('coverageCirclePoints', () => {
  const forEachField = (fn: (c: CoverageCircle) => void) =>
    dp1CoverageCircles().forEach(fn);

  it('returns exactly nPoints points', () => {
    for (const n of [8, 32, 64, 128]) {
      expect(coverageCirclePoints(dp1CoverageCircles()[0]!, n).length).toBe(n);
    }
  });

  it('places EVERY point exactly radiusDeg from the centre (kills centre/box stubs)', () => {
    forEachField((c) => {
      for (const p of coverageCirclePoints(c)) {
        expect(angularSeparation(p.ra, p.dec, c.ra, c.dec)).toBeCloseTo(
          c.radiusDeg,
          6,
        );
      }
    });
  });

  it('stays a true small circle at dec −72 (guards naive RA±r/cos wrap bug)', () => {
    const tuc = dp1CoverageCircles().find((c) => c.id === '47tuc')!;
    expect(tuc.dec).toBeCloseTo(-72.08, 2);
    for (const p of coverageCirclePoints(tuc, 96)) {
      expect(angularSeparation(p.ra, p.dec, tuc.ra, tuc.dec)).toBeCloseTo(
        tuc.radiusDeg,
        6,
      );
      expect(p.ra).toBeGreaterThanOrEqual(0);
      expect(p.ra).toBeLessThan(360);
    }
  });

  it('normalises RA to [0, 360) for every field (incl. centres near RA 0)', () => {
    forEachField((c) => {
      for (const p of coverageCirclePoints(c)) {
        expect(p.ra).toBeGreaterThanOrEqual(0);
        expect(p.ra).toBeLessThan(360);
      }
    });
  });
});
