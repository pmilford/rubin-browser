/**
 * PURE catalog cross-match override for the image classifier (TODO 151).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The luminance-morphology classifier (`objectClassifier.ts`) OVERFITS. On an
 * independent validation holdout (tests/regression/objectClassifier.validation.test.ts)
 * it scores acc 0.36 / star-recall 0.06 — BELOW the 0.5 always-galaxy baseline —
 * because a BRIGHT star (Sirius/Vega/Aldebaran) saturates and blooms in single-band
 * DSS into a large, low-concentration blob that is morphologically INDISTINGUISHABLE
 * from a galaxy. No luminance feature separates them. The robust fix is NOT another
 * pixel threshold; it is a CATALOG cross-match: a source that coincides with a Gaia
 * point source or a SIMBAD stellar type IS a star with high confidence regardless of
 * how its DSS blob looks; a SIMBAD galaxy type IS a galaxy. This module is the pure
 * decision that folds those catalog candidates over the morphology result.
 *
 * PURE: no network, no DOM, no randomness. The caller resolves nearby catalog
 * objects (SIMBAD `objectsNear`, Gaia cone) and passes them in as thin
 * {@link CatalogCandidate} adapters. Precedence: a DECISIVE catalog match (star or
 * galaxy) within the match radius OVERRIDES the morphology call; an ambiguous match
 * (AGN/QSO/Blazar — point-like but extragalactic) or NO match leaves morphology
 * untouched.
 *
 * ── HOW THE UI SHOULD WIRE THIS (for the orchestrator — do NOT wire here) ─────
 * The cursor-classify seam is `ImageViewer.svelte` `handleClick`/`onClassify`
 * (~line 2953): today it calls `sampleCutoutAt(r,d)` → `classifyCutout(cut)` → the
 * `onClassify(classification)` callback that feeds `ObjectInfoPanel`. To integrate:
 *   1. At the SAME clicked (r,d), resolve nearby catalog objects. SIMBAD is the
 *      primary source (public, no token): `objectsNear({ ra:r, dec:d,
 *      radiusArcsec: ~10 })` returns `SimbadObject[]` each already carrying
 *      `objectType` (otype_txt) + `separationArcsec` — map each with
 *      {@link simbadObjectToCandidate}. Gaia (also public) adds point-source
 *      evidence for stars with no SIMBAD entry: cone-search at (r,d), compute each
 *      source's separation via `skyGeom.angularSeparation`, and build a candidate
 *      with `source:'gaia'` (+ its parallax/PM if present). Both clients are async
 *      network calls, so this must happen in the (already async) click handler, NOT
 *      inside `sampleCutoutAt`.
 *   2. Feed the morphology result through this helper:
 *        `const finalCls = classifyWithCatalog(classification, candidates, {});`
 *      then pass `finalCls` to `onClassify`. A match radius of ~3–5″ is right for
 *      a deliberate click (the catalog gives the object CENTRE; the click lands on
 *      the blob). `ObjectInfoPanel` already renders `.provenance` and `.reason`, so
 *      a catalog override is self-documenting ("Gaia point-source match → star").
 *   3. Keep morphology as the FALLBACK: off-line / no catalog reachable / empty
 *      cone ⇒ `candidates:[]` ⇒ this returns the morphology result UNCHANGED. Never
 *      block the classify on the catalog call — resolve it best-effort and fold it
 *      in when it arrives (or skip on network failure).
 *
 * NOTE: no otype→class mapping helper existed anywhere in the codebase (SIMBAD
 * surfaces `otype_txt` as raw text; the bundled `objects.ts` uses a separate
 * `ObjectType` enum), so {@link catalogClass} is that mapping, defined here.
 */

import type { ImageClassification, InferredClass } from './objectClassifier.js';
import type { SimbadObject } from '../api/simbad.js';

/**
 * A thin, catalog-agnostic adapter for one nearby catalog object. Deliberately NOT
 * coupled to the full SIMBAD/Gaia response — the caller maps whatever it fetched
 * into this shape. Only `separationArcsec` is required; the rest are hints that
 * strengthen (or soften) the match.
 */
export interface CatalogCandidate {
  /** Which catalog produced this candidate (provenance + Gaia point-source default). */
  source: 'simbad' | 'gaia' | string;
  /**
   * Raw object-type text (SIMBAD `otype_txt`, e.g. 'Galaxy', 'Star', 'QSO'). Absent
   * or '' for a plain Gaia astrometric source (which is treated as a point source —
   * i.e. stellar — via `source:'gaia'`).
   */
  otype?: string;
  /** Angular separation from the query point, ARCSEC. Required, must be finite ≥ 0. */
  separationArcsec: number;
  /** Optional magnitude (context only; not decisive). */
  magnitude?: number;
  /**
   * Optional parallax, mas. A significant positive parallax is strong stellar
   * evidence (only foreground stars have a measurable parallax).
   */
  parallaxMas?: number;
  /** Optional total proper motion, mas/yr. A significant PM ⇒ a nearby star. */
  properMotionMasYr?: number;
  /**
   * Optional Rubin pipeline `refExtendedness` (0 = point source ⇒ star, 1 = extended
   * ⇒ galaxy). This is Rubin's OWN measured star/galaxy separator (CModel-vs-PSF
   * flux, which we cannot fit in-browser), so when present it is DECISIVE — the
   * authoritative answer our luminance morphology only approximates. A value in
   * (0,1) is treated by the ≥0.5 threshold (Rubin emits it as a 0/1 flag, but be
   * robust to a probabilistic value). Only meaningful for `source:'rubin'`.
   */
  extendedness?: number;
}

/** Coarse class a catalog candidate implies for the star/galaxy decision. */
export type CatalogMatchClass = 'star' | 'galaxy' | 'ambiguous' | 'unknown';

export interface CatalogClassifyOptions {
  /**
   * Acceptance radius, ARCSEC. A candidate farther than this is ignored (the click
   * gives the object centre; a deliberate click lands within a few arcsec).
   * Default 5.
   */
  matchRadiusArcsec?: number;
  /** Confidence assigned to a decisive STAR match at zero separation. Default 0.92. */
  starConfidence?: number;
  /** Confidence assigned to a decisive GALAXY match at zero separation. Default 0.9. */
  galaxyConfidence?: number;
}

const DEFAULTS: Required<CatalogClassifyOptions> = {
  matchRadiusArcsec: 5,
  starConfidence: 0.92,
  galaxyConfidence: 0.9,
};

/** Provenance stamped on a result that a catalog match decided (vs. image morphology). */
export const CATALOG_PROVENANCE = 'catalog cross-match (SIMBAD / Gaia)';

/**
 * Significance thresholds above which a Gaia astrometric measurement is, on its own,
 * strong stellar evidence (foreground stars have measurable parallax/PM; galaxies do
 * not). Used to (a) treat a Gaia source with astrometry as a confident star even
 * with no otype, and (b) waive the separation confidence penalty.
 */
const GAIA_PARALLAX_SIGNIFICANT_MAS = 0.5;
const GAIA_PM_SIGNIFICANT_MAS_YR = 2;

/* -------------------------------------------------------------------------- */
/* otype → coarse class mapping                                               */
/* -------------------------------------------------------------------------- */

// AGN / quasar keywords: point-like but EXTRAGALACTIC. A morphology-only view can
// read these as either star (a compact QSO) or galaxy (a resolved host), so a match
// here must NOT force a flip — it is `ambiguous`. Checked FIRST so "Seyfert Galaxy"
// resolves to ambiguous, not galaxy.
const AGN_KEYWORDS = ['agn', 'qso', 'quasar', 'blazar', 'bl lac', 'bllac', 'liner', 'seyfert', 'active galaxy nucleus', 'active galactic nucleus'];
// Galaxy keywords (SIMBAD otype_txt readable forms + compact codes both contain
// 'galax' for essentially every galaxy type — 'Galaxy', 'Galaxy in Group',
// 'Interacting Galaxies', 'Starburst Galaxy', 'Emission-line galaxy', 'GinCl' → 'g').
const GALAXY_KEYWORDS = ['galax'];
// Stellar keywords. A single star's otype is 'Star' or a stellar-subtype ('White
// Dwarf', 'RR Lyrae', 'Cepheid', 'T Tauri', 'Nova', 'Pulsar', 'Brown Dwarf', …); the
// compact codes end with '*'. NB: 'Cluster of Stars' contains 'star' but is extended,
// so a *cluster* is caught as ambiguous BEFORE this.
const STAR_KEYWORDS = ['star', 'dwarf', 'giant', 'cepheid', 'rr lyr', 'nova', 'pulsar', 't tauri', 'variable of', 'emission-line star', 'young stellar', 'brown dwarf', 'white dwarf'];
// Extended / non-pointlike aggregates that are neither a single star nor a single
// galaxy — do not force a star/galaxy flip.
const CLUSTER_KEYWORDS = ['cluster of', 'globular', 'open (galactic) cluster', 'association of stars', 'stellar stream', 'group of galaxies', 'cluster of galaxies'];

/**
 * Map ONE catalog candidate to the coarse class it implies. PURE.
 *
 * - A Gaia source with a significant parallax or proper motion is a foreground STAR
 *   (only stars have measurable astrometry) — decisive even with no otype.
 * - Otherwise the SIMBAD `otype` text drives it, keyword-matched case-insensitively:
 *   AGN/QSO/cluster → `ambiguous` (checked first); a galaxy type → `galaxy`; a
 *   stellar type → `star`; anything else → `unknown`.
 * - A plain Gaia source with no otype and no significant astrometry is still a point
 *   source from a stellar/point-source catalog → `star` (the Sirius/Vega case: Gaia
 *   HAS it, DSS morphology mis-reads the saturated blob as a galaxy).
 */
export function catalogClass(c: CatalogCandidate): CatalogMatchClass {
  const otype = (c.otype ?? '').trim().toLowerCase();

  // Rubin refExtendedness — the pipeline's OWN star/galaxy call — is authoritative
  // and checked FIRST: 0 ⇒ point source (star), 1 ⇒ extended (galaxy). This is the
  // measurement our morphology proxies only approximate, so it wins outright.
  if (Number.isFinite(c.extendedness)) {
    return (c.extendedness as number) >= 0.5 ? 'galaxy' : 'star';
  }

  // Gaia astrometry: a measurable parallax/PM is unambiguous stellar evidence.
  if (
    (Number.isFinite(c.parallaxMas) && Math.abs(c.parallaxMas as number) >= GAIA_PARALLAX_SIGNIFICANT_MAS) ||
    (Number.isFinite(c.properMotionMasYr) && Math.abs(c.properMotionMasYr as number) >= GAIA_PM_SIGNIFICANT_MAS_YR)
  ) {
    // …unless SIMBAD explicitly typed it extragalactic (rare cross-match collision).
    if (!AGN_KEYWORDS.some((k) => otype.includes(k)) && !GALAXY_KEYWORDS.some((k) => otype.includes(k))) {
      return 'star';
    }
  }

  if (otype !== '') {
    if (AGN_KEYWORDS.some((k) => otype.includes(k))) return 'ambiguous';
    if (CLUSTER_KEYWORDS.some((k) => otype.includes(k))) return 'ambiguous';
    if (GALAXY_KEYWORDS.some((k) => otype.includes(k))) return 'galaxy';
    if (STAR_KEYWORDS.some((k) => otype.includes(k))) return 'star';
    // Bare '*' compact-code star (e.g. 'PM*', 'V*', 'HB*') with no readable word.
    if (otype.endsWith('*')) return 'star';
    return 'unknown';
  }

  // No otype: a plain Gaia point source is stellar; any other source is unknown.
  return c.source === 'gaia' ? 'star' : 'unknown';
}

/**
 * Adapt a {@link SimbadObject} (from `simbad.objectsNear`) into a
 * {@link CatalogCandidate}. Thin: passes through `objectType`→`otype` and
 * `separationArcsec`. A cone result without a separation (name resolution) yields
 * `Infinity` so it can never satisfy the match radius.
 */
export function simbadObjectToCandidate(o: SimbadObject): CatalogCandidate {
  return {
    source: 'simbad',
    otype: o.objectType,
    separationArcsec: Number.isFinite(o.separationArcsec) ? (o.separationArcsec as number) : Infinity,
  };
}

/**
 * Adapt a Rubin `dp1.Object` match into a decisive {@link CatalogCandidate} using
 * its `refExtendedness` flag. Returns null when extendedness is absent/non-finite
 * (nothing decisive to add — morphology should stand), so the caller can
 * `.filter(Boolean)` it into the candidate list.
 */
export function rubinObjectToCandidate(
  o: { separationArcsec: number; extendedness: number | null | undefined; magnitude?: number },
): CatalogCandidate | null {
  if (o.extendedness == null || !Number.isFinite(o.extendedness)) return null;
  return {
    source: 'rubin',
    extendedness: o.extendedness,
    separationArcsec: Number.isFinite(o.separationArcsec) ? o.separationArcsec : Infinity,
    ...(typeof o.magnitude === 'number' && Number.isFinite(o.magnitude) ? { magnitude: o.magnitude } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* The decision                                                               */
/* -------------------------------------------------------------------------- */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Fold nearby catalog candidates over an image-morphology classification.
 *
 * A DECISIVE catalog match (coarse class `star` or `galaxy`) within
 * `matchRadiusArcsec` OVERRIDES the morphology result — this is the whole point:
 * Sirius reads as a galaxy blob in DSS but Gaia/SIMBAD know it is a star. Among the
 * decisive candidates the NEAREST wins. An `ambiguous` (AGN/QSO/cluster) or
 * `unknown` candidate, a candidate beyond the radius, or an empty list all leave the
 * morphology result returned UNCHANGED (same object).
 *
 * PURE. Never mutates `morph` or `candidates`.
 */
export function classifyWithCatalog(
  morph: ImageClassification,
  candidates: CatalogCandidate[],
  opts: CatalogClassifyOptions = {},
): ImageClassification {
  const radius = opts.matchRadiusArcsec ?? DEFAULTS.matchRadiusArcsec;
  const starConf = opts.starConfidence ?? DEFAULTS.starConfidence;
  const galaxyConf = opts.galaxyConfidence ?? DEFAULTS.galaxyConfidence;

  // Nearest DECISIVE candidate within the match radius.
  let best: { cand: CatalogCandidate; cls: 'star' | 'galaxy'; sep: number } | null = null;
  for (const c of candidates) {
    const sep = c.separationArcsec;
    if (!(Number.isFinite(sep) && sep >= 0 && sep <= radius)) continue;
    const cls = catalogClass(c);
    if (cls !== 'star' && cls !== 'galaxy') continue; // ambiguous/unknown never flips
    if (best === null || sep < best.sep) best = { cand: c, cls, sep };
  }

  if (best === null) return morph; // no decisive match → morphology stands, unchanged

  // Confidence: high, softened as the match approaches the radius edge. Gaia
  // astrometric confirmations (measurable parallax/PM) waive the separation penalty.
  const base = best.cls === 'star' ? starConf : galaxyConf;
  // A Rubin refExtendedness match is the pipeline's own measurement of THIS object,
  // so — like a Gaia astrometric confirmation — it waives the separation penalty.
  const authoritative =
    Number.isFinite(best.cand.extendedness) ||
    (Number.isFinite(best.cand.parallaxMas) && Math.abs(best.cand.parallaxMas as number) >= GAIA_PARALLAX_SIGNIFICANT_MAS) ||
    (Number.isFinite(best.cand.properMotionMasYr) && Math.abs(best.cand.properMotionMasYr as number) >= GAIA_PM_SIGNIFICANT_MAS_YR);
  const sepPenalty = authoritative ? 0 : 0.35 * (radius > 0 ? best.sep / radius : 0);
  const confidence = clamp01(base * (1 - sepPenalty));

  const cls: InferredClass = best.cls;
  const flipped = morph.cls !== cls;
  const src =
    best.cand.source === 'gaia' ? 'Gaia'
    : best.cand.source === 'simbad' ? 'SIMBAD'
    : best.cand.source === 'rubin' ? 'Rubin'
    : String(best.cand.source);
  // For a Rubin extendedness match, describe the measured flag rather than an otype.
  const typeStr = Number.isFinite(best.cand.extendedness)
    ? ` (refExtendedness ${(best.cand.extendedness as number) >= 0.5 ? 'extended' : 'point source'})`
    : best.cand.otype && best.cand.otype.trim() !== '' ? ` (${best.cand.otype.trim()})` : '';
  const sepStr = `${best.sep.toFixed(1)}″`;
  const verb = flipped ? `overrides image morphology (${morph.cls})` : 'confirms image morphology';
  const reason = `${src} ${cls} match${typeStr} ${sepStr} away — ${verb}`;

  return {
    cls,
    subtype: null,
    confidence,
    reason,
    features: morph.features, // keep the morphology audit trail visible
    provenance: CATALOG_PROVENANCE,
  };
}
