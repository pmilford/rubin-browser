import type { ScalingParams, ScalingResult } from '../types/image.js';

/** Number of bins for histogram equalization */
const HISTOGRAM_BINS = 65536;

/** Maximum sample size for zscale fitting */
const ZSCALE_MAX_SAMPLES = 10000;

/** Default zscale contrast parameter */
const ZSCALE_DEFAULT_CONTRAST = 0.25;

/** Default value for pixels with NaN or Infinity */
const SANITIZED_VALUE = 0;

/** Default log base for log scaling */
const DEFAULT_LOG_BASE = 1000;

/** Default softening parameter for asinh */
const DEFAULT_ASINH_SOFTENING = 0.1;

/** Default Q parameter for sinh */
const DEFAULT_SINH_Q = 3;

/** Max iterations for zscale iterative rejection */
const ZSCALE_MAX_ITERATIONS = 5;

/** Sigma threshold for zscale rejection */
const ZSCALE_REJECT_SIGMA = 2.5;

function sanitize(value: number): number {
  return Number.isFinite(value) ? value : SANITIZED_VALUE;
}

function sanitizeArray(pixels: Float64Array): Float64Array {
  const result = new Float64Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    result[i] = sanitize(pixels[i]);
  }
  return result;
}

/** Normalize value to [0,1] given min/max, clamped */
function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// --- Per-pixel scaling functions ---
// All take (value, min, max) and return [0,1].
// Internally: normalize to [0,1], then apply stretch.

export function linearScale(value: number, min: number, max: number): number {
  return normalize(value, min, max);
}

/**
 * Log scaling: y = log(1 + x * (base - 1)) / log(base)
 * where x is normalized [0,1], base defaults to 1000.
 */
export function logScale(value: number, min: number, max: number, base: number = DEFAULT_LOG_BASE): number {
  if (max <= min) return 0;
  const x = normalize(value, min, max);
  if (x <= 0) return 0;
  const result = Math.log(1 + x * (base - 1)) / Math.log(base);
  return Math.max(0, Math.min(1, result));
}

export function sqrtScale(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const x = normalize(value, min, max);
  if (x <= 0) return 0;
  return Math.max(0, Math.min(1, Math.sqrt(x)));
}

/**
 * Asinh scaling (Astropy formulation): y = asinh(x/a) / asinh(1/a)
 * where x is normalized [0,1], a is softening parameter (default 0.1).
 * Smaller a = more aggressive nonlinear stretch.
 */
export function asinhScale(value: number, min: number, max: number, softening: number = DEFAULT_ASINH_SOFTENING): number {
  if (max <= min) return 0;
  const x = normalize(value, min, max);
  if (x <= 0) return 0;
  const divisor = Math.asinh(1 / softening);
  if (divisor === 0) return x;
  const result = Math.asinh(x / softening) / divisor;
  return Math.max(0, Math.min(1, result));
}

/**
 * Sinh scaling: y = sinh(x * Q) / sinh(Q)
 * Compresses faint structure, keeps bright regions linear.
 */
export function sinhScale(value: number, min: number, max: number, q: number = DEFAULT_SINH_Q): number {
  if (max <= min) return 0;
  const x = normalize(value, min, max);
  if (x <= 0) return 0;
  const divisor = Math.sinh(q);
  if (divisor === 0) return x;
  const result = Math.sinh(x * q) / divisor;
  return Math.max(0, Math.min(1, result));
}

/**
 * Midtone Transfer Function (Siril):
 * MTF(x) = (m - 1) * x / ((2m - 1) * x - m)
 * where m is midtone balance (0-1). m=0.5 is identity.
 */
export function mtfScale(value: number, min: number, max: number, midtone: number = 0.5): number {
  if (max <= min) return 0;
  const x = normalize(value, min, max);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Clamp midtone away from exact 0 and 1 to avoid division issues
  const m = Math.max(0.001, Math.min(0.999, midtone));
  if (Math.abs(m - 0.5) < 0.001) return x; // identity
  const denom = (2 * m - 1) * x - m;
  if (denom === 0) return 0.5;
  const result = ((m - 1) * x) / denom;
  return Math.max(0, Math.min(1, result));
}

export function histogramEqualize(pixels: Float64Array): Float64Array {
  if (pixels.length === 0) return new Float64Array(0);

  const clean = sanitizeArray(pixels);

  // Use 1st-99th percentile range to avoid outliers skewing the histogram
  const sorted = Array.from(clean).sort((a, b) => a - b);
  const n = sorted.length;
  const p1 = sorted[Math.floor(n * 0.01)] ?? 0;
  const p99 = sorted[Math.floor(n * 0.99)] ?? 1;

  if (p99 <= p1) {
    const result = new Float64Array(pixels.length);
    result.fill(0.5);
    return result;
  }

  const histogram = new Uint32Array(HISTOGRAM_BINS);
  const range = p99 - p1;

  for (let i = 0; i < clean.length; i++) {
    if (clean[i]! >= p1 && clean[i]! <= p99) {
      const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(((clean[i]! - p1) / range) * (HISTOGRAM_BINS - 1)));
      histogram[bin]++;
    }
  }

  // Build cumulative histogram
  const cumulative = new Float64Array(HISTOGRAM_BINS);
  cumulative[0] = histogram[0]!;
  for (let i = 1; i < HISTOGRAM_BINS; i++) {
    cumulative[i] = cumulative[i - 1]! + histogram[i]!;
  }

  const total = cumulative[HISTOGRAM_BINS - 1]!;
  if (total === 0) {
    const result = new Float64Array(pixels.length);
    result.fill(0.5);
    return result;
  }

  const result = new Float64Array(pixels.length);
  for (let i = 0; i < clean.length; i++) {
    if (clean[i]! <= p1) {
      result[i] = 0;
    } else if (clean[i]! >= p99) {
      result[i] = 1;
    } else {
      const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(((clean[i]! - p1) / range) * (HISTOGRAM_BINS - 1)));
      result[i] = cumulative[bin]! / total;
    }
  }

  return result;
}

/**
 * ZScale range computation with IRAF-style iterative sigma rejection.
 *
 * Algorithm:
 * 1. Sample pixels, sort by brightness
 * 2. Fit line I(i) = intercept + slope * (i - midpoint) with iterative rejection
 * 3. Reject points > ZSCALE_REJECT_SIGMA * sigma from fit, re-fit
 * 4. If >50% rejected, use full range
 * 5. z1 = median + (slope/contrast) * (1 - midpoint)
 *    z2 = median + (slope/contrast) * (npoints - midpoint)
 */
export function zscaleRange(pixels: Float64Array, contrast: number = ZSCALE_DEFAULT_CONTRAST): { min: number; max: number } {
  if (pixels.length === 0) return { min: 0, max: 0 };

  const clean = sanitizeArray(pixels);

  // Filter out zero/black pixels for astronomical images
  const nonZero: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i]! > 0) nonZero.push(clean[i]!);
  }

  if (nonZero.length === 0) return { min: 0, max: 0 };
  if (nonZero.length === 1) return { min: nonZero[0]!, max: nonZero[0]! };

  // Sample pixels if array is large
  let sample: number[];
  if (nonZero.length <= ZSCALE_MAX_SAMPLES) {
    sample = nonZero;
  } else {
    sample = [];
    const step = nonZero.length / ZSCALE_MAX_SAMPLES;
    for (let i = 0; i < ZSCALE_MAX_SAMPLES; i++) {
      sample.push(nonZero[Math.floor(i * step)]!);
    }
  }

  sample.sort((a, b) => a - b);
  const n = sample.length;

  if (n === 0) return { min: 0, max: 0 };
  if (n === 1) return { min: sample[0]!, max: sample[0]! };

  const midpoint = Math.floor(n / 2);
  const median = sample[midpoint]!;

  // Need at least 3 points for a meaningful fit
  if (n < 3) {
    return { min: sample[0]!, max: sample[n - 1]! };
  }

  // Iterative linear fit with sigma rejection
  // Fit: I(i) = intercept + slope * (i - midpoint)
  // where I(i) is the sorted pixel value at rank i
  let mask = new Uint8Array(n);
  mask.fill(1); // 1 = included

  let slope = 0;
  let intercept = median;

  for (let iter = 0; iter < ZSCALE_MAX_ITERATIONS; iter++) {
    // Fit line to unmasked points
    let sumW = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;

    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const x = i - midpoint;
      const y = sample[i]!;
      sumW++;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
    }

    if (sumW < 2) break;

    const meanX = sumX / sumW;
    const meanY = sumY / sumW;
    const denom = sumXX - sumW * meanX * meanX;

    if (Math.abs(denom) < 1e-30) {
      slope = 0;
      intercept = meanY;
    } else {
      slope = (sumXY - sumW * meanX * meanY) / denom;
      intercept = meanY - slope * meanX;
    }

    // Compute residuals and sigma
    let sumResidSq = 0;
    let countResid = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const x = i - midpoint;
      const predicted = intercept + slope * x;
      const resid = sample[i]! - predicted;
      sumResidSq += resid * resid;
      countResid++;
    }

    if (countResid < 2) break;
    const sigma = Math.sqrt(sumResidSq / (countResid - 1));
    if (sigma < 1e-30) break; // Perfect fit

    // Reject outliers
    let rejected = 0;
    const newMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const x = i - midpoint;
      const predicted = intercept + slope * x;
      const resid = Math.abs(sample[i]! - predicted);
      if (resid > ZSCALE_REJECT_SIGMA * sigma) {
        rejected++;
      } else {
        newMask[i] = 1;
      }
    }

    if (rejected === 0) break; // Converged
    mask = newMask;
  }

  // Count remaining points
  let remaining = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i]) remaining++;
  }

  // If >50% rejected, use full sample range
  if (remaining < n * 0.5) {
    return { min: sample[0]!, max: sample[n - 1]! };
  }

  // Compute z1, z2 from the IRAF formula
  const z1 = median + (slope / contrast) * (1 - midpoint);
  const z2 = median + (slope / contrast) * (n - midpoint);

  // Clamp to sample range
  return {
    min: Math.max(sample[0]!, Math.min(z1, z2)),
    max: Math.min(sample[n - 1]!, Math.max(z1, z2)),
  };
}

export function percentileRange(pixels: Float64Array, low: number, high: number): { min: number; max: number } {
  if (pixels.length === 0) return { min: 0, max: 0 };

  const clean = sanitizeArray(pixels);
  const sorted = Array.from(clean).sort((a, b) => a - b);
  const n = sorted.length;

  const lowIndex = Math.max(0, Math.min(n - 1, Math.floor((low / 100) * (n - 1))));
  const highIndex = Math.max(0, Math.min(n - 1, Math.floor((high / 100) * (n - 1))));

  return { min: sorted[lowIndex], max: sorted[highIndex] };
}

function computeMinMax(pixels: Float64Array): { min: number; max: number } {
  if (pixels.length === 0) return { min: 0, max: 0 };

  if (pixels.length > 100) {
    const clean = sanitizeArray(pixels);
    const sorted = Array.from(clean).sort((a, b) => a - b);
    const n = sorted.length;

    const lowIndex = Math.max(0, Math.floor(0.01 * (n - 1)));
    const highIndex = Math.max(lowIndex, Math.floor(0.99 * (n - 1)));

    return { min: sorted[lowIndex], max: sorted[highIndex] };
  }

  let min = pixels[0];
  let max = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    if (pixels[i] < min) min = pixels[i];
    if (pixels[i] > max) max = pixels[i];
  }
  return { min, max };
}

/** Compute median of a Float64Array */
function computeMedian(pixels: Float64Array): number {
  if (pixels.length === 0) return 0;
  const sorted = Array.from(pixels).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

type ScaleFn = (value: number, min: number, max: number) => number;

export function applyScaling(pixels: Float64Array, params: ScalingParams): ScalingResult {
  if (pixels.length === 0) {
    return {
      data: new Float64Array(0),
      actualMin: 0,
      actualMax: 0,
      underflow: [],
      overflow: [],
    };
  }

  const clean = sanitizeArray(pixels);

  // Determine min/max range based on method
  let actualMin: number;
  let actualMax: number;

  if (params.method === 'histogram') {
    const result = histogramEqualize(clean);
    const { min, max } = computeMinMax(clean);
    return {
      data: result,
      actualMin: min,
      actualMax: max,
      underflow: [],
      overflow: [],
    };
  }

  if (params.method === 'zscale') {
    const range = zscaleRange(clean, params.zscaleContrast);
    actualMin = params.min ?? range.min;
    actualMax = params.max ?? range.max;
  } else if (params.method === 'percentile') {
    const low = params.percentileLow ?? 0;
    const high = params.percentileHigh ?? 100;
    const range = percentileRange(clean, low, high);
    actualMin = params.min ?? range.min;
    actualMax = params.max ?? range.max;
  } else {
    const { min, max } = computeMinMax(clean);
    actualMin = params.min ?? min;
    actualMax = params.max ?? max;
  }

  // Build the appropriate scale function with parameters
  let scaleFn: ScaleFn;
  switch (params.method) {
    case 'log':
      scaleFn = (v, mn, mx) => logScale(v, mn, mx, params.logBase);
      break;
    case 'asinh':
      scaleFn = (v, mn, mx) => asinhScale(v, mn, mx, params.softening ?? DEFAULT_ASINH_SOFTENING);
      break;
    case 'sinh':
      scaleFn = (v, mn, mx) => sinhScale(v, mn, mx, params.softening ?? DEFAULT_SINH_Q);
      break;
    case 'mtf': {
      // Auto-estimate midtone from median of normalized pixel values if not provided
      let midtone = params.midtone;
      if (midtone === undefined) {
        if (actualMax > actualMin) {
          // Normalize pixels and compute median
          const normalized = new Float64Array(clean.length);
          for (let i = 0; i < clean.length; i++) {
            normalized[i] = Math.max(0, Math.min(1, (clean[i] - actualMin) / (actualMax - actualMin)));
          }
          midtone = computeMedian(normalized);
          // Clamp away from extremes
          midtone = Math.max(0.01, Math.min(0.99, midtone));
        } else {
          midtone = 0.5;
        }
      }
      const m = midtone;
      scaleFn = (v, mn, mx) => mtfScale(v, mn, mx, m);
      break;
    }
    case 'sqrt':
      scaleFn = sqrtScale;
      break;
    case 'linear':
    default:
      scaleFn = linearScale;
      break;
  }

  const data = new Float64Array(clean.length);
  const underflow: number[] = [];
  const overflow: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    if (clean[i] < actualMin) underflow.push(i);
    if (clean[i] > actualMax) overflow.push(i);
    data[i] = scaleFn(clean[i], actualMin, actualMax);
  }

  return { data, actualMin, actualMax, underflow, overflow };
}
