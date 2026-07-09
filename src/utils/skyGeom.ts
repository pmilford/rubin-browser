/**
 * Pure spherical-geometry helpers for the sky viewer.
 *
 * All angles are in DEGREES at the API boundary (RA 0–360, Dec −90..+90),
 * consistent with the rest of the app. These are unit-tested against known
 * references (great-circle separation, position-angle sign) — see
 * tests/unit/skyGeom.test.ts.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Great-circle angular separation between two sky positions, in degrees.
 * Uses the haversine form (numerically stable for small separations). This is
 * a real spherical distance — NOT sqrt(Δα² + Δδ²), which is wrong away from the
 * equator (at Dec 80°, a 10° RA step spans only ~1.7° on the sky).
 */
export function angularSeparation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const φ1 = dec1 * DEG2RAD;
  const φ2 = dec2 * DEG2RAD;
  const dφ = (dec2 - dec1) * DEG2RAD;
  const dλ = (ra2 - ra1) * DEG2RAD;
  const a =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return c * RAD2DEG;
}

/**
 * Position angle of point 2 as seen from point 1, measured in degrees East of
 * North (0 = due North, 90 = due East, 180 = South, 270 = West), in [0, 360).
 * This is the standard astronomical PA convention.
 */
export function positionAngle(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const φ1 = dec1 * DEG2RAD;
  const φ2 = dec2 * DEG2RAD;
  const dλ = (ra2 - ra1) * DEG2RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  let pa = Math.atan2(y, x) * RAD2DEG;
  if (pa < 0) pa += 360;
  return pa;
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Map a position angle (deg E of N) to an 8-point compass label. */
export function cardinalDirection(paDeg: number): string {
  const norm = ((paDeg % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return COMPASS_8[idx]!;
}

/**
 * Format an angular separation (degrees) into a human-readable string, choosing
 * degrees / arcmin / arcsec by magnitude. Never mislabels a large separation.
 */
export function formatSeparation(sepDeg: number): string {
  if (sepDeg >= 1) return `${sepDeg.toFixed(2)}°`;
  const arcmin = sepDeg * 60;
  if (arcmin >= 1) return `${arcmin.toFixed(1)}′`;
  return `${(arcmin * 60).toFixed(1)}″`;
}
