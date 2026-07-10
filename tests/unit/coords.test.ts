import { describe, it, expect } from 'vitest';
import {
  equatorialToGalactic,
  galacticToEquatorial,
  equatorialToEcliptic,
  eclipticToEquatorial,
  fromEquatorial,
  toEquatorial,
  type CoordSystem,
} from '../../src/utils/coords.js';

/** A spread of test points that avoids the exact poles (where lon is singular). */
const GRID: Array<[number, number]> = [];
for (const ra of [0, 37, 90, 123.4, 180, 266.4, 300, 359.9]) {
  for (const dec of [-85, -60, -30, -5, 0, 12, 45, 70, 88]) {
    GRID.push([ra, dec]);
  }
}

/** Angular separation (deg) between two lon/lat points — order-independent check. */
function sep(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const d2r = Math.PI / 180;
  const φ1 = lat1 * d2r;
  const φ2 = lat2 * d2r;
  const dλ = (lon2 - lon1) * d2r;
  const c =
    Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return Math.acos(Math.max(-1, Math.min(1, c))) / d2r;
}

describe('galactic round-trip', () => {
  it('galacticToEquatorial(equatorialToGalactic) recovers the input over a grid', () => {
    for (const [ra, dec] of GRID) {
      const g = equatorialToGalactic(ra, dec);
      const back = galacticToEquatorial(g.lon, g.lat);
      // Compare as a sky separation so the 359.9°↔0° wrap isn't a false failure.
      expect(sep(ra, dec, back.lon, back.lat)).toBeLessThan(1e-6);
    }
  });
});

describe('ecliptic round-trip', () => {
  it('eclipticToEquatorial(equatorialToEcliptic) recovers the input over a grid', () => {
    for (const [ra, dec] of GRID) {
      const e = equatorialToEcliptic(ra, dec);
      const back = eclipticToEquatorial(e.lon, e.lat);
      expect(sep(ra, dec, back.lon, back.lat)).toBeLessThan(1e-6);
    }
  });
});

describe('galactic known values (adversarial)', () => {
  it('maps the galactic centre (266.405, −28.936) to (l≈0, b≈0)', () => {
    const g = equatorialToGalactic(266.405, -28.936);
    // l wraps to ~360 or ~0; test as a separation from (0,0).
    expect(sep(g.lon, g.lat, 0, 0)).toBeLessThan(0.05);
  });

  it('maps the north galactic pole (l=0, b=90) to (ra≈192.859, dec≈27.128)', () => {
    const e = galacticToEquatorial(0, 90);
    expect(e.lon).toBeCloseTo(192.85948, 2);
    expect(e.lat).toBeCloseTo(27.12825, 2);
  });

  it('is NOT the identity (kills an identity / passthrough stub)', () => {
    const g = equatorialToGalactic(83.633, 22.0145); // Crab Nebula
    expect(sep(g.lon, g.lat, 83.633, 22.0145)).toBeGreaterThan(1);
  });

  it('places the equatorial pole at the known galactic latitude 27.128°', () => {
    // NCP galactic latitude equals δ_NGP; guards a swapped/misbuilt matrix.
    const g = equatorialToGalactic(0, 90);
    expect(g.lat).toBeCloseTo(27.12825, 2);
  });
});

describe('ecliptic known values (adversarial)', () => {
  it('maps the vernal equinox (0,0) to (0,0)', () => {
    const e = equatorialToEcliptic(0, 0);
    expect(sep(e.lon, e.lat, 0, 0)).toBeLessThan(1e-6);
  });

  it('maps the north celestial pole to ecliptic latitude 90−ε ≈ 66.56°', () => {
    const e = equatorialToEcliptic(0, 90);
    expect(e.lat).toBeCloseTo(90 - 23.4392911, 4);
  });

  it('is NOT the identity away from the equinox', () => {
    const e = equatorialToEcliptic(90, 0); // summer solstice on the equator
    expect(sep(e.lon, e.lat, 90, 0)).toBeGreaterThan(1);
  });
});

describe('output normalisation', () => {
  it('always returns lon in [0,360) and lat in [−90,90]', () => {
    for (const [ra, dec] of GRID) {
      for (const c of [equatorialToGalactic(ra, dec), equatorialToEcliptic(ra, dec)]) {
        expect(c.lon).toBeGreaterThanOrEqual(0);
        expect(c.lon).toBeLessThan(360);
        expect(c.lat).toBeGreaterThanOrEqual(-90);
        expect(c.lat).toBeLessThanOrEqual(90);
      }
    }
  });

  it('keeps a near-360 longitude strictly inside [0,360) (wrap guard)', () => {
    // Just below the galactic centre in RA maps to l just under 360, not 360+.
    const g = equatorialToGalactic(266.3, -28.936);
    expect(g.lon).toBeGreaterThan(359);
    expect(g.lon).toBeLessThan(360);
  });
});

describe('dispatchers', () => {
  const systems: CoordSystem[] = ['equatorial', 'galactic', 'ecliptic'];

  it('fromEquatorial matches the direct transform for each system', () => {
    const ra = 150.2;
    const dec = -12.7;
    expect(fromEquatorial(ra, dec, 'galactic')).toEqual(equatorialToGalactic(ra, dec));
    expect(fromEquatorial(ra, dec, 'ecliptic')).toEqual(equatorialToEcliptic(ra, dec));
  });

  it('equatorial dispatch is the identity (normalised)', () => {
    const c = fromEquatorial(150.2, -12.7, 'equatorial');
    expect(c.lon).toBeCloseTo(150.2, 9);
    expect(c.lat).toBeCloseTo(-12.7, 9);
  });

  it('fromEquatorial then toEquatorial round-trips in every system', () => {
    for (const system of systems) {
      for (const [ra, dec] of GRID) {
        const c = fromEquatorial(ra, dec, system);
        const back = toEquatorial(c.lon, c.lat, system);
        expect(sep(ra, dec, back.lon, back.lat)).toBeLessThan(1e-6);
      }
    }
  });
});
