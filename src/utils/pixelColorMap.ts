/**
 * PURE maths for a per-pixel RESOLVED COLOUR overlay of a galaxy from two aligned
 * single-band images (TODO 160). No DOM, no network, no randomness.
 *
 * ── WHY COLOUR, NOT REDSHIFT ────────────────────────────────────────────────
 * A per-pixel REDSHIFT map is not defensible: every pixel of one galaxy is the same
 * object at the same distance (redshift is not a per-pixel quantity), and broadband
 * colour is degenerate with redshift (age/metallicity/dust redden the same way). So
 * we map a per-pixel COLOUR index (bluer ⇒ younger/star-forming, redder ⇒
 * older/dustier/higher-z), and the UI shows redshift only as ONE value per object.
 * This is the established resolved-stellar-population technique (Welikala pixel-z
 * fixes z and fits per-pixel population; Zibetti mass maps; piXedfit) — the maps
 * practitioners actually make.
 *
 * ── DEFENSIBLE-OR-GARBAGE REQUIREMENTS (all handled here) ────────────────────
 *  - PSF-match: the two bands must be at a common PSF or edge colours are a seeing
 *    artefact → {@link gaussianPsfMatch} convolves the sharper band up to the broader.
 *  - S/N floor: raw outskirt pixels are noise → masked transparent below a per-pixel
 *    S/N (the "dark/sky pixels must not paint a rainbow" requirement).
 *  - Saturation: a clipped core has the wrong flux ratio → masked transparent.
 *  - Non-finite / non-positive flux: log undefined → masked.
 * Masked pixels render fully transparent so only trustworthy pixels are coloured.
 */

/* -------------------------------------------------------------------------- */
/* 1. PSF matching                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Convolve `image` (row-major, `width`×`height`) with an isotropic Gaussian of
 * standard deviation `sigmaAddPx` PIXELS, via two separable 1-D passes. Used to
 * bring a sharper band up to a broader common PSF: pass
 * `sigmaAddPx = sqrt(max(0, sigmaTarget² − sigmaBand²))`.
 *
 * NaN-aware (a NaN pixel contributes nothing and an all-NaN neighbourhood stays
 * NaN — gaps never poison the blur) and edge-clamped. `sigmaAddPx ≤ 0` or
 * non-finite ⇒ an unchanged COPY (a band already at/above the target PSF is left
 * alone). Flux is approximately conserved for a finite, gap-free region.
 */
export function gaussianPsfMatch(
  image: Float64Array,
  width: number,
  height: number,
  sigmaAddPx: number,
): Float64Array {
  if (!(sigmaAddPx > 0) || !Number.isFinite(sigmaAddPx)) return Float64Array.from(image);

  const radius = Math.max(1, Math.ceil(sigmaAddPx * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  const inv2s2 = 1 / (2 * sigmaAddPx * sigmaAddPx);
  for (let k = -radius; k <= radius; k++) kernel[k + radius] = Math.exp(-(k * k) * inv2s2);

  const clamp = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

  // Horizontal pass image → tmp, then vertical pass tmp → out.
  const blur1D = (src: Float64Array, horizontal: boolean): Float64Array => {
    const out = new Float64Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let wsum = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? clamp(x + k, width - 1) : x;
          const yy = horizontal ? y : clamp(y + k, height - 1);
          const v = src[yy * width + xx]!;
          if (!Number.isFinite(v)) continue;
          const w = kernel[k + radius]!;
          sum += v * w;
          wsum += w;
        }
        out[y * width + x] = wsum > 0 ? sum / wsum : NaN;
      }
    }
    return out;
  };

  return blur1D(blur1D(image, true), false);
}

/* -------------------------------------------------------------------------- */
/* 2. Per-pixel colour index + validity mask                                  */
/* -------------------------------------------------------------------------- */

export interface ColorIndexOptions {
  /** Mask a pixel whose per-pixel S/N (value/sigma) is below this in EITHER band. Default 3. */
  snrFloor?: number;
  /** Sky-noise σ for the blue band (same units as the pixels). If omitted, estimated from the border ring. */
  blueSigma?: number;
  /** Sky-noise σ for the red band. If omitted, estimated from the border ring. */
  redSigma?: number;
  /** Mask a pixel at/above this level in EITHER band (saturation/clipping). Default Infinity (off). */
  satLevel?: number;
}

export interface ColorIndexResult {
  /** Per-pixel colour index −2.5·log10(blue/red); NaN where masked. */
  color: Float64Array;
  /** 1 = valid/trustworthy pixel, 0 = masked (dark/sky, saturated, or non-finite). */
  mask: Uint8Array;
  /** Per-pixel min-of-both-bands S/N (0 where masked) — for alpha fading. */
  snr: Float64Array;
}

/** Robust sky-σ estimate from the 1-pixel border ring: MAD-based, finite pixels only. */
function borderSigma(img: Float64Array, width: number, height: number): number {
  const vals: number[] = [];
  for (let x = 0; x < width; x++) {
    const t = img[x];
    const b = img[(height - 1) * width + x];
    if (Number.isFinite(t)) vals.push(t!);
    if (Number.isFinite(b)) vals.push(b!);
  }
  for (let y = 1; y < height - 1; y++) {
    const l = img[y * width];
    const r = img[y * width + width - 1];
    if (Number.isFinite(l)) vals.push(l!);
    if (Number.isFinite(r)) vals.push(r!);
  }
  if (vals.length < 2) return 1;
  vals.sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)]!;
  const dev = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = dev[Math.floor(dev.length / 2)]!;
  const sigma = 1.4826 * mad; // MAD → σ for a normal
  return sigma > 0 ? sigma : 1;
}

/**
 * Per-pixel relative colour index `−2.5·log10(blue/red)` (bluer ⇒ more NEGATIVE,
 * redder ⇒ more POSITIVE) with a validity mask that drops the pixels a colour must
 * NOT be computed from: below the S/N floor (dark sky / noisy outskirts), at/above
 * saturation (clipped core), or non-finite/≤0 flux (log undefined). Bands are
 * assumed already PSF-matched + aligned by the caller.
 */
export function perPixelColorIndex(
  blue: Float64Array,
  red: Float64Array,
  width: number,
  height: number,
  opts: ColorIndexOptions = {},
): ColorIndexResult {
  const n = width * height;
  const snrFloor = opts.snrFloor ?? 3;
  const satLevel = opts.satLevel ?? Infinity;
  const bSig = opts.blueSigma != null && opts.blueSigma > 0 ? opts.blueSigma : borderSigma(blue, width, height);
  const rSig = opts.redSigma != null && opts.redSigma > 0 ? opts.redSigma : borderSigma(red, width, height);

  const color = new Float64Array(n);
  const mask = new Uint8Array(n);
  const snr = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const bf = blue[i]!;
    const rf = red[i]!;
    const finite = Number.isFinite(bf) && Number.isFinite(rf) && bf > 0 && rf > 0;
    if (!finite || bf >= satLevel || rf >= satLevel) {
      color[i] = NaN;
      continue;
    }
    const s = Math.min(bf / bSig, rf / rSig);
    if (s < snrFloor) {
      color[i] = NaN;
      continue;
    }
    color[i] = -2.5 * Math.log10(bf / rf);
    snr[i] = s;
    mask[i] = 1;
  }
  return { color, mask, snr };
}

/* -------------------------------------------------------------------------- */
/* 3. Colour → RGBA (diverging map centred on the median colour)              */
/* -------------------------------------------------------------------------- */

export interface ColorMapRgbaOptions {
  /** Fade alpha with per-pixel S/N (noisy pixels fainter). Needs `snr`. Default false. */
  alphaBySnr?: boolean;
  /** Per-pixel S/N (from {@link perPixelColorIndex}) — required when `alphaBySnr`. */
  snr?: Float64Array;
  /** S/N at/above which a pixel is fully opaque (alpha ramps floor→1 over [snrFloor, this]). Default 10. */
  snrFull?: number;
  /** S/N floor used for the alpha ramp start. Default 3. */
  snrFloor?: number;
  /** Minimum alpha (0–255) for a just-valid pixel when fading. Default 90. */
  minAlpha?: number;
}

/** Pth percentile of a sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx]!;
}

/** Blue→white→red diverging ramp for t ∈ [−1, 1] (t=0 → neutral centre). */
function divergingRgb(t: number): [number, number, number] {
  const tc = t < -1 ? -1 : t > 1 ? 1 : t;
  const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
  const BLUE: [number, number, number] = [59, 76, 192];
  const WHITE: [number, number, number] = [238, 238, 238];
  const RED: [number, number, number] = [180, 58, 48];
  if (tc < 0) {
    const u = tc + 1; // −1→0 : blue→white
    return [lerp(BLUE[0], WHITE[0], u), lerp(BLUE[1], WHITE[1], u), lerp(BLUE[2], WHITE[2], u)];
  }
  return [lerp(WHITE[0], RED[0], tc), lerp(WHITE[1], RED[1], tc), lerp(WHITE[2], RED[2], tc)];
}

/**
 * Render a per-pixel colour index + mask into an RGBA overlay. The diverging map is
 * centred on the MEDIAN of the valid pixels' colours (so blue = bluer-than-typical
 * ⇒ younger/star-forming, red = redder-than-typical ⇒ older/dustier/higher-z) and
 * scaled by a robust 5–95th-percentile spread so outliers don't wash it out. Masked
 * pixels are fully transparent (alpha 0), so dark sky and saturated cores never
 * paint a colour. With `alphaBySnr`, low-S/N pixels fade so the eye trusts the
 * high-S/N interior.
 */
export function colorMapToRgba(
  color: Float64Array,
  mask: Uint8Array,
  width: number,
  height: number,
  opts: ColorMapRgbaOptions = {},
): Uint8ClampedArray {
  const n = width * height;
  const rgba = new Uint8ClampedArray(n * 4);

  const valid: number[] = [];
  for (let i = 0; i < n; i++) if (mask[i] === 1 && Number.isFinite(color[i])) valid.push(color[i]!);
  if (valid.length === 0) return rgba; // nothing trustworthy → fully transparent

  valid.sort((a, b) => a - b);
  const median = valid[Math.floor(valid.length / 2)]!;
  const p5 = percentile(valid, 5);
  const p95 = percentile(valid, 95);
  const scale = Math.max(Math.abs(p95 - median), Math.abs(median - p5)) || 1;

  const alphaBySnr = opts.alphaBySnr === true && opts.snr != null;
  const snr = opts.snr;
  const snrFull = opts.snrFull ?? 10;
  const snrFloor = opts.snrFloor ?? 3;
  const minAlpha = opts.minAlpha ?? 90;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (mask[i] !== 1 || !Number.isFinite(color[i])) {
      rgba[o + 3] = 0; // transparent
      continue;
    }
    const t = (color[i]! - median) / scale;
    const [r, g, b] = divergingRgb(t);
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    if (alphaBySnr && snr) {
      const frac = Math.max(0, Math.min(1, (snr[i]! - snrFloor) / Math.max(1e-6, snrFull - snrFloor)));
      rgba[o + 3] = Math.round(minAlpha + (255 - minAlpha) * frac);
    } else {
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}
