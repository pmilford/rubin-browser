/**
 * Pure Gaia DR3 visualisation maths (feature: Gaia rich visualization).
 *
 * `src/api/gaia.ts` already fetches the rich Gaia columns — BP−RP colour, proper
 * motion (pmRA*, pmDec), and parallax — but the feature-101 overlay only drew a
 * position + label and threw the rest away. These pure functions turn those
 * columns into the derived quantities the overlay + a colour–magnitude diagram
 * render. They live here (not in a component) so every convention below is unit-
 * testable against a hand-checked value, with NO DOM and NO canvas.
 *
 * Conventions VERIFIED against the ESA Gaia docs / A&A DR3 papers (2026-07), not
 * guessed (see CLAUDE.md "Research the API/tool BEFORE coding"):
 *   - `pmra` in Gaia IS μα* = μα·cosδ, i.e. the true on-sky eastward rate in
 *     mas/yr — so it needs NO extra cosδ factor to point an arrow on the sky.
 *     (ESA Gaia: "proper motions are expressed as μα* = μα cosδ and μδ".)
 *   - Absolute G magnitude from parallax: M_G = G + 5·log10(ϖ_arcsec) + 5. With ϖ
 *     in mas (Gaia's unit) that is M_G = G + 5·log10(ϖ_mas) − 10. VALID ONLY for
 *     ϖ > 0 — Gaia publishes real negative/zero parallaxes that mean "unusable",
 *     never a distance. Hand check: G=15, ϖ=10 mas (d=100 pc) → M_G = 15 + 5·1 −
 *     10 = 10, and m−M = 5·log10(100) − 5 = 5 ⇒ M = 10. ✓
 *   - Distance: d_pc = 1000 / ϖ_mas, ALSO only for ϖ > 0.
 *   - Colour–magnitude diagram (HR): x = BP−RP (blue/hot at LOW colour index, red/
 *     cool at HIGH), y = G with the magnitude axis INVERTED (brighter = up).
 */

import type { GaiaCatalog } from '../api/gaia.js';

/** Marker colour for a source whose BP−RP colour is unknown (NaN) — a real,
 *  visible neutral grey, never mistaken for a hot-blue or a cool-red star. */
export const GAIA_NAN_COLOR: readonly [number, number, number] = [170, 170, 170];

/**
 * BP−RP domain mapped across the blue→white→red ramp. Real Gaia BP−RP for stars
 * runs from roughly −0.3 (very hot/blue) to ~5 (very cool/red); the bulk sits in
 * [0, 3]. Values outside the domain clamp to the endpoint colour.
 */
export const BPRP_BLUE = -0.2; // hottest / bluest anchor
export const BPRP_RED = 2.8; // coolest / reddest anchor

/** Linear interpolate one 0–255 channel and round to an integer. */
function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/**
 * Perceptual blue→white→red colour for a Gaia BP−RP colour index. HOT (small/
 * negative BP−RP) → blue; neutral → white; COOL (large BP−RP) → red — the
 * physical temperature ordering. NaN/undefined colour → {@link GAIA_NAN_COLOR}.
 *
 * The RED channel is strictly non-decreasing and the BLUE channel strictly non-
 * increasing across the whole domain, so two sources of DIFFERENT colour index
 * always get DIFFERENT RGB (a constant-colour renderer fails the unit test).
 */
export function bpRpToRgb(bpRp: number): [number, number, number] {
  if (!Number.isFinite(bpRp)) {
    return [GAIA_NAN_COLOR[0], GAIA_NAN_COLOR[1], GAIA_NAN_COLOR[2]];
  }
  // Normalise into [0,1] across the domain.
  const raw = (bpRp - BPRP_BLUE) / (BPRP_RED - BPRP_BLUE);
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;

  // Blue (50,90,255) → White (240,240,240) → Red (255,60,40).
  const blue: [number, number, number] = [50, 90, 255];
  const white: [number, number, number] = [240, 240, 240];
  const red: [number, number, number] = [255, 60, 40];

  if (t <= 0.5) {
    const s = t / 0.5;
    return [
      lerpChannel(blue[0], white[0], s),
      lerpChannel(blue[1], white[1], s),
      lerpChannel(blue[2], white[2], s),
    ];
  }
  const s = (t - 0.5) / 0.5;
  return [
    lerpChannel(white[0], red[0], s),
    lerpChannel(white[1], red[1], s),
    lerpChannel(white[2], red[2], s),
  ];
}

/**
 * Distance in parsecs from a Gaia parallax in mas: d = 1000 / ϖ. Returns null for
 * ϖ ≤ 0 or non-finite — a negative/zero Gaia parallax is REAL and means the
 * distance is unusable, so callers show "unknown", never a negative distance.
 */
export function parallaxToDistancePc(parallaxMas: number): number | null {
  if (!Number.isFinite(parallaxMas) || parallaxMas <= 0) return null;
  return 1000 / parallaxMas;
}

/**
 * Absolute G magnitude M_G = G + 5·log10(ϖ_mas) − 10. Returns null when G is non-
 * finite or ϖ ≤ 0 / non-finite (no valid distance ⇒ no absolute magnitude).
 */
export function absoluteGMag(gMag: number, parallaxMas: number): number | null {
  if (!Number.isFinite(gMag) || !Number.isFinite(parallaxMas) || parallaxMas <= 0) {
    return null;
  }
  return gMag + 5 * Math.log10(parallaxMas) - 10;
}

/**
 * Screen endpoint of a proper-motion arrow drawn from a marker at (x0,y0).
 *
 * pmRaStar is Gaia `pmra` = μα* (on-sky eastward rate, mas/yr) and pmDec is μδ.
 * On this viewer's tangent-plane projection east = +x and north = −y (see
 * `skyToCanvas` in projection.ts), and near the small overlay cone the two axes
 * share one angular scale, so the arrow endpoint is (x0 + pmRA*·s, y0 − pmDec·s).
 * `scale` is pixels per mas/yr. Returns null when either component is non-finite —
 * a source with no measured proper motion draws NO arrow (never a zero/garbage one).
 */
export function pmVectorEndpoint(
  x0: number,
  y0: number,
  pmRaStar: number,
  pmDec: number,
  scale: number
): { x: number; y: number } | null {
  if (!Number.isFinite(pmRaStar) || !Number.isFinite(pmDec)) return null;
  return { x: x0 + pmRaStar * scale, y: y0 - pmDec * scale };
}

/**
 * One plotted point of a colour–magnitude diagram: the source index (so a click
 * links back to the sky marker + table row), its BP−RP colour (x), its magnitude
 * (y), and whether that magnitude is ABSOLUTE (M_G, when parallax > 0) or the
 * apparent G (fallback when parallax is unusable).
 */
export interface CmdPoint {
  index: number;
  colour: number; // BP−RP
  mag: number; // absolute M_G if `absolute`, else apparent G
  absolute: boolean;
}

/**
 * Extract the plottable colour–magnitude points from a Gaia catalog: one point
 * per source that has BOTH a finite BP−RP colour (needed for the x-axis) AND a
 * finite magnitude. Absolute M_G is preferred (parallax > 0); otherwise the
 * apparent G is used and `absolute=false` flags it so the diagram can disclose the
 * mix. Sources missing colour or all magnitude are DROPPED — an all-NaN catalog
 * yields an empty array (an honest empty diagram, never fabricated points).
 */
export function cmdPoints(cat: GaiaCatalog): CmdPoint[] {
  const out: CmdPoint[] = [];
  for (let i = 0; i < cat.count; i++) {
    const colour = cat.bpRp[i]!;
    if (!Number.isFinite(colour)) continue;
    const abs = absoluteGMag(cat.gMag[i]!, cat.parallax[i]!);
    if (abs !== null) {
      out.push({ index: i, colour, mag: abs, absolute: true });
    } else if (Number.isFinite(cat.gMag[i]!)) {
      out.push({ index: i, colour, mag: cat.gMag[i]!, absolute: false });
    }
  }
  return out;
}
