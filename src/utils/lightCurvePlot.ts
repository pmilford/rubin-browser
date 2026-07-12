/**
 * Pure geometry + scaling helpers for the multi-band light-curve plot
 * (`LightCurvePlot.svelte`). Extracted here so the axis-tick, domain, gap, and
 * normalisation logic is unit-testable WITHOUT a DOM — the component only wires
 * these into SVG. Keep this math here (mirrors the projection.ts split rationale).
 *
 * The plot's x-axis is TIME (MJD), mapped proportionally so real observing gaps
 * are visible; the y-axis is a per-plot intensity/flux quantity. Multiple bands
 * overlay on one shared pair of axes (each band a separate series).
 */

/** One epoch of a light curve. `intensity` is the plotted quantity (flux/counts). */
export interface LcSeriesPoint {
  mjd: number;
  intensity: number;
  /** Optional magnitude, shown in the hover read-out when present. */
  mag?: number;
  /**
   * Optional 1σ uncertainty in `intensity` (SAME units as `intensity`, e.g. nJy
   * flux error for Rubin). Drawn as a vertical error-bar whisker when finite and
   * positive. Absent/NaN/≤0 ⇒ no whisker (never a fabricated zero-length bar).
   */
  err?: number;
}

/** A single band's epoch series. `color` is optional (assigned by band if absent). */
export interface LcSeries {
  band: string;
  color?: string;
  points: LcSeriesPoint[];
}

/** Data ranges spanned by a set of series (over their finite points). */
export interface LcDomain {
  mjdMin: number;
  mjdMax: number;
  vMin: number;
  vMax: number;
}

/** Finite points only (drop NaN/Infinity in mjd or intensity), sorted by mjd. */
export function cleanPoints(points: LcSeriesPoint[]): LcSeriesPoint[] {
  return points
    .filter((p) => Number.isFinite(p.mjd) && Number.isFinite(p.intensity))
    .slice()
    .sort((a, b) => a.mjd - b.mjd);
}

/**
 * The data domain (time + intensity ranges) over every finite point in `series`.
 * Returns null when there are no finite points (caller shows the empty state).
 * `vMin` MAY be negative — difference-image psfFlux is legitimately negative, so
 * callers must map with `(v - vMin)/(vMax - vMin)`, never assume intensity ≥ 0.
 */
export function seriesDomain(series: readonly LcSeries[]): LcDomain | null {
  let mjdMin = Infinity;
  let mjdMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let any = false;
  for (const s of series) {
    for (const p of s.points) {
      if (!Number.isFinite(p.mjd) || !Number.isFinite(p.intensity)) continue;
      any = true;
      if (p.mjd < mjdMin) mjdMin = p.mjd;
      if (p.mjd > mjdMax) mjdMax = p.mjd;
      if (p.intensity < vMin) vMin = p.intensity;
      if (p.intensity > vMax) vMax = p.intensity;
    }
  }
  if (!any) return null;
  return { mjdMin, mjdMax, vMin, vMax };
}

/**
 * Median spacing between consecutive (already time-sorted) MJDs. 0 for <2 points.
 * Computed PER SERIES — overlaid bands are independently time-sampled, so a
 * merged-set median would be meaningless (design-review B2).
 */
export function medianGap(mjds: readonly number[]): number {
  if (mjds.length < 2) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < mjds.length; i++) diffs.push(mjds[i]! - mjds[i - 1]!);
  diffs.sort((a, b) => a - b);
  const m = Math.floor(diffs.length / 2);
  return diffs.length % 2 ? diffs[m]! : (diffs[m - 1]! + diffs[m]!) / 2;
}

/**
 * "Nice" round tick values within [min, max] (1/2/5·10ⁿ steps), targeting ~`target`
 * ticks. Ticks are DERIVED from the data range (never hardcoded), so an axis whose
 * labels don't match the data fails its test. Empty for non-finite input; a single
 * value for min===max.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  if (max < min) [min, max] = [max, min];
  const range = max - min;
  const rawStep = range / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  step *= mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // +tiny epsilon so a tick landing exactly on `max` is included despite FP drift.
  for (let v = start; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

/**
 * Classify each consecutive segment of a series as a "gap" (a temporal jump far
 * larger than the series' own cadence) or not. A segment i→i+1 is a gap when its
 * MJD delta exceeds `factor`× the series median spacing. With <2 points, or a
 * degenerate (all-equal-MJD) series, no segment is a gap. Length === points-1.
 */
export function gapSegments(points: readonly LcSeriesPoint[], factor = 3): boolean[] {
  const mjds = points.map((p) => p.mjd);
  const med = medianGap(mjds);
  const threshold = med > 0 ? med * factor : Infinity;
  const out: boolean[] = [];
  for (let i = 1; i < points.length; i++) {
    out.push(mjds[i]! - mjds[i - 1]! > threshold);
  }
  return out;
}

/**
 * Rescale a series' intensities to [0,1] over its own min..max, preserving MJDs and
 * carrying the original value as `intensity` unchanged is NOT done — instead the
 * caller keeps the raw value separately for the read-out. A flat series maps to 0.5.
 */
export function normalizeIntensities(points: readonly LcSeriesPoint[]): number[] {
  if (points.length === 0) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.intensity < lo) lo = p.intensity;
    if (p.intensity > hi) hi = p.intensity;
  }
  const span = hi - lo;
  return points.map((p) => (span > 0 ? (p.intensity - lo) / span : 0.5));
}

/* -------------------------------------------------------------------------- */
/* Time-axis compression (collapse large observing gaps to a short break)      */
/* -------------------------------------------------------------------------- */

/** Ascending unique values. */
export function uniqueSorted(values: readonly number[]): number[] {
  const out = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

/**
 * One piece of the compressed time axis: the real MJD interval [t0,t1] maps
 * linearly to the compressed interval [c0,c1]. A `gap` piece is a large observing
 * gap whose compressed width is deliberately SHORT (one median cadence) so the
 * dense clusters get the horizontal room instead of a wide void.
 */
export interface CompressedSegment {
  t0: number;
  t1: number;
  c0: number;
  c1: number;
  gap: boolean;
}

/**
 * Build a piecewise-linear compressed time axis over the (already sorted, unique)
 * observation times. A consecutive interval longer than `gapFactor`× the median
 * cadence is a "gap": instead of its true width it takes a fixed SHORT width (the
 * median cadence), so a season-long void no longer squashes the data. Non-gap
 * intervals keep their true (proportional) width. `totalC` is the full compressed
 * span used to normalise into pixels.
 */
export function buildCompressedSegments(
  sortedUniqueMjds: readonly number[],
  gapFactor = 3
): { segments: CompressedSegment[]; totalC: number } {
  const u = sortedUniqueMjds;
  if (u.length <= 1) return { segments: [], totalC: 0 };
  const med = medianGap(u) || 1;
  const segments: CompressedSegment[] = [];
  let c = 0;
  for (let i = 1; i < u.length; i++) {
    const delta = u[i]! - u[i - 1]!;
    const gap = delta > gapFactor * med;
    const cDelta = gap ? med : delta;
    segments.push({ t0: u[i - 1]!, t1: u[i]!, c0: c, c1: c + cDelta, gap });
    c += cDelta;
  }
  return { segments, totalC: c };
}

/** Map an MJD to its compressed coordinate via the segment it falls in (clamped). */
export function compressedCoord(mjd: number, segments: readonly CompressedSegment[], totalC: number): number {
  if (segments.length === 0) return 0;
  if (mjd <= segments[0]!.t0) return 0;
  const last = segments[segments.length - 1]!;
  if (mjd >= last.t1) return totalC;
  for (const s of segments) {
    if (mjd >= s.t0 && mjd <= s.t1) {
      if (s.t1 === s.t0) return s.c0;
      return s.c0 + ((mjd - s.t0) / (s.t1 - s.t0)) * (s.c1 - s.c0);
    }
  }
  return totalC;
}

/** True when `mjd` falls strictly inside a collapsed gap segment (for tick hiding). */
export function isInCollapsedGap(mjd: number, segments: readonly CompressedSegment[]): boolean {
  for (const s of segments) {
    if (s.gap && mjd > s.t0 && mjd < s.t1) return true;
  }
  return false;
}

/** Standard per-band colours (Rubin ugrizy + Gaia g/bp/rp); fallback palette by index. */
const BAND_COLORS: Record<string, string> = {
  u: '#a78bfa',
  g: '#22c55e',
  r: '#ef4444',
  i: '#f59e0b',
  z: '#b45309',
  y: '#9ca3af',
  bp: '#3b82f6',
  rp: '#f43f5e',
  all: '#8fd1c8',
};
const FALLBACK_PALETTE = ['#8fd1c8', '#fbbf72', '#6cc4f5', '#f472b6', '#86efac', '#c4b5fd'];

/** Deterministic colour for a band: the standard map, else a stable palette slot. */
export function bandColor(band: string, index: number): string {
  const key = (band ?? '').toLowerCase();
  return BAND_COLORS[key] ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length]!;
}

/* -------------------------------------------------------------------------- */
/* Phase folding (periodic variables)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Fold a time onto a phase in [0, 1) at a given `period` (days), relative to an
 * `epoch` (MJD) zero-point (default 0). Phase = frac((mjd − epoch) / period),
 * normalised into [0,1) so a negative offset still lands in range. Returns NaN
 * when the period is non-finite or ≤ 0 (the caller must guard — an unfolded plot
 * is the honest fallback, never a divide-by-zero collapse to one point).
 *
 * This is the standard variable-star fold: a light curve sampled over many cycles
 * of a true period P collapses onto a single cycle, revealing the periodic shape
 * that the time-series view scatters across the whole baseline.
 */
export function foldPhase(mjd: number, period: number, epoch = 0): number {
  if (!Number.isFinite(period) || period <= 0 || !Number.isFinite(mjd)) return NaN;
  const phase = ((mjd - epoch) / period) % 1;
  return phase < 0 ? phase + 1 : phase;
}

/**
 * Fold a series' points to phase, returning a NEW point array whose `mjd` field
 * carries the PHASE in [0,1) (so the existing plot machinery can map it on a 0–1
 * x-axis unchanged) while preserving intensity/mag/err. Points whose fold is NaN
 * (guarded above) are dropped. Sorted by phase so line segments connect in phase
 * order within the single folded cycle.
 *
 * NOTE: connecting folded points with lines can cross the 0↔1 seam; the component
 * draws folded data as POINTS (with error bars), not a connected line, to avoid a
 * misleading wrap-around segment.
 */
export function foldSeriesPoints(
  points: readonly LcSeriesPoint[],
  period: number,
  epoch = 0,
): LcSeriesPoint[] {
  const out: LcSeriesPoint[] = [];
  for (const p of points) {
    const ph = foldPhase(p.mjd, period, epoch);
    if (!Number.isFinite(ph)) continue;
    out.push({ ...p, mjd: ph });
  }
  return out.sort((a, b) => a.mjd - b.mjd);
}

/** Compact numeric label for an axis tick / read-out (exponential at extreme magnitudes). */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-2) return v.toExponential(1);
  return String(Number(v.toPrecision(3)));
}
