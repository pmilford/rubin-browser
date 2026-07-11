/**
 * Alert / DIA-event overlay data model — built for VOLUME.
 *
 * Rubin's difference-image analysis emits on the order of ~10 million events per
 * night. To stay fast at that scale this module:
 *  - stores events in flat TypedArrays (not objects) for memory + cache locality;
 *  - indexes them in a uniform RA/Dec grid so a viewport query touches only the
 *    buckets it overlaps, never the whole set;
 *  - supports screen-space density binning so low zooms draw O(cells) instead of
 *    O(events).
 *
 * The synthetic generator is a stand-in for the real alert stream (which is
 * auth-gated and offline-unfriendly); the AlertSet shape is what a real adapter
 * should produce. This also seeds backlog item #1 (known-truth data source).
 */

import { angularSeparation } from '../utils/skyGeom.js';

export enum AlertType {
  Asteroid = 0,
  VariableStar = 1,
  Nova = 2,
  Satellite = 3,
  Unknown = 4,
}

export const ALERT_TYPE_NAMES = ['asteroid', 'variable', 'nova', 'satellite', 'unknown'];
export const ALERT_TYPE_COLORS = ['#ffd24d', '#4dc3ff', '#ff6ec7', '#7dff8a', '#bbbbbb'];
export const ALERT_TYPE_COUNT = 5;

/** Columnar event store. Parallel arrays indexed 0..count-1. */
export interface AlertSet {
  count: number;
  ra: Float32Array; // degrees, [0,360)
  dec: Float32Array; // degrees, [-90,90]
  type: Uint8Array; // AlertType
  mag: Float32Array; // brightness magnitude (smaller = brighter)
  time: Float32Array; // detection epoch, Modified Julian Date (MJD)
  id: Uint32Array;
  /**
   * True when the source truncated the result to a row cap — i.e. the field has
   * MORE detections than are in this set (a spatially-arbitrary subset, since the
   * DIA query has no ORDER BY). Set only by the live DIA fetch; the synthetic
   * generator never truncates and leaves this undefined. Callers must surface it.
   */
  truncated?: boolean;
}

/**
 * Synthetic detection epochs span this MJD window. MJD ~60000 is 2023-02-25;
 * ~one Rubin observing year of events keeps the time slider meaningful.
 */
export const ALERT_MJD_BASE = 60000;
export const ALERT_MJD_SPAN = 365;

/** Deterministic PRNG (mulberry32) — seeded so tests and renders are stable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate `count` synthetic alerts deterministically. Distribution is uniform
 * on the sphere (uniform in sin(dec)) with a fraction of asteroids clustered
 * near the ecliptic and satellites drawn as short great-circle-ish streaks —
 * enough spatial structure to exercise culling and density LOD.
 */
export function generateSyntheticAlerts(count: number, seed = 1): AlertSet {
  const rand = mulberry32(seed);
  const ra = new Float32Array(count);
  const dec = new Float32Array(count);
  const type = new Uint8Array(count);
  const mag = new Float32Array(count);
  const time = new Float32Array(count);
  const id = new Uint32Array(count);

  const ECLIPTIC_TILT = 23.44;
  let i = 0;
  while (i < count) {
    const r = rand();
    let a: number;
    let d: number;
    let t: AlertType;

    if (r < 0.45) {
      // Asteroids: near the ecliptic plane (approx), spread in longitude.
      const lon = rand() * 360;
      const beta = (rand() - 0.5) * 16; // ecliptic latitude spread
      a = lon;
      d = Math.max(-89, Math.min(89, beta + ECLIPTIC_TILT * Math.sin((lon * Math.PI) / 180)));
      t = AlertType.Asteroid;
    } else if (r < 0.5 && i + 20 < count) {
      // Satellite streak: a short run of events along a line.
      const a0 = rand() * 360;
      const d0 = (rand() - 0.5) * 160;
      const da = (rand() - 0.5) * 6;
      const dd = (rand() - 0.5) * 6;
      const n = 8 + Math.floor(rand() * 12);
      for (let k = 0; k < n && i < count; k++, i++) {
        ra[i] = ((a0 + (da * k) / n) % 360 + 360) % 360;
        dec[i] = Math.max(-89, Math.min(89, d0 + (dd * k) / n));
        type[i] = AlertType.Satellite;
        mag[i] = 14 + rand() * 6;
        id[i] = i;
      }
      continue;
    } else {
      // Uniform on sphere: RA uniform, Dec uniform in sin.
      a = rand() * 360;
      d = (Math.asin(2 * rand() - 1) * 180) / Math.PI;
      const rr = rand();
      t = rr < 0.6 ? AlertType.VariableStar : rr < 0.7 ? AlertType.Nova : AlertType.Unknown;
    }

    ra[i] = ((a % 360) + 360) % 360;
    dec[i] = d;
    type[i] = t;
    mag[i] = 14 + rand() * 8;
    id[i] = i;
    i++;
  }

  // Fill detection epochs from an independent PRNG stream so the spatial layout
  // (ra/dec/type/mag) is byte-identical with or without this pass — no visual
  // change to the overlay, only an added time coordinate. Uniform over the
  // survey window so a time-slider sub-window selects a proper subset.
  const trand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  for (let k = 0; k < count; k++) {
    time[k] = ALERT_MJD_BASE + trand() * ALERT_MJD_SPAN;
  }

  return { count, ra, dec, type, mag, time, id };
}

/**
 * Uniform RA/Dec grid index. `cells[bucket]` is an array of event indices, where
 * bucket = row * cols + col. A viewport query visits only overlapping buckets.
 */
export interface AlertIndex {
  cols: number;
  rows: number;
  cells: Int32Array[]; // one array of event indices per bucket
}

function bucketOf(ra: number, dec: number, cols: number, rows: number): number {
  let col = Math.floor((ra / 360) * cols);
  let row = Math.floor(((dec + 90) / 180) * rows);
  if (col < 0) col = 0;
  else if (col >= cols) col = cols - 1;
  if (row < 0) row = 0;
  else if (row >= rows) row = rows - 1;
  return row * cols + col;
}

export function buildAlertIndex(alerts: AlertSet, cols = 360, rows = 180): AlertIndex {
  const nBuckets = cols * rows;
  const counts = new Int32Array(nBuckets);
  for (let i = 0; i < alerts.count; i++) {
    counts[bucketOf(alerts.ra[i]!, alerts.dec[i]!, cols, rows)]!++;
  }
  const cells: Int32Array[] = new Array(nBuckets);
  for (let b = 0; b < nBuckets; b++) cells[b] = new Int32Array(counts[b]!);
  const fill = new Int32Array(nBuckets);
  for (let i = 0; i < alerts.count; i++) {
    const b = bucketOf(alerts.ra[i]!, alerts.dec[i]!, cols, rows);
    cells[b]![fill[b]!++] = i;
  }
  return { cols, rows, cells };
}

/**
 * Invoke `cb(index)` for every event whose RA/Dec falls in the given bounds.
 * Handles RA wrap-around (raMin may be > raMax when the view straddles 0°/360°).
 * Bounds are clamped/expanded by the caller (add a tile of margin as needed).
 */
export function queryViewport(
  index: AlertIndex,
  alerts: AlertSet,
  raMin: number,
  raMax: number,
  decMin: number,
  decMax: number,
  cb: (i: number) => void
): void {
  const { cols, rows, cells } = index;
  const rowLo = Math.max(0, Math.floor(((decMin + 90) / 180) * rows));
  const rowHi = Math.min(rows - 1, Math.floor(((decMax + 90) / 180) * rows));

  // Column ranges, split into one or two spans if RA wraps.
  const spans: [number, number][] = [];
  const wrap = raMin > raMax;
  if (wrap) {
    spans.push([raMin, 360], [0, raMax]);
  } else {
    spans.push([raMin, raMax]);
  }

  const { ra, dec } = alerts;
  for (const [aLo, aHi] of spans) {
    const colLo = Math.max(0, Math.floor((aLo / 360) * cols));
    const colHi = Math.min(cols - 1, Math.floor((aHi / 360) * cols));
    for (let row = rowLo; row <= rowHi; row++) {
      for (let col = colLo; col <= colHi; col++) {
        const bucket = cells[row * cols + col]!;
        for (let k = 0; k < bucket.length; k++) {
          const idx = bucket[k]!;
          const d = dec[idx]!;
          if (d < decMin || d > decMax) continue;
          const a = ra[idx]!;
          if (wrap) {
            if (!(a >= raMin || a <= raMax)) continue;
          } else if (a < raMin || a > raMax) {
            continue;
          }
          cb(idx);
        }
      }
    }
  }
}

/** A type filter as a bitmask over AlertType (bit t set = show type t). */
export function allTypesMask(): number {
  return (1 << ALERT_TYPE_COUNT) - 1;
}
export function typeVisible(mask: number, t: number): boolean {
  return (mask & (1 << t)) !== 0;
}

/**
 * A single alert resolved by hit-testing — everything the tooltip/inspector
 * needs, plus the great-circle distance from the query point. `separationDeg`
 * is a real spherical distance (see skyGeom.angularSeparation), NOT a box metric.
 */
export interface AlertHit {
  index: number; // row into the AlertSet columnar arrays
  id: number; // alerts.id[index]
  ra: number; // degrees
  dec: number; // degrees
  type: AlertType;
  magnitude: number;
  timeMjd: number;
  separationDeg: number; // angular distance from the query point
}

const DEG2RAD = Math.PI / 180;

/**
 * Nearest VISIBLE alert within `maxRadiusDeg` of (ra,dec), or null if none.
 *
 * Backs hover/click identification. Uses the spatial index: it visits only the
 * grid cells overlapping a bounding box around the cursor (RA half-width scaled
 * by 1/cos(dec) so the box actually covers the disc at high declination), then
 * refines each candidate with a true great-circle separation. Cost is
 * O(candidates in the neighborhood), never O(count).
 *
 * `typeMask` (default: all types) hides events whose AlertType bit is clear —
 * a hidden-type alert is never returned even if it is the closest on the sky.
 */
export function nearestAlert(
  index: AlertIndex,
  alerts: AlertSet,
  ra: number,
  dec: number,
  maxRadiusDeg: number,
  typeMask: number = allTypesMask()
): AlertHit | null {
  if (!(maxRadiusDeg > 0) || alerts.count === 0) return null;

  const decMin = Math.max(-90, dec - maxRadiusDeg);
  const decMax = Math.min(90, dec + maxRadiusDeg);

  // Convert the angular radius into an RA span at this declination. Near the
  // poles (or for a very large radius) the box degenerates to the whole RA
  // circle, so query the full [0,360) range in that case.
  const cosDec = Math.cos(dec * DEG2RAD);
  const raHalf = cosDec > 1e-9 ? maxRadiusDeg / cosDec : Infinity;

  let raMin: number;
  let raMax: number;
  if (!Number.isFinite(raHalf) || raHalf >= 180) {
    raMin = 0;
    raMax = 360;
  } else {
    raMin = ((((ra - raHalf) % 360) + 360) % 360);
    raMax = ((((ra + raHalf) % 360) + 360) % 360);
  }

  const { ra: aRa, dec: aDec, type: aType } = alerts;
  let best: AlertHit | null = null;
  let bestSep = maxRadiusDeg;

  queryViewport(index, alerts, raMin, raMax, decMin, decMax, (i) => {
    const t = aType[i]!;
    if (!typeVisible(typeMask, t)) return;
    const sep = angularSeparation(ra, dec, aRa[i]!, aDec[i]!);
    if (sep <= bestSep && (best === null || sep < bestSep)) {
      bestSep = sep;
      best = {
        index: i,
        id: alerts.id[i]!,
        ra: aRa[i]!,
        dec: aDec[i]!,
        type: t,
        magnitude: alerts.mag[i]!,
        timeMjd: alerts.time[i]!,
        separationDeg: sep,
      };
    }
  });

  return best;
}

/**
 * Full [minMjd, maxMjd] span of detection epochs — the endpoints for a time
 * slider. O(count); call once when the set loads, not per frame.
 */
export function alertTimeRange(alerts: AlertSet): [number, number] {
  if (alerts.count === 0) return [0, 0];
  const t = alerts.time;
  let lo = t[0]!;
  let hi = t[0]!;
  for (let i = 1; i < alerts.count; i++) {
    const v = t[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/**
 * The renderer's time-window filter. Returns an O(1) predicate `keep(i)` that is
 * true when event `i`'s epoch is within [tMin, tMax] (inclusive). Pass it into
 * the `queryViewport` callback so time filtering stays O(candidates):
 *
 *   const keep = timeWindowPredicate(alerts, tMin, tMax);
 *   queryViewport(index, alerts, ...bounds, (i) => { if (keep(i)) draw(i); });
 *
 * This is the intended consumption path — no per-frame allocation, no O(count)
 * scan, no mask array to rebuild when the slider moves.
 */
export function timeWindowPredicate(
  alerts: AlertSet,
  tMin: number,
  tMax: number
): (i: number) => boolean {
  const t = alerts.time;
  return (i: number) => {
    const v = t[i]!;
    return v >= tMin && v <= tMax;
  };
}

/**
 * Summary count of alerts whose epoch lies in [tMin, tMax] (inclusive) — for a
 * UI badge ("N of M events in window"). O(count); this is a whole-set summary,
 * NOT the render path (the renderer uses `timeWindowPredicate` + the index).
 * Pass `buildMask = true` to also get a per-alert Uint8Array (1 = in window).
 */
export function alertsInWindow(
  alerts: AlertSet,
  tMin: number,
  tMax: number,
  buildMask = false
): { count: number; mask?: Uint8Array } {
  const t = alerts.time;
  const mask = buildMask ? new Uint8Array(alerts.count) : undefined;
  let count = 0;
  for (let i = 0; i < alerts.count; i++) {
    const v = t[i]!;
    if (v >= tMin && v <= tMax) {
      count++;
      if (mask) mask[i] = 1;
    }
  }
  return mask ? { count, mask } : { count };
}
