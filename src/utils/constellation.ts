import { CONSTELLATION_BOUNDS, CONSTELLATION_NAMES } from './constellation-data.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const ARCSEC2RAD = DEG2RAD / 3600;

/**
 * Precess an equatorial (RA, Dec) position from J2000.0 to the mean equator
 * and equinox of Besselian epoch B1875.0, using the IAU 1976 precession
 * angles (zeta_A, z_A, theta_A). This is the epoch the Roman/Delporte
 * constellation boundaries are defined in.
 *
 * B1875.0 lies T = -1.25 Julian centuries from J2000.0
 * (JD(B1875.0) = 2405889.2589, so T = (JD - 2451545.0)/36525).
 */
function precessJ2000toB1875(raDeg: number, decDeg: number): { raDeg: number; decDeg: number } {
  // Julian centuries from J2000.0 to B1875.0.
  const jdB1875 = 2405889.2589;
  const T = (jdB1875 - 2451545.0) / 36525.0; // ~ -1.24999...

  // IAU 1976 precession angles (arcsec) for the interval J2000 -> epoch(T).
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * ARCSEC2RAD;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * ARCSEC2RAD;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * ARCSEC2RAD;

  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;

  // J2000 unit vector.
  const x0 = Math.cos(ra) * Math.cos(dec);
  const y0 = Math.sin(ra) * Math.cos(dec);
  const z0 = Math.sin(dec);

  // Rotation matrix P = R3(-z) . R2(theta) . R3(-zeta), applied as v' = P v.
  const cZeta = Math.cos(zeta), sZeta = Math.sin(zeta);
  const cZ = Math.cos(z), sZ = Math.sin(z);
  const cT = Math.cos(theta), sT = Math.sin(theta);

  // Standard IAU 1976 precession matrix (rotates mean J2000 -> mean epoch).
  const p00 = cZeta * cT * cZ - sZeta * sZ;
  const p01 = -sZeta * cT * cZ - cZeta * sZ;
  const p02 = -sT * cZ;
  const p10 = cZeta * cT * sZ + sZeta * cZ;
  const p11 = -sZeta * cT * sZ + cZeta * cZ;
  const p12 = -sT * sZ;
  const p20 = cZeta * sT;
  const p21 = -sZeta * sT;
  const p22 = cT;

  const x1 = p00 * x0 + p01 * y0 + p02 * z0;
  const y1 = p10 * x0 + p11 * y0 + p12 * z0;
  const z1 = p20 * x0 + p21 * y0 + p22 * z0;

  let raOut = Math.atan2(y1, x1) * RAD2DEG;
  if (raOut < 0) raOut += 360;
  const decOut = Math.asin(Math.max(-1, Math.min(1, z1))) * RAD2DEG;
  return { raDeg: raOut, decDeg: decOut };
}

/** IAU constellation for a J2000 position (degrees). Never throws. */
export function constellationFor(raDeg: number, decDeg: number): { abbr: string; name: string } {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) {
    return { abbr: '—', name: 'Unknown' };
  }

  // Normalise J2000 RA to [0,360), then precess to B1875.
  let ra = raDeg % 360;
  if (ra < 0) ra += 360;
  const b1875 = precessJ2000toB1875(ra, decDeg);

  const raHours = b1875.raDeg / 15.0; // [0,24)
  const dec = b1875.decDeg;

  for (const [raLo, raHi, decLo, abbr] of CONSTELLATION_BOUNDS) {
    if (dec < decLo) continue;
    if (raLo <= raHours && raHours < raHi) {
      return { abbr, name: CONSTELLATION_NAMES[abbr] ?? abbr };
    }
  }
  return { abbr: '—', name: 'Unknown' };
}
