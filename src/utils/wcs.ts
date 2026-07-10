/**
 * Pure FITS TAN (gnomonic) WCS with a CD matrix.
 *
 * Converts between FITS image PIXEL coordinates (1-based, FITS convention) and
 * WORLD coordinates (RA/Dec, degrees) for a plate-tangent (gnomonic / `TAN`)
 * projection. This lets a FITS cutout's pixels be placed on the sky and lets the
 * cursor over a cutout read out a calibrated RA/Dec — the follow-up flagged at
 * the bottom of `src/utils/fits.ts`.
 *
 * The `fits.ts` reader passes CRVAL/CRPIX/CDELT/CD/CTYPE through verbatim; this
 * module is where the actual pixel<->sky transform and the CD-matrix inversion
 * live. It is PURE — no DOM, no fetch — and degrees at every boundary, matching
 * `projection.ts` / `skyGeom.ts`. All functions are total: `parseWcs` returns
 * `null` (never throws) on a non-TAN or incomplete header, and `worldToPixel`
 * returns `null` for a sky point on the far hemisphere.
 *
 * Math: the FITS CD matrix maps a pixel offset to the "intermediate world
 * coordinates" (xi, eta) in DEGREES:
 *
 *     [xi ]   [CD1_1 CD1_2] [ p1 - CRPIX1 ]
 *     [eta] = [CD2_1 CD2_2] [ p2 - CRPIX2 ]
 *
 * (xi, eta) are then the standard/tangent-plane coordinates of the gnomonic
 * projection about the reference point (CRVAL1, CRVAL2). `worldToPixel` inverts
 * the 2x2 CD matrix to go the other way — dropping that inversion, or the
 * off-diagonal terms, produces a wrong (rotated/sheared) mapping.
 *
 * References: Greisen & Calabretta 2002 (FITS WCS Papers I & II); the TAN
 * de/projection is the same gnomonic map as `projection.ts`.
 */

import type { FitsHeader } from './fits.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * A parsed TAN WCS descriptor, fully self-contained (no reference back to the
 * header). Angles are degrees; CRPIX is 1-based (FITS). The CD matrix is stored
 * in deg/pixel and is the single source of scale + rotation + skew — CDELT and
 * CROTA2 are folded into it by {@link parseWcs} when no CD matrix is present.
 */
export interface Wcs {
  /** CRVAL1 — RA at the reference pixel (degrees). */
  crval1: number;
  /** CRVAL2 — Dec at the reference pixel (degrees). */
  crval2: number;
  /** CRPIX1 — reference pixel along axis 1 (1-based, FITS convention). */
  crpix1: number;
  /** CRPIX2 — reference pixel along axis 2 (1-based, FITS convention). */
  crpix2: number;
  /** CD1_1 — deg/pixel; ∂xi/∂p1. */
  cd11: number;
  /** CD1_2 — deg/pixel; ∂xi/∂p2. */
  cd12: number;
  /** CD2_1 — deg/pixel; ∂eta/∂p1. */
  cd21: number;
  /** CD2_2 — deg/pixel; ∂eta/∂p2. */
  cd22: number;
}

/** RA/Dec pair, degrees. */
export interface World {
  ra: number;
  dec: number;
}

/** Pixel pair, 1-based (FITS convention). */
export interface Pixel {
  x: number;
  y: number;
}

/** Normalise RA into [0, 360). */
function normalizeRa(ra: number): number {
  return ((ra % 360) + 360) % 360;
}

/**
 * Does a CTYPE string name the given coordinate axis with a TAN projection?
 * Matches `RA---TAN` / `DEC--TAN` and any dash-count variant, but rejects
 * distorted forms like `RA---TAN-SIP` (SIP distortion is not implemented) and
 * any non-TAN projection (SIN, ARC, ...).
 */
function isTanCtype(ctype: string | undefined, axis: 'RA' | 'DEC'): boolean {
  if (typeof ctype !== 'string') return false;
  const re = axis === 'RA' ? /^RA-+TAN$/ : /^DEC-+TAN$/;
  return re.test(ctype.trim());
}

/**
 * Read a numeric keyword from the raw `cards` map (for keys not promoted onto
 * the typed FitsHeader, e.g. CROTA2). Returns `undefined` if absent/non-numeric.
 */
function cardNumber(header: FitsHeader, key: string): number | undefined {
  const v = header.cards[key];
  return typeof v === 'number' ? v : undefined;
}

/**
 * Build a {@link Wcs} from a parsed FITS header, or return `null` when the
 * header is not a usable TAN WCS. Never throws on a non-WCS header.
 *
 * Returns `null` when: CTYPE1/2 are not `RA---TAN` / `DEC--TAN`; CRVAL1/2 or
 * CRPIX1/2 are missing; or neither a CD matrix nor a CDELT pair is present. When
 * a CD matrix is present, missing individual CDi_j default to 0 (FITS rule).
 * When only CDELT is present, the CD matrix is synthesised from CDELT1/2 and
 * CROTA2 (default 0) via the standard AIPS convention:
 *
 *     CD1_1 =  CDELT1 cos ρ    CD1_2 = -CDELT2 sin ρ
 *     CD2_1 =  CDELT1 sin ρ    CD2_2 =  CDELT2 cos ρ
 */
export function parseWcs(header: FitsHeader): Wcs | null {
  if (!isTanCtype(header.ctype1, 'RA') || !isTanCtype(header.ctype2, 'DEC')) {
    return null;
  }

  const { crval1, crval2, crpix1, crpix2 } = header;
  if (
    crval1 === undefined ||
    crval2 === undefined ||
    crpix1 === undefined ||
    crpix2 === undefined
  ) {
    return null;
  }

  const hasCd =
    header.cd1_1 !== undefined ||
    header.cd1_2 !== undefined ||
    header.cd2_1 !== undefined ||
    header.cd2_2 !== undefined;

  let cd11: number, cd12: number, cd21: number, cd22: number;

  if (hasCd) {
    cd11 = header.cd1_1 ?? 0;
    cd12 = header.cd1_2 ?? 0;
    cd21 = header.cd2_1 ?? 0;
    cd22 = header.cd2_2 ?? 0;
  } else if (header.cdelt1 !== undefined && header.cdelt2 !== undefined) {
    const cdelt1 = header.cdelt1;
    const cdelt2 = header.cdelt2;
    const rho = (cardNumber(header, 'CROTA2') ?? 0) * DEG2RAD;
    const cosR = Math.cos(rho);
    const sinR = Math.sin(rho);
    cd11 = cdelt1 * cosR;
    cd12 = -cdelt2 * sinR;
    cd21 = cdelt1 * sinR;
    cd22 = cdelt2 * cosR;
  } else {
    // Neither CD nor CDELT: no linear transform available — not a usable WCS.
    return null;
  }

  return { crval1, crval2, crpix1, crpix2, cd11, cd12, cd21, cd22 };
}

/**
 * FITS image pixel (1-based) -> world RA/Dec (degrees) for a TAN WCS.
 *
 * Total: defined for every pixel. Applies the CD matrix to get the intermediate
 * world coordinates (xi, eta) in degrees, then inverse-gnomonic-deprojects about
 * (CRVAL1, CRVAL2). RA is normalised to [0, 360).
 */
export function pixelToWorld(wcs: Wcs, x: number, y: number): World {
  const dp1 = x - wcs.crpix1;
  const dp2 = y - wcs.crpix2;

  // Intermediate world coords (degrees) -> radians tangent-plane coords.
  const xi = (wcs.cd11 * dp1 + wcs.cd12 * dp2) * DEG2RAD;
  const eta = (wcs.cd21 * dp1 + wcs.cd22 * dp2) * DEG2RAD;

  const ra0 = wcs.crval1 * DEG2RAD;
  const dec0 = wcs.crval2 * DEG2RAD;
  const cosDec0 = Math.cos(dec0);
  const sinDec0 = Math.sin(dec0);

  const rho = Math.hypot(xi, eta);
  if (rho === 0) {
    return { ra: normalizeRa(wcs.crval1), dec: wcs.crval2 };
  }
  // Gnomonic (TAN): tan(c) = rho.
  const c = Math.atan(rho);
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);

  const dec = Math.asin(cosC * sinDec0 + (eta * sinC * cosDec0) / rho);
  const ra =
    ra0 + Math.atan2(xi * sinC, rho * cosDec0 * cosC - eta * sinDec0 * sinC);

  return { ra: normalizeRa(ra * RAD2DEG), dec: dec * RAD2DEG };
}

/**
 * World RA/Dec (degrees) -> FITS image pixel (1-based) for a TAN WCS, or `null`.
 *
 * Returns `null` when the sky point is on the far hemisphere (>= 90° from the
 * reference point, where the gnomonic denominator <= 0 and the tangent plane
 * cannot represent it) or when the CD matrix is singular (non-invertible).
 * Otherwise gnomonic-projects to (xi, eta) degrees, then applies the INVERSE CD
 * matrix to recover the pixel offset from CRPIX.
 */
export function worldToPixel(wcs: Wcs, ra: number, dec: number): Pixel | null {
  const ra0 = wcs.crval1 * DEG2RAD;
  const dec0 = wcs.crval2 * DEG2RAD;
  const raR = ra * DEG2RAD;
  const decR = dec * DEG2RAD;

  const cosDec0 = Math.cos(dec0);
  const sinDec0 = Math.sin(dec0);
  const cosDec = Math.cos(decR);
  const sinDec = Math.sin(decR);
  const dRa = raR - ra0;
  const cosDRa = Math.cos(dRa);

  // cos of the angular separation between the point and the tangent point.
  const denom = sinDec * sinDec0 + cosDec * cosDec0 * cosDRa;
  if (denom <= 0) return null; // far hemisphere (>= 90° away)

  // Standard/tangent-plane coordinates (radians) -> intermediate world (deg).
  const xi = (cosDec * Math.sin(dRa)) / denom;
  const eta = (sinDec * cosDec0 - cosDec * sinDec0 * cosDRa) / denom;
  const xiDeg = xi * RAD2DEG;
  const etaDeg = eta * RAD2DEG;

  // Invert the 2x2 CD matrix: pixel_offset = CD^-1 * (xi, eta).
  const det = wcs.cd11 * wcs.cd22 - wcs.cd12 * wcs.cd21;
  if (det === 0) return null; // singular CD — no pixel mapping

  const dp1 = (wcs.cd22 * xiDeg - wcs.cd12 * etaDeg) / det;
  const dp2 = (-wcs.cd21 * xiDeg + wcs.cd11 * etaDeg) / det;

  return { x: dp1 + wcs.crpix1, y: dp2 + wcs.crpix2 };
}

/**
 * Mean on-sky pixel scale of the WCS, in ARCSECONDS per pixel.
 *
 * Averages the two axis scales (the column norms of the CD matrix, deg/pixel)
 * and converts to arcsec (× 3600). For a diagonal CD of ±0.0001111 deg/pixel
 * this is ≈ 0.40″/pixel.
 */
export function wcsPixelScaleArcsec(wcs: Wcs): number {
  const s1 = Math.hypot(wcs.cd11, wcs.cd21); // deg/pixel along axis 1
  const s2 = Math.hypot(wcs.cd12, wcs.cd22); // deg/pixel along axis 2
  return ((s1 + s2) / 2) * 3600;
}
