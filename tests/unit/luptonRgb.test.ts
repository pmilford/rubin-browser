import { describe, it, expect } from 'vitest';
import { luptonRgb, LUPTON_NAN_ALPHA, LUPTON_OPAQUE_ALPHA } from '../../src/utils/luptonRgb.js';

/**
 * OUTCOME tests for the Lupton asinh RGB compositor (per CLAUDE.md's adversarial
 * rule). Each assertion names the broken implementation it kills:
 *   - a GRAYSCALE impl (r==g==b regardless of input) fails channel-dominance;
 *   - a CHANNEL-SWAPPED impl (feeds r-input into the green byte) fails dominance;
 *   - an impl that ignores NaN fails the transparency check;
 *   - a NON-MONOTONIC / constant stretch impl fails the Q/stretch checks.
 * Ground truth is derived from the verified astropy `make_lupton_rgb` algorithm
 * documented in src/utils/luptonRgb.ts, not from the code under test.
 */

const W = 2;
const H = 2;
const N = W * H;

/** RGBA channel reader for pixel index i. */
function px(rgba: Uint8ClampedArray, i: number) {
  return { r: rgba[i * 4]!, g: rgba[i * 4 + 1]!, b: rgba[i * 4 + 2]!, a: rgba[i * 4 + 3]! };
}

/** A flat band filled with one value. */
function flat(value: number): Float64Array {
  return Float64Array.from({ length: N }, () => value);
}

describe('luptonRgb — channel dominance (kills grayscale / channel-swap)', () => {
  it('a pixel bright only in the R input comes out red-dominant', () => {
    // Pixel 0 is bright in R, faint in G/B. Other pixels faint everywhere.
    const r = Float64Array.from([100, 1, 1, 1]);
    const g = Float64Array.from([1, 1, 1, 1]);
    const b = Float64Array.from([1, 1, 1, 1]);
    const rgba = luptonRgb(r, g, b, W, H, { Q: 8, stretch: 5 });
    const p = px(rgba, 0);
    expect(p.r).toBeGreaterThan(p.g);
    expect(p.r).toBeGreaterThan(p.b);
    // Grayscale would give r==g==b; assert a real colour gap.
    expect(p.r - p.g).toBeGreaterThan(20);
  });

  it('a pixel bright only in the B input comes out blue-dominant (not red)', () => {
    const r = Float64Array.from([1, 1, 1, 1]);
    const g = Float64Array.from([1, 1, 1, 1]);
    const b = Float64Array.from([100, 1, 1, 1]);
    const rgba = luptonRgb(r, g, b, W, H, { Q: 8, stretch: 5 });
    const p = px(rgba, 0);
    expect(p.b).toBeGreaterThan(p.r);
    expect(p.b).toBeGreaterThan(p.g);
  });

  it('swapping which band feeds R vs B swaps the output hue (kills a fixed mapping)', () => {
    const bright = Float64Array.from([100, 1, 1, 1]);
    const faint = Float64Array.from([1, 1, 1, 1]);
    const asR = luptonRgb(bright, faint, faint, W, H, { Q: 8, stretch: 5 });
    const asB = luptonRgb(faint, faint, bright, W, H, { Q: 8, stretch: 5 });
    expect(px(asR, 0).r).toBeGreaterThan(px(asR, 0).b);
    expect(px(asB, 0).b).toBeGreaterThan(px(asB, 0).r);
  });
});

describe('luptonRgb — neutral gray (equal channels)', () => {
  it('r == g == b everywhere yields a neutral (r==g==b) output pixel', () => {
    const v = flat(50);
    const rgba = luptonRgb(v, flat(50), flat(50), W, H, { Q: 8, stretch: 5 });
    const p = px(rgba, 0);
    expect(p.r).toBe(p.g);
    expect(p.g).toBe(p.b);
    // And it is not degenerate black — a real mid grey with a positive value.
    expect(p.r).toBeGreaterThan(0);
  });
});

describe('luptonRgb — NaN handling (kills a renderer that treats NaN as 0)', () => {
  it('a pixel NaN in ANY band is fully transparent; all-finite pixels are opaque', () => {
    const r = Float64Array.from([NaN, 10, 10, 10]);
    const g = Float64Array.from([10, NaN, 10, 10]);
    const b = Float64Array.from([10, 10, NaN, 10]);
    const rgba = luptonRgb(r, g, b, W, H, { Q: 8, stretch: 5 });
    expect(px(rgba, 0).a).toBe(LUPTON_NAN_ALPHA); // NaN in R
    expect(px(rgba, 1).a).toBe(LUPTON_NAN_ALPHA); // NaN in G
    expect(px(rgba, 2).a).toBe(LUPTON_NAN_ALPHA); // NaN in B
    expect(px(rgba, 3).a).toBe(LUPTON_OPAQUE_ALPHA); // all finite
    expect(LUPTON_NAN_ALPHA).toBe(0);
  });
});

describe('luptonRgb — Q/stretch monotonicity (kills a constant stretch)', () => {
  // A single faint, neutral pixel; measure its output luminance vs parameters.
  // Value 1 with stretch 20 keeps it below the Q brightening threshold
  // (v < 0.1·stretch = 2), where the asinh compression boosts the faint end.
  const faint = () => ({ r: flat(1), g: flat(1), b: flat(1) });

  it('LOWERING stretch brightens a faint pixel (asinh(I·Q/stretch) sense)', () => {
    const { r, g, b } = faint();
    const dim = luptonRgb(r, g, b, W, H, { Q: 8, stretch: 20 });
    const bright = luptonRgb(r, g, b, W, H, { Q: 8, stretch: 2 });
    // Lower stretch → larger asinh argument → brighter faint pixel.
    expect(px(bright, 0).r).toBeGreaterThan(px(dim, 0).r);
  });

  it('raising Q brightens a faint (sub-saturation) pixel', () => {
    const { r, g, b } = faint();
    const lowQ = luptonRgb(r, g, b, W, H, { Q: 1, stretch: 20 });
    const highQ = luptonRgb(r, g, b, W, H, { Q: 20, stretch: 20 });
    expect(px(highQ, 0).r).toBeGreaterThan(px(lowQ, 0).r);
  });
});

describe('luptonRgb — minimum (black point) subtraction', () => {
  it('raising minimum darkens the output (subtracts before the stretch)', () => {
    const v = flat(30);
    const noSub = luptonRgb(v, flat(30), flat(30), W, H, { Q: 8, stretch: 5, minimum: 0 });
    const withSub = luptonRgb(v, flat(30), flat(30), W, H, { Q: 8, stretch: 5, minimum: 25 });
    expect(px(withSub, 0).r).toBeLessThan(px(noSub, 0).r);
  });

  it('a pixel at or below minimum maps to opaque black (I<=0 guard, no NaN)', () => {
    const v = flat(5);
    const rgba = luptonRgb(v, flat(5), flat(5), W, H, { Q: 8, stretch: 5, minimum: 5 });
    const p = px(rgba, 0);
    expect(p.r).toBe(0);
    expect(p.g).toBe(0);
    expect(p.b).toBe(0);
    expect(p.a).toBe(LUPTON_OPAQUE_ALPHA); // black data, not "no data"
  });
});

describe('luptonRgb — shape + validation', () => {
  it('produces width*height*4 RGBA bytes', () => {
    const rgba = luptonRgb(flat(1), flat(1), flat(1), W, H, { Q: 8, stretch: 5 });
    expect(rgba.length).toBe(N * 4);
  });

  it('throws when the bands differ in size (cannot combine — fail honestly)', () => {
    const r = Float64Array.from([1, 2, 3, 4]);
    const g = Float64Array.from([1, 2, 3]); // wrong length
    const b = Float64Array.from([1, 2, 3, 4]);
    expect(() => luptonRgb(r, g, b, W, H, { Q: 8, stretch: 5 })).toThrow(/differ in size|must be/);
  });

  it('throws on non-positive Q or stretch', () => {
    const v = flat(1);
    expect(() => luptonRgb(v, v, v, W, H, { Q: 0, stretch: 5 })).toThrow(/Q/);
    expect(() => luptonRgb(v, v, v, W, H, { Q: 8, stretch: -1 })).toThrow(/stretch/);
    expect(() => luptonRgb(v, v, v, W, H, { Q: NaN, stretch: 5 })).toThrow(/Q/);
  });

  it('throws on invalid (non-integer / non-positive) dimensions', () => {
    const v = flat(1);
    expect(() => luptonRgb(v, v, v, 0, 4, { Q: 8, stretch: 5 })).toThrow(/dimensions/);
    expect(() => luptonRgb(v, v, v, 2.5, 4, { Q: 8, stretch: 5 })).toThrow(/dimensions/);
  });
});
