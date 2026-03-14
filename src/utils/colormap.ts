import type { ColorMapName, ColorRGB, ColorMap } from '../types/image.js';

interface ColorStop {
  t: number;
  color: ColorRGB;
}

/** Linearly interpolate between color stops for a given normalized value */
export function interpolateColorMap(stops: ColorStop[], value: number): ColorRGB {
  const t = Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));

  if (t <= stops[0].t) return { ...stops[0].color };
  if (t >= stops[stops.length - 1].t) return { ...stops[stops.length - 1].color };

  let lower = stops[0];
  let upper = stops[1];
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].t >= t) {
      lower = stops[i - 1];
      upper = stops[i];
      break;
    }
  }

  const range = upper.t - lower.t;
  const frac = (t - lower.t) / range;

  return {
    r: Math.round(lower.color.r + frac * (upper.color.r - lower.color.r)),
    g: Math.round(lower.color.g + frac * (upper.color.g - lower.color.g)),
    b: Math.round(lower.color.b + frac * (upper.color.b - lower.color.b)),
  };
}

const GRAYSCALE_STOPS: ColorStop[] = [
  { t: 0, color: { r: 0, g: 0, b: 0 } },
  { t: 1, color: { r: 255, g: 255, b: 255 } },
];

const VIRIDIS_STOPS: ColorStop[] = [
  { t: 0.0, color: { r: 68, g: 1, b: 84 } },
  { t: 0.13, color: { r: 72, g: 36, b: 117 } },
  { t: 0.25, color: { r: 56, g: 88, b: 140 } },
  { t: 0.38, color: { r: 39, g: 126, b: 142 } },
  { t: 0.50, color: { r: 31, g: 161, b: 135 } },
  { t: 0.63, color: { r: 74, g: 194, b: 109 } },
  { t: 0.75, color: { r: 159, g: 218, b: 58 } },
  { t: 0.88, color: { r: 223, g: 227, b: 24 } },
  { t: 1.0, color: { r: 253, g: 231, b: 37 } },
];

const PLASMA_STOPS: ColorStop[] = [
  { t: 0.0, color: { r: 13, g: 8, b: 135 } },
  { t: 0.13, color: { r: 84, g: 2, b: 163 } },
  { t: 0.25, color: { r: 139, g: 10, b: 165 } },
  { t: 0.38, color: { r: 185, g: 50, b: 137 } },
  { t: 0.50, color: { r: 219, g: 92, b: 104 } },
  { t: 0.63, color: { r: 244, g: 136, b: 73 } },
  { t: 0.75, color: { r: 254, g: 188, b: 43 } },
  { t: 0.88, color: { r: 240, g: 230, b: 33 } },
  { t: 1.0, color: { r: 240, g: 249, b: 33 } },
];

const INFERNO_STOPS: ColorStop[] = [
  { t: 0.0, color: { r: 0, g: 0, b: 4 } },
  { t: 0.13, color: { r: 40, g: 11, b: 84 } },
  { t: 0.25, color: { r: 101, g: 21, b: 110 } },
  { t: 0.38, color: { r: 159, g: 42, b: 99 } },
  { t: 0.50, color: { r: 212, g: 72, b: 66 } },
  { t: 0.63, color: { r: 245, g: 125, b: 21 } },
  { t: 0.75, color: { r: 250, g: 193, b: 39 } },
  { t: 0.88, color: { r: 230, g: 240, b: 91 } },
  { t: 1.0, color: { r: 252, g: 255, b: 164 } },
];

const HOT_STOPS: ColorStop[] = [
  { t: 0.0, color: { r: 0, g: 0, b: 0 } },
  { t: 0.33, color: { r: 255, g: 0, b: 0 } },
  { t: 0.67, color: { r: 255, g: 255, b: 0 } },
  { t: 1.0, color: { r: 255, g: 255, b: 255 } },
];

const COOL_STOPS: ColorStop[] = [
  { t: 0.0, color: { r: 0, g: 255, b: 255 } },
  { t: 1.0, color: { r: 255, g: 0, b: 255 } },
];

const RED_STOPS: ColorStop[] = [
  { t: 0.0, color: { r: 0, g: 0, b: 0 } },
  { t: 1.0, color: { r: 255, g: 0, b: 0 } },
];

const GREEN_STOPS: ColorStop[] = [
  { t: 0.0, color: { r: 0, g: 0, b: 0 } },
  { t: 1.0, color: { r: 0, g: 255, b: 0 } },
];

const BLUE_STOPS: ColorStop[] = [
  { t: 0.0, color: { r: 0, g: 0, b: 0 } },
  { t: 1.0, color: { r: 0, g: 0, b: 255 } },
];

const COLOR_MAP_STOPS: Record<ColorMapName, ColorStop[]> = {
  grayscale: GRAYSCALE_STOPS,
  viridis: VIRIDIS_STOPS,
  plasma: PLASMA_STOPS,
  inferno: INFERNO_STOPS,
  hot: HOT_STOPS,
  cool: COOL_STOPS,
  red: RED_STOPS,
  green: GREEN_STOPS,
  blue: BLUE_STOPS,
};

/** Get a color map by name */
export function getColorMap(name: ColorMapName): ColorMap {
  const stops = COLOR_MAP_STOPS[name];
  return {
    name,
    lookup: (t: number) => interpolateColorMap(stops, t),
  };
}

/** Get all available color map names */
export function getColorMapNames(): ColorMapName[] {
  return Object.keys(COLOR_MAP_STOPS) as ColorMapName[];
}

/** Apply a color map to normalized data, producing RGBA ImageData-compatible Uint8ClampedArray */
export function applyColorMap(
  data: Float64Array,
  colorMap: ColorMapName
): Uint8ClampedArray {
  if (data.length === 0) return new Uint8ClampedArray(0);

  const result = new Uint8ClampedArray(data.length * 4);
  const map = getColorMap(colorMap);

  for (let i = 0; i < data.length; i++) {
    const color = map.lookup(data[i]);
    const offset = i * 4;
    result[offset] = color.r;
    result[offset + 1] = color.g;
    result[offset + 2] = color.b;
    result[offset + 3] = 255;
  }

  return result;
}

/** Generate a color bar gradient (256 entries) for legend display */
export function generateColorBar(colorMap: ColorMapName): Uint8ClampedArray {
  const result = new Uint8ClampedArray(256 * 4);
  const map = getColorMap(colorMap);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const color = map.lookup(t);
    const offset = i * 4;
    result[offset] = color.r;
    result[offset + 1] = color.g;
    result[offset + 2] = color.b;
    result[offset + 3] = 255;
  }

  return result;
}
