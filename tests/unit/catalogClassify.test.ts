import { describe, it, expect } from 'vitest';
import type { ImageFeatures } from '../../src/utils/imageFeatures.js';
import type { ImageClassification } from '../../src/utils/objectClassifier.js';
import {
  classifyWithCatalog,
  catalogClass,
  simbadObjectToCandidate,
  rubinObjectToCandidate,
  CATALOG_PROVENANCE,
  type CatalogCandidate,
} from '../../src/utils/catalogClassify.js';

/**
 * Adversarial tests for the catalog cross-match override (TODO 151).
 *
 * The failure this fixes: a BRIGHT star (Sirius/Vega) blooms in single-band DSS into
 * a low-concentration blob the luminance classifier calls a "galaxy". A Gaia/SIMBAD
 * point-source match must FLIP that to "star". Conversely a SIMBAD galaxy type must
 * CONFIRM a galaxy; and — the guard against over-flipping — NO match, an out-of-radius
 * match, or an ambiguous AGN/QSO match must leave the morphology result UNCHANGED.
 *
 * A no-op impl (`(morph) => morph`) MUST fail the flip test and the confirm/provenance
 * assertions.
 */

const MORPH_PROVENANCE = 'image-inferred (morphology, luminance only)';

/** A fully-typed but inert ImageFeatures stub (values irrelevant to the override). */
function features(): ImageFeatures {
  return {
    snr: 5,
    gapFraction: 0,
    saturatedCore: false,
    fwhmRatio: 1,
    concentration: 0.5,
    spreadModelProxy: 0,
    peakSharpness: 1,
    asymmetry: 0,
    gini: 0.4,
    m20: -1,
    ellipticity: 0,
    concentrationRatio: 0.2,
    coreConcentration: 0.5,
    coreFluxFraction: 0.3,
    fillFraction: 0.1,
    spatialCoherence: 0.8,
  };
}

/** A morphology classification with a chosen class/confidence and the image provenance. */
function morph(cls: 'star' | 'galaxy' | 'unknown', confidence = 0.4): ImageClassification {
  return {
    cls,
    subtype: null,
    confidence,
    reason: `morphology says ${cls}`,
    features: features(),
    provenance: MORPH_PROVENANCE,
  };
}

describe('catalogClass — otype → coarse class mapping', () => {
  it('maps SIMBAD stellar otypes to star', () => {
    for (const otype of ['Star', 'White Dwarf', 'RR Lyrae Variable', 'Cepheid variable', 'Nova', 'Brown Dwarf', 'T Tauri Star', 'High proper-motion Star']) {
      expect(catalogClass({ source: 'simbad', otype, separationArcsec: 1 })).toBe('star');
    }
  });

  it('maps a bare compact-code star ("V*", "PM*") to star', () => {
    expect(catalogClass({ source: 'simbad', otype: 'V*', separationArcsec: 1 })).toBe('star');
    expect(catalogClass({ source: 'simbad', otype: 'PM*', separationArcsec: 1 })).toBe('star');
  });

  it('maps SIMBAD galaxy otypes to galaxy', () => {
    for (const otype of ['Galaxy', 'Galaxy in Group', 'Interacting Galaxies', 'Starburst Galaxy', 'Emission-line galaxy']) {
      expect(catalogClass({ source: 'simbad', otype, separationArcsec: 1 })).toBe('galaxy');
    }
  });

  it('maps AGN / QSO / Blazar / Seyfert to AMBIGUOUS (not galaxy, not star)', () => {
    for (const otype of ['QSO', 'Quasar', 'Blazar', 'BL Lac', 'AGN', 'Seyfert Galaxy', 'LINER']) {
      expect(catalogClass({ source: 'simbad', otype, separationArcsec: 1 })).toBe('ambiguous');
    }
  });

  it('maps clusters / groups to ambiguous (extended, not a single star/galaxy)', () => {
    expect(catalogClass({ source: 'simbad', otype: 'Cluster of Stars', separationArcsec: 1 })).toBe('ambiguous');
    expect(catalogClass({ source: 'simbad', otype: 'Globular Cluster', separationArcsec: 1 })).toBe('ambiguous');
    expect(catalogClass({ source: 'simbad', otype: 'Cluster of Galaxies', separationArcsec: 1 })).toBe('ambiguous');
  });

  it('treats a plain Gaia source (no otype) as a stellar point source', () => {
    expect(catalogClass({ source: 'gaia', separationArcsec: 1 })).toBe('star');
  });

  it('treats a Gaia source with significant parallax/PM as a star even with no otype', () => {
    expect(catalogClass({ source: 'gaia', separationArcsec: 1, parallaxMas: 3.2 })).toBe('star');
    expect(catalogClass({ source: 'gaia', separationArcsec: 1, properMotionMasYr: 120 })).toBe('star');
  });

  it('an unknown/empty non-Gaia otype is unknown (never forces a flip)', () => {
    expect(catalogClass({ source: 'other', otype: '', separationArcsec: 1 })).toBe('unknown');
    expect(catalogClass({ source: 'simbad', otype: 'Radio Source', separationArcsec: 1 })).toBe('unknown');
  });
});

describe('classifyWithCatalog — the override decision', () => {
  it('FLIPS morphology-galaxy to STAR on a Gaia point-source match (the Sirius/Vega failure)', () => {
    const m = morph('galaxy', 0.6);
    const cands: CatalogCandidate[] = [{ source: 'gaia', separationArcsec: 1.2, parallaxMas: 379 }];
    const out = classifyWithCatalog(m, cands);
    expect(out.cls).toBe('star'); // a no-op (returns morph) would still say 'galaxy' → FAILS
    expect(out.provenance).toBe(CATALOG_PROVENANCE);
    expect(out.confidence).toBeGreaterThan(0.5);
    expect(out.reason).toMatch(/overrides image morphology/i);
  });

  it('FLIPS morphology-galaxy to STAR on a SIMBAD stellar otype match', () => {
    const m = morph('galaxy', 0.7);
    const cands: CatalogCandidate[] = [{ source: 'simbad', otype: 'Star', separationArcsec: 2 }];
    const out = classifyWithCatalog(m, cands);
    expect(out.cls).toBe('star');
    expect(out.provenance).toBe(CATALOG_PROVENANCE);
  });

  it('CONFIRMS a galaxy on a SIMBAD galaxy match (raises confidence + catalog provenance)', () => {
    const m = morph('galaxy', 0.3);
    const cands: CatalogCandidate[] = [{ source: 'simbad', otype: 'Galaxy', separationArcsec: 1.5 }];
    const out = classifyWithCatalog(m, cands);
    expect(out.cls).toBe('galaxy');
    // A no-op impl returns the morphology provenance/confidence → these FAIL it.
    expect(out.provenance).toBe(CATALOG_PROVENANCE);
    expect(out.confidence).toBeGreaterThan(m.confidence);
    expect(out.reason).toMatch(/confirms image morphology/i);
  });

  it('FLIPS a morphology-star to GALAXY on a SIMBAD galaxy match', () => {
    const m = morph('star', 0.6);
    const cands: CatalogCandidate[] = [{ source: 'simbad', otype: 'Galaxy', separationArcsec: 1 }];
    const out = classifyWithCatalog(m, cands);
    expect(out.cls).toBe('galaxy');
    expect(out.reason).toMatch(/overrides image morphology \(star\)/i);
  });

  it('NO nearby candidate → returns the morphology result UNCHANGED (identity)', () => {
    const m = morph('galaxy', 0.42);
    const out = classifyWithCatalog(m, []);
    expect(out).toBe(m); // same object — nothing invented
    expect(out.cls).toBe('galaxy');
    expect(out.provenance).toBe(MORPH_PROVENANCE);
  });

  it('a match BEYOND the radius is ignored (morphology passes through)', () => {
    const m = morph('galaxy', 0.5);
    // A Gaia star, but 40″ away — outside the 5″ default radius.
    const cands: CatalogCandidate[] = [{ source: 'gaia', separationArcsec: 40, parallaxMas: 12 }];
    const out = classifyWithCatalog(m, cands);
    expect(out).toBe(m);
    expect(out.cls).toBe('galaxy');
    expect(out.provenance).toBe(MORPH_PROVENANCE);
  });

  it('an AMBIGUOUS AGN/QSO match does NOT force a flip (morphology stands)', () => {
    const m = morph('galaxy', 0.55);
    const cands: CatalogCandidate[] = [{ source: 'simbad', otype: 'QSO', separationArcsec: 0.5 }];
    const out = classifyWithCatalog(m, cands);
    expect(out).toBe(m); // ambiguous never overrides
    expect(out.cls).toBe('galaxy');
    expect(out.provenance).toBe(MORPH_PROVENANCE);
  });

  it('an ambiguous QSO does not block a decisive star that is also nearby', () => {
    const m = morph('galaxy', 0.5);
    const cands: CatalogCandidate[] = [
      { source: 'simbad', otype: 'QSO', separationArcsec: 0.4 }, // closer, but ambiguous
      { source: 'gaia', separationArcsec: 2.0, parallaxMas: 8 }, // decisive star
    ];
    const out = classifyWithCatalog(m, cands);
    expect(out.cls).toBe('star');
  });

  it('among decisive candidates the NEAREST wins', () => {
    const m = morph('unknown', 0.1);
    const cands: CatalogCandidate[] = [
      { source: 'simbad', otype: 'Galaxy', separationArcsec: 3.5 },
      { source: 'simbad', otype: 'Star', separationArcsec: 1.0 }, // nearer
    ];
    const out = classifyWithCatalog(m, cands);
    expect(out.cls).toBe('star');
  });

  it('confidence is high near the centre and eases toward the radius edge', () => {
    const m = morph('galaxy', 0.5);
    const near = classifyWithCatalog(m, [{ source: 'simbad', otype: 'Star', separationArcsec: 0.2 }]);
    const edge = classifyWithCatalog(m, [{ source: 'simbad', otype: 'Star', separationArcsec: 4.9 }]);
    expect(near.confidence).toBeGreaterThan(edge.confidence);
    expect(near.confidence).toBeGreaterThan(0.8);
    expect(edge.confidence).toBeGreaterThan(0.5); // still confident, just softened
  });

  it('a Gaia astrometric confirmation waives the separation penalty', () => {
    const m = morph('galaxy', 0.5);
    const astro = classifyWithCatalog(m, [{ source: 'gaia', separationArcsec: 4.9, parallaxMas: 50 }]);
    const plain = classifyWithCatalog(m, [{ source: 'gaia', otype: 'Star', separationArcsec: 4.9 }]);
    expect(astro.confidence).toBeGreaterThan(plain.confidence);
  });

  it('respects a custom match radius', () => {
    const m = morph('galaxy', 0.5);
    const cand: CatalogCandidate[] = [{ source: 'gaia', separationArcsec: 8, parallaxMas: 5 }];
    expect(classifyWithCatalog(m, cand, { matchRadiusArcsec: 5 })).toBe(m); // ignored
    expect(classifyWithCatalog(m, cand, { matchRadiusArcsec: 10 }).cls).toBe('star'); // now inside
  });

  it('ignores a candidate with a non-finite / negative separation', () => {
    const m = morph('galaxy', 0.5);
    expect(classifyWithCatalog(m, [{ source: 'gaia', separationArcsec: NaN, parallaxMas: 5 }])).toBe(m);
    expect(classifyWithCatalog(m, [{ source: 'gaia', separationArcsec: -1, parallaxMas: 5 }])).toBe(m);
  });

  it('does not mutate the input morphology result', () => {
    const m = morph('galaxy', 0.6);
    const snapshot = { ...m };
    classifyWithCatalog(m, [{ source: 'gaia', separationArcsec: 1, parallaxMas: 100 }]);
    expect(m.cls).toBe(snapshot.cls);
    expect(m.confidence).toBe(snapshot.confidence);
    expect(m.provenance).toBe(snapshot.provenance);
  });
});

describe('simbadObjectToCandidate — thin adapter', () => {
  it('passes objectType→otype and separationArcsec through', () => {
    const c = simbadObjectToCandidate({ mainId: 'Sirius', ra: 101.28, dec: -16.7, objectType: 'Star', separationArcsec: 1.3 });
    expect(c).toEqual({ source: 'simbad', otype: 'Star', separationArcsec: 1.3 });
    expect(catalogClass(c)).toBe('star');
  });

  it('a SIMBAD object without a separation (name resolution) becomes an out-of-radius candidate', () => {
    const c = simbadObjectToCandidate({ mainId: 'M31', ra: 10.68, dec: 41.27, objectType: 'Galaxy' });
    expect(c.separationArcsec).toBe(Infinity);
    // …so it can never satisfy the match radius.
    expect(classifyWithCatalog(morph('star'), [c])).toEqual(morph('star'));
  });
});

describe('Rubin refExtendedness cross-match (recognizer fix — authoritative star/galaxy)', () => {
  it('extendedness=1 → galaxy, extendedness=0 → star, decisively (Rubin pipeline flag beats morphology)', () => {
    expect(catalogClass({ source: 'rubin', extendedness: 1, separationArcsec: 0.5 })).toBe('galaxy');
    expect(catalogClass({ source: 'rubin', extendedness: 0, separationArcsec: 0.5 })).toBe('star');
  });

  it('FLIPS a morphology "star" to galaxy when Rubin says extended — the user\'s "obvious galaxies misclassified" case', () => {
    const cand = rubinObjectToCandidate({ separationArcsec: 0.8, extendedness: 1 })!;
    const out = classifyWithCatalog(morph('star', 0.4), [cand], { matchRadiusArcsec: 3 });
    expect(out.cls).toBe('galaxy');
    expect(out.provenance).toBe(CATALOG_PROVENANCE); // panel shows "(catalog)"
    expect(out.reason).toMatch(/Rubin galaxy match \(refExtendedness extended\).*overrides image morphology \(star\)/);
    // Authoritative: separation penalty waived → confidence stays high.
    expect(out.confidence).toBeGreaterThan(0.85);
  });

  it('CONFIRMS a morphology "galaxy" and keeps high confidence (no flip wording)', () => {
    const cand = rubinObjectToCandidate({ separationArcsec: 2, extendedness: 1 })!;
    const out = classifyWithCatalog(morph('galaxy', 0.5), [cand], { matchRadiusArcsec: 5 });
    expect(out.cls).toBe('galaxy');
    expect(out.reason).toMatch(/confirms image morphology/);
  });

  it('takes precedence over a conflicting otype on the SAME candidate (extendedness is authoritative)', () => {
    // A candidate that carries BOTH a stellar otype and extendedness=1 → galaxy wins.
    expect(catalogClass({ source: 'rubin', otype: 'Star', extendedness: 1, separationArcsec: 0.3 })).toBe('galaxy');
  });

  it('rubinObjectToCandidate returns null when extendedness is absent (morphology must stand)', () => {
    expect(rubinObjectToCandidate({ separationArcsec: 1, extendedness: null })).toBeNull();
    expect(rubinObjectToCandidate({ separationArcsec: 1, extendedness: undefined })).toBeNull();
    // …and a null candidate filtered out leaves morphology unchanged.
    const cands = [rubinObjectToCandidate({ separationArcsec: 1, extendedness: null })].filter(Boolean) as CatalogCandidate[];
    expect(classifyWithCatalog(morph('star'), cands)).toEqual(morph('star'));
  });

  it('an out-of-radius Rubin match does NOT override (nearest-primary safety)', () => {
    const cand = rubinObjectToCandidate({ separationArcsec: 9, extendedness: 1 })!;
    expect(classifyWithCatalog(morph('star'), [cand], { matchRadiusArcsec: 3 })).toEqual(morph('star'));
  });
});
