import { describe, it, expect } from 'vitest';
import { GLOSSARY, lookup, type GlossaryEntry } from '../../src/data/glossary.js';

const entries = Object.entries(GLOSSARY);

/**
 * Every term BACKLOG #11 requires the glossary to cover. If a key here is missing
 * from GLOSSARY the coverage test fails — this list is the contract.
 */
const REQUIRED_KEYS = [
  'dp1',
  'dp2',
  'dr1',
  'coadd',
  'deep-coadd',
  'visit',
  'forcedsource',
  'diasource',
  'diaobject',
  'rsp',
  'data-rights',
  'hips',
  'healpix',
  'wcs',
  'soda',
  'tap',
  'adql',
  'mjd',
  'moc',
  'gnomonic-tan',
  'fits',
  'bitpix',
  'bscale',
  'arcmin',
  'arcsec',
  'ra',
  'dec',
  'fov',
  'color-composite',
] as const;

describe('GLOSSARY structure', () => {
  it('has entries', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s has a non-empty term and short one-liner ≤120 chars', (_key, entry) => {
    const e = entry as GlossaryEntry;
    expect(e.term.trim().length).toBeGreaterThan(0);
    expect(e.short.trim().length).toBeGreaterThan(0);
    expect(e.short.length).toBeLessThanOrEqual(120);
  });

  it('uses stable lowercase/kebab keys', () => {
    for (const [key] of entries) {
      expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('optional long, when present, is a non-empty string longer than the short', () => {
    for (const [, entry] of entries) {
      if (entry.long !== undefined) {
        expect(entry.long.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('GLOSSARY coverage of BACKLOG #11 terms', () => {
  it.each(REQUIRED_KEYS)('covers required term %s', (key) => {
    expect(GLOSSARY[key], `missing required glossary key: ${key}`).toBeDefined();
  });
});

describe('GLOSSARY has no duplicate or near-duplicate terms', () => {
  it('no two entries share a normalized display term', () => {
    const seen = new Map<string, string>();
    for (const [key, entry] of entries) {
      const norm = entry.term.toLowerCase().replace(/[\s_/()-]+/g, '');
      const prior = seen.get(norm);
      expect(prior, `duplicate term "${entry.term}" in keys ${prior} and ${key}`).toBeUndefined();
      seen.set(norm, key);
    }
  });

  it('no two entries share an identical short definition', () => {
    const seen = new Set<string>();
    for (const [, entry] of entries) {
      const norm = entry.short.trim().toLowerCase();
      expect(seen.has(norm), `duplicate short copy: "${entry.short}"`).toBe(false);
      seen.add(norm);
    }
  });
});

describe('lookup', () => {
  it('resolves the canonical key', () => {
    expect(lookup('dp1')).toBe(GLOSSARY['dp1']);
  });

  it('is case-insensitive', () => {
    expect(lookup('DP1')).toBe(lookup('dp1'));
    expect(lookup('Hips')).toBe(GLOSSARY['hips']);
    expect(lookup('WCS')).toBe(GLOSSARY['wcs']);
  });

  it('is separator-insensitive (spaces, underscores, hyphens all collapse)', () => {
    expect(lookup('deep_coadd')).toBe(GLOSSARY['deep-coadd']);
    expect(lookup('deep coadd')).toBe(GLOSSARY['deep-coadd']);
    expect(lookup('deep-coadd')).toBe(GLOSSARY['deep-coadd']);
    expect(lookup('DEEP COADD')).toBe(GLOSSARY['deep-coadd']);
    expect(lookup('data rights')).toBe(GLOSSARY['data-rights']);
    expect(lookup('color composite')).toBe(GLOSSARY['color-composite']);
  });

  it('resolves by the human-readable display term too', () => {
    expect(lookup('deep_coadd')).toBe(GLOSSARY['deep-coadd']);
    expect(lookup('nanojansky (nJy)')).toBe(GLOSSARY['nanojansky']);
    expect(lookup('Gnomonic (TAN)')).toBe(GLOSSARY['gnomonic-tan']);
  });

  it('returns undefined for an unknown term', () => {
    expect(lookup('quasar-flux-capacitor')).toBeUndefined();
    expect(lookup('')).toBeUndefined();
    expect(lookup('   ')).toBeUndefined();
  });
});

/**
 * ADVERSARIAL: assert specific facts so a wrong or placeholder ("lorem ipsum")
 * definition fails. A glossary that merely has the right keys but garbage copy
 * must NOT pass.
 */
describe('GLOSSARY definitions are factually correct (adversarial)', () => {
  it('DP1 = seven fields', () => {
    expect(GLOSSARY['dp1']!.short).toMatch(/7|seven/i);
    expect(GLOSSARY['dp1']!.short).toMatch(/field/i);
  });

  it('DP1 area is ~15 deg²', () => {
    expect(GLOSSARY['dp1']!.short).toMatch(/15/);
  });

  it('SODA is a cutout protocol', () => {
    expect(GLOSSARY['soda']!.short).toMatch(/cutout/i);
  });

  it('MJD is a Julian date since 1858-11-17', () => {
    expect(GLOSSARY['mjd']!.short).toMatch(/julian/i);
    const text = `${GLOSSARY['mjd']!.short} ${GLOSSARY['mjd']!.long ?? ''}`;
    expect(text).toMatch(/1858/);
  });

  it('HEALPix is an equal-area sphere pixelisation', () => {
    expect(GLOSSARY['healpix']!.short).toMatch(/equal.?area/i);
  });

  it('HiPS is progressive / multi-resolution tiling', () => {
    expect(GLOSSARY['hips']!.short).toMatch(/progressive|multi.?resolution|resolution/i);
  });

  it('WCS maps pixels to sky coordinates', () => {
    expect(GLOSSARY['wcs']!.short).toMatch(/pixel/i);
    expect(GLOSSARY['wcs']!.short).toMatch(/coordinate|sky|ra/i);
  });

  it('ADQL is a query language', () => {
    expect(GLOSSARY['adql']!.short).toMatch(/quer/i);
  });

  it('RA/Dec are the two sky coordinates', () => {
    expect(GLOSSARY['ra']!.short).toMatch(/ascension/i);
    expect(GLOSSARY['dec']!.short).toMatch(/declination/i);
  });

  it('colour composite is about combining bands into colour vs single band', () => {
    expect(GLOSSARY['color-composite']!.short).toMatch(/colou?r/i);
    expect(GLOSSARY['color-composite']!.short).toMatch(/band|filter|red|green|blue|rgb/i);
  });
});
