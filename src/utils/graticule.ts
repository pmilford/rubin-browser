/**
 * Pure RA/Dec graticule + compass + scale-bar geometry for the HiPS viewer.
 *
 * This replaces the DECORATIVE `WcsOverlay.svelte` (hardcoded ↑/← arrows, a
 * "grid" that was just a text list of RA/Dec numbers, and a scale bar computed
 * from an "assume ~400px display" constant) with REAL geometry projected
 * through the viewer's actual gnomonic projection.
 *
 * Everything here is a pure function of the SAME view snapshot that
 * {@link skyToCanvas} consumes — the exact object `ImageViewer.currentView()`
 * returns (`{ ra, dec, fov, canvasWidth, canvasHeight, panOffsetX?, panOffsetY? }`).
 * Output is plain data (polylines of canvas points, screen angles, a pixel
 * length + label) that an overlay canvas renders; no DOM, no drawing here, so
 * the geometry is unit-testable against ground truth.
 *
 * Why project point-by-point instead of drawing straight lines: under gnomonic
 * projection a constant-Dec parallel is a SMALL circle, not a great circle, so
 * it projects to a CURVE — pronounced at wide FOV and near the poles. Drawing a
 * straight chord (the old rectangular-grid assumption) is visibly wrong there.
 * We sample each isoline finely and emit a polyline that follows the real curve,
 * splitting it wherever it leaves the canvas or wraps behind the viewer so we
 * never draw a chord across the gap.
 */

import { skyToCanvas, canvasToSky, type ViewParams } from './projection.js';
import { fromEquatorial, toEquatorial, type CoordSystem } from './coords.js';

export type { CoordSystem };

/** The view snapshot consumed by every function here — identical to skyToCanvas's. */
export type GraticuleView = ViewParams;

export type Point = { x: number; y: number };

/** One projected isoline: a constant-RA meridian or constant-Dec parallel. */
export interface GraticuleLine {
  /** 'ra' = meridian (constant RA); 'dec' = parallel (constant Dec). */
  kind: 'ra' | 'dec';
  /** the constant value (deg) this isoline holds. */
  value: number;
  /** canvas-space polyline; a single continuous on-canvas run of points. */
  points: Point[];
}

export interface GraticuleOptions {
  /** samples per isoline before splitting into on-canvas runs (default 128). */
  samples?: number;
  /** override the auto FOV→spacing choice (deg). */
  spacingDeg?: number;
  /** hard cap on lines of each kind; spacing is coarsened to respect it (default 40). */
  maxLines?: number;
  /** how far off-canvas (px) a point may sit and still anchor a run (default 64). */
  edgeMarginPx?: number;
  /** consecutive points farther apart than this (px) split the run — kills wrap chords (default 200). */
  maxSegmentPx?: number;
  /** Coordinate system the grid follows: 'equatorial' (default), 'galactic', 'ecliptic'. */
  system?: CoordSystem;
}

export interface CompassRose {
  /** screen angle (rad, atan2(dy,dx), +x right / +y DOWN) of the +Dec (North) direction at center. */
  northAngleRad: number;
  /** screen angle (rad) of the +RA (East) direction at center. */
  eastAngleRad: number;
  /**
   * Sign of the screen-space cross product North×East (nx*ey − ny*ex).
   * Records the handedness the projection actually produces rather than
   * assuming a textbook orientation — for this North-up / East-right gnomonic
   * projection (screen +y points DOWN) it is +1.
   */
  handedness: number;
}

export interface ScaleBar {
  /** projected length (px) of `labelDeg` at the view center — the REAL pixels-per-degree. */
  lengthPx: number;
  /** the chosen "nice" angular length (deg). */
  labelDeg: number;
  /** human-readable form of `labelDeg` (° / ′ / ″). */
  label: string;
}

const DEG2RAD = Math.PI / 180;

/**
 * Nice grid spacing (deg) for a FOV, as a pure ladder (the WcsOverlay ladder,
 * extracted from the component so it can be tested and reused).
 */
export function gridSpacingForFov(fov: number): number {
  if (fov > 40) return 10;
  if (fov > 20) return 5;
  if (fov > 10) return 2;
  if (fov > 5) return 1;
  if (fov > 2) return 0.5;
  if (fov > 1) return 0.2;
  if (fov > 0.5) return 0.1;
  if (fov > 0.2) return 0.05;
  if (fov > 0.1) return 0.02;
  return 0.01;
}

/** Wrap an RA delta (deg) into (−180, 180]. */
function wrapDeltaDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

function clampDec(dec: number): number {
  return Math.max(-90, Math.min(90, dec));
}

function inMargin(p: [number, number], view: GraticuleView, margin: number): boolean {
  const [x, y] = p;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return (
    x >= -margin &&
    x <= view.canvasWidth + margin &&
    y >= -margin &&
    y <= view.canvasHeight + margin
  );
}

/** Is the given celestial pole inside the visible canvas? */
function poleVisible(view: GraticuleView, dec: 90 | -90): boolean {
  const p = skyToCanvas(view, view.ra, dec);
  return inMargin(p, view, 0);
}

/**
 * Visible sky window: the Dec range and the RA half-width (about the center RA)
 * that the canvas actually covers, found by inverse-projecting a grid of canvas
 * points (canvasToSky is stable at wide FOV — it never returns NaN). If a pole
 * is on screen the RA wraps fully and Dec runs to the pole, so we widen to the
 * whole circle.
 */
function visibleWindow(view: GraticuleView): {
  decMin: number;
  decMax: number;
  raHalf: number;
} {
  const { canvasWidth: w, canvasHeight: h } = view;
  let decMin = Infinity;
  let decMax = -Infinity;
  let raHalf = 0;
  const N = 6;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const px = (i / N) * w;
      const py = (j / N) * h;
      const [r, d] = canvasToSky(view, px, py);
      if (d < decMin) decMin = d;
      if (d > decMax) decMax = d;
      const dr = Math.abs(wrapDeltaDeg(r - view.ra));
      if (dr > raHalf) raHalf = dr;
    }
  }
  if (poleVisible(view, 90)) {
    decMax = 90;
    raHalf = 180;
  }
  if (poleVisible(view, -90)) {
    decMin = -90;
    raHalf = 180;
  }
  return { decMin: clampDec(decMin), decMax: clampDec(decMax), raHalf };
}

/**
 * Isoline values on the `spacing` grid covering [center−half, center+half],
 * coarsening the spacing (×2, ×2.5 ladder) until at most `maxLines` result — so
 * the line count stays bounded and never explodes as FOV shrinks or near a pole.
 */
function isoValues(
  center: number,
  half: number,
  spacing: number,
  maxLines: number,
  clampRange?: [number, number]
): { values: number[]; spacing: number } {
  let s = spacing;
  const mult = [2, 2.5, 2];
  let mi = 0;
  for (let guard = 0; guard < 20; guard++) {
    const lo = clampRange ? Math.max(clampRange[0], center - half) : center - half;
    const hi = clampRange ? Math.min(clampRange[1], center + half) : center + half;
    const start = Math.ceil(lo / s) * s;
    const values: number[] = [];
    for (let v = start; v <= hi + 1e-9; v += s) {
      values.push(Math.round(v * 1e6) / 1e6);
    }
    if (values.length <= maxLines) return { values, spacing: s };
    s *= mult[mi % mult.length]!;
    mi++;
  }
  return { values: [], spacing: s };
}

/**
 * Split a finely-sampled sequence of projected points into continuous on-canvas
 * runs. A run breaks when a point falls off-canvas / behind the horizon (NaN) or
 * when two consecutive on-canvas points are farther apart than `maxSegmentPx`
 * (an RA wrap or a jump across the behind-viewer gap). This is what keeps us
 * from drawing a straight chord across the gap.
 */
function splitRuns(
  raw: [number, number][],
  view: GraticuleView,
  edgeMargin: number,
  maxSegmentPx: number
): Point[][] {
  const runs: Point[][] = [];
  let cur: Point[] = [];
  let prev: [number, number] | null = null;
  const flush = () => {
    if (cur.length >= 2) runs.push(cur);
    cur = [];
  };
  for (const p of raw) {
    if (!inMargin(p, view, edgeMargin)) {
      flush();
      prev = null;
      continue;
    }
    if (prev) {
      const gap = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      if (gap > maxSegmentPx) flush();
    }
    cur.push({ x: p[0], y: p[1] });
    prev = p;
  }
  flush();
  return runs;
}

/**
 * The visible RA/Dec graticule as projected polylines. Meridians (constant RA)
 * and parallels (constant Dec) are each sampled finely across the visible range
 * and split into on-canvas runs, so the lines follow the real gnomonic curve and
 * never chord across an off-screen gap.
 */
export function graticuleLines(
  view: GraticuleView,
  opts: GraticuleOptions = {}
): GraticuleLine[] {
  // Non-equatorial grids follow lines of constant galactic/ecliptic lon/lat,
  // converted to RA/Dec and projected the same way. The equatorial path below is
  // left exactly as-is (its invariant tests are unchanged).
  if (opts.system && opts.system !== 'equatorial') {
    return graticuleLinesInSystem(view, opts.system, opts);
  }
  const samples = opts.samples ?? 128;
  const maxLines = opts.maxLines ?? 40;
  const edgeMargin = opts.edgeMarginPx ?? 64;
  const maxSegmentPx = opts.maxSegmentPx ?? 200;
  const baseSpacing = opts.spacingDeg ?? gridSpacingForFov(view.fov);

  const win = visibleWindow(view);
  const lines: GraticuleLine[] = [];

  // Parallels: constant Dec, swept over the visible RA window.
  const decHalf = (win.decMax - win.decMin) / 2 + baseSpacing;
  const decCenter = (win.decMax + win.decMin) / 2;
  const parallels = isoValues(decCenter, decHalf, baseSpacing, maxLines, [-90, 90]);
  // Sweep RA a touch wider than the visible half so lines reach the edges.
  const raSweep = Math.min(180, win.raHalf + baseSpacing * 2);
  for (const decVal of parallels.values) {
    const raw: [number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const ra = view.ra - raSweep + (2 * raSweep * i) / samples;
      raw.push(skyToCanvas(view, ra, decVal));
    }
    for (const run of splitRuns(raw, view, edgeMargin, maxSegmentPx)) {
      lines.push({ kind: 'dec', value: decVal, points: run });
    }
  }

  // Meridians: constant RA, swept over the visible Dec window.
  const raHalf = win.raHalf + baseSpacing;
  const meridians = isoValues(view.ra, raHalf, baseSpacing, maxLines);
  const decLo = clampDec(win.decMin - baseSpacing);
  const decHi = clampDec(win.decMax + baseSpacing);
  for (const raValRaw of meridians.values) {
    const raVal = ((raValRaw % 360) + 360) % 360;
    const raw: [number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const dec = clampDec(decLo + ((decHi - decLo) * i) / samples);
      raw.push(skyToCanvas(view, raVal, dec));
    }
    for (const run of splitRuns(raw, view, edgeMargin, maxSegmentPx)) {
      lines.push({ kind: 'ra', value: raVal, points: run });
    }
  }

  return lines;
}

/** Is the given pole of `system` (lat ±90) inside the visible canvas? */
function systemPoleVisible(view: GraticuleView, system: CoordSystem, lat: 90 | -90): boolean {
  const eq = toEquatorial(0, lat, system);
  return inMargin(skyToCanvas(view, eq.lon, eq.lat), view, 0);
}

/** Visible lon/lat window in `system` — the generic analogue of visibleWindow. */
function visibleWindowInSystem(view: GraticuleView, system: CoordSystem): {
  latMin: number;
  latMax: number;
  lonHalf: number;
  centerLon: number;
} {
  const { canvasWidth: w, canvasHeight: h } = view;
  const center = fromEquatorial(view.ra, view.dec, system);
  let latMin = Infinity;
  let latMax = -Infinity;
  let lonHalf = 0;
  const N = 6;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const [ra, dec] = canvasToSky(view, (i / N) * w, (j / N) * h);
      const s = fromEquatorial(ra, dec, system);
      if (s.lat < latMin) latMin = s.lat;
      if (s.lat > latMax) latMax = s.lat;
      const dl = Math.abs(wrapDeltaDeg(s.lon - center.lon));
      if (dl > lonHalf) lonHalf = dl;
    }
  }
  if (systemPoleVisible(view, system, 90)) { latMax = 90; lonHalf = 180; }
  if (systemPoleVisible(view, system, -90)) { latMin = -90; lonHalf = 180; }
  return { latMin: clampDec(latMin), latMax: clampDec(latMax), lonHalf, centerLon: center.lon };
}

/**
 * Graticule for a non-equatorial system: iso-lat parallels and iso-lon meridians
 * of `system`, each point converted to RA/Dec and projected through the same
 * gnomonic skyToCanvas, then split into on-canvas runs. `kind:'ra'` = meridian
 * (constant lon), `kind:'dec'` = parallel (constant lat).
 */
function graticuleLinesInSystem(
  view: GraticuleView,
  system: CoordSystem,
  opts: GraticuleOptions
): GraticuleLine[] {
  const samples = opts.samples ?? 128;
  const maxLines = opts.maxLines ?? 40;
  const edgeMargin = opts.edgeMarginPx ?? 64;
  const maxSegmentPx = opts.maxSegmentPx ?? 200;
  const baseSpacing = opts.spacingDeg ?? gridSpacingForFov(view.fov);

  const win = visibleWindowInSystem(view, system);
  const lines: GraticuleLine[] = [];
  const project = (lon: number, lat: number): [number, number] => {
    const eq = toEquatorial(lon, lat, system);
    return skyToCanvas(view, eq.lon, eq.lat);
  };

  // Parallels: constant lat, swept over the visible lon window.
  const latHalf = (win.latMax - win.latMin) / 2 + baseSpacing;
  const latCenter = (win.latMax + win.latMin) / 2;
  const parallels = isoValues(latCenter, latHalf, baseSpacing, maxLines, [-90, 90]);
  const lonSweep = Math.min(180, win.lonHalf + baseSpacing * 2);
  for (const latVal of parallels.values) {
    const raw: [number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const lon = win.centerLon - lonSweep + (2 * lonSweep * i) / samples;
      raw.push(project(lon, latVal));
    }
    for (const run of splitRuns(raw, view, edgeMargin, maxSegmentPx)) {
      lines.push({ kind: 'dec', value: latVal, points: run });
    }
  }

  // Meridians: constant lon, swept over the visible lat window.
  const lonHalf = win.lonHalf + baseSpacing;
  const meridians = isoValues(win.centerLon, lonHalf, baseSpacing, maxLines);
  const latLo = clampDec(win.latMin - baseSpacing);
  const latHi = clampDec(win.latMax + baseSpacing);
  for (const lonRaw of meridians.values) {
    const lonVal = ((lonRaw % 360) + 360) % 360;
    const raw: [number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const lat = clampDec(latLo + ((latHi - latLo) * i) / samples);
      raw.push(project(lonVal, lat));
    }
    for (const run of splitRuns(raw, view, edgeMargin, maxSegmentPx)) {
      lines.push({ kind: 'ra', value: lonVal, points: run });
    }
  }

  return lines;
}

/**
 * Label for a grid isoline. Equatorial uses the h:m / °:′ formatters; galactic and
 * ecliptic use plain degrees with the conventional axis letters (l/b, λ/β).
 */
export function formatGridLabel(
  kind: 'ra' | 'dec',
  value: number,
  system: CoordSystem = 'equatorial'
): string {
  if (system === 'equatorial') return kind === 'ra' ? formatRa(value) : formatDec(value);
  const deg =
    kind === 'dec'
      ? `${value >= 0 ? '+' : ''}${value.toFixed(0)}°`
      : `${Math.round(((value % 360) + 360) % 360)}°`;
  const letter =
    system === 'galactic' ? (kind === 'ra' ? 'l' : 'b') : kind === 'ra' ? 'λ' : 'β';
  return `${letter} ${deg}`;
}

/**
 * Screen directions of true North (+Dec) and East (+RA) at the view center,
 * found by projecting the center vs a tiny step in each and taking atan2 of the
 * screen delta — NOT hardcoded up/left. The epsilon scales with FOV so the
 * projected delta keeps precision at any zoom.
 */
export function compassRose(view: GraticuleView): CompassRose {
  const eps = Math.max(view.fov * 1e-3, 1e-6);
  const c = skyToCanvas(view, view.ra, view.dec);

  // North: +Dec. Flip the probe if the center is so close to a pole that
  // dec+eps would cross it, then negate the measured delta.
  let nSign = 1;
  let nDec = view.dec + eps;
  if (nDec > 90) {
    nDec = view.dec - eps;
    nSign = -1;
  }
  const n = skyToCanvas(view, view.ra, nDec);
  const ndx = (n[0] - c[0]) * nSign;
  const ndy = (n[1] - c[1]) * nSign;
  const northAngleRad = Math.atan2(ndy, ndx);

  // East: +RA. Divide the step by cos(dec) so it stays a genuine east tangent.
  const cosDec = Math.max(Math.abs(Math.cos(view.dec * DEG2RAD)), 1e-6);
  const e = skyToCanvas(view, view.ra + eps / cosDec, view.dec);
  const edx = e[0] - c[0];
  const edy = e[1] - c[1];
  const eastAngleRad = Math.atan2(edy, edx);

  const nvx = Math.cos(northAngleRad);
  const nvy = Math.sin(northAngleRad);
  const evx = Math.cos(eastAngleRad);
  const evy = Math.sin(eastAngleRad);
  const handedness = Math.sign(nvx * evy - nvy * evx);

  return { northAngleRad, eastAngleRad, handedness };
}

const DEG = 1;
const ARCMIN = 1 / 60;
const ARCSEC = 1 / 3600;
/** Astronomer-friendly angular lengths (deg), ascending. */
const NICE_ANGLES_DEG: number[] = [
  1 * ARCSEC, 2 * ARCSEC, 5 * ARCSEC, 10 * ARCSEC, 15 * ARCSEC, 30 * ARCSEC,
  1 * ARCMIN, 2 * ARCMIN, 5 * ARCMIN, 10 * ARCMIN, 15 * ARCMIN, 30 * ARCMIN,
  1 * DEG, 2 * DEG, 5 * DEG, 10 * DEG, 20 * DEG, 30 * DEG, 45 * DEG,
];

/** Format an angular length (deg) as °, ′ or ″ by magnitude. */
export function formatScaleLabel(deg: number): string {
  if (deg >= 1) {
    return Number.isInteger(deg) ? `${deg}°` : `${deg.toFixed(1)}°`;
  }
  const arcmin = deg * 60;
  if (arcmin >= 1) {
    return Number.isInteger(arcmin) ? `${arcmin}′` : `${arcmin.toFixed(1)}′`;
  }
  const arcsec = deg * 3600;
  return Number.isInteger(arcsec) ? `${arcsec}″` : `${arcsec.toFixed(1)}″`;
}

/**
 * A "relevant-sized" scale bar: the LARGEST astronomer-friendly (1/2/5×10ⁿ)
 * angular length that is still ≤ a fraction (`maxFovFraction`, default 1/5) of
 * the view's FOV, labelled in its natural unit (″/′/°). This gives a predictable
 * clean fraction of the view — e.g. a 1° FOV yields a 10′ bar (15′ = 0.25° would
 * exceed 1/5), a 22.5° FOV yields 2° (5° too big).
 *
 * The drawn LENGTH is the chosen angle times the REAL projected pixels-per-degree
 * at the view center (measured by projecting the center and a small Dec offset),
 * so the bar is physically correct — a visual test can verify its px length
 * against the projection. Doubling the FOV halves pixels-per-degree.
 *
 * `targetPx` is retained for signature compatibility (older ~80px-target callers)
 * but no longer drives selection; `maxFovFraction` is the primary selector.
 */
export function scaleBar(
  view: GraticuleView,
  targetPx = 80,
  maxFovFraction = 0.2,
): ScaleBar {
  void targetPx; // kept for backward-compatible signature; not used for selection

  const c = skyToCanvas(view, view.ra, view.dec);
  // Probe a small Dec offset toward the interior (flip near the pole).
  const dProbe = Math.max(view.fov * 1e-3, 1e-6);
  let d2 = view.dec + dProbe;
  if (d2 > 90) d2 = view.dec - dProbe;
  const p = skyToCanvas(view, view.ra, d2);
  const pxPerDeg = Math.hypot(p[0] - c[0], p[1] - c[1]) / dProbe;

  // Largest nice angle whose length is ≤ maxFovFraction of the FOV. NICE_ANGLES_DEG
  // is ascending, so the last qualifying entry is the largest. If none qualifies
  // (FOV smaller than the smallest nice angle / fraction), fall back to the
  // smallest nice angle so the bar is never empty.
  const bound = maxFovFraction * view.fov;
  let best = NICE_ANGLES_DEG[0]!;
  for (const cand of NICE_ANGLES_DEG) {
    if (cand <= bound) best = cand;
    else break;
  }

  return {
    lengthPx: best * pxPerDeg,
    labelDeg: best,
    label: formatScaleLabel(best),
  };
}

/** Format RA (deg) as hours + minutes, e.g. "12h 34m". */
export function formatRa(deg: number): string {
  const norm = ((deg % 360) + 360) % 360;
  const hoursTotal = norm / 15;
  let h = Math.floor(hoursTotal);
  let m = Math.round((hoursTotal - h) * 60);
  if (m === 60) {
    m = 0;
    h = (h + 1) % 24;
  }
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Format Dec (deg) as signed degrees + arcminutes, e.g. "+41° 16′". */
export function formatDec(deg: number): string {
  const sign = deg < 0 ? '-' : '+';
  const abs = Math.abs(deg);
  let d = Math.floor(abs);
  let m = Math.round((abs - d) * 60);
  if (m === 60) {
    m = 0;
    d += 1;
  }
  return `${sign}${d}° ${String(m).padStart(2, '0')}′`;
}
