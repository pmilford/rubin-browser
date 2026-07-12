/**
 * Adversarial tests for the per-pixel colour-map maths (TODO 160). Each pins an
 * OUTCOME a broken impl (ignore-input / no-mask / no-op blur / min-max-anchored map)
 * would get wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  gaussianPsfMatch,
  perPixelColorIndex,
  colorMapToRgba,
} from '../../src/utils/pixelColorMap.js';

/** Fill a width×height Float64Array via a per-pixel function. */
function grid(w: number, h: number, f: (x: number, y: number) => number): Float64Array {
  const a = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = f(x, y);
  return a;
}

describe('gaussianPsfMatch', () => {
  it('BROADENS a single bright pixel (peak drops, neighbours rise, flux ~conserved)', () => {
    const w = 11, h = 11;
    const img = grid(w, h, (x, y) => (x === 5 && y === 5 ? 100 : 0));
    const out = gaussianPsfMatch(img, w, h, 1.2);
    const peak = out[5 * w + 5]!;
    const neighbour = out[5 * w + 6]!;
    expect(peak).toBeLessThan(100); // spread out
    expect(neighbour).toBeGreaterThan(0); // light moved to neighbours
    const fluxIn = 100;
    const fluxOut = out.reduce((s, v) => s + v, 0);
    expect(fluxOut).toBeGreaterThan(fluxIn * 0.9); // approx conserved
    expect(fluxOut).toBeLessThan(fluxIn * 1.1);
  });

  it('is the identity (a copy) for sigmaAddPx ≤ 0 — a band already at the target PSF', () => {
    const w = 5, h = 5;
    const img = grid(w, h, (x, y) => x + y);
    const out = gaussianPsfMatch(img, w, h, 0);
    expect(Array.from(out)).toEqual(Array.from(img));
    expect(out).not.toBe(img); // a COPY, not the same reference
  });

  it('does not let a NaN gap poison the blur (finite neighbours stay finite)', () => {
    const w = 7, h = 7;
    const img = grid(w, h, (x, y) => (x === 3 && y === 3 ? NaN : 10));
    const out = gaussianPsfMatch(img, w, h, 1);
    // A pixel next to the gap is still finite (gap excluded from the weighted mean).
    expect(Number.isFinite(out[3 * w + 4]!)).toBe(true);
    expect(out[3 * w + 4]!).toBeGreaterThan(5);
  });
});

describe('perPixelColorIndex', () => {
  it('a FLAT constant-ratio field gives every valid pixel the SAME colour', () => {
    const w = 8, h = 8;
    const blue = grid(w, h, () => 40);
    const red = grid(w, h, () => 20); // ratio 2 everywhere
    const { color, mask } = perPixelColorIndex(blue, red, w, h, { blueSigma: 1, redSigma: 1, snrFloor: 3 });
    const vals = [...color].filter((v, i) => mask[i] === 1);
    expect(vals.length).toBeGreaterThan(0);
    const expected = -2.5 * Math.log10(2);
    for (const v of vals) expect(v).toBeCloseTo(expected, 10);
  });

  it('a BLUE half and a RED half get OPPOSITE-sign colour indices', () => {
    const w = 8, h = 8;
    // Left half: blue-bright (blue>red → negative index). Right half: red-bright (positive).
    const blue = grid(w, h, (x) => (x < 4 ? 80 : 20));
    const red = grid(w, h, (x) => (x < 4 ? 20 : 80));
    const { color, mask } = perPixelColorIndex(blue, red, w, h, { blueSigma: 1, redSigma: 1, snrFloor: 3 });
    const left = color[4 * w + 1]!; // in the blue half
    const right = color[4 * w + 6]!; // in the red half
    expect(mask[4 * w + 1]).toBe(1);
    expect(mask[4 * w + 6]).toBe(1);
    expect(left).toBeLessThan(0); // bluer → negative
    expect(right).toBeGreaterThan(0); // redder → positive
    expect(Math.sign(left)).not.toBe(Math.sign(right));
  });

  it('MASKS dark/low-S/N and SATURATED pixels (no fake colour from noise or clipped cores)', () => {
    const w = 6, h = 6;
    // Most pixels bright; one dark (low S/N), one saturated.
    const blue = grid(w, h, (x, y) => (x === 0 && y === 0 ? 0.5 : x === 5 && y === 5 ? 1000 : 50));
    const red = grid(w, h, (x, y) => (x === 0 && y === 0 ? 0.5 : x === 5 && y === 5 ? 1000 : 25));
    const { mask } = perPixelColorIndex(blue, red, w, h, { blueSigma: 1, redSigma: 1, snrFloor: 3, satLevel: 900 });
    expect(mask[0]).toBe(0); // dark corner → below S/N → masked
    expect(mask[5 * w + 5]).toBe(0); // saturated corner → masked
    expect(mask[3 * w + 3]).toBe(1); // a normal bright pixel → valid
  });

  it('masks a non-positive / non-finite flux pixel (log undefined)', () => {
    const w = 4, h = 4;
    const blue = grid(w, h, (x, y) => (x === 1 && y === 1 ? -3 : 50));
    const red = grid(w, h, (x, y) => (x === 2 && y === 2 ? NaN : 25));
    const { mask } = perPixelColorIndex(blue, red, w, h, { blueSigma: 1, redSigma: 1, snrFloor: 1 });
    expect(mask[1 * w + 1]).toBe(0); // negative blue
    expect(mask[2 * w + 2]).toBe(0); // NaN red
  });
});

describe('colorMapToRgba', () => {
  it('centres the diverging map on the MEDIAN colour (median pixel → neutral centre)', () => {
    const w = 3, h = 1;
    // colours −1, 0, +1 → median 0 → the middle pixel should be ~neutral (white-ish),
    // the ends blue / red. A min/max-anchored map would put the median off-centre.
    const color = Float64Array.from([-1, 0, 1]);
    const mask = Uint8Array.from([1, 1, 1]);
    const rgba = colorMapToRgba(color, mask, w, h);
    const px = (i: number): [number, number, number] => [rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!];
    const [mr, mg, mb] = px(1);
    // near-neutral: R≈G≈B and high
    expect(Math.abs(mr - mg)).toBeLessThan(20);
    expect(Math.abs(mg - mb)).toBeLessThan(20);
    expect(mg).toBeGreaterThan(200);
    // ends: left bluer (B>R), right redder (R>B)
    const [lr, , lb] = px(0);
    const [rr, , rb] = px(2);
    expect(lb).toBeGreaterThan(lr);
    expect(rr).toBeGreaterThan(rb);
  });

  it('renders masked pixels fully TRANSPARENT (alpha 0), valid pixels opaque', () => {
    const w = 3, h = 1;
    const color = Float64Array.from([-1, NaN, 1]);
    const mask = Uint8Array.from([1, 0, 1]);
    const rgba = colorMapToRgba(color, mask, w, h);
    expect(rgba[1 * 4 + 3]).toBe(0); // masked → transparent
    expect(rgba[0 * 4 + 3]).toBe(255); // valid → opaque
    expect(rgba[2 * 4 + 3]).toBe(255);
  });

  it('all-masked input → a fully transparent overlay (never a fabricated colour)', () => {
    const rgba = colorMapToRgba(Float64Array.from([NaN, NaN]), Uint8Array.from([0, 0]), 2, 1);
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBe(0);
  });

  it('alphaBySnr fades low-S/N pixels below high-S/N pixels', () => {
    const w = 2, h = 1;
    const color = Float64Array.from([0.5, 0.5]);
    const mask = Uint8Array.from([1, 1]);
    const snr = Float64Array.from([3, 20]); // one just-valid, one strong
    const rgba = colorMapToRgba(color, mask, w, h, { alphaBySnr: true, snr, snrFloor: 3, snrFull: 10 });
    expect(rgba[0 * 4 + 3]!).toBeLessThan(rgba[1 * 4 + 3]!);
    expect(rgba[1 * 4 + 3]).toBe(255);
  });
});
