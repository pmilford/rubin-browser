/**
 * Bundled catalog of well-known strong gravitational lenses (feature 130).
 *
 * Every coordinate, redshift, angular scale and magnitude below is a REAL,
 * web-verified value (SIMBAD ICRS J2000 positions, the Cambridge lensed-quasar
 * database, CASTLES/SLACS and the published discovery / follow-up literature),
 * NOT a placeholder. A wrong hardcoded position would paint a marker in the wrong
 * place and mislead the user, so the accompanying unit test
 * (`tests/unit/lenses.test.ts`) looks up several entries BY NAME and asserts their
 * RA/Dec (to ~arcsecond), angular scale and image configuration against the
 * independently-known literature values — a zeros / placeholder catalog fails it.
 *
 * A value that is genuinely unknown or not well defined (an unmeasured lens
 * redshift, a cluster with no single representative magnitude, a cluster whose
 * published Einstein radius we could not pin down to one trustworthy number) is
 * stored as `null`, never fabricated. `null` renders as the {@link CATALOG_NO_DATA}
 * dash in the linked table.
 *
 * ── The four "discriminating" columns (feature 130 enrichment) ──────────────────
 *  1. `thetaEArcsec` — the ANGULAR SCALE of the lensing, the single number for
 *     "how big is it on the sky". We use ONE consistent measure for every type:
 *     the Einstein / ring RADIUS θ_E in ARCSECONDS.
 *       • lensed quasars: θ_E ≈ (maximum image separation) / 2. The max separation
 *         is what the literature quotes; θ_E is half of it (the images straddle the
 *         Einstein radius). The per-entry comment cites the measured separation.
 *       • Einstein rings / arcs: θ_E is the ring/arc radius, quoted directly.
 *       • cluster lenses: θ_E is the critical-curve (Einstein) radius for a
 *         fiducial source at z≈2, quoted directly from the lens-model papers.
 *     So the max image separation of a quasar lens ≈ 2·θ_E, and a giant-arc
 *     cluster shows arcs at radius θ_E (tens of arcsec).
 *  2. `config` — the image configuration / count: "double" (2 images), "quad" (4),
 *     "five images", "Einstein ring", "double ring", "arc", "giant arc(s)",
 *     "many arcs" (clusters).
 *  3. `magnitude` (+ `magBand`) — a representative apparent magnitude and the band
 *     it is measured in (e.g. the lensed-source ring `g`, or the brightest quasar
 *     image `V`/`G`). `null` where there is no single meaningful value (most
 *     clusters, radio-discovered rings).
 *  4. `prominent` — a boolean flag marking the visually most obvious / iconic
 *     handful, so a user can sort/spot them. CRITERION: a lens is flagged
 *     `prominent` when it is one of the striking, easily-recognised systems — an
 *     iconic textbook configuration (Einstein Cross), a wide easily-split
 *     multiple (Twin Quasar), a near-complete Einstein ring (Cosmic Horseshoe),
 *     or a major giant-arc cluster with a large Einstein radius (Abell 1689/370/
 *     2218, SMACS J0723) or the famous double ring (the Jackpot). It is NOT a
 *     data-derived score; it is a curated "these are the obvious ones" mark.
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

/** One strong gravitational lens with a verified J2000 position and properties. */
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
  /**
   * Angular scale of the lensing: the Einstein / ring RADIUS θ_E in ARCSECONDS
   * (see the module header for the one-measure convention). Max image separation
   * of a quasar lens ≈ 2·θ_E. `null` where no trustworthy single value exists.
   */
  thetaEArcsec: number | null;
  /** Image configuration / count, e.g. "double", "quad", "Einstein ring", "many arcs". */
  config: string;
  /** Representative apparent magnitude, or null if there is no single meaningful value. */
  magnitude: number | null;
  /** Photometric band for {@link magnitude} (e.g. "V", "g", "G"); null iff magnitude is null. */
  magBand: string | null;
  /** True for the visually most obvious / iconic handful (see header criterion). */
  prominent: boolean;
  /** One-line human note. */
  note: string;
}

/**
 * The curated set. Positions are ICRS J2000 from SIMBAD (verified 2026-07);
 * redshifts, angular scales, configurations and magnitudes from SIMBAD and the
 * cited discovery / analysis literature (sources in the per-entry comments).
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
    // Max image separation ≈ 1.8″ ⇒ θ_E ≈ 0.9″. Quasar total mag V≈16.8.
    // (Wikipedia/constellation-guide; NASA/Hubble G2237+0305.)
    thetaEArcsec: 0.9, config: 'quad', magnitude: 16.8, magBand: 'V', prominent: true,
    note: 'z=1.7 quasar imaged into a cross by a face-on z=0.04 spiral (Huchra’s Lens); ~1.8″ across.',
  },
  {
    name: 'Twin Quasar (Q0957+561)',
    ra: 150.3362, dec: 55.8988,
    type: 'lensed-quasar', zLens: 0.36, zSource: 1.413,
    // A–B separation 6.1″ ⇒ θ_E ≈ 3.05″ (cluster-boosted); images V≈16.7.
    // (Wikipedia Twin Quasar; Walsh, Carswell & Weymann 1979.)
    thetaEArcsec: 3.05, config: 'double', magnitude: 16.7, magBand: 'V', prominent: true,
    note: 'First gravitational lens ever confirmed (1979); two images 6.1″ apart — easily split.',
  },
  {
    name: 'HE 0435-1223',
    ra: 69.5620, dec: -12.2874,
    type: 'lensed-quasar', zLens: 0.454, zSource: 1.693,
    // Max image separation ≈ 2.6″ ⇒ θ_E ≈ 1.3″; images g≈19.0–19.6.
    // (Wisotzki et al. 2002; Wikipedia HE 0435−1223.)
    thetaEArcsec: 1.3, config: 'quad', magnitude: 19.0, magBand: 'g', prominent: false,
    note: 'Quadruply-imaged quasar (a rare Einstein cross); a H0LiCOW time-delay system.',
  },
  {
    name: 'PG 1115+080',
    ra: 169.5706, dec: 7.7662,
    type: 'lensed-quasar', zLens: 0.311, zSource: 1.722,
    // Max image separation 2.43″ ⇒ θ_E ≈ 1.22″; brightest image Gaia G≈17.2.
    // (Cambridge lensed-quasar database, PG1115+080.)
    thetaEArcsec: 1.22, config: 'quad', magnitude: 17.2, magBand: 'G', prominent: false,
    note: 'Classic "triple quasar" quad lens (Weymann et al. 1980); images span 2.4″.',
  },
  {
    name: 'Cloverleaf (H1413+117)',
    ra: 213.9427, dec: 11.4954,
    type: 'lensed-quasar', zLens: null, zSource: 2.520,
    // Image separations 0.77–1.36″ ⇒ θ_E ≈ 0.68″; quasar V≈17. Lens z unmeasured.
    // (Magain et al. 1988; A&A 2007 HST deconvolution.)
    thetaEArcsec: 0.68, config: 'quad', magnitude: 17.0, magBand: 'V', prominent: false,
    note: 'Quadruple-imaged broad-absorption-line quasar (~1.4″ across); lens redshift unmeasured.',
  },
  {
    name: 'RX J1131-1231',
    ra: 172.9644, dec: -12.5329,
    type: 'lensed-quasar', zLens: 0.295, zSource: 0.658,
    // Host lensed into an Einstein ring of radius θ_E ≈ 1.8″ (max image sep 3.23″);
    // brightest image Gaia G≈17.9. (Cambridge lensed-quasar DB; Sluse et al. 2003.)
    thetaEArcsec: 1.8, config: 'quad', magnitude: 17.9, magBand: 'G', prominent: false,
    note: 'Brightest X-ray quad lens; spinning black hole measured via microlensing.',
  },

  // ---- Group / cluster lenses ----
  {
    name: 'SDSS J1004+4112',
    ra: 151.1450, dec: 41.2108,
    type: 'group-cluster', zLens: 0.68, zSource: 1.734,
    // Five quasar images span a max separation of 14.62″ ⇒ θ_E ≈ 7.3″.
    // (Inada et al. 2003; Oguri et al. 2004; Wikipedia SDSS J1004+4112.)
    thetaEArcsec: 7.3, config: 'five images', magnitude: null, magBand: null, prominent: false,
    note: 'Galaxy cluster lensing a z=1.734 quasar into five images ~15″ apart.',
  },
  {
    name: 'Abell 1689',
    ra: 197.8729, dec: -1.3411,
    type: 'group-cluster', zLens: 0.184, zSource: null,
    // Einstein radius θ_E = 47.0 ± 1.2″ for a source at z=2 (>100 giant arcs).
    // (Limousin et al. 2007; Coe et al. 2010.)
    thetaEArcsec: 47.0, config: 'many arcs', magnitude: null, magBand: null, prominent: true,
    note: 'Massive cluster with >100 giant arcs; θ_E≈47″ — a canonical strong-lens cluster.',
  },
  {
    name: 'Abell 370',
    ra: 39.9604, dec: -1.5856,
    type: 'group-cluster', zLens: 0.375, zSource: null,
    // Einstein radius θ_E = 39 ± 2″ for a source at z=2; hosts the giant "Dragon" arc.
    // (Richard et al. 2010, "Abell 370 revisited".)
    thetaEArcsec: 39.0, config: 'giant arc', magnitude: null, magBand: null, prominent: true,
    note: 'First cluster where a giant lensed arc ("the Dragon") was recognised; θ_E≈39″.',
  },
  {
    name: 'Abell 2218',
    ra: 248.9750, dec: 66.2167,
    type: 'group-cluster', zLens: 0.175, zSource: null,
    // Critical (Einstein) radius ≈ 22.1″ (~85 kpc); >100 arclets, 7 image systems.
    // (Kneib et al.; AbdelSalam/Saha nonparametric models.)
    thetaEArcsec: 22.1, config: 'many arcs', magnitude: null, magBand: null, prominent: true,
    note: 'Textbook Hubble cluster lens; giant arcs at θ_E≈22″, arcs at several redshifts.',
  },
  {
    name: 'Bullet Cluster (1E 0657-56)',
    ra: 104.6120, dec: -55.9720,
    type: 'group-cluster', zLens: 0.296, zSource: null,
    // Merging cluster; strong-lensing Einstein radius is model-dependent and not
    // quoted as one trustworthy value here → null rather than a guess.
    thetaEArcsec: null, config: 'arcs', magnitude: null, magBand: null, prominent: false,
    note: 'Merging cluster; weak+strong lensing offset from gas maps dark matter.',
  },
  {
    name: 'MACS J1149.5+2223',
    ra: 177.6490, dec: 22.3990,
    type: 'group-cluster', zLens: 0.544, zSource: null,
    // Critically lensed region ≈170 kpc in radius with 1″=6.4 kpc ⇒ θ_E ≈ 27″.
    // (Zitrin & Broadhurst 2009; Smith et al. 2009.)
    thetaEArcsec: 27.0, config: 'giant arcs', magnitude: null, magBand: null, prominent: false,
    note: 'Host of "Refsdal" — first predicted, then observed, lensed supernova; θ_E≈27″.',
  },
  {
    name: 'SMACS J0723.3-7327',
    ra: 110.8050, dec: -73.4570,
    type: 'group-cluster', zLens: 0.390, zSource: null,
    // Published effective Einstein radii vary widely between models/definitions, so
    // we leave the single-number scale null rather than commit to one uncertain value.
    thetaEArcsec: null, config: 'many arcs', magnitude: null, magBand: null, prominent: true,
    note: "Subject of JWST's first deep field; striking arcs of many background galaxies.",
  },

  // ---- Arcs / Einstein rings ----
  {
    name: 'Cosmic Horseshoe (SDSS J1148+1930)',
    ra: 177.1379, dec: 19.5009,
    type: 'arc-ring', zLens: 0.444, zSource: 2.379,
    // Einstein ring radius θ_E = 5.0 ± 0.3″ (near-complete ~300° ring); ring g≈20.1.
    // (Belokurov et al. 2007; Dye et al. 2008.)
    thetaEArcsec: 5.0, config: 'Einstein ring', magnitude: 20.1, magBand: 'g', prominent: true,
    note: 'Near-complete 300° Einstein ring (radius ≈5″) around a very massive LRG.',
  },
  {
    name: 'MG1131+0456',
    ra: 172.9854, dec: 4.9302,
    type: 'arc-ring', zLens: 0.844, zSource: null,
    // Radio ring major axis ≈2.2″ ⇒ ring radius θ_E ≈ 1.05″; radio-discovered (no
    // single optical mag) → magnitude null. (Hewitt et al. 1988, Nature.)
    thetaEArcsec: 1.05, config: 'Einstein ring', magnitude: null, magBand: null, prominent: false,
    note: 'First Einstein ring ever discovered (Hewitt et al. 1988, radio); ~2.2″ across.',
  },
  {
    name: "8 o'clock arc (SDSS J0022+1431)",
    ra: 5.6705, dec: 14.5195,
    type: 'arc-ring', zLens: 0.38, zSource: 2.73,
    // Three images form a partial ring of radius θ_E = 3.32 ± 0.16″ (arc 9.6″ long,
    // 162°); total g≈20.0. (Allam et al. 2007.)
    thetaEArcsec: 3.32, config: 'arc', magnitude: 20.0, magBand: 'g', prominent: false,
    note: 'One of the brightest lensed Lyman-break galaxies known; 162° arc, θ_E≈3.3″.',
  },

  // ---- Galaxy-galaxy lenses ----
  {
    name: 'The Jackpot (SDSS J0946+1006)',
    ra: 146.7363, dec: 10.1144,
    type: 'galaxy-galaxy', zLens: 0.222, zSource: 0.609,
    // Double ring: inner θ_E1 = 1.43″ (z=0.609), outer θ_E2 = 2.07″; we store the
    // outer (largest) radius. (Gavazzi et al. 2008, SLACS VI.)
    thetaEArcsec: 2.07, config: 'double ring', magnitude: null, magBand: null, prominent: true,
    note: 'Double Einstein ring (inner 1.43″, outer 2.07″) — two sources at different z (SLACS).',
  },
  {
    name: 'ESO 325-G004',
    ra: 205.8884, dec: -38.1760,
    type: 'galaxy-galaxy', zLens: 0.034, zSource: 2.141,
    // Partial Einstein ring of radius θ_E = 2.85 ± 0.40″. (Smith & Lucey 2013.)
    thetaEArcsec: 2.85, config: 'Einstein ring', magnitude: null, magBand: null, prominent: false,
    note: 'One of the nearest galaxy-galaxy lenses (θ_E≈2.85″); used to test gravity.',
  },
  {
    name: 'SDSS J0737+3216',
    ra: 114.3685, dec: 32.2718,
    type: 'galaxy-galaxy', zLens: 0.322, zSource: 0.581,
    // SLACS Einstein radius b_SIE = 1.03″. (Bolton et al. 2008, SLACS V.)
    thetaEArcsec: 1.03, config: 'Einstein ring', magnitude: null, magBand: null, prominent: false,
    note: 'SLACS Einstein-ring lens (θ_E≈1.03″) resolved by Hubble + Keck laser-guide-star AO.',
  },
];

/** Table-cell value for a redshift: the number, or the {@link CATALOG_NO_DATA} dash. */
function zField(z: number | null): string | number {
  return z === null ? CATALOG_NO_DATA : z;
}

/** Table-cell value for the angular scale θ_E: the number, or the dash if null. */
function scaleField(theta: number | null): string | number {
  return theta === null ? CATALOG_NO_DATA : theta;
}

/**
 * Table-cell value for the magnitude: "16.8 V" (value + band), or the dash when
 * there is no single representative magnitude.
 */
function magField(mag: number | null, band: string | null): string {
  return mag === null || band === null ? CATALOG_NO_DATA : `${mag} ${band}`;
}

/** Table-cell value for the prominence flag: a visible "yes", or the dash. */
function prominentField(prominent: boolean): string {
  return prominent ? 'yes' : CATALOG_NO_DATA;
}

/**
 * Adapt {@link LENS_CATALOG} into the generic {@link CatalogSet} the feature-101
 * overlay renderer and `CatalogTable` consume.
 *
 * - Geometry: `ra`/`dec` are the verified J2000 degrees, column-for-column.
 * - `label[i]` is the lens name (drawn beside the marker).
 * - `records[i]` is the table row. Alongside the original `Name`/`Type`/`z_lens`/
 *   `z_source`/`Note` columns it now carries the four discriminating columns
 *   `θ_E (")`, `Config`, `Mag`, `Obvious`, so a user can compare the diameter,
 *   image count, brightness and "which is the most obvious" at a glance.
 *   A null number becomes the dash, never `null`/`NaN`.
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
      'θ_E (")': scaleField(lens.thetaEArcsec),
      Config: lens.config,
      Mag: magField(lens.magnitude, lens.magBand),
      Obvious: prominentField(lens.prominent),
      Note: lens.note,
    };
  }

  return { count, ra, dec, label, records };
}
