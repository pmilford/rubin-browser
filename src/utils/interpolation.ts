import type { InterpolationMethod, AiUpscaleHook } from '../types/image.js';

const aiUpscaleHooks: AiUpscaleHook[] = [];

/** Clamp value to [min, max] */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Get pixel value with clamped coordinates */
function getPixelClamped(data: Float64Array, width: number, height: number, x: number, y: number): number {
  const cx = clamp(Math.round(x), 0, width - 1);
  const cy = clamp(Math.round(y), 0, height - 1);
  return data[cy * width + cx];
}

/** Get pixel value with clamped integer coordinates (no rounding) */
function getPixelAt(data: Float64Array, width: number, height: number, x: number, y: number): number {
  const cx = clamp(x, 0, width - 1);
  const cy = clamp(y, 0, height - 1);
  return data[cy * width + cx];
}

/** Nearest neighbor sampling */
function sampleNearest(data: Float64Array, width: number, height: number, x: number, y: number): number {
  return getPixelClamped(data, width, height, x, y);
}

/** Bilinear interpolation */
function sampleBilinear(data: Float64Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const fx = x - x0;
  const fy = y - y0;

  const p00 = getPixelAt(data, width, height, x0, y0);
  const p10 = getPixelAt(data, width, height, x1, y0);
  const p01 = getPixelAt(data, width, height, x0, y1);
  const p11 = getPixelAt(data, width, height, x1, y1);

  return (
    p00 * (1 - fx) * (1 - fy) +
    p10 * fx * (1 - fy) +
    p01 * (1 - fx) * fy +
    p11 * fx * fy
  );
}

/** Catmull-Rom cubic kernel (a = -0.5) */
export function cubicWeight(t: number): number {
  const a = -0.5;
  const absT = Math.abs(t);
  if (absT <= 1) {
    return (a + 2) * absT * absT * absT - (a + 3) * absT * absT + 1;
  }
  if (absT <= 2) {
    return a * absT * absT * absT - 5 * a * absT * absT + 8 * a * absT - 4 * a;
  }
  return 0;
}

/** Bicubic interpolation using 4x4 neighborhood */
function sampleBicubic(data: Float64Array, width: number, height: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  let value = 0;
  for (let dy = -1; dy <= 2; dy++) {
    const wy = cubicWeight(fy - dy);
    for (let dx = -1; dx <= 2; dx++) {
      const wx = cubicWeight(fx - dx);
      const pixel = getPixelAt(data, width, height, ix + dx, iy + dy);
      value += pixel * wx * wy;
    }
  }
  return value;
}

/** sinc(x) = sin(pi*x) / (pi*x), sinc(0) = 1 */
export function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Lanczos-3 kernel */
export function lanczosWeight(x: number): number {
  const a = 3;
  const absX = Math.abs(x);
  if (absX >= a) return 0;
  return sinc(x) * sinc(x / a);
}

/** Lanczos-3 interpolation using 6x6 neighborhood */
function sampleLanczos(data: Float64Array, width: number, height: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = 3;

  let value = 0;
  let weightSum = 0;
  for (let dy = -(a - 1); dy <= a; dy++) {
    const wy = lanczosWeight(fy - dy);
    for (let dx = -(a - 1); dx <= a; dx++) {
      const wx = lanczosWeight(fx - dx);
      const w = wx * wy;
      const pixel = getPixelAt(data, width, height, ix + dx, iy + dy);
      value += pixel * w;
      weightSum += w;
    }
  }
  return weightSum !== 0 ? value / weightSum : 0;
}

/** Get a single interpolated pixel value at fractional coordinates */
export function samplePixel(
  data: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  method: InterpolationMethod
): number {
  if (data.length === 0 || width === 0 || height === 0) return 0;

  switch (method) {
    case 'nearest':
      return sampleNearest(data, width, height, x, y);
    case 'bilinear':
      return sampleBilinear(data, width, height, x, y);
    case 'bicubic':
      return sampleBicubic(data, width, height, x, y);
    case 'lanczos':
      return sampleLanczos(data, width, height, x, y);
  }
}

/** Resample a 2D image (stored as flat Float64Array, row-major) to new dimensions */
export function resample(
  data: Float64Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  method: InterpolationMethod
): Float64Array {
  if (data.length === 0 || srcWidth === 0 || srcHeight === 0 || dstWidth === 0 || dstHeight === 0) {
    return new Float64Array(0);
  }

  const result = new Float64Array(dstWidth * dstHeight);

  for (let dy = 0; dy < dstHeight; dy++) {
    const srcY = (dy + 0.5) * (srcHeight / dstHeight) - 0.5;
    for (let dx = 0; dx < dstWidth; dx++) {
      const srcX = (dx + 0.5) * (srcWidth / dstWidth) - 0.5;
      result[dy * dstWidth + dx] = samplePixel(data, srcWidth, srcHeight, srcX, srcY, method);
    }
  }

  return result;
}

/** Register an AI upscale hook for future use */
export function registerAiUpscaleHook(hook: AiUpscaleHook): void {
  aiUpscaleHooks.push(hook);
}

/** Get registered AI upscale hooks */
export function getAiUpscaleHooks(): AiUpscaleHook[] {
  return [...aiUpscaleHooks];
}

/** Clear all registered hooks */
export function clearAiUpscaleHooks(): void {
  aiUpscaleHooks.length = 0;
}
