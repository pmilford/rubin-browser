import { describe, it, expect } from 'vitest';
import { nearestObject, ALL_OBJECTS, type NearestObjectResult } from '../../src/data/objects.js';
import { angularSeparation, positionAngle } from '../../src/utils/skyGeom.js';

/**
 * Brute-force reference: the plain O(n) linear great-circle scan that
 * `nearestObject` used to be. This is the ground-truth oracle — the indexed
 * implementation must agree with it for EVERY query. A wrong prune (stopping a
 * direction too early, comparing RA instead of dec, mishandling RA-wrap or the
 * poles) makes some query disagree with this and FAIL.
 */
function bruteNearest(ra: number, dec: number): NearestObjectResult | null {
  let best = null as (typeof ALL_OBJECTS)[number] | null;
  let bestSep = Infinity;
  for (const obj of ALL_OBJECTS) {
    const sep = angularSeparation(ra, dec, obj.ra, obj.dec);
    if (sep < bestSep) {
      bestSep = sep;
      best = obj;
    }
  }
  if (!best) return null;
  return {
    object: best,
    separationDeg: bestSep,
    positionAngleDeg: positionAngle(ra, dec, best.ra, best.dec),
  };
}

describe('nearestObject dec-pruned index', () => {
  it('the catalog is the expected large size (sanity for the perf motivation)', () => {
    // The whole point of the index is that ALL_OBJECTS is large.
    expect(ALL_OBJECTS.length).toBeGreaterThan(10000);
  });

  it('never returns null for a non-empty catalog', () => {
    expect(ALL_OBJECTS.length).toBeGreaterThan(0);
    for (const dec of [-90, -45, 0, 45, 90]) {
      for (const ra of [0, 90, 180, 270, 359.999]) {
        expect(nearestObject(ra, dec)).not.toBeNull();
      }
    }
  });

  /**
   * Equivalence oracle over a dense grid of query points. For each point the
   * indexed result must match the brute-force reference on: object id, the
   * separation (to ~1e-9 deg), and the position angle (to ~1e-9 deg).
   */
  it('matches the brute-force linear scan across a dense sky grid', () => {
    const raSteps = 60; // 6° spacing in RA
    const decSteps = 60; // ~3° spacing in Dec
    let checked = 0;
    for (let i = 0; i < raSteps; i++) {
      const ra = (i * 360) / raSteps; // [0, 360)
      for (let j = 0; j <= decSteps; j++) {
        const dec = -89 + (j * 178) / decSteps; // [-89, 89]
        const got = nearestObject(ra, dec);
        const want = bruteNearest(ra, dec);
        expect(got).not.toBeNull();
        expect(want).not.toBeNull();
        expect(got!.object.id).toBe(want!.object.id);
        expect(got!.separationDeg).toBeCloseTo(want!.separationDeg, 9);
        expect(got!.positionAngleDeg).toBeCloseTo(want!.positionAngleDeg, 9);
        checked++;
      }
    }
    expect(checked).toBe(raSteps * (decSteps + 1));
  });

  /**
   * Edge points that specifically stress the parts a naive early-stopping or
   * RA-grid implementation gets wrong: the RA 0/360 seam, both poles, and a
   * scan of decs at the exact pole where every object shares a large dec gap.
   */
  it('matches brute force at the RA-wrap seam and both poles', () => {
    const edgePoints: Array<[number, number]> = [];
    // RA-wrap seam: points just either side of 0/360.
    for (const dec of [-89, -60, -30, 0, 30, 60, 89]) {
      edgePoints.push([0, dec]);
      edgePoints.push([0.0001, dec]);
      edgePoints.push([359.9999, dec]);
      edgePoints.push([360, dec]); // 360 == 0 on the sky
    }
    // The exact poles: the nearest object is far in dec, so a broken prune that
    // stops after the first direction is exhausted would miss the other pole's
    // objects.
    for (let ra = 0; ra < 360; ra += 15) {
      edgePoints.push([ra, 90]);
      edgePoints.push([ra, -90]);
    }
    for (const [ra, dec] of edgePoints) {
      const got = nearestObject(ra, dec);
      const want = bruteNearest(ra, dec);
      expect(got!.object.id).toBe(want!.object.id);
      expect(got!.separationDeg).toBeCloseTo(want!.separationDeg, 9);
      expect(got!.positionAngleDeg).toBeCloseTo(want!.positionAngleDeg, 9);
    }
  });

  /**
   * Query points placed ON real catalog objects: the nearest must be that
   * object itself with ~0 separation. Catches an off-by-one in the binary
   * search landing point.
   */
  it('returns the object itself when the query sits on a catalog position', () => {
    // Sample across the catalog (every ~500th object) so we cover many decs.
    for (let i = 0; i < ALL_OBJECTS.length; i += 500) {
      const o = ALL_OBJECTS[i]!;
      const got = nearestObject(o.ra, o.dec);
      const want = bruteNearest(o.ra, o.dec);
      expect(got!.object.id).toBe(want!.object.id);
      expect(got!.separationDeg).toBeCloseTo(want!.separationDeg, 9);
      // The self-match separation is ~0.
      expect(want!.separationDeg).toBeCloseTo(0, 9);
    }
  });
});
