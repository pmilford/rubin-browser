/**
 * Gravitational-lens catalog (feature 130) — correctness of the BUNDLED data.
 *
 * The failure this guards against is wrong hardcoded coordinates: a lens marker
 * painted in the wrong place looks fine but is a lie. So these tests do NOT check
 * self-consistency — they look up named lenses and assert their RA/Dec/type/redshift
 * against INDEPENDENTLY-KNOWN values (SIMBAD J2000 + discovery papers). A catalog of
 * zeros, a placeholder, or a sign-flipped declination fails these assertions.
 */

import { describe, it, expect } from 'vitest';
import { LENS_CATALOG, lensCatalogSet, type GravLens, type LensType } from '../../src/data/lenses.js';
import { CATALOG_NO_DATA } from '../../src/data/catalog.js';

function byName(name: string): GravLens {
  const found = LENS_CATALOG.find((l) => l.name.includes(name));
  if (!found) throw new Error(`lens not found by name fragment: ${name}`);
  return found;
}

describe('LENS_CATALOG — well-formed', () => {
  it('has at least 15 entries spanning all four lens types', () => {
    expect(LENS_CATALOG.length).toBeGreaterThanOrEqual(15);
    const types = new Set<LensType>(LENS_CATALOG.map((l) => l.type));
    expect(types).toEqual(new Set(['galaxy-galaxy', 'group-cluster', 'lensed-quasar', 'arc-ring']));
  });

  it('every entry has a valid on-sky position, a name, and a note (no placeholders)', () => {
    for (const l of LENS_CATALOG) {
      expect(l.name.length).toBeGreaterThan(3);
      expect(l.note.length).toBeGreaterThan(3);
      expect(Number.isFinite(l.ra)).toBe(true);
      expect(Number.isFinite(l.dec)).toBe(true);
      expect(l.ra).toBeGreaterThanOrEqual(0);
      expect(l.ra).toBeLessThan(360);
      expect(l.dec).toBeGreaterThanOrEqual(-90);
      expect(l.dec).toBeLessThanOrEqual(90);
      // A real catalog is not all at (0,0) — guard against a zeros placeholder.
      expect(Math.abs(l.ra) + Math.abs(l.dec)).toBeGreaterThan(0);
      // Redshifts are a finite non-negative number or an honest null (never NaN).
      for (const z of [l.zLens, l.zSource]) {
        expect(z === null || (Number.isFinite(z) && z >= 0)).toBe(true);
      }
    }
  });

  it('names are unique and the sky is not clustered at one point', () => {
    const names = new Set(LENS_CATALOG.map((l) => l.name));
    expect(names.size).toBe(LENS_CATALOG.length);
    const raSpan = Math.max(...LENS_CATALOG.map((l) => l.ra)) - Math.min(...LENS_CATALOG.map((l) => l.ra));
    const decSpan = Math.max(...LENS_CATALOG.map((l) => l.dec)) - Math.min(...LENS_CATALOG.map((l) => l.dec));
    expect(raSpan).toBeGreaterThan(180); // spread across the sky in RA
    expect(decSpan).toBeGreaterThan(80); // and in Dec (has both hemispheres)
  });
});

describe('LENS_CATALOG — verified ground-truth anchors', () => {
  // Each anchor is a KNOWN position/redshift (SIMBAD J2000 + published discovery).
  // Asserting by name against these exact values means a zeros / placeholder /
  // sign-flipped catalog cannot pass.
  const anchors: Array<{
    frag: string; ra: number; dec: number; type: LensType; zLens: number | null; zSource: number | null;
  }> = [
    // Einstein Cross: declination is POSITIVE (+03°21′, per the "+0305" designation).
    { frag: 'Einstein Cross', ra: 340.1260, dec: 3.3585, type: 'lensed-quasar', zLens: 0.0394, zSource: 1.695 },
    { frag: 'Twin Quasar', ra: 150.3362, dec: 55.8988, type: 'lensed-quasar', zLens: 0.36, zSource: 1.413 },
    { frag: 'Cosmic Horseshoe', ra: 177.1379, dec: 19.5009, type: 'arc-ring', zLens: 0.444, zSource: 2.379 },
    { frag: 'SDSS J1004+4112', ra: 151.1450, dec: 41.2108, type: 'group-cluster', zLens: 0.68, zSource: 1.734 },
    { frag: 'Jackpot', ra: 146.7363, dec: 10.1144, type: 'galaxy-galaxy', zLens: 0.222, zSource: 0.609 },
  ];

  for (const a of anchors) {
    it(`${a.frag} matches its known position/type/redshift`, () => {
      const lens = byName(a.frag);
      expect(lens.ra).toBeCloseTo(a.ra, 2); // within ~0.01°
      expect(lens.dec).toBeCloseTo(a.dec, 2);
      expect(lens.type).toBe(a.type);
      expect(lens.zLens).toBe(a.zLens);
      expect(lens.zSource).toBe(a.zSource);
    });
  }

  it('the Einstein Cross declination is not the (wrong) negative value', () => {
    // Explicit regression against the common sign error: it is NOT at Dec -3.36.
    expect(byName('Einstein Cross').dec).toBeGreaterThan(0);
  });
});

describe('lensCatalogSet()', () => {
  it('produces a valid CatalogSet with parallel arrays of equal length', () => {
    const set = lensCatalogSet();
    expect(set.count).toBe(LENS_CATALOG.length);
    expect(set.ra.length).toBe(set.count);
    expect(set.dec.length).toBe(set.count);
    expect(set.label.length).toBe(set.count);
    expect(set.records.length).toBe(set.count);
  });

  it('carries the verified positions into the columnar arrays', () => {
    const set = lensCatalogSet();
    const i = LENS_CATALOG.findIndex((l) => l.name.includes('Einstein Cross'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(set.ra[i]).toBeCloseTo(340.1260, 2);
    expect(set.dec[i]).toBeCloseTo(3.3585, 2);
    expect(set.label[i]).toContain('Einstein Cross');
  });

  it('every record has non-empty label + the expected table columns', () => {
    const set = lensCatalogSet();
    for (let i = 0; i < set.count; i++) {
      expect(set.label[i]!.length).toBeGreaterThan(0);
      const rec = set.records[i]!;
      // The enriched row keeps the original Name/Type/z columns AND adds the four
      // discriminating columns (diameter, image count, brightness, "most obvious").
      expect(Object.keys(rec)).toEqual([
        'Name', 'Type', 'z_lens', 'z_source', 'θ_E (")', 'Config', 'Mag', 'Obvious', 'Note',
      ]);
      expect(String(rec['Name']).length).toBeGreaterThan(0);
    }
  });

  it('renders an unknown redshift as the no-data dash, never null/NaN', () => {
    const set = lensCatalogSet();
    const i = LENS_CATALOG.findIndex((l) => l.zLens === null);
    expect(i).toBeGreaterThanOrEqual(0); // catalog includes at least one honest unknown
    expect(set.records[i]!['z_lens']).toBe(CATALOG_NO_DATA);
  });

  it('renders a null angular scale / magnitude as the no-data dash', () => {
    const set = lensCatalogSet();
    // A cluster we could not pin to one Einstein-radius number has a dash, not 0.
    const bullet = LENS_CATALOG.findIndex((l) => l.name.includes('Bullet'));
    expect(bullet).toBeGreaterThanOrEqual(0);
    expect(LENS_CATALOG[bullet]!.thetaEArcsec).toBeNull();
    expect(set.records[bullet]!['θ_E (")']).toBe(CATALOG_NO_DATA);
    expect(set.records[bullet]!['Mag']).toBe(CATALOG_NO_DATA); // clusters have no single mag
  });
});

describe('LENS_CATALOG — enriched discriminating fields', () => {
  it('every entry has a config string and a scale/mag that is a number or an honest null', () => {
    for (const l of LENS_CATALOG) {
      expect(typeof l.config).toBe('string');
      expect(l.config.length).toBeGreaterThan(1);
      expect(l.thetaEArcsec === null || (Number.isFinite(l.thetaEArcsec) && l.thetaEArcsec > 0)).toBe(true);
      expect(l.magnitude === null || (Number.isFinite(l.magnitude) && l.magnitude > 0)).toBe(true);
      // A magnitude without a band (or vice versa) would render nonsense — forbid it.
      expect(l.magnitude === null).toBe(l.magBand === null);
      expect(typeof l.prominent).toBe('boolean');
    }
  });

  it('angular scales match the KNOWN literature values (a zeros/placeholder impl fails)', () => {
    // θ_E is the Einstein/ring RADIUS in arcsec; max image separation ≈ 2·θ_E.
    const cross = byName('Einstein Cross');
    // Known max image separation ≈ 1.8″ ⇒ θ_E ≈ 0.9″.
    expect(cross.thetaEArcsec).toBeCloseTo(0.9, 1);
    expect(2 * cross.thetaEArcsec!).toBeCloseTo(1.8, 1); // recover the famous ~1.8″ cross

    // Cosmic Horseshoe: near-complete ring of RADIUS ≈ 5.0″ (diameter ≈ 10″).
    const horseshoe = byName('Cosmic Horseshoe');
    expect(horseshoe.thetaEArcsec).toBeCloseTo(5.0, 1);
    expect(2 * horseshoe.thetaEArcsec!).toBeGreaterThan(9); // ring diameter ~10″

    // A big cluster arc sits at a radius of TENS of arcsec (Abell 1689 θ_E≈47″).
    const a1689 = byName('Abell 1689');
    expect(a1689.thetaEArcsec).toBeGreaterThan(30);
    expect(a1689.thetaEArcsec).toBeCloseTo(47.0, 0);

    // Cluster arcs are an order of magnitude larger than galaxy-scale quasar lenses.
    expect(a1689.thetaEArcsec!).toBeGreaterThan(10 * cross.thetaEArcsec!);
  });

  it('image-configuration strings are the right kind for known systems', () => {
    expect(byName('Einstein Cross').config).toBe('quad');
    expect(byName('Twin Quasar').config).toBe('double');
    expect(byName('Cosmic Horseshoe').config).toMatch(/ring/i);
    expect(byName('SDSS J1004').config).toMatch(/five/i);
    expect(byName('Jackpot').config).toMatch(/ring/i);
    // Every cluster shows arcs/multiple images, never a single "double".
    for (const l of LENS_CATALOG.filter((x) => x.type === 'group-cluster')) {
      expect(l.config).toMatch(/arc|image/i);
    }
  });

  it('representative magnitudes are sane where known (and clusters have none)', () => {
    // Einstein Cross quasar V≈16.8; Cosmic Horseshoe ring g≈20.1.
    const cross = byName('Einstein Cross');
    expect(cross.magnitude).toBeCloseTo(16.8, 1);
    expect(cross.magBand).toBe('V');
    expect(byName('Cosmic Horseshoe').magnitude).toBeCloseTo(20.1, 1);
    // No cluster has a single representative magnitude.
    for (const l of LENS_CATALOG.filter((x) => x.type === 'group-cluster')) {
      expect(l.magnitude).toBeNull();
    }
  });

  it('the "most obvious" flag marks the iconic handful, not everything', () => {
    const prominent = LENS_CATALOG.filter((l) => l.prominent);
    // A "handful" — several, but well under half of the catalog.
    expect(prominent.length).toBeGreaterThanOrEqual(4);
    expect(prominent.length).toBeLessThan(LENS_CATALOG.length / 2);
    // The iconic ones the criterion calls out are flagged...
    expect(byName('Einstein Cross').prominent).toBe(true);
    expect(byName('Cosmic Horseshoe').prominent).toBe(true);
    // ...including at least two of the big giant-arc clusters.
    const bigClusters = LENS_CATALOG.filter(
      (l) => l.type === 'group-cluster' && l.prominent
    );
    expect(bigClusters.length).toBeGreaterThanOrEqual(2);
    // ...and a plain small quad lens is NOT flagged as visually obvious.
    expect(byName('PG 1115').prominent).toBe(false);
    // Every flagged cluster genuinely has a large Einstein radius (or is famously
    // striking with an unquantified scale, e.g. SMACS J0723 / JWST first deep field).
    for (const l of bigClusters) {
      expect(l.thetaEArcsec === null || l.thetaEArcsec >= 20).toBe(true);
    }
  });

  it('exposes the new discriminating columns in the CatalogSet records', () => {
    const set = lensCatalogSet();
    const i = LENS_CATALOG.findIndex((l) => l.name.includes('Einstein Cross'));
    const rec = set.records[i]!;
    expect(rec['θ_E (")']).toBeCloseTo(0.9, 1);
    expect(rec['Config']).toBe('quad');
    expect(rec['Mag']).toBe('16.8 V'); // value + band, formatted for the table
    expect(rec['Obvious']).toBe('yes');
    // Columnar arrays stay parallel and consistent after enrichment.
    expect(set.records.length).toBe(set.count);
    expect(set.count).toBe(LENS_CATALOG.length);
  });
});
