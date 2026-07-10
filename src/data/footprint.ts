/**
 * DP1 footprint / coverage geometry (PURE).
 *
 * DP1 (Data Preview 1) is only ~15 deg² of sky spread across seven small fields
 * (see `dp1Fields.ts`). Users who authenticate expecting all-sky Rubin data are
 * repeatedly confused when a view centred elsewhere shows only public DSS — the
 * data simply does not exist there. This module models each field as a coverage
 * disc so the viewer can shade WHERE Rubin DP1 imagery actually exists and
 * answer "is this point covered?" / "which field is nearest?".
 *
 * All angles are in DEGREES (RA 0–360, Dec −90..+90), matching the rest of the
 * app. Great-circle distance is delegated to `angularSeparation` in
 * `utils/skyGeom.ts` — this file does NOT re-derive spherical math for that.
 */

import { angularSeparation } from '../utils/skyGeom.js';
import { DP1_FIELDS, DP1_TOTAL_AREA_DEG2 } from './dp1Fields.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Per-field coverage-disc radius, in degrees.
 *
 * APPROXIMATION: DP1 is ~15 deg² across 7 fields → ~2.14 deg²/field. Modelling a
 * field as a disc of area A gives radius √(A/π) ≈ √(2.14/π) ≈ 0.82°. The REAL
 * footprints are irregular coadd/mosaic regions (rectangular-ish tract patches,
 * not circles), so this disc is a deliberate first-order stand-in for shading
 * and "am I on coverage?" hints — it is NOT the authoritative footprint polygon.
 * If exact coadd boundaries are wired later, replace this with per-field regions.
 */
export const DP1_FIELD_RADIUS_DEG =
  Math.sqrt(DP1_TOTAL_AREA_DEG2 / DP1_FIELDS.length / Math.PI);

/** A circular coverage region on the sky (one per DP1 field). */
export interface CoverageCircle {
  /** Stable field id (matches the corresponding `Dp1Field.id`). */
  id: string;
  /** Human-readable field name. */
  name: string;
  /** Disc-centre right ascension, degrees [0, 360). */
  ra: number;
  /** Disc-centre declination, degrees [-90, 90]. */
  dec: number;
  /** Coverage-disc radius, degrees. */
  radiusDeg: number;
}

/** One coverage disc per DP1 field, all at `DP1_FIELD_RADIUS_DEG`. */
export function dp1CoverageCircles(): CoverageCircle[] {
  return DP1_FIELDS.map((f) => ({
    id: f.id,
    name: f.name,
    ra: f.ra,
    dec: f.dec,
    radiusDeg: DP1_FIELD_RADIUS_DEG,
  }));
}

/** Angular slack (deg) so a point exactly on a disc edge counts as inside. */
const COVERAGE_EPS_DEG = 1e-9;

/** True iff (ra, dec) falls within ANY DP1 field's coverage disc. */
export function isInDp1Coverage(ra: number, dec: number): boolean {
  return dp1CoverageCircles().some(
    (c) => angularSeparation(ra, dec, c.ra, c.dec) <= c.radiusDeg + COVERAGE_EPS_DEG,
  );
}

/**
 * The DP1 field whose CENTRE is closest to (ra, dec), plus that great-circle
 * centre separation in degrees (0 at a field centre; may exceed radiusDeg when
 * the point is outside all coverage).
 */
export function nearestDp1Field(
  ra: number,
  dec: number,
): { field: CoverageCircle; separationDeg: number } {
  const circles = dp1CoverageCircles();
  let best = circles[0]!;
  let bestSep = angularSeparation(ra, dec, best.ra, best.dec);
  for (let i = 1; i < circles.length; i++) {
    const sep = angularSeparation(ra, dec, circles[i]!.ra, circles[i]!.dec);
    if (sep < bestSep) {
      bestSep = sep;
      best = circles[i]!;
    }
  }
  return { field: best, separationDeg: bestSep };
}

/**
 * Points evenly spaced around a coverage disc's boundary, for an overlay to
 * project and fill/outline. Each point lies exactly `circle.radiusDeg` from the
 * centre on the sphere.
 *
 * Uses the spherical destination-point formula: for each position angle θ
 * (bearing, East of North), offset the centre by `radiusDeg` along θ. This walks
 * a true small circle, so it stays correct at high declination (e.g. 47 Tuc at
 * dec −72) — unlike a naive RA ± r/cos(dec) box, which distorts and can wrap.
 * RA is normalised to [0, 360).
 */
export function coverageCirclePoints(
  circle: CoverageCircle,
  nPoints = 64,
): { ra: number; dec: number }[] {
  const φ1 = circle.dec * DEG2RAD;
  const λ1 = circle.ra * DEG2RAD;
  const d = circle.radiusDeg * DEG2RAD;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinD = Math.sin(d);
  const cosD = Math.cos(d);

  const points: { ra: number; dec: number }[] = [];
  for (let i = 0; i < nPoints; i++) {
    const θ = (2 * Math.PI * i) / nPoints; // position angle, E of N
    const sinφ2 = sinφ1 * cosD + cosφ1 * sinD * Math.cos(θ);
    const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
    const λ2 =
      λ1 +
      Math.atan2(Math.sin(θ) * sinD * cosφ1, cosD - sinφ1 * sinφ2);
    let ra = λ2 * RAD2DEG;
    ra = ((ra % 360) + 360) % 360; // normalise to [0, 360)
    points.push({ ra, dec: φ2 * RAD2DEG });
  }
  return points;
}
