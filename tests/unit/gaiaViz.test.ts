import { describe, it, expect } from 'vitest';
import {
  bpRpToRgb,
  parallaxToDistancePc,
  absoluteGMag,
  pmVectorEndpoint,
  cmdPoints,
  GAIA_NAN_COLOR,
  BPRP_BLUE,
  BPRP_RED,
} from '../../src/utils/gaiaViz.js';
import type { GaiaCatalog } from '../../src/api/gaia.js';

/** Build a minimal GaiaCatalog fixture from parallel arrays (NaN-filled defaults). */
function gaiaFixture(
  cols: Partial<{ bpRp: number[]; gMag: number[]; parallax: number[]; pmRa: number[]; pmDec: number[] }>,
  n: number
): GaiaCatalog {
  const f = (a?: number[]) => {
    const arr = new Float32Array(n).fill(NaN);
    a?.forEach((v, i) => (arr[i] = v));
    return arr;
  };
  return {
    count: n,
    sourceId: Array.from({ length: n }, (_, i) => `id-${i}`),
    ra: f(),
    dec: f(),
    gMag: f(cols.gMag),
    bpRp: f(cols.bpRp),
    pmRa: f(cols.pmRa),
    pmDec: f(cols.pmDec),
    parallax: f(cols.parallax),
    radialVelocity: f(),
    teff: f(),
  };
}

describe('bpRpToRgb — perceptual blue→white→red, monotonic in colour index', () => {
  // ADVERSARIAL: a constant-colour renderer (returns the same RGB for every
  // source) FAILS this — the RED channel must strictly increase and BLUE strictly
  // decrease as BP−RP goes from hot/blue to cool/red.
  it('is strictly monotonic across the domain (R↑, B↓)', () => {
    const samples = [BPRP_BLUE, 0.0, 0.5, 1.0, 1.5, 2.0, BPRP_RED];
    const rgbs = samples.map(bpRpToRgb);
    for (let i = 1; i < rgbs.length; i++) {
      expect(rgbs[i]![0]).toBeGreaterThan(rgbs[i - 1]![0]); // red rises
      expect(rgbs[i]![2]).toBeLessThan(rgbs[i - 1]![2]); // blue falls
    }
  });

  it('hot (low BP−RP) is blue-dominant; cool (high BP−RP) is red-dominant', () => {
    const hot = bpRpToRgb(0.0);
    const cool = bpRpToRgb(2.5);
    expect(hot[2]).toBeGreaterThan(hot[0]); // blue > red for a hot star
    expect(cool[0]).toBeGreaterThan(cool[2]); // red > blue for a cool star
  });

  it('two DIFFERENT colour indices give DIFFERENT RGB (kills a constant map)', () => {
    expect(bpRpToRgb(0.3)).not.toEqual(bpRpToRgb(1.7));
  });

  it('NaN colour → the neutral grey, not a blue/red star', () => {
    expect(bpRpToRgb(NaN)).toEqual([GAIA_NAN_COLOR[0], GAIA_NAN_COLOR[1], GAIA_NAN_COLOR[2]]);
    expect(bpRpToRgb(Infinity)).toEqual([GAIA_NAN_COLOR[0], GAIA_NAN_COLOR[1], GAIA_NAN_COLOR[2]]);
  });

  it('clamps out-of-domain values to the endpoint colours', () => {
    expect(bpRpToRgb(-5)).toEqual(bpRpToRgb(BPRP_BLUE));
    expect(bpRpToRgb(99)).toEqual(bpRpToRgb(BPRP_RED));
  });
});

describe('parallaxToDistancePc — 1000/ϖ, positive parallax only', () => {
  it('returns the correct parsec distance for ϖ > 0', () => {
    expect(parallaxToDistancePc(10)).toBeCloseTo(100, 6); // 10 mas → 100 pc
    expect(parallaxToDistancePc(2)).toBeCloseTo(500, 6);
    expect(parallaxToDistancePc(1000)).toBeCloseTo(1, 6); // 1 arcsec → 1 pc (definition)
  });

  it('returns null for ϖ ≤ 0 or NaN (never a negative/bogus distance)', () => {
    expect(parallaxToDistancePc(0)).toBeNull();
    expect(parallaxToDistancePc(-3)).toBeNull();
    expect(parallaxToDistancePc(NaN)).toBeNull();
    expect(parallaxToDistancePc(Infinity)).toBeNull();
  });
});

describe('absoluteGMag — M_G = G + 5·log10(ϖ_mas) − 10', () => {
  it('matches a hand-computed value (G=15, ϖ=10 mas → M_G=10)', () => {
    expect(absoluteGMag(15, 10)).toBeCloseTo(10, 10);
  });

  it('G=10 at ϖ=100 mas (10 pc) → M_G=10 (distance modulus 0)', () => {
    expect(absoluteGMag(10, 100)).toBeCloseTo(10, 10);
  });

  it('returns null when G or ϖ is unusable', () => {
    expect(absoluteGMag(15, 0)).toBeNull();
    expect(absoluteGMag(15, -1)).toBeNull();
    expect(absoluteGMag(NaN, 10)).toBeNull();
    expect(absoluteGMag(15, NaN)).toBeNull();
  });
});

describe('pmVectorEndpoint — screen arrow along (pmRA*, pmDec)', () => {
  it('scales the endpoint with pmRA* (east=+x) and pmDec (north=−y)', () => {
    const e = pmVectorEndpoint(100, 100, 4, 3, 2);
    expect(e).not.toBeNull();
    expect(e!.x).toBeCloseTo(100 + 4 * 2, 10); // +x with pmRA*
    expect(e!.y).toBeCloseTo(100 - 3 * 2, 10); // −y with pmDec
  });

  it('doubling both PM components doubles the offset from the origin', () => {
    const a = pmVectorEndpoint(0, 0, 5, -2, 1)!;
    const b = pmVectorEndpoint(0, 0, 10, -4, 1)!;
    expect(b.x).toBeCloseTo(2 * a.x, 10);
    expect(b.y).toBeCloseTo(2 * a.y, 10);
  });

  it('returns null when either PM component is NaN (no arrow, never a garbage one)', () => {
    expect(pmVectorEndpoint(0, 0, NaN, 3, 1)).toBeNull();
    expect(pmVectorEndpoint(0, 0, 3, NaN, 1)).toBeNull();
    expect(pmVectorEndpoint(0, 0, NaN, NaN, 1)).toBeNull();
  });
});

describe('cmdPoints — real plottable points only', () => {
  it('prefers absolute M_G when parallax > 0, falls back to apparent G otherwise', () => {
    const cat = gaiaFixture(
      { bpRp: [1.0, 0.5], gMag: [15, 18], parallax: [10, -1] },
      2
    );
    const pts = cmdPoints(cat);
    expect(pts.length).toBe(2);
    // Source 0: parallax 10 → absolute mag 10.
    expect(pts[0]!.absolute).toBe(true);
    expect(pts[0]!.mag).toBeCloseTo(10, 6);
    // Source 1: parallax negative → apparent G 18.
    expect(pts[1]!.absolute).toBe(false);
    expect(pts[1]!.mag).toBeCloseTo(18, 6);
    expect(pts[1]!.index).toBe(1);
  });

  it('drops sources with no BP−RP colour (needed for the x-axis)', () => {
    const cat = gaiaFixture({ bpRp: [NaN, 1.2], gMag: [15, 16], parallax: [5, 5] }, 2);
    const pts = cmdPoints(cat);
    expect(pts.length).toBe(1);
    expect(pts[0]!.index).toBe(1);
  });

  it('drops a source with colour but NO magnitude at all', () => {
    const cat = gaiaFixture({ bpRp: [1.0], gMag: [NaN], parallax: [NaN] }, 1);
    expect(cmdPoints(cat)).toEqual([]);
  });

  it('an all-NaN catalog yields an empty array (honest empty diagram)', () => {
    const cat = gaiaFixture({}, 5);
    expect(cmdPoints(cat)).toEqual([]);
  });
});
