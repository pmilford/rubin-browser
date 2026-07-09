import { describe, it, expect } from 'vitest';
import {
  ALL_OBJECTS,
  OBJECT_TYPES,
  lookupObject,
  nearestObject,
  getObjectsByType,
  type ObjectType,
} from '../../src/data/objects.js';
import { angularSeparation } from '../../src/utils/skyGeom.js';

describe('catalog integrity', () => {
  it('has at least 1000 objects', () => {
    expect(ALL_OBJECTS.length).toBeGreaterThanOrEqual(1000);
  });

  it('every object has valid type, finite coords in range, and a numeric magnitude', () => {
    const typeSet = new Set<ObjectType>(OBJECT_TYPES);
    for (const o of ALL_OBJECTS) {
      expect(typeSet.has(o.type), `${o.id} type ${o.type}`).toBe(true);
      expect(Number.isFinite(o.ra) && o.ra >= 0 && o.ra < 360, `${o.id} ra ${o.ra}`).toBe(true);
      expect(Number.isFinite(o.dec) && o.dec >= -90 && o.dec <= 90, `${o.id} dec ${o.dec}`).toBe(true);
      expect(Number.isFinite(o.magnitude), `${o.id} mag`).toBe(true);
    }
  });

  it('has unique ids', () => {
    expect(new Set(ALL_OBJECTS.map((o) => o.id)).size).toBe(ALL_OBJECTS.length);
  });
});

describe('known objects present at correct DEGREE coordinates (catches RA hours-vs-deg parse bug)', () => {
  const cases: [string, number, number][] = [
    ['Sirius', 101.29, -16.72],
    ['Vega', 279.23, 38.78],
    ['Betelgeuse', 88.79, 7.41],
    ['Rigel', 78.63, -8.2],
    ['Polaris', 37.95, 89.26],
    ['M31', 10.68, 41.27], // deep-sky RA was in hours in the raw data → must be ×15
    ['M42', 83.82, -5.39],
    ['M13', 250.42, 36.46],
  ];
  for (const [q, ra, dec] of cases) {
    it(`${q} resolves near ${ra}, ${dec}`, () => {
      const o = lookupObject(q);
      expect(o, `lookup ${q}`).toBeTruthy();
      expect(o!.ra).toBeCloseTo(ra, 0);
      expect(o!.dec).toBeCloseTo(dec, 0);
    });
  }
});

describe('object types are correct (not just enum-valid)', () => {
  it('M31 is a galaxy, M45 an open cluster, M13 a globular cluster', () => {
    expect(lookupObject('M31')!.type).toBe('galaxy');
    expect(lookupObject('M45')!.type).toBe('open-cluster');
    expect(lookupObject('M13')!.type).toBe('globular-cluster');
  });
  it('has a substantial number of galaxies and stars', () => {
    expect(getObjectsByType('galaxy').length).toBeGreaterThan(20);
    expect(getObjectsByType('star').length).toBeGreaterThan(1000);
  });
});

describe('common-name aliases still resolve', () => {
  it('Andromeda → M31', () => {
    expect(lookupObject('Andromeda')!.id).toBe('M-31');
  });
  it('Pleiades → M45', () => {
    expect(lookupObject('Pleiades')!.id).toBe('M-45');
  });
});

describe('nearestObject', () => {
  it('returns the object itself (sep ≈ 0) at its own coordinates', () => {
    const m42 = lookupObject('M42')!;
    const near = nearestObject(m42.ra, m42.dec)!;
    expect(near.object.id).toBe('M-42');
    expect(near.separationDeg).toBeLessThan(0.01);
  });

  it('returns the TRUE minimum (not the first element) and its real separation', () => {
    const ra = 200;
    const dec = -30;
    const near = nearestObject(ra, dec)!;
    // Brute-force the real minimum and compare.
    let brute = Infinity;
    for (const o of ALL_OBJECTS) brute = Math.min(brute, angularSeparation(ra, dec, o.ra, o.dec));
    expect(near.separationDeg).toBeCloseTo(brute, 6);
    // Reported separation must equal the geometry to the returned object.
    expect(near.separationDeg).toBeCloseTo(
      angularSeparation(ra, dec, near.object.ra, near.object.dec),
      6
    );
  });
});
