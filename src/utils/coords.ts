/**
 * Pure celestial coordinate-system transforms for the grid coordinate-system
 * toggle (equatorial ↔ galactic ↔ ecliptic).
 *
 * All angles are in DEGREES at the API boundary (longitude 0–360, latitude
 * −90..+90), consistent with the rest of the app (see {@link ./skyGeom.ts},
 * {@link ./graticule.ts}). Everything here is J2000 / ICRS, pure, and dependency
 * free — the transforms are rotation matrices built from documented constants,
 * so they are unit-testable against known reference points (galactic centre,
 * north galactic pole, vernal equinox) — see tests/unit/coords.test.ts.
 *
 * Constants (J2000 / ICRS):
 *  - Galactic north pole:      α_NGP = 192.85948°, δ_NGP = +27.12825°
 *  - Galactic longitude of the
 *    north celestial pole:      l_Ω  = 122.93192°
 *  - Mean ecliptic obliquity:   ε    = 23.4392911°
 * These are the IAU 1958 galactic pole precessed to J2000 (Hipparcos, ESA 1997)
 * and the IAU 2006 mean obliquity at J2000.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** RA of the galactic north pole (J2000), degrees. */
const ALPHA_NGP = 192.85948;
/** Dec of the galactic north pole (J2000), degrees. */
const DELTA_NGP = 27.12825;
/** Galactic longitude of the north celestial pole (J2000), degrees. */
const L_OMEGA = 122.93192;
/** Mean obliquity of the ecliptic at J2000, degrees. */
const OBLIQUITY = 23.4392911;

/** A generic longitude/latitude sky position in degrees. */
export interface SkyCoord {
  /** longitude (RA, galactic l, or ecliptic λ), degrees in [0, 360). */
  lon: number;
  /** latitude (Dec, galactic b, or ecliptic β), degrees in [−90, 90]. */
  lat: number;
}

/** The coordinate systems the grid can be drawn in. */
export type CoordSystem = 'equatorial' | 'galactic' | 'ecliptic';

/** A 3×3 rotation matrix, row-major. */
type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];
type Vec3 = readonly [number, number, number];

/** Longitude/latitude (deg) → unit vector on the sphere. */
function toVector(lon: number, lat: number): Vec3 {
  const λ = lon * DEG2RAD;
  const φ = lat * DEG2RAD;
  const cosφ = Math.cos(φ);
  return [cosφ * Math.cos(λ), cosφ * Math.sin(λ), Math.sin(φ)];
}

/**
 * Unit vector → longitude/latitude (deg), longitude normalised to [0, 360) and
 * latitude clamped to [−90, 90] (guards asin domain against rounding).
 */
function toSky(v: Vec3): SkyCoord {
  let lon = Math.atan2(v[1], v[0]) * RAD2DEG;
  lon = ((lon % 360) + 360) % 360;
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) * RAD2DEG;
  return { lon, lat };
}

/** Apply a rotation matrix to a vector. */
function apply(m: Matrix3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Transpose of a rotation matrix (== its inverse, since it is orthonormal). */
function transpose(m: Matrix3): Matrix3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

/**
 * Equatorial→galactic rotation matrix, whose rows are the galactic x/y/z axes
 * expressed in equatorial coordinates. Built from the three documented
 * constants rather than hardcoded, so it is self-checking:
 *  - z_gal is the NGP direction (α_NGP, δ_NGP).
 *  - the ascending node of the galactic plane on the equator is at RA α_NGP+90°;
 *    the galactic longitude of that node is l_Ω − 90°.
 *  - x_gal (l=0, the galactic centre) and y_gal (l=90°) follow by rotating the
 *    node frame by that longitude.
 * This reproduces the standard ICRS→galactic matrix (Hipparcos, ESA 1997).
 */
const EQ_TO_GAL: Matrix3 = (() => {
  const a = ALPHA_NGP * DEG2RAD;
  const d = DELTA_NGP * DEG2RAD;
  const cosD = Math.cos(d);
  const sinD = Math.sin(d);
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);

  // Galactic north pole (l=b=90) in equatorial coords.
  const zGal: Vec3 = [cosD * cosA, cosD * sinA, sinD];
  // Ascending node of the galactic equator on the celestial equator (RA α+90°).
  const node: Vec3 = [-sinA, cosA, 0];
  // The in-plane vector 90° along the galactic equator from the node.
  const m: Vec3 = [-sinD * cosA, -sinD * sinA, cosD];

  // Rotate (node, m) by the node's galactic longitude (l_Ω − 90°) to reach the
  // galactic centre (l=0) and l=90° directions.
  const cosL = Math.sin(L_OMEGA * DEG2RAD); //  cos(l_Ω − 90°)
  const sinL = -Math.cos(L_OMEGA * DEG2RAD); //  sin(l_Ω − 90°)
  const xGal: Vec3 = [
    cosL * node[0] - sinL * m[0],
    cosL * node[1] - sinL * m[1],
    cosL * node[2] - sinL * m[2],
  ];
  const yGal: Vec3 = [
    sinL * node[0] + cosL * m[0],
    sinL * node[1] + cosL * m[1],
    sinL * node[2] + cosL * m[2],
  ];
  return [xGal, yGal, zGal];
})();

const GAL_TO_EQ: Matrix3 = transpose(EQ_TO_GAL);

/**
 * Equatorial→ecliptic rotation matrix: a rotation by the obliquity ε about the
 * shared x-axis (vernal equinox). The north celestial pole maps to ecliptic
 * latitude 90° − ε.
 */
const EQ_TO_ECL: Matrix3 = (() => {
  const ε = OBLIQUITY * DEG2RAD;
  const c = Math.cos(ε);
  const s = Math.sin(ε);
  return [
    [1, 0, 0],
    [0, c, s],
    [0, -s, c],
  ];
})();

const ECL_TO_EQ: Matrix3 = transpose(EQ_TO_ECL);

/** Equatorial (RA, Dec) → galactic (l, b). */
export function equatorialToGalactic(ra: number, dec: number): SkyCoord {
  return toSky(apply(EQ_TO_GAL, toVector(ra, dec)));
}

/** Galactic (l, b) → equatorial (RA, Dec). */
export function galacticToEquatorial(l: number, b: number): SkyCoord {
  return toSky(apply(GAL_TO_EQ, toVector(l, b)));
}

/** Equatorial (RA, Dec) → ecliptic (λ, β). */
export function equatorialToEcliptic(ra: number, dec: number): SkyCoord {
  return toSky(apply(EQ_TO_ECL, toVector(ra, dec)));
}

/** Ecliptic (λ, β) → equatorial (RA, Dec). */
export function eclipticToEquatorial(lon: number, lat: number): SkyCoord {
  return toSky(apply(ECL_TO_EQ, toVector(lon, lat)));
}

/**
 * Convert an equatorial (RA, Dec) position into the given system's (lon, lat).
 * `equatorial` is the identity (returned normalised to [0,360) / [−90,90]).
 */
export function fromEquatorial(ra: number, dec: number, system: CoordSystem): SkyCoord {
  switch (system) {
    case 'galactic':
      return equatorialToGalactic(ra, dec);
    case 'ecliptic':
      return equatorialToEcliptic(ra, dec);
    case 'equatorial':
    default:
      return toSky(toVector(ra, dec));
  }
}

/**
 * Convert a (lon, lat) position in the given system back to equatorial (RA,
 * Dec). `equatorial` is the identity (returned normalised).
 */
export function toEquatorial(lon: number, lat: number, system: CoordSystem): SkyCoord {
  switch (system) {
    case 'galactic':
      return galacticToEquatorial(lon, lat);
    case 'ecliptic':
      return eclipticToEquatorial(lon, lat);
    case 'equatorial':
    default:
      return toSky(toVector(lon, lat));
  }
}
