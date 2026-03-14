import type { ScalingParams, ScalingResult } from '../types/image.js';

/** Number of bins for histogram equalization */
const HISTOGRAM_BINS = 65536;

/** Maximum sample size for zscale fitting */
const ZSCALE_MAX_SAMPLES = 10000;

/** Default zscale contrast parameter */
const ZSCALE_DEFAULT_CONTRAST = 0.25;

/** Default value for pixels with NaN or Infinity */
const SANITIZED_VALUE = 0;

/** Value returned when all pixels are identical (histogram equalization) */
const HISTOGRAM_UNIFORM_VALUE = 0.5;

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

export function linearScale(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(1, normalized));
}

export function logScale(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  if (value <= min) return 0;
  const numerator = Math.log(1 + value - min);
  const denominator = Math.log(1 + max - min);
  if (denominator === 0) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
}

export function sqrtScale(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  if (value <= min) return 0;
  const numerator = Math.sqrt(value - min);
  const denominator = Math.sqrt(max - min);
  if (denominator === 0) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
}

export function asinhScale(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const denominator = Math.asinh(max - min);
  if (denominator === 0) return 0;
  const normalized = Math.asinh(value - min) / denominator;
  return Math.max(0, Math.min(1, normalized));
}

export function histogramEqualize(pixels: Float64Array): Float64Array {
  if (pixels.length === 0) return new Float64Array(0);

  const clean = sanitizeArray(pixels);
  let min = clean[0];
  let max = clean[0];
  for (let i = 1; i < clean.length; i++) {
    if (clean[i] < min) min = clean[i];
    if (clean[i] > max) max = clean[i];
  }

  if (min === max) {
    const result = new Float64Array(pixels.length);
    result.fill(HISTOGRAM_UNIFORM_VALUE);
    return result;
  }

  const histogram = new Uint32Array(HISTOGRAM_BINS);
  const range = max - min;

  for (let i = 0; i < clean.length; i++) {
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(((clean[i] - min) / range) * (HISTOGRAM_BINS - 1)));
    histogram[bin]++;
  }

  // Build cumulative histogram
  const cumulative = new Float64Array(HISTOGRAM_BINS);
  cumulative[0] = histogram[0];
  for (let i = 1; i < HISTOGRAM_BINS; i++) {
    cumulative[i] = cumulative[i - 1] + histogram[i];
  }

  const totalPixels = clean.length;
  const result = new Float64Array(pixels.length);
  for (let i = 0; i < clean.length; i++) {
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(((clean[i] - min) / range) * (HISTOGRAM_BINS - 1)));
    result[i] = cumulative[bin] / totalPixels;
  }

  return result;
}

export function zscaleRange(pixels: Float64Array, contrast: number = ZSCALE_DEFAULT_CONTRAST): { min: number; max: number } {
  if (pixels.length === 0) return { min: 0, max: 0 };

  const clean = sanitizeArray(pixels);

  // Sample pixels if array is large
  let sample: number[];
  if (clean.length <= ZSCALE_MAX_SAMPLES) {
    sample = Array.from(clean);
  } else {
    sample = [];
    const step = clean.length / ZSCALE_MAX_SAMPLES;
    for (let i = 0; i < ZSCALE_MAX_SAMPLES; i++) {
      sample.push(clean[Math.floor(i * step)]);
    }
  }

  sample.sort((a, b) => a - b);
  const n = sample.length;

  if (n === 0) return { min: 0, max: 0 };
  if (n === 1) return { min: sample[0], max: sample[0] };

  // Fit a line to the central portion of sorted pixels
  const quarterStart = Math.floor(n * 0.25);
  const quarterEnd = Math.floor(n * 0.75);
  const centralLength = quarterEnd - quarterStart;

  if (centralLength < 2) {
    return { min: sample[0], max: sample[n - 1] };
  }

  // Simple linear regression on central portion: y = pixel value, x = index
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = quarterStart; i < quarterEnd; i++) {
    const x = i - quarterStart;
    const y = sample[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const meanX = sumX / centralLength;
  const meanY = sumY / centralLength;
  const slope = (sumXY - centralLength * meanX * meanY) / (sumXX - centralLength * meanX * meanX);
  const median = sample[Math.floor(n / 2)];

  const zmin = median - (median - sample[0]) * contrast;
  const zmax = median + (sample[n - 1] - median) * contrast;

  // Adjust by slope — steeper slope means narrower range
  const slopeAdjust = Math.abs(slope) > 0 ? 1 / (1 + Math.abs(slope) * contrast) : 1;
  const adjustedMin = median - (median - zmin) * slopeAdjust;
  const adjustedMax = median + (zmax - median) * slopeAdjust;

  return {
    min: Math.max(sample[0], adjustedMin),
    max: Math.min(sample[n - 1], adjustedMax),
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
  let min = pixels[0];
  let max = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    if (pixels[i] < min) min = pixels[i];
    if (pixels[i] > max) max = pixels[i];
  }
  return { min, max };
}

type ScaleFn = (value: number, min: number, max: number) => number;

const SCALE_FUNCTIONS: Record<string, ScaleFn> = {
  linear: linearScale,
  log: logScale,
  sqrt: sqrtScale,
  asinh: asinhScale,
};

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

  const scaleFn = SCALE_FUNCTIONS[params.method] ?? linearScale;
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
