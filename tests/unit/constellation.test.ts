import { describe, it, expect } from 'vitest';
import { constellationFor } from '../../src/utils/constellation.js';
import { CONSTELLATION_NAMES } from '../../src/utils/constellation-data.js';
import { ALL_OBJECTS } from '../../src/data/objects.js';

describe('constellationFor — known interior points', () => {
  const cases: [string, number, number, string][] = [
    ['Polaris', 37.95, 89.26, 'UMi'],
    ['M31', 10.68, 41.27, 'And'],
    ['Betelgeuse', 88.79, 7.41, 'Ori'],
    ['Sirius', 101.29, -16.72, 'CMa'],
    ['Vega', 279.23, 38.78, 'Lyr'],
    ['Acrux', 186.65, -63.1, 'Cru'],
    ['Galactic center', 266.42, -28.99, 'Sgr'],
    ['Aldebaran', 68.98, 16.51, 'Tau'],
    ['Regulus', 152.09, 11.97, 'Leo'],
  ];
  for (const [name, ra, dec, abbr] of cases) {
    it(`${name} → ${abbr}`, () => {
      expect(constellationFor(ra, dec).abbr).toBe(abbr);
    });
  }
});

describe('constellationFor — poles, wrap, robustness', () => {
  it('north celestial pole → UMi', () => {
    expect(constellationFor(0, 90).abbr).toBe('UMi');
    expect(constellationFor(180, 90).abbr).toBe('UMi');
  });
  it('south celestial pole → Oct', () => {
    expect(constellationFor(0, -90).abbr).toBe('Oct');
  });
  it('handles RA just above 0h and just below 24h', () => {
    expect(constellationFor(0.1, 5).abbr).not.toBe('—');
    expect(constellationFor(359.9, 5).abbr).not.toBe('—');
    expect(constellationFor(400, 5).abbr).toBe(constellationFor(40, 5).abbr); // RA wrap
  });
  it('never throws and never returns empty over a full-sky grid', () => {
    for (let dec = -89; dec <= 89; dec += 7) {
      for (let ra = 0; ra < 360; ra += 11) {
        const c = constellationFor(ra, dec);
        expect(c.abbr).not.toBe('—');
        expect(CONSTELLATION_NAMES[c.abbr]).toBeTruthy();
      }
    }
  });
  it('returns Unknown for non-finite input without throwing', () => {
    expect(constellationFor(NaN, 10).abbr).toBe('—');
  });
});

/**
 * Independent adversarial cross-check: a star's Bayer/Flamsteed designation
 * encodes the IAU constellation it belongs to (the IAU assigned it from the same
 * boundaries). Parse that abbreviation from each catalog star name and require
 * constellationFor() to agree. This exercises THOUSANDS of real positions, many
 * near boundaries — a no-precession impl misplaces boundary stars and fails the
 * threshold; a flat table mis-sort does too. The tiny residual (<1%) are the
 * handful of genuine designation-vs-boundary discrepancies.
 */
describe('constellationFor — Bayer-designation cross-check (needs real precession)', () => {
  const abbrs = new Set(Object.keys(CONSTELLATION_NAMES));

  function expectedAbbr(name: string): string | null {
    const tokens = name.match(/[A-Za-z]+/g);
    if (!tokens) return null;
    let last: string | null = null;
    for (const t of tokens) if (abbrs.has(t)) last = t; // constellation is the LAST known abbr token
    return last;
  }

  it('agrees with ≥98% of Bayer-designated stars', () => {
    let total = 0;
    let match = 0;
    const misses: string[] = [];
    for (const o of ALL_OBJECTS) {
      if (o.type !== 'star' && o.type !== 'double-star') continue;
      const exp = expectedAbbr(o.name);
      if (!exp) continue;
      total++;
      if (constellationFor(o.ra, o.dec).abbr === exp) match++;
      else if (misses.length < 12) misses.push(`${o.name} @${o.ra.toFixed(2)},${o.dec.toFixed(2)} → got ${constellationFor(o.ra, o.dec).abbr}, exp ${exp}`);
    }
    expect(total).toBeGreaterThan(1000);
    const frac = match / total;
    if (frac < 0.98) console.error('constellation misses sample:', misses);
    expect(frac).toBeGreaterThanOrEqual(0.98);
  });
});
