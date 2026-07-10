/**
 * Multi-epoch image differencing — "what changed between two epochs".
 *
 * Given two co-registered single-band images of the SAME sky region at two
 * epochs (epoch A = reference, epoch B = new), this module isolates *transients
 * and variables*: a source that appeared or brightened lights up in the
 * difference image while static sources cancel. This is the core of
 * transient-finding, and it is validated against KNOWN synthetic ground truth
 * (see syntheticSky.ts / offlineDataset.ts): the offline cube exposes each
 * source's true position and per-epoch light curve, so a broken differencer
 * (one that just returns B, or that flags every static source, or that lights
 * up the whole frame after a flat brightness change) FAILS the tests.
 *
 * PURE: no DOM, no fetch, no Date, no Math.random — same discipline as fits.ts.
 * Inputs are Float64Array/Float32Array + width/height (the linear intensity
 * arrays a tile/cutout carries), NOT pre-stretched 8-bit RGBA.
 *
 * Robustness the design demands:
 *  - A global ADDITIVE offset (B = A + const, e.g. a sky-background change) must
 *    NOT create detections — removed via the fitted intercept c.
 *  - A global photometric SCALE change (B = k·A, e.g. a gain/zero-point change)
 *    must NOT create detections — removed via the fitted slope k. The slope is
 *    estimated from bright sources COMMON to both epochs, so it is not attenuated
 *    by independent per-pixel noise (ordinary regression would bias k toward 0
 *    and leave a signal residual on every static source — a dipole storm).
 *  - Noise, all-NaN frames, all-equal frames, and a zero-spread difference are
 *    handled without dividing by zero and without spurious detections.
 *
 * Thresholding uses MEDIAN + MAD-based std (robust), never plain mean/stdev,
 * so a single hot pixel or a real transient does not inflate the noise estimate
 * and hide itself.
 */

/** A frame is a linear-intensity raster; either float width matches a tile buffer. */
export type ImageArray = Float64Array | Float32Array;

/** Scale MAD → an estimate of the Gaussian standard deviation. */
const MAD_TO_STD = 1.4826;

/** Robust location + scale of a sample: median and MAD-based standard deviation. */
export interface RobustStats {
  /** Sigma-clipped mean of the inliers (robust to outliers). */
  mean: number;
  /** Median of the finite values. */
  median: number;
  /** MAD-based standard deviation (1.4826 · median|x − median|). */
  std: number;
}

/** Result of differencing two frames. */
export interface DifferenceResult {
  /** b − (k·a + c): the difference image, same length/geometry as the inputs. */
  diff: Float64Array;
  /** Fitted photometric slope (B ≈ k·A + c). 1 when no scale was removed. */
  k: number;
  /** Fitted photometric offset (additive). 0 when no offset was removed. */
  c: number;
}

/** One detected transient/variable candidate in a difference image. */
export interface Transient {
  /** Intensity-weighted centroid column (x), sub-pixel. */
  x: number;
  /** Intensity-weighted centroid row (y), sub-pixel. */
  y: number;
  /**
   * Difference value at the component's extreme pixel. POSITIVE for a source
   * that appeared/brightened, NEGATIVE for one that disappeared/faded — the sign
   * distinguishes appear vs disappear.
   */
  peak: number;
  /** Summed (value − median) over the component. Signed like `peak`. */
  flux: number;
  /** (peak − median) / robust-std of the diff. Signed; |significance| ranks. */
  significance: number;
  /** Number of connected pixels above threshold (1 == a lone hot pixel). */
  area: number;
}

/** How to remove the global photometric relationship before differencing. */
export type DiffMethod =
  /** Fit slope k (from common bright sources) AND offset c. Default. */
  | 'linear'
  /** Offset only: k = 1, c = median(b − a). Cancels an additive change. */
  | 'median'
  /** Subtract raw: k = 1, c = 0. No photometric matching. */
  | 'none';

/** Options for {@link differenceImages}. */
export interface DifferenceOptions {
  method?: DiffMethod;
  /**
   * For 'linear': a pixel is treated as a "common bright source" (used to fit
   * the slope) when its reference value a exceeds median(a) + brightSigma·std(a).
   * High by default so only genuine sources — not the positive noise tail —
   * drive the slope, keeping k unattenuated. Default 5.
   */
  brightSigma?: number;
  /**
   * Minimum number of bright pixels required to trust a fitted slope; below
   * this the fit falls back to offset-only (k = 1). Default 6.
   */
  minBright?: number;
}

/** Options for {@link detectTransients}. */
export interface DetectOptions {
  /** Detection threshold in robust sigma above/below the diff median. Default 5. */
  nSigma?: number;
  /** Max detections returned (highest |significance| first). Default 100. */
  maxDetections?: number;
  /** Minimum connected area (pixels) for a detection. Default 1. */
  minArea?: number;
  /**
   * Which polarity to report:
   *  - 'positive' (default): appeared/brightened sources only.
   *  - 'negative': disappeared/faded sources only.
   *  - 'both': both, sign carried in `peak`/`significance`.
   */
  sign?: 'positive' | 'negative' | 'both';
  /** Pixel connectivity for components: 4 or 8 (default 8). */
  connectivity?: 4 | 8;
}

/** Sorted-copy median of a plain number array. Returns NaN for an empty array. */
function median(sortedCopyInput: number[]): number {
  const n = sortedCopyInput.length;
  if (n === 0) return NaN;
  const s = sortedCopyInput.slice().sort((p, q) => p - q);
  const mid = n >> 1;
  return n % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median and MAD-based std of a number array (already collected finite values). */
function medianAndMadStd(values: number[]): { median: number; std: number } {
  if (values.length === 0) return { median: NaN, std: NaN };
  const med = median(values);
  const absDev = values.map((v) => Math.abs(v - med));
  const std = MAD_TO_STD * median(absDev);
  return { median: med, std };
}

/** Collect finite values from a typed array into a plain array. */
function finiteValues(data: ImageArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Robust location/scale of a sample: median + MAD-std (both resistant to
 * outliers), and a sigma-clipped mean. Kills a plain mean/stdev that an outlier
 * would skew. Empty/all-NaN input returns NaN fields (callers must guard).
 */
export function sigmaClipStats(
  data: ImageArray,
  opts: { nSigma?: number; iterations?: number } = {}
): RobustStats {
  const nSigma = opts.nSigma ?? 3;
  const iterations = opts.iterations ?? 3;

  const finite = finiteValues(data);
  if (finite.length === 0) return { mean: NaN, median: NaN, std: NaN };

  const { median: med, std } = medianAndMadStd(finite);

  // Sigma-clipped mean: iteratively drop points outside median ± nSigma·std,
  // then average the survivors. When std == 0 the band is degenerate and the
  // mean collapses to the median (no divide-by-zero).
  let inliers = finite;
  if (std > 0) {
    for (let it = 0; it < iterations; it++) {
      const lo = med - nSigma * std;
      const hi = med + nSigma * std;
      const next = inliers.filter((v) => v >= lo && v <= hi);
      if (next.length === 0 || next.length === inliers.length) {
        inliers = next.length === 0 ? inliers : next;
        break;
      }
      inliers = next;
    }
  }
  const mean = inliers.reduce((acc, v) => acc + v, 0) / inliers.length;

  return { mean, median: med, std };
}

/** Ordinary least-squares slope/intercept of y on x. */
function olsLine(xs: number[], ys: number[]): { k: number; c: number } {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) {
    // x has no spread; slope is undefined. Assume unit gain, offset = mean(y−x).
    return { k: 1, c: (sy - sx) / n };
  }
  const k = (n * sxy - sx * sy) / denom;
  const c = (sy - k * sx) / n;
  return { k, c };
}

/**
 * Robustly fit b ≈ k·a + c so that a global photometric change cancels.
 *
 * The slope k is fit from pixels that are BRIGHT in the reference a (common
 * sources present in both epochs). There the per-pixel noise is tiny next to the
 * source signal, so k is not attenuated toward 0 the way a whole-frame regression
 * would be — that attenuation is exactly what would leave a residual on every
 * static source and manufacture false transients. The offset c is then taken as
 * median(b − k·a) over ALL pixels, i.e. from the background where a ≈ b.
 *
 * Falls back to offset-only (k = 1) when there are too few bright common pixels
 * or the reference has no spread — then only an additive change is removed.
 */
function robustLinearFit(
  a: ImageArray,
  b: ImageArray,
  brightSigma: number,
  minBright: number
): { k: number; c: number } {
  // Finite, paired samples.
  const aVals: number[] = [];
  const bVals: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (Number.isFinite(av) && Number.isFinite(bv)) {
      aVals.push(av);
      bVals.push(bv);
    }
  }
  if (aVals.length < 2) return { k: 1, c: 0 };

  const offsetOnly = (): { k: number; c: number } => {
    const diffs = aVals.map((av, i) => bVals[i]! - av);
    return { k: 1, c: median(diffs) };
  };

  const { median: medA, std: stdA } = medianAndMadStd(aVals);
  if (!(stdA > 0)) return offsetOnly(); // reference is flat → no scale to fit.

  // Select bright common pixels to fit the slope.
  const thresh = medA + brightSigma * stdA;
  let bx: number[] = [];
  let by: number[] = [];
  for (let i = 0; i < aVals.length; i++) {
    if (aVals[i]! > thresh) {
      bx.push(aVals[i]!);
      by.push(bVals[i]!);
    }
  }
  if (bx.length < minBright) return offsetOnly();

  // OLS on the bright subset, then one round of residual clipping to shed any
  // variable/mismatched source that slipped into the bright set.
  let fit = olsLine(bx, by);
  const resid = bx.map((x, i) => by[i]! - (fit.k * x + fit.c));
  const { median: medR, std: stdR } = medianAndMadStd(resid);
  if (stdR > 0) {
    const keepX: number[] = [];
    const keepY: number[] = [];
    for (let i = 0; i < bx.length; i++) {
      if (Math.abs(resid[i]! - medR) <= 3 * stdR) {
        keepX.push(bx[i]!);
        keepY.push(by[i]!);
      }
    }
    if (keepX.length >= minBright) {
      bx = keepX;
      by = keepY;
      fit = olsLine(bx, by);
    }
  }

  // Offset from the WHOLE frame (background-dominated), holding the fitted slope.
  const bMinusKA = aVals.map((av, i) => bVals[i]! - fit.k * av);
  const c = median(bMinusKA);
  return { k: fit.k, c };
}

/**
 * Difference two co-registered frames: diff = b − (k·a + c), after robustly
 * removing a global photometric offset/scale so a flat brightness change of the
 * whole frame does NOT survive as signal. `a` is the reference (earlier) epoch,
 * `b` the later epoch; a NEW/brightened source shows as a positive diff, a
 * vanished one as negative. Static sources cancel.
 *
 * @throws if the two arrays differ in length, or if width·height ≠ length.
 */
export function differenceImages(
  a: ImageArray,
  b: ImageArray,
  width: number,
  height: number,
  opts: DifferenceOptions = {}
): DifferenceResult {
  if (a.length !== b.length) {
    throw new Error(
      `differenceImages: frame length mismatch (a=${a.length}, b=${b.length})`
    );
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`differenceImages: invalid dimensions ${width}x${height}`);
  }
  if (width * height !== a.length) {
    throw new Error(
      `differenceImages: dimensions ${width}x${height}=${width * height} ` +
        `do not match frame length ${a.length}`
    );
  }

  const method = opts.method ?? 'linear';
  let k = 1;
  let c = 0;
  if (method === 'linear') {
    ({ k, c } = robustLinearFit(a, b, opts.brightSigma ?? 5, opts.minBright ?? 6));
  } else if (method === 'median') {
    const diffs: number[] = [];
    for (let i = 0; i < a.length; i++) {
      const av = a[i]!;
      const bv = b[i]!;
      if (Number.isFinite(av) && Number.isFinite(bv)) diffs.push(bv - av);
    }
    k = 1;
    c = diffs.length ? median(diffs) : 0;
  } // 'none' leaves k=1, c=0.

  const diff = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    // Propagate NaN where either frame is undefined; detection skips NaN.
    diff[i] = bv - (k * av + c);
  }

  return { diff, k, c };
}

/**
 * Detect transients/variables in a difference image as connected components of
 * pixels that deviate from the robust diff median by more than `nSigma` robust
 * std. Returns intensity-weighted centroids sorted by |significance|, bounded to
 * `maxDetections`.
 *
 * Default polarity is 'positive' (sources that appeared/brightened). A vanished
 * source is a NEGATIVE excursion and is only reported when `sign` is 'negative'
 * or 'both'; in the default mode it is NOT falsely reported as an appearance.
 *
 * Degenerate input (all-NaN, all-equal, or zero-spread diff → std 0 or NaN)
 * yields ZERO detections with no divide-by-zero.
 */
export function detectTransients(
  diff: ImageArray,
  width: number,
  height: number,
  opts: DetectOptions = {}
): Transient[] {
  if (width * height !== diff.length) {
    throw new Error(
      `detectTransients: dimensions ${width}x${height} do not match length ${diff.length}`
    );
  }
  const nSigma = opts.nSigma ?? 5;
  const maxDetections = opts.maxDetections ?? 100;
  const minArea = opts.minArea ?? 1;
  const sign = opts.sign ?? 'positive';
  const connectivity = opts.connectivity ?? 8;

  const stats = sigmaClipStats(diff);
  // No usable noise scale → nothing can be "significant"; bail without dividing.
  if (!Number.isFinite(stats.std) || stats.std <= 0) return [];

  const med = stats.median;
  const std = stats.std;

  const neighbors: [number, number][] =
    connectivity === 8
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      : [[0, -1], [-1, 0], [1, 0], [0, 1]];

  const detections: Transient[] = [];
  const polarities: (1 | -1)[] =
    sign === 'both' ? [1, -1] : sign === 'negative' ? [-1] : [1];

  for (const pol of polarities) {
    const threshold = med + pol * nSigma * std;
    const above = new Uint8Array(diff.length);
    for (let i = 0; i < diff.length; i++) {
      const v = diff[i]!;
      if (!Number.isFinite(v)) continue;
      above[i] = pol > 0 ? (v > threshold ? 1 : 0) : v < threshold ? 1 : 0;
    }

    const visited = new Uint8Array(diff.length);
    const stack: number[] = [];
    for (let start = 0; start < diff.length; start++) {
      if (above[start] === 0 || visited[start] === 1) continue;

      // Flood-fill one connected component.
      stack.length = 0;
      stack.push(start);
      visited[start] = 1;
      let area = 0;
      let sumW = 0;
      let sumWX = 0;
      let sumWY = 0;
      let flux = 0;
      let peakVal = diff[start]!;
      let peakDev = pol > 0 ? -Infinity : Infinity;

      while (stack.length) {
        const idx = stack.pop()!;
        const x = idx % width;
        const y = (idx - x) / width;
        const val = diff[idx]!;
        const dev = val - med;
        const w = Math.abs(dev);
        area += 1;
        sumW += w;
        sumWX += w * x;
        sumWY += w * y;
        flux += dev;
        if (pol > 0 ? dev > peakDev : dev < peakDev) {
          peakDev = dev;
          peakVal = val;
        }

        for (const [dx, dy] of neighbors) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (above[nIdx] === 1 && visited[nIdx] === 0) {
            visited[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }

      if (area < minArea) continue;
      // Intensity-weighted centroid; fall back to geometric if weights vanish.
      const cx = sumW > 0 ? sumWX / sumW : start % width;
      const cy = sumW > 0 ? sumWY / sumW : (start - (start % width)) / width;
      detections.push({
        x: cx,
        y: cy,
        peak: peakVal,
        flux,
        significance: (peakVal - med) / std,
        area,
      });
    }
  }

  detections.sort((p, q) => Math.abs(q.significance) - Math.abs(p.significance));
  return detections.slice(0, maxDetections);
}
