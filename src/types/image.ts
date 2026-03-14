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
