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
  id: Uint32Array;
}

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

  return { count, ra, dec, type, mag, id };
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
