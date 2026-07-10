/**
 * Pure line-profile sampling for the cross-section tool — NO DOM, NO colormap.
 *
 * The tool draws an arbitrary line across the sky image and plots intensity vs.
 * position along it. Correctness rules baked in here (see the design review):
 *  - Intensity is DISPLAYED RELATIVE LUMINANCE from the pre-colormap gray raster,
 *    `(0.299R+0.587G+0.114B)/255` — never post-colormap/inverted pixels.
 *  - A sample with no underlying data (off-buffer / null pixel) is flagged as a
 *    GAP with a NaN value — never a silent 0 (which would draw a fake trough).
 *  - The distance axis is great-circle arcminutes between the endpoints, not px.
 *
 * Unit-tested against closed-form ground truth in tests/unit/crossSection.test.ts.
 */

import { angularSeparation } from './skyGeom.js';

/** Returns the [r,g,b] (0-255) at integer pixel (x,y), or null if out of data. */
export type PixelGetter = (x: number, y: number) => [number, number, number] | null;

export interface LineProfile {
  /** Fractional position 0..1 along the line for each sample. */
  t: number[];
  /** Great-circle distance from the start endpoint, in arcminutes. */
  distanceArcmin: number[];
  /** Relative luminance 0..1; NaN where `gap` is true. */
  lum: number[];
  /** True where the sample had no underlying data (off-canvas / no tile). */
  gap: boolean[];
}

/** Rec. 601 relative luminance of an 8-bit RGB triple, normalised to 0..1. */
export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Sample `nSamples` points along the segment (x0,y0)→(x1,y1) in pixel space,
 * reading intensity via `getPixel` with bilinear interpolation. Endpoints in
 * RA/Dec give the great-circle length for the distance axis.
 *
 * A sample whose bilinear neighbourhood contains ANY null pixel is a gap
 * (lum=NaN), so missing tiles read as "no data", not zero.
 */
export function sampleProfile(
  getPixel: PixelGetter,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ra0: number,
  dec0: number,
  ra1: number,
  dec1: number,
  nSamples: number,
): LineProfile {
  const n = Math.max(2, Math.floor(nSamples));
  const totalArcmin = angularSeparation(ra0, dec0, ra1, dec1) * 60;

  const t: number[] = new Array(n);
  const distanceArcmin: number[] = new Array(n);
  const lum: number[] = new Array(n);
  const gap: boolean[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    t[i] = f;
    distanceArcmin[i] = f * totalArcmin;
    const x = x0 + (x1 - x0) * f;
    const y = y0 + (y1 - y0) * f;
    const v = bilinearLuminance(getPixel, x, y);
    if (v === null) {
      lum[i] = NaN;
      gap[i] = true;
    } else {
      lum[i] = v;
      gap[i] = false;
    }
  }

  return { t, distanceArcmin, lum, gap };
}

/** Bilinear-interpolated luminance at floating (x,y); null if any corner is null. */
function bilinearLuminance(getPixel: PixelGetter, x: number, y: number): number | null {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const dx = x - fx;
  const dy = y - fy;

  const p00 = getPixel(fx, fy);
  const p10 = getPixel(fx + 1, fy);
  const p01 = getPixel(fx, fy + 1);
  const p11 = getPixel(fx + 1, fy + 1);
  if (!p00 || !p10 || !p01 || !p11) return null;

  const l00 = luminance(p00[0], p00[1], p00[2]);
  const l10 = luminance(p10[0], p10[1], p10[2]);
  const l01 = luminance(p01[0], p01[1], p01[2]);
  const l11 = luminance(p11[0], p11[1], p11[2]);

  const top = l00 * (1 - dx) + l10 * dx;
  const bot = l01 * (1 - dx) + l11 * dx;
  return top * (1 - dy) + bot * dy;
}

/**
 * Build an SVG path `d` for the profile, mapping distance→x and value→y in a
 * [0,0,w,h] box, with the trace BROKEN across gap runs (no line through
 * no-data). `logScale` applies log10 on a clamped floor. Returns one or more
 * "M…L…" subpaths joined by spaces (empty string if fully gapped).
 */
export function profilePath(
  profile: LineProfile,
  w: number,
  h: number,
  logScale: boolean,
  floor = 1e-3,
): string {
  const { distanceArcmin, lum, gap } = profile;
  const maxD = distanceArcmin[distanceArcmin.length - 1] || 1;
  const xy = (i: number): [number, number] => {
    const x = (distanceArcmin[i]! / maxD) * w;
    let v = lum[i]!;
    if (logScale) {
      const lo = Math.log10(floor);
      v = (Math.log10(Math.max(floor, v)) - lo) / (0 - lo); // log floor..1 → 0..1
    }
    const y = h - Math.max(0, Math.min(1, v)) * h;
    return [x, y];
  };

  const parts: string[] = [];
  let open = false;
  for (let i = 0; i < lum.length; i++) {
    if (gap[i] || Number.isNaN(lum[i]!)) {
      open = false;
      continue;
    }
    const [x, y] = xy(i);
    parts.push(`${open ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`);
    open = true;
  }
  return parts.join(' ');
}
