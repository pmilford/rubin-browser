import { describe, it, expect } from 'vitest';
import { renderCutout, CUTOUT_NAN_ALPHA } from '../../src/utils/cutoutRender.js';
import type { FitsImage, FitsHeader } from '../../src/utils/fits.js';

/**
 * OUTCOME tests for the cutout renderer (per CLAUDE.md's adversarial rule): we
 * feed a synthetic FitsImage with KNOWN structure and assert the RGBA reflects
 * it — a bright pixel is brighter than a faint one, a BLANK pixel is transparent,
 * inverting darkens the bright pixel. Each assertion names the broken renderer
 * it kills. A constant/placeholder renderer (returns the same colour everywhere)
 * fails the brightness ordering; a renderer that ignores BLANK fails the alpha
 * check; a no-op invert fails the inversion check.
 */

/** Minimal header — cutoutRender only reads `width`/`height`/`data`. */
function header(): FitsHeader {
  return {
    simple: true,
    bitpix: -32,
    naxis: 2,
    naxis1: 4,
    naxis2: 4,
    bscale: 1,
    bzero: 0,
    cards: {},
  };
}

/** Build a 4x4 FitsImage from a row-major value array. */
function image(values: number[]): FitsImage {
  return { header: header(), width: 4, height: 4, data: Float64Array.from(values) };
}

/** Grayscale luminance of pixel `i` (r==g==b for grayscale). */
function lum(rgba: Uint8ClampedArray, i: number): number {
  return rgba[i * 4]!;
}
function alpha(rgba: Uint8ClampedArray, i: number): number {
  return rgba[i * 4 + 3]!;
}

describe('renderCutout — brightness ordering (kills a constant/placeholder renderer)', () => {
  // Distinct gradient values so the percentile clip yields a NON-degenerate
  // range (min<max); pixel 5 is a bright spike.
  const values = [0, 1, 2, 3, 4, 1000, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const BRIGHT = 5;
  const FAINT = 0;

  it('maps a bright pixel to a strictly higher luminance than a faint pixel', () => {
    const { rgba } = renderCutout(image(values), { scale: 'linear', colormap: 'grayscale' });
    expect(lum(rgba, BRIGHT)).toBeGreaterThan(lum(rgba, FAINT));
    // The bright spike saturates the high end of the stretch.
    expect(lum(rgba, BRIGHT)).toBe(255);
  });

  it('inverting darkens the bright pixel below its non-inverted luminance (kills a no-op invert)', () => {
    const normal = renderCutout(image(values), { scale: 'linear', colormap: 'grayscale' });
    const inverted = renderCutout(image(values), { scale: 'linear', colormap: 'grayscale', invert: true });
    expect(lum(inverted.rgba, BRIGHT)).toBeLessThan(lum(normal.rgba, BRIGHT));
    // The (previously black) faintest pixel becomes bright when inverted.
    expect(lum(inverted.rgba, FAINT)).toBeGreaterThan(lum(normal.rgba, FAINT));
  });
});

describe('renderCutout — BLANK/NaN handling (kills a renderer that treats NaN as 0)', () => {
  it('writes the documented transparent alpha for NaN pixels, opaque for real ones', () => {
    const values = [1, 2, 3, 4, 5, NaN, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const NAN_IDX = 5;
    const { rgba } = renderCutout(image(values), { scale: 'linear', colormap: 'viridis' });
    expect(alpha(rgba, NAN_IDX)).toBe(CUTOUT_NAN_ALPHA);
    expect(CUTOUT_NAN_ALPHA).toBe(0); // documented sentinel
    // A real pixel stays fully opaque.
    expect(alpha(rgba, 0)).toBe(255);
  });
});

describe('renderCutout — shape + bounds', () => {
  it('produces width*height*4 RGBA bytes', () => {
    const values = Array.from({ length: 16 }, (_, i) => i);
    const { rgba, width, height } = renderCutout(image(values), { scale: 'sqrt', colormap: 'inferno' });
    expect(width).toBe(4);
    expect(height).toBe(4);
    expect(rgba.length).toBe(4 * 4 * 4);
  });

  it('honours explicit min/max over the percentile clip', () => {
    const values = Array.from({ length: 16 }, () => 5); // flat field
    // Flat data has a degenerate percentile range; explicit bounds place 5 at mid.
    const { rgba, min, max } = renderCutout(image(values), {
      scale: 'linear',
      colormap: 'grayscale',
      min: 0,
      max: 10,
    });
    expect(min).toBe(0);
    expect(max).toBe(10);
    // 5 normalises to 0.5 → ~128 grey (NOT 0 or 255).
    expect(lum(rgba, 0)).toBeGreaterThan(100);
    expect(lum(rgba, 0)).toBeLessThan(160);
  });

  it('returns NaN bounds for an all-NaN image (honest "no finite data", not silent zeros)', () => {
    const values = Array.from({ length: 16 }, () => NaN);
    const { rgba, min, max } = renderCutout(image(values), { scale: 'linear', colormap: 'grayscale' });
    expect(Number.isNaN(min)).toBe(true);
    expect(Number.isNaN(max)).toBe(true);
    // Every pixel is transparent (no data anywhere).
    for (let i = 0; i < 16; i++) expect(alpha(rgba, i)).toBe(CUTOUT_NAN_ALPHA);
  });
});
