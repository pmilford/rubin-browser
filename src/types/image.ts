/** Image viewer types for HiPS tile viewing, scaling, colormaps, and interpolation */

export type ScalingFunction = 'linear' | 'log' | 'sqrt' | 'asinh' | 'histogram' | 'zscale' | 'percentile';

export type ColorMapName = 'grayscale' | 'viridis' | 'plasma' | 'inferno' | 'hot' | 'cool';

export type InterpolationMethod = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';

export interface ScalingParams {
  method: ScalingFunction;
  min?: number;
  max?: number;
  /** Percentile bounds for percentile scaling (0-100) */
  percentileLow?: number;
  percentileHigh?: number;
  /** Number of samples for ZScale */
  zscaleContrast?: number;
}

export interface ScalingResult {
  /** Normalized output values in [0, 1] */
  data: Float64Array;
  /** Actual min value used */
  actualMin: number;
  /** Actual max value used */
  actualMax: number;
  /** Indices of underflow pixels */
  underflow: number[];
  /** Indices of overflow pixels */
  overflow: number[];
}

export interface ColorRGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export interface ColorMap {
  name: ColorMapName;
  /** Map normalized value [0,1] to RGB */
  lookup: (t: number) => ColorRGB;
}

export interface InterpolationOptions {
  method: InterpolationMethod;
  width: number;
  height: number;
}

export interface AiUpscaleHook {
  name: string;
  upscale: (
    data: Float64Array,
    width: number,
    height: number,
    scaleFactor: number
  ) => Promise<Float64Array>;
}

export interface HipsTile {
  order: number;
  pixelIndex: number;
  url: string;
  format: 'png' | 'jpg' | 'fits';
}

export interface HipsProperties {
  title: string;
  hipsOrder: number;
  tileFormat: string;
  frame: string;
  tileWidth: number;
}

export interface ViewerState {
  centerRa: number;
  centerDec: number;
  zoomLevel: number;
  scaling: ScalingParams;
  colorMap: ColorMapName;
  interpolation: InterpolationMethod;
}

const SCALING_FUNCTIONS: readonly ScalingFunction[] = ['linear', 'log', 'sqrt', 'asinh', 'histogram', 'zscale', 'percentile'];
const COLOR_MAP_NAMES: readonly ColorMapName[] = ['grayscale', 'viridis', 'plasma', 'inferno', 'hot', 'cool'];
const INTERPOLATION_METHODS: readonly InterpolationMethod[] = ['nearest', 'bilinear', 'bicubic', 'lanczos'];

/** Type guard: validates a string is a valid ScalingFunction */
export function isScalingFunction(v: string): v is ScalingFunction {
  return (SCALING_FUNCTIONS as readonly string[]).includes(v);
}

/** Type guard: validates a string is a valid ColorMapName */
export function isColorMapName(v: string): v is ColorMapName {
  return (COLOR_MAP_NAMES as readonly string[]).includes(v);
}

/** Type guard: validates a string is a valid InterpolationMethod */
export function isInterpolationMethod(v: string): v is InterpolationMethod {
  return (INTERPOLATION_METHODS as readonly string[]).includes(v);
}

/** Type guard: validates a value is a valid ScalingParams */
export function isValidScalingParams(v: unknown): v is ScalingParams {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.method !== 'string' || !isScalingFunction(o.method)) return false;
  if (o.min !== undefined && typeof o.min !== 'number') return false;
  if (o.max !== undefined && typeof o.max !== 'number') return false;
  if (o.percentileLow !== undefined && typeof o.percentileLow !== 'number') return false;
  if (o.percentileHigh !== undefined && typeof o.percentileHigh !== 'number') return false;
  if (o.zscaleContrast !== undefined && typeof o.zscaleContrast !== 'number') return false;
  return true;
}

/** Type guard: validates a value is a valid HipsTile */
export function isHipsTile(v: unknown): v is HipsTile {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.order === 'number' &&
    typeof o.pixelIndex === 'number' &&
    typeof o.url === 'string' &&
    (o.format === 'png' || o.format === 'jpg' || o.format === 'fits')
  );
}

/** Type guard: validates a value is a valid HipsProperties */
export function isHipsProperties(v: unknown): v is HipsProperties {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.title === 'string' &&
    typeof o.hipsOrder === 'number' &&
    typeof o.tileFormat === 'string' &&
    typeof o.frame === 'string' &&
    typeof o.tileWidth === 'number'
  );
}

/** Type guard: validates a value is a valid ViewerState */
export function isViewerState(v: unknown): v is ViewerState {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.centerRa === 'number' &&
    typeof o.centerDec === 'number' &&
    typeof o.zoomLevel === 'number' &&
    isValidScalingParams(o.scaling) &&
    isColorMapName(String(o.colorMap)) &&
    isInterpolationMethod(String(o.interpolation))
  );
}
