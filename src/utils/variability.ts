/**
 * Multi-epoch VARIABILITY analysis — "which locations change over time, at what scale".
 *
 * Where `imageDiff.ts` answers a PAIRWISE question (what changed between epoch A
 * and epoch B), this module analyses the WHOLE epoch STACK at once: given N
 * co-registered single-band frames of the same sky region, it measures per-pixel
 * (and multi-scale spatial-bin) TEMPORAL variability and flags the locations whose
 * intensity varies against the static background — the substrate for
 * supernova-rate-by-epoch / transient discovery. It is validated against the
 * KNOWN synthetic ground truth (syntheticSky.ts / offlineDataset.ts): a stack
 * built from the offline cube has known variable (transient/sinusoid/supernova)
 * and known constant locations, so a broken analyser — one that returns the
 * temporal MEAN (flagging bright *constant* sources), a constant, random, or
 * transposed map — FAILS the tests.
 *
 * PURE: no DOM, no fetch, no Date, no Math.random — same discipline as imageDiff.ts.
 * Inputs are Float64Array frames + width/height (the linear-intensity rasters a
 * tile/cutout carries), NOT pre-stretched 8-bit RGBA.
 *
 * ── Why the DEFAULT per-pixel metric is temporal STANDARD DEVIATION, not MAD ──
 * The offline noise model adds ADDITIVE, zero-mean, FIXED-sigma Gaussian noise
 * INDEPENDENT of pixel flux (homoscedastic; see renderSyntheticIntensityFrame).
 * Therefore a bright CONSTANT source has temporal spread ≈ noiseSigma — the SAME
 * as blank background, regardless of how bright it is — so std does NOT flag it.
 * A transient that is bright in only 1–2 of ~12 epochs is an OUTLIER in its own
 * time series: a robust MAD spread would IGNORE it (a single spike among 12 does
 * not move the median-of-abs-deviations) and the transient would be missed. std
 * is sensitive to exactly that spike, so it surfaces transients while leaving
 * constant sources at the noise floor. (This separation relies on the noise being
 * flux-independent; under a Poisson/√counts model a bright constant source would
 * show elevated temporal std and this default would need revisiting.)
 *
 * Detection then thresholds the variability MAP against its own SPATIAL robust
 * background (median + nSigma·MAD-std), the same robust philosophy imageDiff uses
 * on a difference image — a single hot pixel or a real source does not inflate the
 * background estimate and hide the detection.
 *
 * NaN/gap pixels are EXCLUDED from every statistic (never treated as 0). Fully
 * deterministic.
 */

/** A frame is a linear-intensity raster; a stack is one per epoch, all co-registered. */
export type ImageArray = Float64Array | Float32Array;

/** Scale a MAD → an estimate of the Gaussian standard deviation (matches imageDiff). */
const MAD_TO_STD = 1.4826;

/**
 * Per-location temporal statistics over its epoch series.
 * All spread measures are 0 for a constant series and NaN for an empty one.
 */
export interface VariabilityStats {
  /** Arithmetic mean of the finite epochs. NaN if none finite. */
  mean: number;
  /**
   * Root-mean-square deviation from the mean = POPULATION standard deviation
   * (NOT √mean(x²)). 0 for a constant series, ≈ noiseSigma for constant+noise,
   * ≈ A/√2 for a well-sampled sinusoid of amplitude A. NaN if none finite.
   */
  rms: number;
  /**
   * RAW median absolute deviation: median(|x − median(x)|) — the unscaled robust
   * spread (multiply by 1.4826 for a Gaussian-σ estimate). 0 for a constant series.
   */
  mad: number;
  /**
   * Reduced chi-square variability index, present ONLY when per-epoch errors are
   * supplied. χ²_red = Σ((xᵢ − μ)²/σᵢ²)/(N−1) with the inverse-variance-weighted
   * mean μ. ≈ 0 for a noise-FREE constant, ≈ 1 for a constant consistent with its
   * errors, ≫ 1 for a genuine variable. NaN when fewer than 2 usable points.
   */
  chi2Reduced?: number;
  /** Half the peak-to-peak range, (max − min)/2. Equals A for a sinusoid sampled to its extrema. */
  amplitude: number;
  /** Index (into the ORIGINAL series) of the brightest finite epoch. −1 if none finite. */
  peakIndex: number;
}

/** Which per-pixel temporal statistic {@link variabilityMap} writes. */
export type VariabilityMetric =
  /** Population temporal standard deviation. DEFAULT — see module header on why not MAD. */
  | 'std'
  /** MAD-based robust std: 1.4826·median(|x−median|). Robust, but suppresses lone spikes. */
  | 'mad'
  /** Peak-to-peak range, max − min. */
  | 'range'
  /** Half peak-to-peak, (max − min)/2. */
  | 'amplitude'
  /** Reduced chi-square vs an ASSUMED per-epoch error (`noise`); needs `noise > 0`. */
  | 'chi2';

/** Options for {@link variabilityMap} / {@link multiScaleVariability}. */
export interface VariabilityMapOptions {
  /** Per-pixel metric. Default 'std'. */
  metric?: VariabilityMetric;
  /** Assumed per-epoch 1-σ error, REQUIRED for metric 'chi2'. */
  noise?: number;
}

/** One spatial scale's variability map (from {@link multiScaleVariability}). */
export interface ScaleVariability {
  /** Bin factor: this map was computed after box-averaging `scale`×`scale` blocks. */
  scale: number;
  /** Binned-map width (= ceil(width/scale)). */
  width: number;
  /** Binned-map height (= ceil(height/scale)). */
  height: number;
  /** The variability map at this scale. Map coord (cx,cy) ↔ fine center (cx·scale+(scale−1)/2, …). */
  map: Float64Array;
}

/** One detected variable location (from {@link detectVariableSources}). */
export interface VariableSource {
  /** Column of the peak map pixel (integer). */
  x: number;
  /** Row of the peak map pixel (integer). */
  y: number;
  /** The variability-map value at the peak (the metric value that fired). */
  index: number;
  /** (peak − spatial-median) / spatial-MAD-std of the map — how far above background. */
  significance: number;
}

/** Options for {@link detectVariableSources}. */
export interface DetectVariableOptions {
  /** Detection threshold in robust sigma above the map's spatial median. Default 5. */
  nSigma?: number;
  /** Minimum Euclidean pixel separation between two reported detections. Default 3. */
  minSeparation?: number;
  /** Max detections returned (highest significance first). Default 100. */
  maxDetections?: number;
  /** Pixel connectivity for connected components: 4 or 8 (default 8). */
  connectivity?: 4 | 8;
}

// ─────────────────────────── small numeric helpers ───────────────────────────

/** Median of a number array (does not mutate the input). NaN for empty. */
function median(values: number[]): number {
  const n = values.length;
  if (n === 0) return NaN;
  const s = values.slice().sort((p, q) => p - q);
  const mid = n >> 1;
  return n % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Raw MAD (median|x−median|) and MAD-based std (1.4826·MAD) of finite values. */
function madStats(values: number[]): { median: number; mad: number; madStd: number } {
  if (values.length === 0) return { median: NaN, mad: NaN, madStd: NaN };
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  return { median: med, mad, madStd: MAD_TO_STD * mad };
}

/** Mean and POPULATION standard deviation of finite values. std is 0 for length 1. */
function meanAndStd(values: number[]): { mean: number; std: number } {
  const n = values.length;
  if (n === 0) return { mean: NaN, std: NaN };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let ss = 0;
  for (const v of values) {
    const d = v - mean;
    ss += d * d;
  }
  return { mean, std: Math.sqrt(ss / n) };
}

/**
 * Reduced chi-square of a series vs per-point errors, using the inverse-variance
 * weighted mean. Points with a non-finite or non-positive error are dropped.
 * Returns NaN when fewer than 2 usable points (dof ≤ 0).
 */
function reducedChiSquare(values: number[], errors: number[]): number {
  let sw = 0;
  let swx = 0;
  const used: { x: number; s2: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = values[i]!;
    const sig = errors[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(sig) || sig <= 0) continue;
    const w = 1 / (sig * sig);
    sw += w;
    swx += w * x;
    used.push({ x, s2: sig * sig });
  }
  if (used.length < 2 || sw <= 0) return NaN;
  const mu = swx / sw;
  let chi2 = 0;
  for (const u of used) chi2 += ((u.x - mu) * (u.x - mu)) / u.s2;
  return chi2 / (used.length - 1);
}

// ─────────────────────────── public API ───────────────────────────

/**
 * Per-location temporal statistics over an epoch series. NaN epochs are excluded
 * from every statistic (a gap, never treated as 0). `opts.errors` may be a scalar
 * (same assumed 1-σ for every epoch) or a per-epoch array; supplying it enables
 * the reduced-chi-square variability index.
 *
 * @param series intensity vs epoch at one location.
 */
export function variabilityStats(
  series: ImageArray | number[],
  opts: { errors?: number | number[] } = {}
): VariabilityStats {
  // Collect finite (value, original-index) pairs.
  const vals: number[] = [];
  const idxs: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i]!;
    if (Number.isFinite(v)) {
      vals.push(v);
      idxs.push(i);
    }
  }

  const haveErrors = opts.errors !== undefined;
  if (vals.length === 0) {
    return {
      mean: NaN, rms: NaN, mad: NaN, amplitude: NaN, peakIndex: -1,
      ...(haveErrors ? { chi2Reduced: NaN } : {}),
    };
  }

  const { mean, std } = meanAndStd(vals);
  const { mad } = madStats(vals);

  let min = vals[0]!;
  let max = vals[0]!;
  let peakLocal = 0;
  for (let i = 1; i < vals.length; i++) {
    const v = vals[i]!;
    if (v < min) min = v;
    if (v > max) {
      max = v;
      peakLocal = i;
    }
  }
  const amplitude = (max - min) / 2;
  const peakIndex = idxs[peakLocal]!;

  let chi2Reduced: number | undefined;
  if (haveErrors) {
    const errs = opts.errors!;
    // Errors aligned to the FINITE values, in the same order.
    const errAligned = Array.isArray(errs)
      ? idxs.map((i) => errs[i] ?? NaN)
      : idxs.map(() => errs as number);
    chi2Reduced = reducedChiSquare(vals, errAligned);
  }

  return { mean, rms: std, mad, amplitude, peakIndex, ...(haveErrors ? { chi2Reduced } : {}) };
}

/** Validate that `frames` is a non-empty stack of `width·height` rasters. */
function assertStack(frames: ImageArray[], width: number, height: number): void {
  if (frames.length === 0) throw new Error('variability: empty frame stack');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`variability: invalid dimensions ${width}x${height}`);
  }
  const expected = width * height;
  for (let e = 0; e < frames.length; e++) {
    if (frames[e]!.length !== expected) {
      throw new Error(
        `variability: frame ${e} length ${frames[e]!.length} ≠ ${width}x${height}=${expected}`
      );
    }
  }
}

/**
 * Per-pixel variability index across a stack of co-registered epoch frames. For
 * each pixel the finite values across epochs form its time series and the chosen
 * `metric` (default temporal standard deviation) is written to the output raster.
 * A pixel with fewer than 2 finite epochs is NaN (variability undefined).
 *
 * See the module header for why 'std' is the default (surfaces transients, ignores
 * bright CONSTANT sources) rather than a robust MAD spread.
 *
 * @throws if the stack is empty, dimensions are invalid, a frame length mismatches,
 *   or metric 'chi2' is requested without a positive `noise`.
 */
export function variabilityMap(
  frames: ImageArray[],
  width: number,
  height: number,
  opts: VariabilityMapOptions = {}
): Float64Array {
  assertStack(frames, width, height);
  const metric = opts.metric ?? 'std';
  const noise = opts.noise;
  if (metric === 'chi2' && !(typeof noise === 'number' && noise > 0)) {
    throw new Error("variability: metric 'chi2' requires a positive `noise` (assumed per-epoch error)");
  }

  const nPix = width * height;
  const nEpoch = frames.length;
  const out = new Float64Array(nPix);
  const series: number[] = [];

  for (let p = 0; p < nPix; p++) {
    series.length = 0;
    for (let e = 0; e < nEpoch; e++) {
      const v = frames[e]![p]!;
      if (Number.isFinite(v)) series.push(v);
    }
    if (series.length < 2) {
      out[p] = NaN;
      continue;
    }
    switch (metric) {
      case 'std':
        out[p] = meanAndStd(series).std;
        break;
      case 'mad':
        out[p] = madStats(series).madStd;
        break;
      case 'range':
      case 'amplitude': {
        let mn = series[0]!;
        let mx = series[0]!;
        for (let i = 1; i < series.length; i++) {
          const v = series[i]!;
          if (v < mn) mn = v;
          else if (v > mx) mx = v;
        }
        out[p] = metric === 'range' ? mx - mn : (mx - mn) / 2;
        break;
      }
      case 'chi2':
        out[p] = reducedChiSquare(series, series.map(() => noise!));
        break;
    }
  }
  return out;
}

/**
 * Box-average one frame down by an integer `scale` (s×s blocks). Output size is
 * ceil(w/s) × ceil(h/s); edge blocks average whatever pixels fall in them. NaN
 * pixels are excluded from a block's mean; a block with no finite pixels is NaN.
 * This is a plain integer box downsample — NO sub-pixel resampling (out of scope).
 */
function boxDownsample(
  frame: ImageArray,
  width: number,
  height: number,
  scale: number,
  outW: number,
  outH: number
): Float64Array {
  const out = new Float64Array(outW * outH);
  for (let by = 0; by < outH; by++) {
    for (let bx = 0; bx < outW; bx++) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < scale; dy++) {
        const y = by * scale + dy;
        if (y >= height) break;
        for (let dx = 0; dx < scale; dx++) {
          const x = bx * scale + dx;
          if (x >= width) break;
          const v = frame[y * width + x]!;
          if (Number.isFinite(v)) {
            sum += v;
            n++;
          }
        }
      }
      out[by * outW + bx] = n > 0 ? sum / n : NaN;
    }
  }
  return out;
}

/**
 * Multi-SCALE variability: at each spatial `scale` the stack is box-averaged into
 * scale×scale bins and a {@link variabilityMap} is computed on the binned stack.
 *
 * This makes BOTH point-source and extended/large-scale variability surface. A
 * point source's variability is concentrated in one pixel — strongest at the
 * finest scale, diluted as coarser bins average it against static neighbours. A
 * broad, low-amplitude COHERENT variation can sit BELOW the per-pixel noise at the
 * finest scale yet survive binning (independent noise averages down as σ/scale
 * while the coherent signal persists), becoming detectable at a coarser scale.
 *
 * Coordinate mapping: a coarse-map pixel (cx,cy) corresponds to fine-image center
 * (cx·scale + (scale−1)/2, cy·scale + (scale−1)/2).
 *
 * @param scales bin factors (positive integers); scale 1 is the native resolution.
 * @throws if `scales` is empty or any scale is not a positive integer (plus the
 *   {@link variabilityMap} validation).
 */
export function multiScaleVariability(
  frames: ImageArray[],
  width: number,
  height: number,
  scales: number[],
  opts: VariabilityMapOptions = {}
): ScaleVariability[] {
  assertStack(frames, width, height);
  if (scales.length === 0) throw new Error('variability: no scales given');
  for (const s of scales) {
    if (!Number.isInteger(s) || s < 1) {
      throw new Error(`variability: scale must be a positive integer, got ${s}`);
    }
  }

  return scales.map((scale) => {
    if (scale === 1) {
      return { scale, width, height, map: variabilityMap(frames, width, height, opts) };
    }
    const outW = Math.ceil(width / scale);
    const outH = Math.ceil(height / scale);
    const binned = frames.map((f) => boxDownsample(f, width, height, scale, outW, outH));
    return { scale, width: outW, height: outH, map: variabilityMap(binned, outW, outH, opts) };
  });
}

/**
 * Detect variable locations as peaks on a variability map. The map's own SPATIAL
 * robust background (median + `nSigma`·MAD-std) sets the threshold; connected
 * components above it are found, and each component's peak pixel is reported.
 * Detections are sorted by significance and greedily de-duplicated so no two lie
 * within `minSeparation` pixels (the stronger wins).
 *
 * Because the map is built with metric 'std' (default), a bright CONSTANT source
 * sits at the noise floor and is NOT reported — only genuinely varying locations
 * cross the threshold. NaN map pixels are never above threshold. A degenerate map
 * (all-NaN or zero spatial spread → MAD-std 0/NaN) yields ZERO detections with no
 * divide-by-zero.
 *
 * @param map a variability map (e.g. from {@link variabilityMap}).
 * @throws if width·height ≠ map.length.
 */
export function detectVariableSources(
  map: ImageArray,
  width: number,
  height: number,
  opts: DetectVariableOptions = {}
): VariableSource[] {
  if (width * height !== map.length) {
    throw new Error(
      `detectVariableSources: dimensions ${width}x${height} do not match length ${map.length}`
    );
  }
  const nSigma = opts.nSigma ?? 5;
  const minSeparation = opts.minSeparation ?? 3;
  const maxDetections = opts.maxDetections ?? 100;
  const connectivity = opts.connectivity ?? 8;

  // Spatial robust background from the finite map values.
  const finite: number[] = [];
  for (let i = 0; i < map.length; i++) {
    const v = map[i]!;
    if (Number.isFinite(v)) finite.push(v);
  }
  const { median: med, madStd: std } = madStats(finite);
  if (!Number.isFinite(std) || std <= 0) return [];

  const threshold = med + nSigma * std;
  const above = new Uint8Array(map.length);
  for (let i = 0; i < map.length; i++) {
    const v = map[i]!;
    above[i] = Number.isFinite(v) && v > threshold ? 1 : 0;
  }

  const neighbors: [number, number][] =
    connectivity === 8
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      : [[0, -1], [-1, 0], [1, 0], [0, 1]];

  const visited = new Uint8Array(map.length);
  const stack: number[] = [];
  const candidates: VariableSource[] = [];

  for (let start = 0; start < map.length; start++) {
    if (above[start] === 0 || visited[start] === 1) continue;

    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let peakVal = map[start]!;
    let peakIdx = start;

    while (stack.length) {
      const idx = stack.pop()!;
      if (map[idx]! > peakVal) {
        peakVal = map[idx]!;
        peakIdx = idx;
      }
      const x = idx % width;
      const y = (idx - x) / width;
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

    candidates.push({
      x: peakIdx % width,
      y: (peakIdx - (peakIdx % width)) / width,
      index: peakVal,
      significance: (peakVal - med) / std,
    });
  }

  // Strongest first, then greedily drop any within minSeparation of an accepted one.
  candidates.sort((p, q) => q.significance - p.significance);
  const accepted: VariableSource[] = [];
  const minSep2 = minSeparation * minSeparation;
  for (const cand of candidates) {
    let tooClose = false;
    for (const a of accepted) {
      const dx = cand.x - a.x;
      const dy = cand.y - a.y;
      if (dx * dx + dy * dy < minSep2) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) accepted.push(cand);
    if (accepted.length >= maxDetections) break;
  }
  return accepted;
}
