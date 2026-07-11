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
      expect(Object.keys(rec)).toEqual(['Name', 'Type', 'z_lens', 'z_source', 'Note']);
      expect(String(rec['Name']).length).toBeGreaterThan(0);
    }
  });

  it('renders an unknown redshift as the no-data dash, never null/NaN', () => {
    const set = lensCatalogSet();
    const i = LENS_CATALOG.findIndex((l) => l.zLens === null);
    expect(i).toBeGreaterThanOrEqual(0); // catalog includes at least one honest unknown
    expect(set.records[i]!['z_lens']).toBe(CATALOG_NO_DATA);
  });
});
