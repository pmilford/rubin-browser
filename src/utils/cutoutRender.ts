/**
 * Pure FITS-cutout renderer: a parsed {@link FitsImage} (linear-float physical
 * pixels) → RGBA bytes ready for `ctx.putImageData`.
 *
 * This is the display half of the FITS cutout pipeline (feature 109): the SODA
 * client (`src/api/soda.ts`) fetches the bytes, `readFits` (`src/utils/fits.ts`)
 * decodes them to physical Float64 pixels, and THIS module turns those pixels
 * into a stretched, colour-mapped image. Keeping it PURE (no DOM, no canvas) is
 * what makes the rendering testable by OUTCOME — a synthetic image with a known
 * bright pixel must come out brighter than a faint one, which a placeholder /
 * constant renderer cannot fake (see `tests/unit/cutoutRender.test.ts`).
 *
 * Pipeline: percentile-clip stretch bounds (default 0.5–99.5 %, ignoring NaN)
 * → `applyScaling` (linear/log/sqrt/asinh, normalised to [0,1]) → optional
 * INVERT (1 − v) → `applyColorMap` → RGBA. It reuses the exact DS9-style
 * post-processing used elsewhere so a cutout stretches identically to the HiPS
 * viewer.
 *
 * Pixel ORDER: `data[row*width + col]` is FITS pixel (col+1, row+1); the RGBA is
 * written in the SAME order, so canvas row 0 is data row 0. This is
 * self-consistent with the WCS readout in `CutoutPanel`, which reads a cursor at
 * canvas (col,row) as FITS pixel (col+1, row+1) via `wcs.pixelToWorld`.
 *
 * BLANK / NaN pixels: rendered FULLY TRANSPARENT (alpha 0, {@link CUTOUT_NAN_ALPHA}).
 * They are detected from the ORIGINAL physical data (not the NaN→0 sanitised copy
 * `applyScaling` works on), so "no data" reads as transparent rather than as a
 * misleading black-is-zero pixel.
 */

import type { FitsImage } from './fits.js';
import { percentileClip } from './fits.js';
import { applyScaling } from './scaling.js';
import { applyColorMap } from './colormap.js';
import type { ScalingFunction, ColorMapName } from '../types/image.js';

/** Alpha byte written for a BLANK/NaN pixel: fully transparent. */
export const CUTOUT_NAN_ALPHA = 0;

/** Default low percentile for the automatic stretch (ignores NaN). */
export const DEFAULT_LO_PCT = 0.5;
/** Default high percentile for the automatic stretch (ignores NaN). */
export const DEFAULT_HI_PCT = 99.5;

export interface CutoutRenderOptions {
  /** Stretch function applied to the normalised pixels. */
  scale: ScalingFunction;
  /** Colour map applied after scaling. */
  colormap: ColorMapName;
  /** Invert the stretched value (1 − v) before the colour map. */
  invert?: boolean;
  /** Low percentile for the automatic stretch (default {@link DEFAULT_LO_PCT}). */
  loPct?: number;
  /** High percentile for the automatic stretch (default {@link DEFAULT_HI_PCT}). */
  hiPct?: number;
  /** Explicit stretch minimum — overrides the percentile clip when given with `max`. */
  min?: number;
  /** Explicit stretch maximum — overrides the percentile clip when given with `min`. */
  max?: number;
}

export interface CutoutRenderResult {
  /** RGBA bytes, length width*height*4, row-major (canvas row 0 = data row 0). */
  rgba: Uint8ClampedArray;
  /** Image width in pixels (== image.width). */
  width: number;
  /** Image height in pixels (== image.height). */
  height: number;
  /** Physical value mapped to the low end of the stretch (NaN if no finite data). */
  min: number;
  /** Physical value mapped to the high end of the stretch (NaN if no finite data). */
  max: number;
}

/**
 * Render a FITS cutout to RGBA. PURE — no DOM. See the file header for the
 * pipeline, pixel ordering, and BLANK/NaN handling.
 */
export function renderCutout(
  image: FitsImage,
  opts: CutoutRenderOptions
): CutoutRenderResult {
  const { data, width, height } = image;
  const pixelCount = width * height;

  // Stretch bounds: explicit min+max win; otherwise a percentile clip that
  // ignores NaN (so a lone saturated core or a BLANK border doesn't wreck it).
  let min: number;
  let max: number;
  if (opts.min !== undefined && opts.max !== undefined) {
    min = opts.min;
    max = opts.max;
  } else {
    const clip = percentileClip(
      data,
      opts.loPct ?? DEFAULT_LO_PCT,
      opts.hiPct ?? DEFAULT_HI_PCT
    );
    min = clip.min;
    max = clip.max;
  }

  // Normalise to [0,1] with the chosen stretch. applyScaling sanitises NaN→0
  // internally; we re-apply true transparency for NaN pixels below using the
  // ORIGINAL data, so a BLANK never masquerades as a real zero-valued pixel.
  const scaled = applyScaling(data, { method: opts.scale, min, max }).data;

  if (opts.invert) {
    for (let i = 0; i < scaled.length; i++) {
      scaled[i] = 1 - scaled[i]!;
    }
  }

  const rgba = applyColorMap(scaled, opts.colormap);

  // BLANK / NaN → fully transparent (detected from the original physical data).
  for (let i = 0; i < pixelCount; i++) {
    if (Number.isNaN(data[i]!)) {
      rgba[i * 4 + 3] = CUTOUT_NAN_ALPHA;
    }
  }

  return { rgba, width, height, min, max };
}
