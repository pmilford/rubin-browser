/**
 * Bundled catalog of well-known strong gravitational lenses (feature 130).
 *
 * Every coordinate and redshift below is a REAL, web-verified value (SIMBAD ICRS
 * J2000 positions and published discovery / follow-up papers), NOT a placeholder.
 * A wrong hardcoded position would paint a marker in the wrong place and mislead
 * the user, so the accompanying unit test (`tests/unit/lenses.test.ts`) looks up
 * several entries BY NAME and asserts their RA/Dec against the independently-known
 * positions to ~arcsecond — a zeros / placeholder catalog fails that test.
 *
 * A redshift that is genuinely unknown (e.g. an unmeasured background source, or
 * a cluster lens with many sources at different redshifts) is stored as `null`,
 * never fabricated. `null` renders as the {@link CATALOG_NO_DATA} dash in the
 * linked table.
 *
 * The `lensCatalogSet()` adapter turns this list into the generic {@link CatalogSet}
 * the existing feature-101 overlay renderer + `CatalogTable` consume — this module
 * adds NO new overlay/table machinery.
 */

import { CATALOG_NO_DATA, type CatalogSet } from './catalog.js';

/**
 * Broad class of a strong lens:
 * - `lensed-quasar` — a background QSO multiply imaged by a foreground galaxy.
 * - `galaxy-galaxy` — a galaxy lensing a background galaxy (Einstein ring/arcs).
 * - `group-cluster` — a galaxy group or cluster producing giant arcs / multiple images.
 * - `arc-ring` — systems best known for a prominent arc or (near-)complete Einstein ring.
 */
export type LensType = 'galaxy-galaxy' | 'group-cluster' | 'lensed-quasar' | 'arc-ring';

/** One strong gravitational lens with a verified J2000 position and redshifts. */
export interface GravLens {
  /** Common name plus catalogue designation (e.g. "Einstein Cross (Q2237+0305)"). */
  name: string;
  /** J2000 right ascension, degrees [0,360). */
  ra: number;
  /** J2000 declination, degrees [-90,90]. */
  dec: number;
  /** Strong-lens class. */
  type: LensType;
  /** Redshift of the lensing (foreground) object, or null if genuinely unknown. */
  zLens: number | null;
  /** Redshift of the lensed (background) source, or null if unknown / not single-valued. */
  zSource: number | null;
  /** One-line human note. */
  note: string;
}

/**
 * The curated set. Positions are ICRS J2000 from SIMBAD (verified 2026-07);
 * redshifts from SIMBAD and the cited discovery / analysis literature.
 *
 * NOTE ON THE EINSTEIN CROSS: its declination is POSITIVE, +3.3585°, consistent
 * with the "+0305" in the designation Q2237+0305 (Dec +03°21′ in J2000) and with
 * SIMBAD. (A commonly-circulated negative value is wrong.)
 */
export const LENS_CATALOG: GravLens[] = [
  // ---- Lensed quasars ----
  {
    name: 'Einstein Cross (Q2237+0305)',
    ra: 340.1260, dec: 3.3585,
    type: 'lensed-quasar', zLens: 0.0394, zSource: 1.695,
    note: 'z=1.7 quasar imaged into a cross by a face-on z=0.04 spiral (Huchra’s Lens).',
  },
  {
    name: 'Twin Quasar (Q0957+561)',
    ra: 150.3362, dec: 55.8988,
    type: 'lensed-quasar', zLens: 0.36, zSource: 1.413,
    note: 'First gravitational lens ever confirmed (Walsh, Carswell & Weymann 1979).',
  },
  {
    name: 'HE 0435-1223',
    ra: 69.5620, dec: -12.2874,
    type: 'lensed-quasar', zLens: 0.454, zSource: 1.693,
    note: 'Quadruply-imaged quasar; a H0LiCOW time-delay cosmography system.',
  },
  {
    name: 'PG 1115+080',
    ra: 169.5706, dec: 7.7662,
    type: 'lensed-quasar', zLens: 0.311, zSource: 1.722,
    note: 'Classic "triple quasar" quad lens (Weymann et al. 1980).',
  },
  {
    name: 'Cloverleaf (H1413+117)',
    ra: 213.9427, dec: 11.4954,
    type: 'lensed-quasar', zLens: null, zSource: 2.520,
    note: 'Quadruple-imaged broad-absorption-line quasar; lens redshift unmeasured.',
  },
  {
    name: 'RX J1131-1231',
    ra: 172.9644, dec: -12.5329,
    type: 'lensed-quasar', zLens: 0.295, zSource: 0.658,
    note: 'Brightest X-ray quad lens; spinning black hole measured via microlensing.',
  },

  // ---- Group / cluster lenses ----
  {
    name: 'SDSS J1004+4112',
    ra: 151.1450, dec: 41.2108,
    type: 'group-cluster', zLens: 0.68, zSource: 1.734,
    note: 'Galaxy cluster lensing a z=1.734 quasar into five images 15″ apart.',
  },
  {
    name: 'Abell 1689',
    ra: 197.8729, dec: -1.3411,
    type: 'group-cluster', zLens: 0.184, zSource: null,
    note: 'Massive cluster with >100 giant arcs; a canonical strong-lens cluster.',
  },
  {
    name: 'Abell 370',
    ra: 39.9604, dec: -1.5856,
    type: 'group-cluster', zLens: 0.375, zSource: null,
    note: 'First cluster where a giant lensed arc ("the Dragon") was recognised.',
  },
  {
    name: 'Abell 2218',
    ra: 248.9750, dec: 66.2167,
    type: 'group-cluster', zLens: 0.175, zSource: null,
    note: 'Textbook Hubble cluster lens; multiple arc systems at several redshifts.',
  },
  {
    name: 'Bullet Cluster (1E 0657-56)',
    ra: 104.6120, dec: -55.9720,
    type: 'group-cluster', zLens: 0.296, zSource: null,
    note: 'Merging cluster; weak+strong lensing offset from gas maps dark matter.',
  },
  {
    name: 'MACS J1149.5+2223',
    ra: 177.6490, dec: 22.3990,
    type: 'group-cluster', zLens: 0.544, zSource: null,
    note: 'Host of "Refsdal" — first predicted, then observed, lensed supernova.',
  },
  {
    name: 'SMACS J0723.3-7327',
    ra: 110.8050, dec: -73.4570,
    type: 'group-cluster', zLens: 0.390, zSource: null,
    note: "Subject of JWST's first deep field; arcs of many background galaxies.",
  },

  // ---- Arcs / Einstein rings ----
  {
    name: 'Cosmic Horseshoe (SDSS J1148+1930)',
    ra: 177.1379, dec: 19.5009,
    type: 'arc-ring', zLens: 0.444, zSource: 2.379,
    note: 'Near-complete 300° Einstein ring around a very massive LRG.',
  },
  {
    name: 'MG1131+0456',
    ra: 172.9854, dec: 4.9302,
    type: 'arc-ring', zLens: 0.844, zSource: null,
    note: 'First Einstein ring ever discovered (Hewitt et al. 1988, radio).',
  },
  {
    name: "8 o'clock arc (SDSS J0022+1431)",
    ra: 5.6705, dec: 14.5195,
    type: 'arc-ring', zLens: 0.38, zSource: 2.73,
    note: 'One of the brightest lensed Lyman-break galaxies known.',
  },

  // ---- Galaxy-galaxy lenses ----
  {
    name: 'The Jackpot (SDSS J0946+1006)',
    ra: 146.7363, dec: 10.1144,
    type: 'galaxy-galaxy', zLens: 0.222, zSource: 0.609,
    note: 'Double Einstein ring — two background sources at different redshifts (SLACS).',
  },
  {
    name: 'ESO 325-G004',
    ra: 205.8884, dec: -38.1760,
    type: 'galaxy-galaxy', zLens: 0.034, zSource: 2.141,
    note: 'One of the nearest galaxy-galaxy lenses; used to test gravity (Smith & Lucey 2013).',
  },
  {
    name: 'SDSS J0737+3216',
    ra: 114.3685, dec: 32.2718,
    type: 'galaxy-galaxy', zLens: 0.322, zSource: 0.581,
    note: 'SLACS Einstein-ring lens resolved by Hubble + Keck laser-guide-star AO.',
  },
];

/** Table-cell value for a redshift: the number, or the {@link CATALOG_NO_DATA} dash. */
function zField(z: number | null): string | number {
  return z === null ? CATALOG_NO_DATA : z;
}

/**
 * Adapt {@link LENS_CATALOG} into the generic {@link CatalogSet} the feature-101
 * overlay renderer and `CatalogTable` consume.
 *
 * - Geometry: `ra`/`dec` are the verified J2000 degrees, column-for-column.
 * - `label[i]` is the lens name (drawn beside the marker).
 * - `records[i]` is the table row: `Name`, `Type`, `z_lens`, `z_source`, `Note`.
 *   A null redshift becomes the dash, never `null`/`NaN`.
 */
export function lensCatalogSet(): CatalogSet {
  const count = LENS_CATALOG.length;
  const ra = new Float32Array(count);
  const dec = new Float32Array(count);
  const label: string[] = new Array<string>(count);
  const records: Record<string, string | number>[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const lens = LENS_CATALOG[i]!;
    ra[i] = lens.ra;
    dec[i] = lens.dec;
    label[i] = lens.name;
    records[i] = {
      Name: lens.name,
      Type: lens.type,
      z_lens: zField(lens.zLens),
      z_source: zField(lens.zSource),
      Note: lens.note,
    };
  }

  return { count, ra, dec, label, records };
}
