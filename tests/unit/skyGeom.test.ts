import { describe, it, expect } from 'vitest';
import {
  angularSeparation,
  positionAngle,
  cardinalDirection,
  formatSeparation,
} from '../../src/utils/skyGeom.js';

describe('angularSeparation (great-circle, not flat)', () => {
  it('is zero for identical points', () => {
    expect(angularSeparation(123.4, -45.6, 123.4, -45.6)).toBeCloseTo(0, 6);
  });

  it('equals the ΔRA at the equator', () => {
    expect(angularSeparation(10, 0, 20, 0)).toBeCloseTo(10, 4);
  });

  it('SHRINKS with cos(dec) at high declination (kills a flat sqrt(Δα²+Δδ²) impl)', () => {
    // Two points at Dec +80°, 10° apart in RA span only ~1.73° on the sky.
    const sep = angularSeparation(0, 80, 10, 80);
    expect(sep).toBeCloseTo(1.736, 2);
    expect(sep).toBeLessThan(2); // a flat impl would report ~10
  });

  it('matches the M31–M32 reference separation (~0.40°)', () => {
    // M31 (10.6847, +41.269), M32 (10.6742, +40.8651)
    expect(angularSeparation(10.6847, 41.269, 10.6742, 40.8651)).toBeCloseTo(0.40, 1);
  });

  it('is symmetric', () => {
    const a = angularSeparation(30, 12, 200, -60);
    const b = angularSeparation(200, -60, 30, 12);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe('positionAngle (East of North, signed)', () => {
  const base: [number, number] = [10, 0];
  it('is ~0 due North', () => {
    expect(positionAngle(base[0], base[1], 10, 0.5)).toBeCloseTo(0, 1);
  });
  it('is ~90 due East (kills a sign flip → 270)', () => {
    expect(positionAngle(base[0], base[1], 10.5, 0)).toBeCloseTo(90, 1);
  });
  it('is ~180 due South', () => {
    expect(positionAngle(base[0], base[1], 10, -0.5)).toBeCloseTo(180, 1);
  });
  it('is ~270 due West', () => {
    expect(positionAngle(base[0], base[1], 9.5, 0)).toBeCloseTo(270, 1);
  });
  it('always returns [0,360)', () => {
    for (let i = 0; i < 40; i++) {
      const pa = positionAngle(10, 0, 10 + Math.cos(i), Math.sin(i) * 20);
      expect(pa).toBeGreaterThanOrEqual(0);
      expect(pa).toBeLessThan(360);
    }
  });
});

describe('cardinalDirection', () => {
  it('maps the 8 principal angles', () => {
    expect(cardinalDirection(0)).toBe('N');
    expect(cardinalDirection(45)).toBe('NE');
    expect(cardinalDirection(90)).toBe('E');
    expect(cardinalDirection(135)).toBe('SE');
    expect(cardinalDirection(180)).toBe('S');
    expect(cardinalDirection(225)).toBe('SW');
    expect(cardinalDirection(270)).toBe('W');
    expect(cardinalDirection(315)).toBe('NW');
  });
  it('wraps at 360 and handles negatives', () => {
    expect(cardinalDirection(359)).toBe('N');
    expect(cardinalDirection(360)).toBe('N');
    expect(cardinalDirection(-45)).toBe('NW');
  });
});

describe('formatSeparation', () => {
  it('uses degrees ≥ 1°', () => {
    expect(formatSeparation(2.5)).toBe('2.50°');
  });
  it('uses arcmin below 1°', () => {
    expect(formatSeparation(0.5)).toBe('30.0′');
  });
  it('uses arcsec below 1′', () => {
    expect(formatSeparation(0.005)).toBe('18.0″');
  });
});
