/**
 * Pure aperture photometry + radial profile (curve-of-growth) on a FITS cutout.
 *
 * This is the maths half of feature 122. A parsed {@link FitsImage} (linear-float
 * physical pixels from `readFits`) plus a click position yield a measured net
 * flux (aperture sum minus a local annulus background) and a radial profile /
 * curve-of-growth. Keeping it PURE (no DOM, no canvas) makes it testable by
 * OUTCOME against synthetic ground truth — a 2D Gaussian of known total flux must
 * produce a monotonic curve-of-growth that approaches that total, and a flat
 * field must net ~0 after background subtraction (see
 * `tests/unit/photometry.test.ts`).
 *
 * ── Conventions ──────────────────────────────────────────────────────────────
 * PIXEL CENTRES: the centre (cx, cy) is given in 1-based FITS pixel coordinates,
 * the SAME convention as `wcs.ts` (px = col+1, py = row+1) and the cursor readout
 * in `CutoutPanel`. The centre of array element `data[row*width + col]` is at FITS
 * coordinate (col+1, row+1); the radius of that pixel from the aperture centre is
 *     r = hypot((col+1) − cx, (row+1) − cy)
 * So a click reported as pixel (col+1, row+1) is passed straight through as
 * (cx, cy) with no off-by-one. Radii (rAper, rInner, rOuter, maxRadius) are in
 * PIXELS.
 *
 * BACKGROUND: the local sky level is the MEDIAN of the finite pixels in the
 * annulus rInner ≤ r ≤ rOuter (median is robust to sources/cosmic rays landing in
 * the annulus). Net flux = apertureSum − backgroundPerPixel · nPixels, where
 * nPixels is the count of FINITE aperture pixels actually summed (so the
 * background is subtracted only for the pixels that contributed signal).
 *
 * NaN / EDGE: NaN pixels (BLANK / no-data) are excluded from BOTH the aperture
 * sum and the annulus. Pixels outside the image simply do not exist (the loop is
 * bounded to the array), so an aperture clipped by the image edge measures fewer
 * pixels — honest, not fabricated.
 *
 * References: Lupton/DS9/photutils aperture conventions; the sep and photutils
 * docs (sum within r_aper, annulus background, curve-of-growth of encircled flux).
 */

import type { FitsImage } from './fits.js';

export interface ApertureOptions {
  /** Aperture radius in PIXELS: pixels with r ≤ rAper are summed. */
  rAper: number;
  /** Inner radius of the background annulus, PIXELS (rInner ≤ r). */
  rInner: number;
  /** Outer radius of the background annulus, PIXELS (r ≤ rOuter). */
  rOuter: number;
}

export interface AperturePhotometryResult {
  /** Sum of finite pixel values with r ≤ rAper (raw, before background). */
  apertureSum: number;
  /** Count of FINITE pixels inside the aperture (excludes NaN / off-image). */
  nPixels: number;
  /** Local sky per pixel: MEDIAN of finite annulus pixels (0 if annulus empty). */
  backgroundPerPixel: number;
  /** apertureSum − backgroundPerPixel · nPixels. */
  netFlux: number;
  /**
   * Rough signal-to-noise: netFlux / (σ_bkg · √nPixels), where σ_bkg is the RMS
   * of the finite annulus pixels about their median. `null` when it cannot be
   * estimated (fewer than 2 annulus pixels, or σ_bkg = 0).
   */
  snr: number | null;
  /** Number of finite pixels used to estimate the background annulus. */
  nBackgroundPixels: number;
}

export interface RadialProfileOptions {
  /** Maximum radius in PIXELS out to which the profile is computed. */
  maxRadius: number;
  /** Number of equal-width radial bins over [0, maxRadius]. */
  nBins: number;
}

export interface RadialProfileResult {
  /** Outer radius (PIXELS) of each bin — bin k covers ((k)·bw, (k+1)·bw]. */
  radius: number[];
  /** Mean of the finite pixel values in each annular bin (NaN if the bin empty). */
  meanFlux: number[];
  /**
   * Curve-of-growth: cumulative sum of finite pixel values with r ≤ radius[k]
   * (raw encircled flux, no background subtraction). Monotonic non-decreasing for
   * non-negative data; approaches the source's total flux as radius grows.
   */
  encircledFlux: number[];
}

/** Median of a finite-number array (sorts a copy). Returns 0 for an empty array. */
function median(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Population standard deviation about `mean` of a finite-number array. */
function rms(values: number[], mean: number): number {
  const n = values.length;
  if (n < 2) return 0;
  let s = 0;
  for (const v of values) {
    const d = v - mean;
    s += d * d;
  }
  return Math.sqrt(s / n);
}

function requireFinite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected a finite number, got ${String(value)}`);
  }
  return value;
}

/**
 * Aperture photometry at (cx, cy) — see the file header for conventions.
 *
 * @param image  Parsed FITS cutout (physical Float64 pixels, NaN for BLANK).
 * @param cx     Aperture centre X, 1-based FITS pixel (col+1).
 * @param cy     Aperture centre Y, 1-based FITS pixel (row+1).
 * @throws if cx/cy or any radius is non-finite, or the radii are not
 *   0 < rAper and rInner < rOuter with rInner ≥ 0.
 */
export function aperturePhotometry(
  image: FitsImage,
  cx: number,
  cy: number,
  opts: ApertureOptions
): AperturePhotometryResult {
  requireFinite(cx, 'cx');
  requireFinite(cy, 'cy');
  const rAper = requireFinite(opts.rAper, 'rAper');
  const rInner = requireFinite(opts.rInner, 'rInner');
  const rOuter = requireFinite(opts.rOuter, 'rOuter');
  if (rAper <= 0) throw new Error(`Invalid rAper: must be > 0, got ${rAper}`);
  if (rInner < 0) throw new Error(`Invalid rInner: must be >= 0, got ${rInner}`);
  if (rOuter <= rInner) {
    throw new Error(`Invalid annulus: rOuter (${rOuter}) must exceed rInner (${rInner})`);
  }

  const { data, width, height } = image;
  const rAperSq = rAper * rAper;
  const rInnerSq = rInner * rInner;
  const rOuterSq = rOuter * rOuter;

  let apertureSum = 0;
  let nPixels = 0;
  const annulusValues: number[] = [];

  // Bound the scan to the annulus's bounding box for speed; still exact.
  const colMin = Math.max(0, Math.floor(cx - 1 - rOuter));
  const colMax = Math.min(width - 1, Math.ceil(cx - 1 + rOuter));
  const rowMin = Math.max(0, Math.floor(cy - 1 - rOuter));
  const rowMax = Math.min(height - 1, Math.ceil(cy - 1 + rOuter));

  for (let row = rowMin; row <= rowMax; row++) {
    const dy = row + 1 - cy; // pixel centre is (col+1, row+1) in FITS coords
    for (let col = colMin; col <= colMax; col++) {
      const dx = col + 1 - cx;
      const rSq = dx * dx + dy * dy;
      const value = data[row * width + col]!;
      if (Number.isNaN(value)) continue; // BLANK / no-data → excluded

      if (rSq <= rAperSq) {
        apertureSum += value;
        nPixels += 1;
      }
      if (rSq >= rInnerSq && rSq <= rOuterSq) {
        annulusValues.push(value);
      }
    }
  }

  const backgroundPerPixel = median(annulusValues);
  const netFlux = apertureSum - backgroundPerPixel * nPixels;

  // Rough SNR from the annulus scatter (background-limited estimate).
  let snr: number | null = null;
  if (annulusValues.length >= 2 && nPixels > 0) {
    const sigmaBkg = rms(annulusValues, backgroundPerPixel);
    if (sigmaBkg > 0) {
      snr = netFlux / (sigmaBkg * Math.sqrt(nPixels));
    }
  }

  return {
    apertureSum,
    nPixels,
    backgroundPerPixel,
    netFlux,
    snr,
    nBackgroundPixels: annulusValues.length,
  };
}

/**
 * Radial profile + curve-of-growth about (cx, cy) — see the file header.
 *
 * @param image  Parsed FITS cutout (physical Float64 pixels, NaN for BLANK).
 * @param cx     Centre X, 1-based FITS pixel (col+1).
 * @param cy     Centre Y, 1-based FITS pixel (row+1).
 * @throws if cx/cy/maxRadius are non-finite, maxRadius ≤ 0, or nBins < 1.
 */
export function radialProfile(
  image: FitsImage,
  cx: number,
  cy: number,
  opts: RadialProfileOptions
): RadialProfileResult {
  requireFinite(cx, 'cx');
  requireFinite(cy, 'cy');
  const maxRadius = requireFinite(opts.maxRadius, 'maxRadius');
  if (maxRadius <= 0) throw new Error(`Invalid maxRadius: must be > 0, got ${maxRadius}`);
  const nBins = Math.floor(opts.nBins);
  if (!Number.isFinite(nBins) || nBins < 1) {
    throw new Error(`Invalid nBins: must be an integer >= 1, got ${opts.nBins}`);
  }

  const { data, width, height } = image;
  const binWidth = maxRadius / nBins;

  const binSum = new Float64Array(nBins);
  const binCount = new Int32Array(nBins);

  const colMin = Math.max(0, Math.floor(cx - 1 - maxRadius));
  const colMax = Math.min(width - 1, Math.ceil(cx - 1 + maxRadius));
  const rowMin = Math.max(0, Math.floor(cy - 1 - maxRadius));
  const rowMax = Math.min(height - 1, Math.ceil(cy - 1 + maxRadius));

  for (let row = rowMin; row <= rowMax; row++) {
    const dy = row + 1 - cy;
    for (let col = colMin; col <= colMax; col++) {
      const dx = col + 1 - cx;
      const r = Math.hypot(dx, dy);
      if (r > maxRadius) continue;
      const value = data[row * width + col]!;
      if (Number.isNaN(value)) continue;
      // Bin index: pixels exactly at r=maxRadius land in the last bin.
      let bin = Math.floor(r / binWidth);
      if (bin >= nBins) bin = nBins - 1;
      binSum[bin]! += value;
      binCount[bin]! += 1;
    }
  }

  const radius: number[] = new Array(nBins);
  const meanFlux: number[] = new Array(nBins);
  const encircledFlux: number[] = new Array(nBins);
  let cumulative = 0;
  for (let k = 0; k < nBins; k++) {
    radius[k] = (k + 1) * binWidth; // outer edge of the bin
    meanFlux[k] = binCount[k]! > 0 ? binSum[k]! / binCount[k]! : NaN;
    cumulative += binSum[k]!;
    encircledFlux[k] = cumulative;
  }

  return { radius, meanFlux, encircledFlux };
}
