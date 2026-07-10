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

/* -------------------------------------------------------------------------- */
/* Generic catalog-overlay data layer (src/data/catalog.ts)                   */
/*                                                                            */
/* These suites cover the NEW columnar CatalogSet + uniform-grid index used   */
/* by the ImageViewer overlay and the linked table. They are unrelated to the */
/* ALL_OBJECTS integrity tests above (which cover src/data/objects.ts).       */
/* -------------------------------------------------------------------------- */
import {
  gaiaToCatalogSet,
  buildCatalogIndex,
  catalogInViewport,
  nearestInCatalog,
  CATALOG_NO_DATA,
  type CatalogSet,
} from '../../src/data/catalog.js';
import type { GaiaCatalog } from '../../src/api/gaia.js';

/** Build a GaiaCatalog from parallel plain arrays (NaN where a field is null). */
function makeGaia(rows: {
  sourceId: string;
  ra: number;
  dec: number;
  gMag?: number;
  bpRp?: number;
  pmRa?: number;
  pmDec?: number;
  parallax?: number;
  radialVelocity?: number;
  teff?: number;
}[]): GaiaCatalog {
  const n = rows.length;
  const f = (pick: (r: (typeof rows)[number]) => number | undefined): Float32Array => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = pick(rows[i]!) ?? NaN;
    return a;
  };
  return {
    count: n,
    sourceId: rows.map((r) => r.sourceId),
    ra: f((r) => r.ra),
    dec: f((r) => r.dec),
    gMag: f((r) => r.gMag),
    bpRp: f((r) => r.bpRp),
    pmRa: f((r) => r.pmRa),
    pmDec: f((r) => r.pmDec),
    parallax: f((r) => r.parallax),
    radialVelocity: f((r) => r.radialVelocity),
    teff: f((r) => r.teff),
  };
}

/** Minimal CatalogSet from (label, ra, dec) triples — index/query tests. */
function makeSet(rows: [string, number, number][]): CatalogSet {
  const n = rows.length;
  const ra = new Float32Array(n);
  const dec = new Float32Array(n);
  const label: string[] = [];
  const records: Record<string, string | number>[] = [];
  rows.forEach(([l, r, d], i) => {
    ra[i] = r;
    dec[i] = d;
    label.push(l);
    records.push({ Label: l });
  });
  return { count: n, ra, dec, label, records };
}

describe('gaiaToCatalogSet (adapter)', () => {
  const gaia = makeGaia([
    { sourceId: '4611686018427387904', ra: 62.1, dec: -37.4, gMag: 18.2, bpRp: 1.3, pmRa: -2.5, pmDec: 4.1, parallax: 0.8 },
    { sourceId: '999', ra: 150.0, dec: 10.0, gMag: 20.5, bpRp: NaN, pmRa: NaN, pmDec: NaN, parallax: NaN },
  ]);
  const set = gaiaToCatalogSet(gaia);

  it('preserves the source count', () => {
    expect(set.count).toBe(2);
    expect(set.ra.length).toBe(2);
    expect(set.records.length).toBe(2);
    expect(set.label.length).toBe(2);
  });

  it('maps a known source ra/dec and label (source id) correctly', () => {
    expect(set.ra[0]).toBeCloseTo(62.1, 4);
    expect(set.dec[0]).toBeCloseTo(-37.4, 4);
    expect(set.label[0]).toBe('4611686018427387904');
    expect(set.records[0]!['Source ID']).toBe('4611686018427387904');
    // A present numeric field stays numeric (not stringified).
    expect(set.records[0]!['G (mag)']).toBeCloseTo(18.2, 4);
  });

  it('renders a NaN field as the dash, never NaN', () => {
    const bpRp = set.records[1]!['BP−RP'];
    expect(bpRp).toBe(CATALOG_NO_DATA);
    expect(Number.isNaN(bpRp as number)).toBe(false);
    // Adversarial: no record value may be a NaN number anywhere.
    for (const rec of set.records) {
      for (const v of Object.values(rec)) {
        expect(typeof v === 'number' && Number.isNaN(v)).toBe(false);
      }
    }
  });

  it('stamps provenance Catalog = "Gaia DR3" on every row', () => {
    for (const rec of set.records) expect(rec.Catalog).toBe('Gaia DR3');
  });
});

describe('buildCatalogIndex + catalogInViewport (culling)', () => {
  it('returns sources inside a small bbox and culls ones outside it', () => {
    const set = makeSet([
      ['in-a', 100.0, 20.0],
      ['in-b', 100.4, 20.3],
      ['out-far', 200.0, -40.0],
    ]);
    const index = buildCatalogIndex(set);
    const hits = catalogInViewport(index, 99.5, 100.5, 19.5, 20.5).map((i) => set.label[i]);
    expect(hits.sort()).toEqual(['in-a', 'in-b']);
    expect(hits).not.toContain('out-far');
  });

  it('ADVERSARIAL: a source JUST outside the bbox does not appear', () => {
    // Two sources straddle the eastern RA edge (100.5): one just inside, one just
    // outside. A bucket-only (unfiltered) impl would wrongly include the outsider.
    const set = makeSet([
      ['inside', 100.49, 20.0],
      ['outside', 100.51, 20.0],
      ['dec-outside', 100.0, 20.51],
    ]);
    const index = buildCatalogIndex(set);
    const hits = catalogInViewport(index, 99.5, 100.5, 19.5, 20.5).map((i) => set.label[i]);
    expect(hits).toEqual(['inside']);
    expect(hits).not.toContain('outside');
    expect(hits).not.toContain('dec-outside');
  });
});

describe('nearestInCatalog', () => {
  it('returns the CLOSEST source, not the first in the array', () => {
    // The first array element is far; a nearer one sits later. A "return first
    // candidate" bug would return 'first-far'.
    const set = makeSet([
      ['first-far', 50.2, 10.0], // ~0.2 deg away
      ['closest', 50.02, 10.0], // ~0.02 deg away
      ['also-far', 49.7, 10.0],
    ]);
    const index = buildCatalogIndex(set);
    const near = nearestInCatalog(index, 50.0, 10.0, 1.0);
    expect(near).not.toBeNull();
    expect(set.label[near!.index]).toBe('closest');
    expect(near!.separationDeg).toBeLessThan(0.05);
  });

  it('returns null when nothing is within maxRadiusDeg', () => {
    const set = makeSet([
      ['a', 10.0, 10.0],
      ['b', 200.0, -30.0],
    ]);
    const index = buildCatalogIndex(set);
    // Query empty sky with a radius far smaller than the nearest source.
    expect(nearestInCatalog(index, 100.0, 0.0, 0.5)).toBeNull();
  });

  it('reports a true great-circle separation (shrinks with cos(dec), not flat)', () => {
    // At Dec +80°, a source 10° away in RA is only ~1.7° on the sky.
    const set = makeSet([['hi-dec', 10.0, 80.0]]);
    const index = buildCatalogIndex(set);
    const near = nearestInCatalog(index, 0.0, 80.0, 5.0);
    expect(near).not.toBeNull();
    expect(near!.separationDeg).toBeCloseTo(angularSeparation(0, 80, 10, 80), 4);
    expect(near!.separationDeg).toBeLessThan(2); // a flat sqrt(Δα²+Δδ²) would give ~10
  });
});

describe('catalogInViewport RA-wrap at 0°/360° (mirrors alerts.ts queryViewport)', () => {
  it('a viewport straddling RA 0/360 (raMin > raMax) includes 359.9 and 0.1, excludes 180', () => {
    const set = makeSet([
      ['near-360', 359.9, 5.0],
      ['near-0', 0.1, 5.0],
      ['opposite', 180.0, 5.0],
    ]);
    const index = buildCatalogIndex(set);
    // Straddle: raMin=359 wraps to raMax=1.
    const hits = catalogInViewport(index, 359.0, 1.0, 4.0, 6.0).map((i) => set.label[i]);
    expect(hits.sort()).toEqual(['near-0', 'near-360']);
    expect(hits).not.toContain('opposite');
  });

  it('nearestInCatalog resolves across the 0/360 seam', () => {
    // Query at RA 0.05 should find the source at 359.95 (~0.1 deg away), even
    // though their numeric RA difference is ~359.9.
    const set = makeSet([['seam', 359.95, 0.0]]);
    const index = buildCatalogIndex(set);
    const near = nearestInCatalog(index, 0.05, 0.0, 1.0);
    expect(near).not.toBeNull();
    expect(set.label[near!.index]).toBe('seam');
    expect(near!.separationDeg).toBeCloseTo(0.1, 3);
  });
});
