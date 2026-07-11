/**
 * Pure Lupton asinh RGB compositor: three aligned single-band FITS float arrays
 * (linear-physical pixels, e.g. from `readFits`) → one RGBA image.
 *
 * This is the maths half of feature 120 (RGB band-mixing composite). The SODA
 * client fetches three per-band DP1 cutouts at the SAME position/size (see
 * `TileViewer`), `readFits` decodes each to physical Float64 pixels, and THIS
 * module mixes them into a colour image with the standard Lupton stretch. Keeping
 * it PURE (no DOM, no canvas) is what makes the colour mapping testable by
 * OUTCOME — a pixel bright only in the R input must come out red-dominant, which
 * a grayscale or channel-swapped implementation cannot fake (see
 * `tests/unit/luptonRgb.test.ts`).
 *
 * ── Algorithm (VERIFIED against astropy `make_lupton_rgb` /
 *    `astropy.visualization.lupton_rgb.AsinhMapping`, main branch; Lupton et al.
 *    2004, PASP 116, 133) ────────────────────────────────────────────────────
 *
 *   For each pixel, with per-channel `minimum` first subtracted:
 *       r' = r − minimum,  g' = g − minimum,  b' = b − minimum
 *       I  = (r' + g' + b') / 3                          // mean intensity
 *       soften = Q / stretch
 *       slope  = FRAC / asinh(FRAC · Q)                  // FRAC = 0.1 (astropy)
 *       factor = (I <= 0) ? 0 : asinh(I · soften) · slope / I      // I→0 guard
 *       R = r'·factor,  G = g'·factor,  B = b'·factor
 *       clip each channel below at 0
 *       // hue-preserving saturation: if max(R,G,B) > 1, divide all three by it
 *       m = max(R,G,B);  if (m > 1) { R/=m; G/=m; B/=m; }
 *       output byte = round(channel · 255), clamped to [0,255]
 *
 *   The `slope` normalisation (astropy's `frac=0.1`) anchors the asinh so the
 *   output is well-scaled independent of Q; it depends only on Q, not on the
 *   pixel. The `I <= 0` branch is the zero/negative-intensity guard that avoids a
 *   divide-by-zero (a fully-black-or-below-`minimum` pixel maps to black, opaque).
 *
 *   Parameter senses (per the asinh(I·Q/stretch) form, verified above):
 *     • larger `Q`      → stronger asinh compression → faint structure boosted;
 *     • larger `stretch`→ soften = Q/stretch smaller → a given faint pixel DIMS
 *       (equivalently: LOWER stretch brightens the faint end). NOTE this is the
 *       astropy `stretch` convention — the parameter is a *linear* stretch, so
 *       raising it spreads the linear range and darkens faint pixels.
 *
 * A common band→channel convention maps the longer-wavelength band to R (e.g.
 * i→R, r→G, g→B); this module is channel-agnostic (the caller decides which band
 * feeds r/g/b), so that convention lives in the UI, not here.
 *
 * NaN handling: a pixel that is NaN in ANY of the three inputs is rendered FULLY
 * TRANSPARENT (alpha {@link LUPTON_NAN_ALPHA} = 0) — "no data" reads as
 * transparent, never as a misleading black-is-zero pixel.
 */

/** astropy's `frac`: the asinh normalisation anchor. Do not change lightly. */
const LUPTON_FRAC = 0.1;

/** Max channel value in normalised space (astropy's `pixmax` is 1.0 here). */
const LUPTON_PIXMAX = 1;

/** Alpha byte written for a pixel that is NaN in any input band: transparent. */
export const LUPTON_NAN_ALPHA = 0;

/** Alpha byte for a valid (all-finite) pixel: opaque. */
export const LUPTON_OPAQUE_ALPHA = 255;

export interface LuptonOptions {
  /**
   * Asinh softening parameter Q (> 0). Larger Q compresses the faint end more,
   * revealing more low-surface-brightness structure. astropy default 8.
   */
  Q: number;
  /**
   * Linear stretch (> 0). Larger stretch spreads the linear range so faint
   * pixels appear dimmer; smaller stretch brightens the faint end. astropy
   * default 5.
   */
  stretch: number;
  /**
   * Per-channel value subtracted before the stretch (the black point). A single
   * number is applied to all three channels. Default 0.
   */
  minimum?: number;
}

/** Guard a numeric option: reject NaN/Infinity and (optionally) non-positive. */
function requirePositive(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}: expected a finite number > 0, got ${String(value)}`);
  }
  return value;
}

/**
 * Composite three aligned single-band float images into RGBA using the Lupton
 * asinh recipe. PURE — no DOM. See the file header for the exact algorithm,
 * parameter senses, the I→0 guard, and NaN handling.
 *
 * @param r Physical pixels feeding the RED channel (row-major, length w*h).
 * @param g Physical pixels feeding the GREEN channel.
 * @param b Physical pixels feeding the BLUE channel.
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @returns RGBA bytes, length width*height*4, row-major (row 0 first).
 * @throws if the three arrays are not all length width*height (bands whose
 *   cutouts differ in size CANNOT be combined — fail honestly, never pad/crop),
 *   or if Q/stretch are not finite and > 0.
 */
export function luptonRgb(
  r: Float64Array,
  g: Float64Array,
  b: Float64Array,
  width: number,
  height: number,
  opts: LuptonOptions
): Uint8ClampedArray {
  const pixelCount = width * height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`luptonRgb: invalid dimensions ${width}x${height}`);
  }
  if (r.length !== pixelCount || g.length !== pixelCount || b.length !== pixelCount) {
    throw new Error(
      `luptonRgb: all three bands must be ${pixelCount} pixels (${width}x${height}); ` +
        `got r=${r.length}, g=${g.length}, b=${b.length}. Bands whose cutouts differ ` +
        'in size cannot be combined.'
    );
  }

  const Q = requirePositive(opts.Q, 'Q');
  const stretch = requirePositive(opts.stretch, 'stretch');
  const minimum = opts.minimum ?? 0;

  const soften = Q / stretch;
  // slope depends only on Q (astropy's frac·pixmax/asinh(frac·Q) with pixmax=1).
  const slope = LUPTON_FRAC / Math.asinh(LUPTON_FRAC * Q);

  const rgba = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const rv = r[i]!;
    const gv = g[i]!;
    const bv = b[i]!;

    // A pixel with no data in ANY band → fully transparent (never black-is-zero).
    if (Number.isNaN(rv) || Number.isNaN(gv) || Number.isNaN(bv)) {
      rgba[i * 4 + 3] = LUPTON_NAN_ALPHA;
      continue;
    }

    const rMin = rv - minimum;
    const gMin = gv - minimum;
    const bMin = bv - minimum;

    const intensity = (rMin + gMin + bMin) / 3;
    // Zero/negative-intensity guard: factor 0 → black pixel, no divide-by-zero.
    const factor = intensity <= 0 ? 0 : (Math.asinh(intensity * soften) * slope) / intensity;

    // Scale each channel, then clip negatives to 0 (astropy `c[c < 0] = 0`).
    let R = Math.max(0, rMin * factor);
    let G = Math.max(0, gMin * factor);
    let B = Math.max(0, bMin * factor);

    // Hue-preserving saturation: if any channel exceeds the max, scale ALL three
    // down by the same factor so the colour ratio (hue) is preserved instead of
    // clipping each channel independently (which would wash the colour to white).
    const m = Math.max(R, G, B);
    if (m > LUPTON_PIXMAX) {
      const s = LUPTON_PIXMAX / m;
      R *= s;
      G *= s;
      B *= s;
    }

    rgba[i * 4] = Math.round(R * 255);
    rgba[i * 4 + 1] = Math.round(G * 255);
    rgba[i * 4 + 2] = Math.round(B * 255);
    rgba[i * 4 + 3] = LUPTON_OPAQUE_ALPHA;
  }

  return rgba;
}
