import { describe, it, expect } from 'vitest';
import { parseWcs, pixelToWorld, worldToPixel, wcsPixelScaleArcsec } from '../../src/utils/wcs.js';
import type { Wcs } from '../../src/utils/wcs.js';
import type { FitsHeader } from '../../src/utils/fits.js';
import { positionAngle } from '../../src/utils/skyGeom.js';

/** A realistic diagonal TAN WCS: 0.4″/pixel, RA increasing to the LEFT (CD1_1<0). */
const DIAG: Wcs = {
  crval1: 150.0,
  crval2: 2.2,
  crpix1: 1024.5,
  crpix2: 1024.5,
  cd11: -0.0001111,
  cd12: 0,
  cd21: 0,
  cd22: 0.0001111,
};

/** Build a FitsHeader carrying only the WCS-relevant fields (rest are defaults). */
function header(overrides: Partial<FitsHeader>): FitsHeader {
  return {
    simple: true,
    bitpix: -32,
    naxis: 2,
    naxis1: 2048,
    naxis2: 2048,
    bscale: 1,
    bzero: 0,
    cards: {},
    ...overrides,
  } as FitsHeader;
}

describe('parseWcs', () => {
  it('parses a CD-matrix TAN header', () => {
    const wcs = parseWcs(
      header({
        ctype1: 'RA---TAN',
        ctype2: 'DEC--TAN',
        crval1: 150,
        crval2: 2.2,
        crpix1: 1024.5,
        crpix2: 1024.5,
        cd1_1: -0.0001111,
        cd2_2: 0.0001111,
        // cd1_2 / cd2_1 absent -> default to 0
      })
    );
    // Kills an impl that mishandles absent off-diagonal CD terms (should be 0, not NaN).
    expect(wcs).not.toBeNull();
    expect(wcs!.cd11).toBeCloseTo(-0.0001111, 12);
    expect(wcs!.cd12).toBe(0);
    expect(wcs!.cd21).toBe(0);
    expect(wcs!.cd22).toBeCloseTo(0.0001111, 12);
  });

  it('returns null when there is NO CD matrix and NO CDELT (kills a "never null" impl)', () => {
    const wcs = parseWcs(
      header({
        ctype1: 'RA---TAN',
        ctype2: 'DEC--TAN',
        crval1: 150,
        crval2: 2.2,
        crpix1: 100,
        crpix2: 100,
        // no cd*, no cdelt* -> unusable
      })
    );
    expect(wcs).toBeNull();
  });

  it('returns null for a non-TAN projection (kills accepting any header)', () => {
    // SIN projection is a different sphere->plane map; we must not treat it as TAN.
    expect(
      parseWcs(
        header({
          ctype1: 'RA---SIN',
          ctype2: 'DEC--SIN',
          crval1: 150,
          crval2: 2.2,
          crpix1: 100,
          crpix2: 100,
          cd1_1: -0.0001111,
          cd2_2: 0.0001111,
        })
      )
    ).toBeNull();
    // SIP distortion needs terms we don't implement -> also rejected.
    expect(
      parseWcs(
        header({
          ctype1: 'RA---TAN-SIP',
          ctype2: 'DEC--TAN-SIP',
          crval1: 150,
          crval2: 2.2,
          crpix1: 100,
          crpix2: 100,
          cd1_1: -0.0001111,
          cd2_2: 0.0001111,
        })
      )
    ).toBeNull();
  });

  it('returns null when a required CRVAL/CRPIX is missing', () => {
    expect(
      parseWcs(
        header({
          ctype1: 'RA---TAN',
          ctype2: 'DEC--TAN',
          crval1: 150,
          // crval2 missing
          crpix1: 100,
          crpix2: 100,
          cd1_1: -0.0001111,
          cd2_2: 0.0001111,
        })
      )
    ).toBeNull();
  });

  it('synthesises CD from CDELT + CROTA2 when no CD matrix is present', () => {
    const wcs = parseWcs(
      header({
        ctype1: 'RA---TAN',
        ctype2: 'DEC--TAN',
        crval1: 150,
        crval2: 2.2,
        crpix1: 100,
        crpix2: 100,
        cdelt1: 0.0001111,
        cdelt2: 0.0001111,
        cards: { CROTA2: 30 },
      })
    );
    expect(wcs).not.toBeNull();
    // AIPS convention: CD1_1=CDELT1 cos30, CD1_2=-CDELT2 sin30, etc.
    // Kills an impl that ignores CROTA2 (would give a diagonal CD).
    const c = Math.cos(30 * (Math.PI / 180));
    const s = Math.sin(30 * (Math.PI / 180));
    expect(wcs!.cd11).toBeCloseTo(0.0001111 * c, 12);
    expect(wcs!.cd12).toBeCloseTo(-0.0001111 * s, 12);
    expect(wcs!.cd21).toBeCloseTo(0.0001111 * s, 12);
    expect(wcs!.cd22).toBeCloseTo(0.0001111 * c, 12);
    expect(wcs!.cd12).not.toBe(0); // rotation actually applied
  });
});

describe('reference point', () => {
  it('pixelToWorld(CRPIX) === (CRVAL) exactly (kills an offset/one-based bug)', () => {
    const w = pixelToWorld(DIAG, DIAG.crpix1, DIAG.crpix2);
    expect(w.ra).toBeCloseTo(150.0, 9);
    expect(w.dec).toBeCloseTo(2.2, 9);
  });
});

describe('round-trip pixel <-> world', () => {
  // Kills any impl that isn't a true inverse (e.g. forgets the CD inversion,
  // uses a flat scale, or mismatches deg/rad) — a hardcoded impl cannot survive
  // the whole grid including corners.
  const grid = [
    [1, 1],
    [1, 2048],
    [2048, 1],
    [2048, 2048],
    [1024.5, 1024.5],
    [512.25, 1536.75],
    [900, 1200],
  ];

  it('worldToPixel(pixelToWorld(p)) === p across a pixel grid', () => {
    for (const [x, y] of grid) {
      const w = pixelToWorld(DIAG, x!, y!);
      const p = worldToPixel(DIAG, w.ra, w.dec);
      expect(p).not.toBeNull();
      expect(p!.x).toBeCloseTo(x!, 6);
      expect(p!.y).toBeCloseTo(y!, 6);
    }
  });

  it('pixelToWorld(worldToPixel(w)) === w for sky points near the reference', () => {
    const worlds = [
      [150.0, 2.2],
      [150.05, 2.25],
      [149.9, 2.1],
      [150.1, 2.3],
    ];
    for (const [ra, dec] of worlds) {
      const p = worldToPixel(DIAG, ra!, dec!);
      expect(p).not.toBeNull();
      const w = pixelToWorld(DIAG, p!.x, p!.y);
      expect(w.ra).toBeCloseTo(ra!, 7);
      expect(w.dec).toBeCloseTo(dec!, 7);
    }
  });
});

describe('orientation / handedness (kills a flipped-axis impl)', () => {
  it('with CD1_1<0, moving +1 pixel in x DECREASES RA', () => {
    const ref = pixelToWorld(DIAG, DIAG.crpix1, DIAG.crpix2);
    const plusX = pixelToWorld(DIAG, DIAG.crpix1 + 1, DIAG.crpix2);
    // Standard sky orientation: East (increasing RA) is to the LEFT.
    expect(plusX.ra).toBeLessThan(ref.ra);
    // And it's a pure-RA move: Dec essentially unchanged at +x.
    expect(plusX.dec).toBeCloseTo(ref.dec, 6);
  });

  it('moving +1 pixel in y INCREASES Dec', () => {
    const ref = pixelToWorld(DIAG, DIAG.crpix1, DIAG.crpix2);
    const plusY = pixelToWorld(DIAG, DIAG.crpix1, DIAG.crpix2 + 1);
    expect(plusY.dec).toBeGreaterThan(ref.dec);
    expect(plusY.ra).toBeCloseTo(ref.ra, 6);
  });
});

describe('wcsPixelScaleArcsec (kills a deg-vs-arcsec confusion)', () => {
  it('is ~0.4 arcsec/pixel for a 0.0001111 deg/pixel CD', () => {
    expect(wcsPixelScaleArcsec(DIAG)).toBeCloseTo(0.0001111 * 3600, 6);
    expect(wcsPixelScaleArcsec(DIAG)).toBeCloseTo(0.4, 2);
    // A deg-not-arcsec impl would return ~0.0001, three orders of magnitude off.
    expect(wcsPixelScaleArcsec(DIAG)).toBeGreaterThan(0.1);
  });
});

describe('rotated CD (kills dropping the off-diagonal terms)', () => {
  const rotated = parseWcs(
    header({
      ctype1: 'RA---TAN',
      ctype2: 'DEC--TAN',
      crval1: 150,
      crval2: 2.2,
      crpix1: 1024.5,
      crpix2: 1024.5,
      cdelt1: 0.0001111,
      cdelt2: 0.0001111,
      cards: { CROTA2: 30 },
    })
  )!;

  it('round-trips even with a rotation applied', () => {
    for (const [x, y] of [
      [1, 1],
      [2048, 2048],
      [700, 1500],
    ]) {
      const w = pixelToWorld(rotated, x!, y!);
      const p = worldToPixel(rotated, w.ra, w.dec);
      expect(p!.x).toBeCloseTo(x!, 6);
      expect(p!.y).toBeCloseTo(y!, 6);
    }
  });

  it('tilts the +y axis 30 degrees away from North (a diagonal-drop impl gives 0)', () => {
    const ref = pixelToWorld(rotated, rotated.crpix1, rotated.crpix2);
    const up = pixelToWorld(rotated, rotated.crpix1, rotated.crpix2 + 10);
    const pa = positionAngle(ref.ra, ref.dec, up.ra, up.dec);
    // Position angle is measured E of N; the +y axis should be 30 deg off North.
    const offNorth = Math.min(pa, 360 - pa);
    expect(offNorth).toBeCloseTo(30, 0);
    // A diagonal CD (dropped off-diagonal) would keep +y due North -> offNorth 0.
    expect(offNorth).toBeGreaterThan(20);
  });
});

describe('off-sky failure mode', () => {
  it('worldToPixel returns null for a point > 90 degrees from the reference', () => {
    // Reference is (150, 2.2); the south pole neighbourhood is >90 deg away.
    expect(worldToPixel(DIAG, 150, -89)).toBeNull();
    // A point 120 deg away along the equatorial-ish direction is also off-sky.
    expect(worldToPixel(DIAG, 270, 2.2)).toBeNull();
  });

  it('pixelToWorld is still defined for pixels that project to the far field', () => {
    // Even far from CRPIX the forward map is total (returns finite RA/Dec).
    const w = pixelToWorld(DIAG, 1e6, 1e6);
    expect(Number.isFinite(w.ra)).toBe(true);
    expect(Number.isFinite(w.dec)).toBe(true);
  });

  it('returns null from worldToPixel when the CD matrix is singular', () => {
    const singular: Wcs = { ...DIAG, cd11: 0, cd12: 0, cd21: 0, cd22: 0 };
    expect(worldToPixel(singular, 150, 2.2)).toBeNull();
  });
});

describe('poles and RA wrap', () => {
  it('handles a reference near the north pole without NaN', () => {
    const polar: Wcs = { ...DIAG, crval1: 42, crval2: 89.9 };
    const w = pixelToWorld(polar, polar.crpix1 + 5, polar.crpix2 + 5);
    expect(Number.isFinite(w.ra)).toBe(true);
    expect(w.dec).toBeLessThanOrEqual(90);
    const p = worldToPixel(polar, w.ra, w.dec);
    expect(p!.x).toBeCloseTo(polar.crpix1 + 5, 5);
    expect(p!.y).toBeCloseTo(polar.crpix2 + 5, 5);
  });

  it('normalises RA across the 0/360 wrap', () => {
    // Reference at RA 0: a -x pixel step should wrap to just under 360, not go negative.
    const atZero: Wcs = { ...DIAG, crval1: 0.0 };
    const w = pixelToWorld(atZero, atZero.crpix1 + 5, atZero.crpix2);
    // CD1_1<0 so +x decreases RA -> wraps below 0 to ~359.99.
    expect(w.ra).toBeGreaterThan(359);
    expect(w.ra).toBeLessThan(360);
    const p = worldToPixel(atZero, w.ra, w.dec);
    expect(p!.x).toBeCloseTo(atZero.crpix1 + 5, 6);
  });
});
