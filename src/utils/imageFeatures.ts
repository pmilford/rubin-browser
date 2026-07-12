/**
 * PURE, NaN-safe image morphology features for star/galaxy classification.
 *
 * This is the "measurement" half of the image-based object classifier (see
 * docs/research/object-type-classification-prd.md §3). It takes a small cutout of
 * honest, pre-colormap intensity (a Float32Array grid, with NaN cells marking
 * GAPS — off-tile / no-data — exactly like crossSection.ts) and returns a fixed
 * set of scalar features. Every feature is a pure function of the cutout; there is
 * NO DOM, NO colormap, and NO randomness.
 *
 * INDEPENDENCE (design-review blocker B2): this module shares NO centroid / PSF /
 * second-moment helper with syntheticMorphology.ts. It measures a source using
 * ONLY the pixels handed to it and the caller-supplied `psfFwhmArcsec`. The
 * closed-form tests pin HAND-computed published values (a Gaussian of known σ
 * measures FWHM = 2.3548·σ; Gini of a single-nonzero pixel ≈ 1, of a flat field
 * ≈ 0; concentration of a point < an n=1 disk < an n=4 bulge; asymmetry of a
 * one-sided source > 0) — never by round-tripping any renderer's parameters.
 *
 * PSF SELF-REFERENCE (blocker B3): the local PSF is NOT estimated from the target.
 * `fwhmRatio` is the measured source size divided by the EXTERNAL PSF size
 * (`psfFwhmArcsec / pixelScaleArcsec`) supplied by the caller. An isolated galaxy
 * with no companion stars therefore still reads fwhmRatio > 1.
 *
 * GAPS (blocker B8): gaps are NaN cells only. A faint source on a near-zero but
 * COVERED background is NOT a gap — `gapFraction` counts NaN cells and nothing
 * else. NaN cells are excluded from every statistic; they never poison a result.
 *
 * SATURATION (blocker B9): a clipped/plateau core (a ≥2×2 contiguous block sitting
 * at the cutout's maximum value, e.g. an 8-bit core pinned at 255/1.0) sets
 * `saturatedCore = true` so the classifier can refuse rather than call an inflated
 * size a galaxy.
 */

/** A small square-ish patch of honest, pre-colormap intensity around a target. */
export interface Cutout {
  /** Row-major intensity, length `width*height`. NaN marks a GAP (no data). */
  data: Float32Array;
  /** Grid width in pixels. */
  width: number;
  /** Grid height in pixels. */
  height: number;
  /** Sky sampling of one pixel, arcsec/px. */
  pixelScaleArcsec: number;
  /**
   * The EXTERNAL local PSF FWHM in arcsec (caller-supplied, e.g. a survey nominal
   * or a value measured from OTHER nearby stars) — NEVER estimated from this
   * cutout's own target. This is the reference `fwhmRatio` is measured against.
   */
  psfFwhmArcsec: number;
}

/** The scalar feature vector measured from a {@link Cutout}. All finite. */
export interface ImageFeatures {
  /** Peak background-subtracted signal over robust noise: max(I')/σ. */
  snr: number;
  /** Fraction of cells that are NaN (gaps). Counts NaN ONLY — never low light. */
  gapFraction: number;
  /** A ≥2×2 block pinned at the cutout max — a clipped/saturated core. */
  saturatedCore: boolean;
  /** Measured source FWHM (px) / external PSF FWHM (px). ≈1 point, >1 extended. */
  fwhmRatio: number;
  /** Concentration C = 5·log10(r80/r20) of the circular curve-of-growth. */
  concentration: number;
  /** SExtractor-style spread: >0 ⇒ light broader than the PSF ⇒ extended. */
  spreadModelProxy: number;
  /** Core peakiness: (peak/3×3-core-sum) normalised by the PSF's expected value. */
  peakSharpness: number;
  /** Rotational asymmetry A = Σ|I−I₁₈₀|/Σ|I| about the flux centroid. */
  asymmetry: number;
  /** Lotz Gini coefficient of the segmented flux (0 flat … 1 all in one pixel). */
  gini: number;
  /** Lotz M20 (log10). NEGATIVE by construction; more negative ⇒ single nucleus. */
  m20: number;
  /** Second-moment ellipticity e = 1 − b/a of the flux distribution (0 = round). */
  ellipticity: number;

  // ── Scale- & stretch-ROBUST features (retune TODO 138) ──────────────────────
  // These are the features the real-imagery classifier keys off. They are computed
  // against a ROBUST low-percentile sky (not the border ring, which lands INSIDE a
  // patch-filling galaxy and collapses its segmentation) and are expressed as
  // dimensionless ratios in PSF units, so they do NOT swing with zoom the way the
  // second-moment size / curve-of-growth C do on 8-bit asinh-stretched HiPS pixels.

  /**
   * Curve-of-growth concentration ratio: enclosed flux within 2·PSF-FWHM ÷ enclosed
   * flux within 6·PSF-FWHM, both apertures PSF-scaled (so patch-size independent) and
   * centred on the flux centroid, over the robust-sky-subtracted patch. A point
   * source packs its light into the inner aperture (ratio HIGH); a resolved galaxy
   * spreads it to larger radii (ratio LOW). Primary star/galaxy discriminant on real
   * stretched imagery — insensitive to the asinh-lifted faint wings that wreck the
   * threshold-mask second-moment FWHM. 1 for a delta, →(2/6 area) for a flat blob.
   */
  concentrationRatio: number;
  /**
   * Tight-core concentration: enclosed flux within 1·PSF-FWHM ÷ within 3·PSF-FWHM. The
   * discriminant for the WELL-SAMPLED regime (a big-beam offline cube or high-res
   * imagery where the PSF spans many pixels and sources are NOT undersampled). There a
   * point source sits entirely inside 1·PSF (ratio HIGH ≈0.7–0.8) while a resolved
   * galaxy leaks past it (ratio LOW ≈0.3). In the UNDERSAMPLED, asinh-stretched HiPS
   * regime this saturates (both classes ~0.1–0.2) so `concentrationRatio` is used
   * instead — see objectClassifier's regime split on localPsfPx.
   */
  coreConcentration: number;
  /**
   * Fraction of the robust-sky-subtracted patch flux contained within 1.5·PSF-FWHM of
   * the peak. High ⇒ compact (star); low ⇒ light spread across the patch (galaxy).
   */
  coreFluxFraction: number;
  /**
   * Fraction of the robust-sky-subtracted flux sitting on the 2-px outer border ring.
   * High ⇒ the source (or a saturated stellar halo) overruns the FOV — a degeneracy
   * flag: a true point source never fills the patch, so a high value means the
   * curve-of-growth is untrustworthy and the honest call is "extended, low confidence".
   */
  fillFraction: number;

  /**
   * Lag-1 spatial autocorrelation (Moran's I, rook adjacency) of the finite pixels
   * (retune TODO 147). This is the STRUCTURE / spatial-coherence discriminant that
   * separates a real light concentration from spatially-incoherent noise WITHOUT
   * relying on amplitude (which fails on 8-bit asinh-stretched pixels, where a diffuse
   * ~1.2σ galaxy and empty sky have the SAME peak-SNR). A real source — compact star OR
   * a patch-filling diffuse galaxy — is smooth, so neighbouring pixels co-vary and I is
   * HIGH (measured ≥0.65 on the real DSS/SIMBAD holdout). White sky noise has
   * independent pixels, so I ≈ 0. Scale-invariant (a correlation coefficient, so
   * multiplying the patch by any positive constant leaves it unchanged) and it needs NO
   * background/σ estimate, so — unlike peak-SNR — it is not fooled by a border ring that
   * lands inside a patch-filling galaxy. The classifier gates the UNDERSAMPLED/stretched
   * regime on this so empty sky honestly returns `unknown`. 0 for a constant/all-NaN
   * patch (no measurable structure).
   */
  spatialCoherence: number;
}

/** FWHM = 2·√(2·ln2)·σ ⇒ this constant times σ. Pinned by a closed-form test. */
const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.LN2); // 2.354820045...

/** Detection threshold above noise for the segmentation used by shape features. */
const SEG_K_SIGMA = 1.5;

/** Median of a numeric array (ascending copy). Empty ⇒ NaN. */
function median(vals: number[]): number {
  if (vals.length === 0) return NaN;
  const s = [...vals].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 1.4826·MAD — a robust σ estimate. Returns 0 for a constant sample. */
function robustSigma(vals: number[], center: number): number {
  if (vals.length === 0) return 0;
  const dev = vals.map((v) => Math.abs(v - center));
  return 1.4826 * median(dev);
}

/** Border-ring (outer `ring` px) finite values — the background estimator sample. */
function borderValues(c: Cutout, ring: number): number[] {
  const { data, width, height } = c;
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onRing = x < ring || y < ring || x >= width - ring || y >= height - ring;
      if (!onRing) continue;
      const v = data[y * width + x]!;
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

/** All finite values in the cutout (background + source), for a global fallback. */
function finiteValues(c: Cutout): number[] {
  const out: number[] = [];
  for (let i = 0; i < c.data.length; i++) {
    const v = c.data[i]!;
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Background `b` (median of the border ring) and noise `σ` (1.4826·MAD of the same
 * ring). If the border ring is entirely NaN, or degenerate (σ ≤ 0, e.g. a
 * perfectly flat noise-free test image), fall back to a GLOBAL robust estimate so
 * `snr` is never NaN/Inf (blocker: "don't emit NaN into snr"). The σ is floored to
 * a tiny positive value so a truly constant image yields a finite (large) snr
 * rather than a divide-by-zero.
 */
function estimateBackground(c: Cutout): { b: number; sigma: number } {
  const ring = c.width >= 8 && c.height >= 8 ? 2 : 1;
  const border = borderValues(c, ring);
  let b = median(border);
  let sigma = robustSigma(border, b);
  if (!Number.isFinite(b) || sigma <= 0) {
    const all = finiteValues(c);
    if (!Number.isFinite(b)) b = median(all);
    if (sigma <= 0) sigma = robustSigma(all, b);
  }
  if (!(sigma > 0)) {
    // Truly constant image: floor σ to a tiny fraction of the dynamic range.
    const all = finiteValues(c);
    const max = all.length ? Math.max(...all) : 1;
    sigma = Math.max(1e-12, Math.abs(max - b) * 1e-6, 1e-12);
  }
  return { b, sigma };
}

/** Bilinear sample of a Float64 grid; NaN if any needed corner is NaN/off-grid. */
function bilinear(grid: Float64Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height) return NaN;
  const dx = x - x0;
  const dy = y - y0;
  const v00 = grid[y0 * width + x0]!;
  const v10 = grid[y0 * width + x1]!;
  const v01 = grid[y1 * width + x0]!;
  const v11 = grid[y1 * width + x1]!;
  if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
    return NaN;
  }
  const top = v00 * (1 - dx) + v10 * dx;
  const bot = v01 * (1 - dx) + v11 * dx;
  return top * (1 - dy) + bot * dy;
}

/**
 * Detect a GENUINELY saturated (flat-topped) core: a connected plateau of at least
 * `SAT_MIN_PLATEAU` pixels all pinned at the finite max.
 *
 * A bare 2×2 test (retune TODO 138) over-fired catastrophically on real 8-bit
 * asinh-stretched HiPS pixels: quantising a smooth bright core rounds a handful of
 * neighbouring pixels to the same top value, manufacturing a fake "saturated" plateau
 * on essentially every source and gating the whole sky to "unknown". A real clipped
 * core (photographic/detector saturation) is a LARGE flat region; requiring a sizeable
 * connected max-plateau separates it from quantisation dabs (which are only a few px).
 */
const SAT_MIN_PLATEAU = 16;
function detectSaturatedCore(c: Cutout): boolean {
  const { data, width, height } = c;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (Number.isFinite(v) && v > max) max = v;
  }
  if (!Number.isFinite(max)) return false;
  // Largest 4-connected component of exactly-max pixels.
  const seen = new Uint8Array(width * height);
  for (let start = 0; start < data.length; start++) {
    if (seen[start] || data[start] !== max) continue;
    let count = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      count++;
      const px = idx % width;
      const py = (idx - px) / width;
      const nbrs = [
        px > 0 ? idx - 1 : -1,
        px < width - 1 ? idx + 1 : -1,
        py > 0 ? idx - width : -1,
        py < height - 1 ? idx + width : -1,
      ];
      for (const nIdx of nbrs) {
        if (nIdx >= 0 && !seen[nIdx] && data[nIdx] === max) {
          seen[nIdx] = 1;
          stack.push(nIdx);
        }
      }
    }
    if (count >= SAT_MIN_PLATEAU) return true;
  }
  return false;
}

/**
 * A CONNECTED-COMPONENT segmentation of the source, grown from the brightest
 * pixel over cells above `thr`. Using a connected footprint (SExtractor-style
 * detection) instead of a bare per-pixel threshold is essential: it excludes
 * ISOLATED noise pixels far from the source, whose r²-weighted contribution would
 * otherwise dominate (and wildly inflate) the second-moment size of a bright,
 * compact star. The `mask` is the source footprint every shape feature integrates
 * over.
 */
interface Segmentation {
  /** Background-subtracted values, NaN preserved (gaps). */
  resid: Float64Array;
  /** 1 where the pixel belongs to the connected source footprint. */
  mask: Uint8Array;
  /** Centroid (x,y) in pixel coordinates (flux-weighted over the mask). */
  cx: number;
  cy: number;
  /** Detection threshold used (in resid units). */
  thr: number;
  /** Sum of masked flux. */
  fluxSum: number;
}

function segment(c: Cutout, b: number, sigma: number): Segmentation {
  const { data, width, height } = c;
  const n = width * height;
  const resid = new Float64Array(n);
  let peakVal = -Infinity;
  let peakIdx = -1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    const r = Number.isFinite(v) ? v - b : NaN;
    resid[i] = r;
    if (Number.isFinite(r) && r > peakVal) {
      peakVal = r;
      peakIdx = i;
    }
  }
  const thr = Math.max(SEG_K_SIGMA * sigma, 0);
  const mask = new Uint8Array(n);

  if (peakIdx < 0 || peakVal <= thr) {
    // No pixel above threshold: mask just the brightest finite pixel so the shape
    // features still have a defined (if trivial) centre.
    const cx = peakIdx >= 0 ? peakIdx % width : (width - 1) / 2;
    const cy = peakIdx >= 0 ? Math.floor(peakIdx / width) : (height - 1) / 2;
    if (peakIdx >= 0) mask[peakIdx] = 1;
    return { resid, mask, cx, cy, thr, fluxSum: Math.max(0, peakVal) };
  }

  // 8-connected flood fill from the peak over cells above threshold.
  const stack: number[] = [peakIdx];
  mask[peakIdx] = 1;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  while (stack.length > 0) {
    const idx = stack.pop()!;
    const px = idx % width;
    const py = (idx - px) / width;
    const r = resid[idx]!;
    sw += r;
    sx += r * px;
    sy += r * py;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (mask[nIdx]) continue;
        const nr = resid[nIdx]!;
        if (Number.isFinite(nr) && nr > thr) {
          mask[nIdx] = 1;
          stack.push(nIdx);
        }
      }
    }
  }
  return { resid, mask, cx: sx / sw, cy: sy / sw, thr, fluxSum: sw };
}

/** Second-moment size + ellipticity of the segmented flux about its centroid. */
function secondMoments(seg: Segmentation, width: number, height: number): { fwhmPx: number; ellipticity: number } {
  const { resid, mask, cx, cy } = seg;
  let sw = 0;
  let qxx = 0;
  let qyy = 0;
  let qxy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const r = resid[idx]!;
      if (!Number.isFinite(r) || r <= 0) continue;
      const dx = x - cx;
      const dy = y - cy;
      sw += r;
      qxx += r * dx * dx;
      qyy += r * dy * dy;
      qxy += r * dx * dy;
    }
  }
  if (sw <= 0) return { fwhmPx: 0, ellipticity: 0 };
  qxx /= sw;
  qyy /= sw;
  qxy /= sw;
  // rms radius r_rms = √(Qxx+Qyy); for a 2D Gaussian Qxx=Qyy=σ² so r_rms=√2·σ and
  // FWHM = 2.3548·σ = 2.3548·(r_rms/√2). Pinned by the known-σ Gaussian test.
  const rrms = Math.sqrt(Math.max(0, qxx + qyy));
  const fwhmPx = FWHM_PER_SIGMA * (rrms / Math.SQRT2);
  const trace = qxx + qyy;
  const disc = Math.sqrt(Math.max(0, (qxx - qyy) * (qxx - qyy) + 4 * qxy * qxy));
  const lam1 = (trace + disc) / 2;
  const lam2 = (trace - disc) / 2;
  const ellipticity = lam1 > 0 ? 1 - Math.sqrt(Math.max(0, lam2) / lam1) : 0;
  return { fwhmPx, ellipticity };
}

/** Concentration C = 5·log10(r80/r20) from the circular curve-of-growth. */
function concentration(seg: Segmentation, width: number, height: number): number {
  const { resid, mask, cx, cy } = seg;
  const pts: { d: number; f: number }[] = [];
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const r = resid[idx]!;
      if (!Number.isFinite(r) || r <= 0) continue;
      const dx = x - cx;
      const dy = y - cy;
      pts.push({ d: Math.sqrt(dx * dx + dy * dy), f: r });
      total += r;
    }
  }
  if (total <= 0 || pts.length < 3) return 0;
  pts.sort((a, b) => a.d - b.d);
  const radiusAt = (frac: number): number => {
    const target = frac * total;
    let cum = 0;
    let prevD = 0;
    for (const p of pts) {
      const next = cum + p.f;
      if (next >= target) {
        // Linear interpolate the enclosing radius between the bracketing points.
        const span = next - cum;
        const t = span > 0 ? (target - cum) / span : 0;
        return prevD + (p.d - prevD) * t;
      }
      prevD = p.d;
      cum = next;
    }
    return pts[pts.length - 1]!.d;
  };
  const r20 = radiusAt(0.2);
  const r80 = radiusAt(0.8);
  if (r20 <= 0 || r80 <= 0) return 0;
  return 5 * Math.log10(r80 / r20);
}

/**
 * SExtractor-style spread relative to the PSF. With P a normalised PSF template
 * and G a slightly broader ("fuzzy", PSF⊛exp) template centred on the source:
 *   spread = (Σ I'·G)(Σ P·P) / [(Σ I'·P)(Σ P·G)] − 1
 * For a point source I' ∝ P this is exactly 0; for light broader than the PSF the
 * numerator ratio grows, so spread > 0 ⇒ extended.
 */
function spreadModel(seg: Segmentation, c: Cutout, sigmaPsfPx: number): number {
  const { resid, cx, cy } = seg;
  const { width, height } = c;
  const sp = Math.max(0.5, sigmaPsfPx);
  const sg = sp * 1.6; // fuzzier template (PSF convolved with a small exponential)
  let sIG = 0;
  let sIP = 0;
  let sPP = 0;
  let sPG = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = resid[y * width + x]!;
      if (!Number.isFinite(r)) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      const P = Math.exp(-0.5 * d2 / (sp * sp));
      const G = Math.exp(-0.5 * d2 / (sg * sg));
      sIG += r * G;
      sIP += r * P;
      sPP += P * P;
      sPG += P * G;
    }
  }
  if (sIP === 0 || sPG === 0) return 0;
  return (sIG * sPP) / (sIP * sPG) - 1;
}

/** peak/3×3-core-sum normalised by the PSF's expected central fraction. */
function peakSharpness(seg: Segmentation, c: Cutout, sigmaPsfPx: number): number {
  const { resid, cx, cy } = seg;
  const { width, height } = c;
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  let core = 0;
  let peak = -Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = ix + dx;
      const y = iy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const r = resid[y * width + x]!;
      if (!Number.isFinite(r)) continue;
      const rr = Math.max(0, r);
      core += rr;
      if (rr > peak) peak = rr;
    }
  }
  if (core <= 0 || !Number.isFinite(peak)) return 0;
  const measured = peak / core;
  // Expected peak/3×3 fraction for a Gaussian PSF sampled at pixel centres.
  const sp = Math.max(0.5, sigmaPsfPx);
  let ecore = 0;
  let epeak = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const w = Math.exp(-0.5 * (dx * dx + dy * dy) / (sp * sp));
      ecore += w;
      if (w > epeak) epeak = w;
    }
  }
  const expected = epeak / ecore;
  return expected > 0 ? measured / expected : 0;
}

/** Rotational asymmetry A = Σ|I−I₁₈₀|/Σ|I| about the flux centroid (bilinear). */
function asymmetry(seg: Segmentation, c: Cutout): number {
  const { resid, mask, cx, cy } = seg;
  const { width, height } = c;
  let num = 0;
  let den = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const r = resid[idx]!;
      if (!Number.isFinite(r)) continue;
      const rx = 2 * cx - x;
      const ry = 2 * cy - y;
      const rot = bilinear(resid, width, height, rx, ry);
      if (!Number.isFinite(rot)) continue;
      num += Math.abs(r - rot);
      den += Math.abs(r);
    }
  }
  return den > 0 ? num / den : 0;
}

/** Lotz Gini over the segmented |flux| values: 0 (flat) … 1 (all in one pixel). */
function gini(seg: Segmentation, width: number, height: number): number {
  const { resid, mask } = seg;
  const xs: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const r = resid[idx]!;
      if (Number.isFinite(r)) xs.push(Math.abs(r));
    }
  }
  const n = xs.length;
  if (n < 2) return n === 1 ? 1 : 0;
  xs.sort((a, b) => a - b);
  let mean = 0;
  for (const v of xs) mean += v;
  mean /= n;
  if (mean <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += (2 * (i + 1) - n - 1) * xs[i]!;
  }
  return acc / (mean * n * (n - 1));
}

/**
 * Lotz M20 = log10(Σ_i M_i / M_tot) over the brightest pixels holding 20% of the
 * total flux, with M_i = f_i·((x−x_c)²+(y−y_c)²). NEGATIVE by construction (the
 * bright-20% subset carries a small share of the total spatial second moment); a
 * single concentrated nucleus is more negative than scattered bright clumps.
 */
function m20(seg: Segmentation, width: number, height: number): number {
  const { resid, mask, cx, cy } = seg;
  const pix: { f: number; m: number }[] = [];
  let ftot = 0;
  let mtot = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const r = resid[idx]!;
      if (!Number.isFinite(r) || r <= 0) continue;
      const dx = x - cx;
      const dy = y - cy;
      const m = r * (dx * dx + dy * dy);
      pix.push({ f: r, m });
      ftot += r;
      mtot += m;
    }
  }
  if (ftot <= 0 || mtot <= 0 || pix.length < 2) return 0;
  pix.sort((a, b) => b.f - a.f); // brightest first
  const target = 0.2 * ftot;
  let cumF = 0;
  let m20sum = 0;
  for (const p of pix) {
    m20sum += p.m;
    cumF += p.f;
    if (cumF >= target) break;
  }
  const ratio = m20sum / mtot;
  return ratio > 0 ? Math.log10(ratio) : 0;
}

/** A percentile (q∈[0,1]) of an ASCENDING-sorted array; empty ⇒ NaN. */
function percentileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * Scale- and stretch-ROBUST concentration / fill features (retune TODO 138).
 *
 * Uses a ROBUST low-percentile sky rather than the border ring: on a big diffuse
 * galaxy the border ring lands INSIDE the galaxy, inflating the background and
 * collapsing the source to a single core pixel (fwhmRatio→0, gini→1) — which is
 * exactly what made the classifier flip a 12-mag galaxy to "star" at some zooms.
 *
 * All apertures are PSF-scaled (patch-size independent) and the concentration is a
 * RATIO of two such apertures, so the value does not swing with zoom the way an
 * absolute second-moment size does on 8-bit asinh-stretched pixels.
 */
function concentrationFeatures(
  c: Cutout,
  psfFwhmPx: number,
): { concentrationRatio: number; coreConcentration: number; coreFluxFraction: number; fillFraction: number } {
  const { data, width, height } = c;
  const finite: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return { concentrationRatio: 0, coreConcentration: 0, coreFluxFraction: 0, fillFraction: 0 };
  finite.sort((a, b) => a - b);
  const sky = percentileSorted(finite, 0.2);

  // Peak (robust-sky-subtracted) and its location.
  let peak = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (Number.isFinite(v)) {
      const r = v - sky;
      if (r > peak) peak = r;
    }
  }
  if (!(peak > 0)) return { concentrationRatio: 0, coreConcentration: 0, coreFluxFraction: 0, fillFraction: 0 };

  // Flux-weighted centroid over the bright core (r > 0.1·peak), so faint asymmetric
  // wing noise cannot drag the centre off the source.
  let sw = 0;
  let scx = 0;
  let scy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x]!;
      if (!Number.isFinite(v)) continue;
      const r = v - sky;
      if (r > 0.1 * peak) {
        sw += r;
        scx += r * x;
        scy += r * y;
      }
    }
  }
  if (!(sw > 0)) return { concentrationRatio: 0, coreConcentration: 0, coreFluxFraction: 0, fillFraction: 0 };
  const cx = scx / sw;
  const cy = scy / sw;

  const rInner = 1.5 * psfFwhmPx; // core aperture for coreFluxFraction
  const rC1 = 1 * psfFwhmPx; // tight core aperture (coreConcentration numerator)
  const rC2 = 2 * psfFwhmPx; // concentrationRatio numerator aperture
  const rC3 = 3 * psfFwhmPx; // coreConcentration denominator aperture
  const rC6 = 6 * psfFwhmPx; // concentrationRatio denominator aperture
  let encInner = 0;
  let encC1 = 0;
  let encC2 = 0;
  let encC3 = 0;
  let encC6 = 0;
  let total = 0;
  let border = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x]!;
      if (!Number.isFinite(v)) continue;
      const r = v - sky;
      if (r <= 0) continue;
      total += r;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rInner) encInner += r;
      if (d <= rC1) encC1 += r;
      if (d <= rC2) encC2 += r;
      if (d <= rC3) encC3 += r;
      if (d <= rC6) encC6 += r;
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) border += r;
    }
  }
  const concentrationRatio = encC6 > 0 ? encC2 / encC6 : 0;
  const coreConcentration = encC3 > 0 ? encC1 / encC3 : 0;
  const coreFluxFraction = total > 0 ? encInner / total : 0;
  const fillFraction = total > 0 ? border / total : 0;
  return { concentrationRatio, coreConcentration, coreFluxFraction, fillFraction };
}

/**
 * Lag-1 spatial autocorrelation (Moran's I, rook/4-neighbour adjacency) over the
 * FINITE pixels of the patch — the structure/coherence discriminant (retune TODO 147).
 *
 *   I = (N / S0) · (Σ_ij w_ij·(v_i−μ)(v_j−μ)) / (Σ_i (v_i−μ)²)
 *
 * with w_ij = 1 for horizontally/vertically adjacent finite cells (symmetric). A
 * smooth light distribution (any real source — a compact PSF core or a diffuse galaxy)
 * makes adjacent pixels co-vary ⇒ I → 1; spatially-independent sky noise ⇒ I ≈ 0.
 *
 * Deliberately AMPLITUDE-FREE: subtracting the (finite-pixel) mean cancels any additive
 * sky pedestal, and the ratio form cancels any positive multiplicative rescale — so it
 * neither needs a σ estimate nor is fooled by the border-ring contamination that
 * collapses peak-SNR on a patch-filling galaxy. NaN cells (gaps) are excluded from both
 * the mean and every adjacency term. A constant patch (den = 0) or one with < 2 finite
 * cells returns 0 (no measurable structure).
 */
function spatialCoherence(c: Cutout): number {
  const { data, width, height } = c;
  let n = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  if (n < 2) return 0;
  const mean = sum / n;
  let num = 0; // Σ over UNORDERED adjacent finite pairs of (v_i−μ)(v_j−μ)
  let pairs = 0; // count of those unordered pairs
  let den = 0; // Σ (v_i−μ)²
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const vi = data[idx]!;
      if (!Number.isFinite(vi)) continue;
      const di = vi - mean;
      den += di * di;
      if (x + 1 < width) {
        const vr = data[idx + 1]!;
        if (Number.isFinite(vr)) {
          num += di * (vr - mean);
          pairs++;
        }
      }
      if (y + 1 < height) {
        const vd = data[idx + width]!;
        if (Number.isFinite(vd)) {
          num += di * (vd - mean);
          pairs++;
        }
      }
    }
  }
  if (den <= 0 || pairs === 0) return 0;
  // Symmetric weights: S0 = 2·pairs and the weighted double sum = 2·num, so the
  // factors of 2 cancel and I = (N / pairs) · (num / den).
  return (n / pairs) * (num / den);
}

/**
 * Compute the full feature vector for a cutout. PURE and NaN-safe: NaN cells are
 * gaps (excluded from every statistic, counted only by `gapFraction`); no feature
 * emits NaN/Inf. See the module header for the design-review blockers each rule
 * satisfies (B2 independence, B3 external PSF, B8 gaps, B9 saturation).
 */
export function computeFeatures(c: Cutout): ImageFeatures {
  const { width, height, pixelScaleArcsec, psfFwhmArcsec } = c;
  const total = width * height;

  // Gaps: NaN cells ONLY (blocker B8) — never low luminance.
  let nan = 0;
  for (let i = 0; i < c.data.length; i++) {
    if (Number.isNaN(c.data[i]!)) nan++;
  }
  const gapFraction = total > 0 ? nan / total : 1;

  const { b, sigma } = estimateBackground(c);
  const saturatedCore = detectSaturatedCore(c);

  // Peak signal / noise.
  let maxResid = -Infinity;
  for (let i = 0; i < c.data.length; i++) {
    const v = c.data[i]!;
    if (Number.isFinite(v)) {
      const r = v - b;
      if (r > maxResid) maxResid = r;
    }
  }
  const snr = Number.isFinite(maxResid) ? maxResid / sigma : 0;

  const seg = segment(c, b, sigma);
  const psfFwhmPx = psfFwhmArcsec / pixelScaleArcsec;
  const sigmaPsfPx = psfFwhmPx / FWHM_PER_SIGMA;

  const { fwhmPx, ellipticity } = secondMoments(seg, width, height);
  const fwhmRatio = psfFwhmPx > 0 ? fwhmPx / psfFwhmPx : 0;
  const conc = concentration(seg, width, height);
  const spread = spreadModel(seg, c, sigmaPsfPx);
  const sharp = peakSharpness(seg, c, sigmaPsfPx);
  const asym = asymmetry(seg, c);
  const g = gini(seg, width, height);
  const mm = m20(seg, width, height);
  const { concentrationRatio, coreConcentration, coreFluxFraction, fillFraction } = concentrationFeatures(c, psfFwhmPx);
  const coherence = spatialCoherence(c);

  return {
    snr,
    gapFraction,
    saturatedCore,
    fwhmRatio,
    concentration: conc,
    spreadModelProxy: spread,
    peakSharpness: sharp,
    asymmetry: asym,
    gini: g,
    m20: mm,
    ellipticity,
    concentrationRatio,
    coreConcentration,
    coreFluxFraction,
    fillFraction,
    spatialCoherence: coherence,
  };
}
