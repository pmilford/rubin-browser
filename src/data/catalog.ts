/**
 * Generic catalog-overlay data layer — the shape the ImageViewer overlay renders
 * and a linked table panel lists.
 *
 * This is deliberately catalog-AGNOSTIC. It mirrors the columnar + uniform-grid
 * strategy of `src/data/alerts.ts` (flat TypedArrays for RA/Dec, a uniform RA/Dec
 * bucket grid for O(cells) viewport culling) so the overlay renderer can reuse the
 * exact same culling path it already uses for alerts. On top of the geometry it
 * carries two per-source presentation columns the alert set does not need:
 *
 *   - `label[i]`   — the short marker/id string drawn at the source.
 *   - `records[i]` — the full attribute map shown in the linked table row for
 *                    source i (parallel to ra/dec, so a table click ↔ marker
 *                    highlight is a single shared index).
 *
 * A concrete adapter ({@link gaiaToCatalogSet}) turns a Gaia cone-search result
 * into this shape; other catalogs (Rubin Object, DIA, …) get their own adapters.
 */

import { angularSeparation } from '../utils/skyGeom.js';
import type { GaiaCatalog } from '../api/gaia.js';
import { bpRpToRgb, parallaxToDistancePc } from '../utils/gaiaViz.js';

/**
 * Columnar catalog store. `ra`/`dec`/`label`/`records` are all parallel arrays
 * indexed 0..count-1: source i is at (ra[i], dec[i]), draws marker `label[i]`,
 * and lists attribute map `records[i]` in the table.
 *
 * The trailing OPTIONAL columns carry richer per-source presentation the overlay
 * renderer can use when a catalog provides it (Gaia does; the lens set does not):
 *   - `colorRgb[i*3..i*3+2]` — the marker's RGB (Gaia colours markers by BP−RP).
 *   - `pmRaMasYr[i]` / `pmDecMasYr[i]` — proper motion (μα*, μδ) in mas/yr for the
 *     optional PM-vector arrows; NaN where a source has no measured proper motion.
 * A catalog that omits these is drawn with the default marker style (unchanged),
 * so adding them NEVER breaks the existing Gaia table or the lens overlay.
 */
export interface CatalogSet {
  count: number;
  ra: Float32Array; // degrees, [0,360)
  dec: Float32Array; // degrees, [-90,90]
  label: string[]; // short marker/id per source
  records: Record<string, string | number>[]; // full attribute map per source (table row)
  colorRgb?: Uint8ClampedArray; // optional per-source marker RGB (length count*3)
  pmRaMasYr?: Float32Array; // optional per-source pmRA* (μα*, mas/yr), NaN if unknown
  pmDecMasYr?: Float32Array; // optional per-source pmDec (μδ, mas/yr), NaN if unknown
}

/**
 * Uniform RA/Dec grid index over a CatalogSet. `cells[row * cols + col]` is the
 * array of source indices whose RA/Dec fall in that bucket, so a viewport query
 * visits only overlapping buckets, never all `count` sources. The `ra`/`dec`
 * references are held so {@link catalogInViewport} / {@link nearestInCatalog} can
 * refine candidates without the caller re-passing the set (mirrors the alert
 * index's role, kept self-contained per the overlay's needs).
 */
export interface CatalogIndex {
  cols: number;
  rows: number;
  cells: Int32Array[]; // one array of source indices per bucket
  ra: Float32Array; // reference to the set's RA column
  dec: Float32Array; // reference to the set's Dec column
  count: number;
}

const DEG2RAD = Math.PI / 180;

/** Bucket index for an (ra,dec), clamped into the grid (mirrors alerts.ts). */
function bucketOf(ra: number, dec: number, cols: number, rows: number): number {
  let col = Math.floor((ra / 360) * cols);
  let row = Math.floor(((dec + 90) / 180) * rows);
  if (col < 0) col = 0;
  else if (col >= cols) col = cols - 1;
  if (row < 0) row = 0;
  else if (row >= rows) row = rows - 1;
  return row * cols + col;
}

/**
 * Build a uniform RA/Dec grid index over a CatalogSet. Two-pass counting fill
 * (count per bucket, allocate, scatter) so each cell is a tightly-sized
 * Int32Array — same construction as `buildAlertIndex`.
 */
export function buildCatalogIndex(set: CatalogSet, cols = 360, rows = 180): CatalogIndex {
  const nBuckets = cols * rows;
  const counts = new Int32Array(nBuckets);
  for (let i = 0; i < set.count; i++) {
    counts[bucketOf(set.ra[i]!, set.dec[i]!, cols, rows)]!++;
  }
  const cells: Int32Array[] = new Array(nBuckets);
  for (let b = 0; b < nBuckets; b++) cells[b] = new Int32Array(counts[b]!);
  const fill = new Int32Array(nBuckets);
  for (let i = 0; i < set.count; i++) {
    const b = bucketOf(set.ra[i]!, set.dec[i]!, cols, rows);
    cells[b]![fill[b]!++] = i;
  }
  return { cols, rows, cells, ra: set.ra, dec: set.dec, count: set.count };
}

/**
 * Indices of every source whose RA/Dec falls within [raMin,raMax]×[decMin,decMax].
 * Visits only the grid buckets the box overlaps. Handles RA wrap-around exactly
 * like `queryViewport` in alerts.ts: when the view straddles 0°/360° the caller
 * passes `raMin > raMax`, which is split into two column spans ([raMin,360] and
 * [0,raMax]) and each candidate's RA is tested with the wrap predicate
 * `ra >= raMin || ra <= raMax`.
 */
export function catalogInViewport(
  index: CatalogIndex,
  raMin: number,
  raMax: number,
  decMin: number,
  decMax: number
): number[] {
  const { cols, rows, cells, ra, dec } = index;
  const out: number[] = [];
  const rowLo = Math.max(0, Math.floor(((decMin + 90) / 180) * rows));
  const rowHi = Math.min(rows - 1, Math.floor(((decMax + 90) / 180) * rows));
  if (rowLo > rowHi) return out;

  const wrap = raMin > raMax;
  const spans: [number, number][] = wrap ? [[raMin, 360], [0, raMax]] : [[raMin, raMax]];

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
          out.push(idx);
        }
      }
    }
  }
  return out;
}

/**
 * Nearest source to (ra,dec) within `maxRadiusDeg`, by TRUE great-circle
 * separation (skyGeom.angularSeparation) — not a box metric, not the first hit.
 * Returns `{ index, separationDeg }` for the closest source, or null if none is
 * within the radius (or the set is empty / radius ≤ 0).
 *
 * Uses the grid: the angular radius is converted to an RA half-width scaled by
 * 1/cos(dec) (degenerating to the full RA circle near the poles / for a large
 * radius), only the overlapping buckets are visited, and each candidate is
 * refined with a real spherical separation — O(neighborhood), never O(count).
 */
export function nearestInCatalog(
  index: CatalogIndex,
  ra: number,
  dec: number,
  maxRadiusDeg: number
): { index: number; separationDeg: number } | null {
  if (!(maxRadiusDeg > 0) || index.count === 0) return null;

  const decMin = Math.max(-90, dec - maxRadiusDeg);
  const decMax = Math.min(90, dec + maxRadiusDeg);

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

  const { ra: cRa, dec: cDec } = index;
  const candidates = catalogInViewport(index, raMin, raMax, decMin, decMax);

  let bestIndex = -1;
  let bestSep = maxRadiusDeg;
  for (let k = 0; k < candidates.length; k++) {
    const i = candidates[k]!;
    const sep = angularSeparation(ra, dec, cRa[i]!, cDec[i]!);
    if (sep <= bestSep && (bestIndex === -1 || sep < bestSep)) {
      bestSep = sep;
      bestIndex = i;
    }
  }

  return bestIndex === -1 ? null : { index: bestIndex, separationDeg: bestSep };
}

/**
 * Placeholder shown in a table cell whose underlying value is null/NaN — a real,
 * visible "no data" mark, never a raw `NaN` leaking into the UI.
 */
export const CATALOG_NO_DATA = '—';

/** Add `key` = finite `value`, else the {@link CATALOG_NO_DATA} dash. */
function numField(
  rec: Record<string, string | number>,
  key: string,
  value: number
): void {
  rec[key] = Number.isFinite(value) ? value : CATALOG_NO_DATA;
}

/**
 * Adapt a Gaia DR3 cone-search {@link GaiaCatalog} into the generic CatalogSet.
 *
 * - Geometry: `ra`/`dec` are shared column-for-column (already degrees, [0,360)).
 * - `label` is the Gaia `source_id` string (kept textual — a 64-bit id would lose
 *   its low digits through a JS number).
 * - `records[i]` is the table row: a provenance `Catalog` = "Gaia DR3", the
 *   `Source ID`, and the standard astrometry/photometry columns. A NaN numeric
 *   (Gaia leaves colour/parallax/pm null for many sources) renders as the
 *   {@link CATALOG_NO_DATA} dash, never as `NaN`.
 */
export function gaiaToCatalogSet(cat: GaiaCatalog): CatalogSet {
  const count = cat.count;
  const ra = new Float32Array(count);
  const dec = new Float32Array(count);
  const label: string[] = new Array<string>(count);
  const records: Record<string, string | number>[] = new Array(count);
  // Rich presentation columns: per-source marker colour (from BP−RP) and proper
  // motion (for the optional PM arrows). A NaN BP−RP yields the neutral grey via
  // bpRpToRgb, so every source gets a colour and none is dropped.
  const colorRgb = new Uint8ClampedArray(count * 3);
  const pmRaMasYr = new Float32Array(count);
  const pmDecMasYr = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    ra[i] = cat.ra[i]!;
    dec[i] = cat.dec[i]!;
    const sourceId = cat.sourceId[i] ?? '';
    label[i] = sourceId;

    const [r, g, b] = bpRpToRgb(cat.bpRp[i]!);
    colorRgb[i * 3] = r;
    colorRgb[i * 3 + 1] = g;
    colorRgb[i * 3 + 2] = b;
    pmRaMasYr[i] = cat.pmRa[i]!;
    pmDecMasYr[i] = cat.pmDec[i]!;

    const rec: Record<string, string | number> = {
      Catalog: 'Gaia DR3',
      'Source ID': sourceId,
    };
    numField(rec, 'G (mag)', cat.gMag[i]!);
    numField(rec, 'BP−RP', cat.bpRp[i]!);
    numField(rec, 'pmRA (mas/yr)', cat.pmRa[i]!);
    numField(rec, 'pmDec (mas/yr)', cat.pmDec[i]!);
    numField(rec, 'Parallax (mas)', cat.parallax[i]!);
    // Distance from parallax (1000/ϖ pc) — only for ϖ > 0; a non-positive parallax
    // is real and unusable, so it shows the "no data" dash, never a bogus/negative
    // distance. Rounded to whole parsecs for a compact readout.
    const dpc = parallaxToDistancePc(cat.parallax[i]!);
    rec['Distance (pc)'] = dpc === null ? CATALOG_NO_DATA : Math.round(dpc);
    records[i] = rec;
  }

  return { count, ra, dec, label, records, colorRgb, pmRaMasYr, pmDecMasYr };
}
