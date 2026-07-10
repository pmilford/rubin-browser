import { describe, it, expect } from 'vitest';
import {
  ALL_OBJECTS,
  OBJECT_TYPES,
  lookupObject,
  nearestObject,
  identifyAt,
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

describe('newly-added NGC/IC objects present at correct DEGREE coords', () => {
  // Adversarial guard against a re-introduced hours-vs-degrees (or wrong-object)
  // bug in the expanded batch. Coordinates are published J2000 positions in
  // DEGREES, independent of the catalog file, matched to within 0.05 deg.
  const cases: [string, number, number, ObjectType][] = [
    ['NGC-4565', 189.088, 25.988, 'galaxy'], // Needle Galaxy
    ['NGC-6543', 269.639, 66.633, 'planetary-nebula'], // Cat's Eye Nebula
    ['NGC-40', 3.254, 72.523, 'planetary-nebula'], // Bow-Tie Nebula
    ['NGC-7331', 339.267, 34.416, 'galaxy'],
    ['NGC-2903', 143.042, 21.5, 'galaxy'],
    ['NGC-4631', 190.533, 32.541, 'galaxy'], // Whale Galaxy
    ['NGC-5128', 201.365, -43.019, 'galaxy'], // Centaurus A
    ['NGC-1300', 49.921, -19.411, 'galaxy'], // barred spiral
  ];
  for (const [id, ra, dec, type] of cases) {
    it(`${id} exists at ~${ra}, ${dec} as a ${type}`, () => {
      const o = ALL_OBJECTS.find((x) => x.id === id);
      expect(o, `missing ${id}`).toBeTruthy();
      expect(Math.abs(o!.ra - ra), `${id} ra`).toBeLessThan(0.05);
      expect(Math.abs(o!.dec - dec), `${id} dec`).toBeLessThan(0.05);
      expect(o!.type).toBe(type);
    });
  }
});

describe('the expanded catalog is substantially larger', () => {
  it('has thousands of objects (naked-eye stars + NGC/IC slice)', () => {
    expect(ALL_OBJECTS.length).toBeGreaterThan(10000);
  });
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

describe('identifyAt (click-to-identify, thresholded)', () => {
  const m42 = ALL_OBJECTS.find((o) => o.id === 'M-42')!;

  it('matches a KNOWN object at its own coords (not the first element)', () => {
    const r = identifyAt(m42.ra, m42.dec, 0.5);
    expect(r.match).not.toBeNull();
    expect(r.match!.object.id).toBe('M-42');
    expect(r.match!.separationDeg).toBeCloseTo(0, 5);
  });

  it('matches when the click is offset but within the radius, with the true separation', () => {
    // Canopus is isolated (no near neighbour), so a small offset stays on it.
    const canopus = ALL_OBJECTS.find((o) => o.id === 'HR-2326')!;
    const r = identifyAt(canopus.ra, canopus.dec + 0.1, 0.5);
    expect(r.match?.object.id).toBe('HR-2326');
    expect(r.match!.separationDeg).toBeCloseTo(0.1, 2);
  });

  it('returns NO match in empty sky but still reports the (far) nearest', () => {
    // Robust: derive a radius strictly smaller than the true nearest separation,
    // so this can never flake regardless of catalog contents.
    const nearest = nearestObject(200, -30)!;
    const r = identifyAt(200, -30, nearest.separationDeg / 2);
    // A broken "always return the nearest" implementation fails here.
    expect(r.match).toBeNull();
    // ...but the honest "nearest is N away" hint is still available.
    expect(r.nearest).not.toBeNull();
    expect(r.nearest!.object.id).toBe(nearest.object.id);
    expect(r.nearest!.separationDeg).toBeGreaterThan(r.matchRadiusDeg);
  });
});
