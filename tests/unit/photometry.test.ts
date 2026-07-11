import { describe, it, expect } from 'vitest';
import { aperturePhotometry, radialProfile } from '../../src/utils/photometry.js';
import type { FitsImage, FitsHeader } from '../../src/utils/fits.js';

/**
 * OUTCOME tests for aperture photometry + curve-of-growth (per CLAUDE.md's
 * adversarial rule), against SYNTHETIC GROUND TRUTH:
 *   - a 2D Gaussian PSF of KNOWN total flux (A·2π·σ²) → the curve-of-growth is
 *     monotonic non-decreasing and its encircled flux approaches that known total
 *     (a wrong-area impl, or one that forgets pixel-by-pixel accumulation, fails);
 *   - a FLAT field → aperture NET flux ≈ 0 after annulus background subtraction
 *     (a background-sign or no-background impl fails: raw sum is huge);
 *   - NaN pixels are excluded from both the aperture and the annulus.
 */

function header(width: number, height: number): FitsHeader {
  return {
    simple: true,
    bitpix: -64,
    naxis: 2,
    naxis1: width,
    naxis2: height,
    bscale: 1,
    bzero: 0,
    cards: {},
  };
}

function makeImage(width: number, height: number, fill: (col: number, row: number) => number): FitsImage {
  const data = new Float64Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      data[row * width + col] = fill(col, row);
    }
  }
  return { header: header(width, height), width, height, data };
}

/**
 * A centred 2D Gaussian on an N×N grid. Analytic total flux (over the whole
 * plane, pixel area 1) = amplitude · 2π · sigma². Centre at FITS (cx, cy).
 */
function gaussianImage(n: number, amplitude: number, sigma: number) {
  const cx = (n + 1) / 2; // 1-based FITS centre
  const cy = (n + 1) / 2;
  const image = makeImage(n, n, (col, row) => {
    const dx = col + 1 - cx;
    const dy = row + 1 - cy;
    return amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  });
  const totalFlux = amplitude * 2 * Math.PI * sigma * sigma;
  return { image, cx, cy, totalFlux };
}

describe('radialProfile — Gaussian curve-of-growth (kills wrong-area / non-accumulating impl)', () => {
  const { image, cx, cy, totalFlux } = gaussianImage(81, 100, 5);

  it('encircled flux is monotonic non-decreasing', () => {
    const { encircledFlux } = radialProfile(image, cx, cy, { maxRadius: 30, nBins: 30 });
    for (let k = 1; k < encircledFlux.length; k++) {
      expect(encircledFlux[k]!).toBeGreaterThanOrEqual(encircledFlux[k - 1]!);
    }
  });

  it('encircled flux approaches the KNOWN analytic total as radius grows', () => {
    const { encircledFlux, radius } = radialProfile(image, cx, cy, { maxRadius: 30, nBins: 30 });
    const last = encircledFlux[encircledFlux.length - 1]!;
    // maxRadius = 30 = 6σ encloses > 99.9% of the Gaussian; expect within 2%.
    expect(radius[radius.length - 1]).toBeCloseTo(30, 6);
    expect(last).toBeGreaterThan(totalFlux * 0.98);
    expect(last).toBeLessThan(totalFlux * 1.02);
  });

  it('the mean radial flux DECREASES outward for a peaked source (kills a flat/constant profile)', () => {
    const { meanFlux } = radialProfile(image, cx, cy, { maxRadius: 20, nBins: 20 });
    // Innermost annulus is far brighter than an outer one.
    expect(meanFlux[0]!).toBeGreaterThan(meanFlux[10]!);
  });
});

describe('aperturePhotometry — Gaussian net flux recovers most of the source', () => {
  const { image, cx, cy, totalFlux } = gaussianImage(81, 100, 5);

  it('net flux in a 4σ aperture on a zero background ≈ total flux', () => {
    const res = aperturePhotometry(image, cx, cy, { rAper: 20, rInner: 25, rOuter: 35 });
    // Background annulus is essentially zero here, so net ≈ aperture sum ≈ total.
    expect(res.backgroundPerPixel).toBeCloseTo(0, 3);
    expect(res.netFlux).toBeGreaterThan(totalFlux * 0.98);
    expect(res.netFlux).toBeLessThan(totalFlux * 1.02);
    expect(res.nPixels).toBeGreaterThan(0);
  });
});

describe('aperturePhotometry — flat field nets ~0 after background subtraction', () => {
  it('a constant field has aperture net flux ≈ 0 (kills a no-background / sign-error impl)', () => {
    const level = 42;
    const image = makeImage(64, 64, () => level);
    const res = aperturePhotometry(image, 32, 32, { rAper: 8, rInner: 10, rOuter: 15 });
    // Raw aperture sum is large (level × nPixels); the honest NET must cancel.
    expect(res.apertureSum).toBeGreaterThan(level * 100);
    expect(res.backgroundPerPixel).toBeCloseTo(level, 6);
    expect(Math.abs(res.netFlux)).toBeLessThan(1e-6);
  });
});

describe('aperturePhotometry — a real source over a nonzero background', () => {
  it('subtracts a constant sky pedestal and recovers the added source flux', () => {
    const sky = 10;
    const { image, cx, cy, totalFlux } = (() => {
      const g = gaussianImage(81, 100, 5);
      // Add a constant sky pedestal to every pixel.
      for (let i = 0; i < g.image.data.length; i++) g.image.data[i]! += sky;
      return g;
    })();
    const res = aperturePhotometry(image, cx, cy, { rAper: 20, rInner: 25, rOuter: 35 });
    expect(res.backgroundPerPixel).toBeCloseTo(sky, 3);
    // Net flux removes the sky·nPixels pedestal, leaving ~the source total.
    expect(res.netFlux).toBeGreaterThan(totalFlux * 0.98);
    expect(res.netFlux).toBeLessThan(totalFlux * 1.02);
  });
});

describe('aperturePhotometry / radialProfile — NaN + edge handling', () => {
  it('excludes NaN pixels from the aperture sum and pixel count', () => {
    // 5×5 flat field of 4, but the centre pixel is NaN (BLANK).
    const image = makeImage(5, 5, () => 4);
    image.data[2 * 5 + 2] = NaN; // centre
    const res = aperturePhotometry(image, 3, 3, { rAper: 1.0, rInner: 2, rOuter: 3 });
    // Aperture r<=1.0 around centre covers 5 pixels (centre + 4 edge neighbours;
    // the 4 diagonals at r=1.414 are excluded) minus the NaN centre → 4 finite.
    expect(res.nPixels).toBe(4);
    expect(res.apertureSum).toBe(16); // 4 pixels × 4, NaN excluded (not NaN-poisoned)
    expect(Number.isNaN(res.apertureSum)).toBe(false);
  });

  it('excludes NaN pixels from the radial profile bins', () => {
    const image = makeImage(5, 5, () => 4);
    image.data[0] = NaN;
    const { encircledFlux } = radialProfile(image, 3, 3, { maxRadius: 3, nBins: 3 });
    // No bin value is NaN-poisoned.
    for (const v of encircledFlux) expect(Number.isNaN(v)).toBe(false);
  });

  it('measures fewer pixels when the aperture is clipped by the image edge (no fabrication)', () => {
    const image = makeImage(9, 9, () => 1);
    const centre = aperturePhotometry(image, 5, 5, { rAper: 3, rInner: 4, rOuter: 4.5 });
    const corner = aperturePhotometry(image, 1, 1, { rAper: 3, rInner: 4, rOuter: 4.5 });
    expect(corner.nPixels).toBeLessThan(centre.nPixels);
  });
});

describe('photometry — input validation', () => {
  const image = makeImage(8, 8, () => 1);
  it('throws on a degenerate annulus (rOuter <= rInner)', () => {
    expect(() => aperturePhotometry(image, 4, 4, { rAper: 2, rInner: 5, rOuter: 5 })).toThrow(/annulus/);
  });
  it('throws on non-positive rAper', () => {
    expect(() => aperturePhotometry(image, 4, 4, { rAper: 0, rInner: 3, rOuter: 5 })).toThrow(/rAper/);
  });
  it('throws on nBins < 1', () => {
    expect(() => radialProfile(image, 4, 4, { maxRadius: 3, nBins: 0 })).toThrow(/nBins/);
  });
  it('throws on a non-finite centre or radius', () => {
    expect(() => aperturePhotometry(image, NaN, 4, { rAper: 2, rInner: 3, rOuter: 5 })).toThrow(/cx/);
    expect(() => aperturePhotometry(image, 4, 4, { rAper: 2, rInner: -1, rOuter: 5 })).toThrow(/rInner/);
    expect(() => radialProfile(image, 4, 4, { maxRadius: 0, nBins: 4 })).toThrow(/maxRadius/);
  });
  it('reports snr = null when the annulus is degenerate (all-equal, zero scatter)', () => {
    // A flat field → annulus RMS is 0 → SNR cannot be estimated → null (honest).
    const res = aperturePhotometry(image, 4, 4, { rAper: 1, rInner: 2, rOuter: 3 });
    expect(res.snr).toBeNull();
  });
});
