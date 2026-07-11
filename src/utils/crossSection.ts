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

/** The two sky endpoints (start → end) of a drawn cross-section line, in degrees. */
export interface LineEndpoints {
  /** RA (deg) of the start endpoint (t=0). */
  ra0: number;
  /** Dec (deg) of the start endpoint (t=0). */
  dec0: number;
  /** RA (deg) of the end endpoint (t=1). */
  ra1: number;
  /** Dec (deg) of the end endpoint (t=1). */
  dec1: number;
}

export interface LineProfile {
  /** Fractional position 0..1 along the line for each sample. */
  t: number[];
  /** Great-circle distance from the start endpoint, in arcminutes. */
  distanceArcmin: number[];
  /** Relative luminance 0..1; NaN where `gap` is true. */
  lum: number[];
  /** Red channel 0..1; NaN at gaps. */
  r: number[];
  /** Green channel 0..1; NaN at gaps. */
  g: number[];
  /** Blue channel 0..1; NaN at gaps. */
  b: number[];
  /** True where the sample had no underlying data (off-canvas / no tile). */
  gap: boolean[];
  /**
   * The line's sky endpoints (start → end), so a downstream tool can RE-SAMPLE
   * the same on-sky line in another data frame — e.g. the 3D surface waterfall
   * that samples this line across every epoch. Optional so hand-built test
   * literals stay valid; {@link sampleProfile} always populates it.
   */
  endpoints?: LineEndpoints;
}

/** A plottable channel of the profile: overall luminance or one colour channel. */
export type ProfileChannel = 'lum' | 'r' | 'g' | 'b';

/** The value array for a channel (0..1, NaN at gaps). */
export function channelValues(p: LineProfile, ch: ProfileChannel): number[] {
  return ch === 'r' ? p.r : ch === 'g' ? p.g : ch === 'b' ? p.b : p.lum;
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
  const r: number[] = new Array(n);
  const g: number[] = new Array(n);
  const b: number[] = new Array(n);
  const gap: boolean[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    t[i] = f;
    distanceArcmin[i] = f * totalArcmin;
    const x = x0 + (x1 - x0) * f;
    const y = y0 + (y1 - y0) * f;
    const rgb = bilinearRGB(getPixel, x, y);
    if (rgb === null) {
      lum[i] = NaN; r[i] = NaN; g[i] = NaN; b[i] = NaN;
      gap[i] = true;
    } else {
      r[i] = rgb[0]; g[i] = rgb[1]; b[i] = rgb[2];
      // Luminance from the same interpolated channels (Rec. 601), 0..1.
      lum[i] = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      gap[i] = false;
    }
  }

  return { t, distanceArcmin, lum, r, g, b, gap, endpoints: { ra0, dec0, ra1, dec1 } };
}

/**
 * Build a TEMPORAL cross-section grid — a "waterfall" of the drawn line's
 * intensity as it evolves over epochs. This is the height field for the 3D
 * surface plot: `grid[epochIndex][sampleIndex]`.
 *
 *  - COLUMN (sampleIndex) = position along the line: sample 0 sits at the start
 *    endpoint, sample n-1 at the end endpoint. Sky positions are linearly
 *    interpolated between the endpoints (shortest-path in RA, so a line straddling
 *    the 0/360° wrap still interpolates the short way).
 *  - ROW (epochIndex) = TIME: row 0 = the EARLIEST epoch, row `epochCount-1` = the
 *    LATEST. In the surface renderer row 0 is drawn at the back, so time flows
 *    back→front (earliest behind, latest in front).
 *  - VALUE = intensity at that (position, epoch), normalised so the grid's peak is
 *    1.0 (unless `normalize` is false). A sample with no data returns NaN and
 *    stays NaN (a gap), never a fabricated 0.
 *
 * `intensityAtEpoch(ra, dec, epochIndex, sampleIndex)` returns the raw (linear,
 * ≥0) intensity at that sky point for that epoch, or NaN for no data. It is given
 * the sample index too so a caller can memoise per-position work (e.g. one light
 * curve per column). PURE: no DOM, no colormap — the source of the intensities is
 * entirely the caller's concern.
 */
export function temporalCrossSectionGrid(
  endpoints: LineEndpoints,
  epochCount: number,
  sampleCount: number,
  intensityAtEpoch: (ra: number, dec: number, epochIndex: number, sampleIndex: number) => number,
  opts: { normalize?: boolean } = {},
): number[][] {
  const rows = Math.floor(epochCount);
  const cols = Math.max(2, Math.floor(sampleCount));
  if (rows < 2) return []; // a waterfall needs ≥2 epochs to be a time axis at all

  const { ra0, dec0, ra1, dec1 } = endpoints;
  // Shortest-path RA delta so an endpoint pair straddling 0/360° interpolates the
  // short way instead of sweeping ~360° across the sky.
  const dRa = ((ra1 - ra0 + 540) % 360) - 180;
  const ras = new Array<number>(cols);
  const decs = new Array<number>(cols);
  for (let s = 0; s < cols; s++) {
    const f = s / (cols - 1);
    ras[s] = ra0 + dRa * f;
    decs[s] = dec0 + (dec1 - dec0) * f;
  }

  const grid: number[][] = new Array(rows);
  let maxFinite = 0;
  for (let e = 0; e < rows; e++) {
    const row = new Array<number>(cols);
    for (let s = 0; s < cols; s++) {
      const v = intensityAtEpoch(ras[s]!, decs[s]!, e, s);
      row[s] = v;
      if (Number.isFinite(v) && v > maxFinite) maxFinite = v;
    }
    grid[e] = row;
  }

  const normalize = opts.normalize ?? true;
  if (normalize && maxFinite > 0) {
    for (let e = 0; e < rows; e++) {
      const row = grid[e]!;
      for (let s = 0; s < cols; s++) {
        const v = row[s]!;
        row[s] = Number.isNaN(v) ? NaN : v / maxFinite;
      }
    }
  }
  return grid;
}

/** Bilinear-interpolated [r,g,b] in 0..1 at floating (x,y); null if any corner is null. */
function bilinearRGB(getPixel: PixelGetter, x: number, y: number): [number, number, number] | null {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const dx = x - fx;
  const dy = y - fy;

  const p00 = getPixel(fx, fy);
  const p10 = getPixel(fx + 1, fy);
  const p01 = getPixel(fx, fy + 1);
  const p11 = getPixel(fx + 1, fy + 1);
  if (!p00 || !p10 || !p01 || !p11) return null;

  const chan = (c: 0 | 1 | 2): number => {
    const top = p00[c] * (1 - dx) + p10[c] * dx;
    const bot = p01[c] * (1 - dx) + p11[c] * dx;
    return (top * (1 - dy) + bot * dy) / 255;
  };
  return [chan(0), chan(1), chan(2)];
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
  channel: ProfileChannel = 'lum',
): string {
  const { distanceArcmin, gap } = profile;
  const vals = channelValues(profile, channel);
  const maxD = distanceArcmin[distanceArcmin.length - 1] || 1;
  const xy = (i: number): [number, number] => {
    const x = (distanceArcmin[i]! / maxD) * w;
    let v = vals[i]!;
    if (logScale) {
      const lo = Math.log10(floor);
      v = (Math.log10(Math.max(floor, v)) - lo) / (0 - lo); // log floor..1 → 0..1
    }
    const y = h - Math.max(0, Math.min(1, v)) * h;
    return [x, y];
  };

  const parts: string[] = [];
  let open = false;
  for (let i = 0; i < vals.length; i++) {
    if (gap[i] || Number.isNaN(vals[i]!)) {
      open = false;
      continue;
    }
    const [x, y] = xy(i);
    parts.push(`${open ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`);
    open = true;
  }
  return parts.join(' ');
}
