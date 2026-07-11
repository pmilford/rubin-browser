/**
 * Deterministic synthetic multi-epoch / multi-band / multi-tile sky generator.
 *
 * This is a *ground-truth substrate*: given a seed, it produces a fixed catalog
 * of sources with KNOWN positions, magnitudes, and light curves, plus a pure
 * rasterizer that paints those sources into HiPS tiles. Because every source's
 * true position/brightness is exposed, tests can assert renders against a
 * closed-form reference instead of self-consistency — the exact failure mode the
 * project's CLAUDE.md warns about (tests that check "the label changed" rather
 * than an outcome). It also backs an OFFLINE in-app render mode that needs no
 * network and no auth.
 *
 * Hard invariants:
 *  - Pure + deterministic. The ONLY entropy source is the seed, threaded through
 *    a mulberry32 PRNG (copied from src/data/alerts.ts). No Math.random / Date.
 *  - Coordinates are degrees at the boundary: RA in [0,360), Dec in [-90,90].
 *  - Bands are Rubin g,r,i,z,y.
 *
 * Tile geometry is EXACT, not approximated: each tile pixel's sky position comes
 * from `pixcoord2vec_nest` — the same authoritative HEALPix primitive the live
 * renderer (`ImageViewer.svelte` drawTile via `tileImageCornerVectors`) uses to
 * texture-map tiles. The in-tile fractional mapping is pinned to match that
 * renderer: image column (left→right) → `nw` in [0,1], image row (top→bottom) →
 * `ne` in [0,1] (see TILE_RASTER_CORNERS in src/utils/projection.ts). A source
 * therefore lands in the offline raster at the same pixel the real HiPS tile
 * would place it, to sub-pixel accuracy.
 */

import { order2nside, pixcoord2vec_nest, max_pixrad, type V3 } from '@hscmap/healpix';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const ARCSEC_PER_RAD = RAD2DEG * 3600;

export type Band = 'g' | 'r' | 'i' | 'z' | 'y';

/** Canonical Rubin band order; index doubles as the noise-hash band key. */
export const BANDS: readonly Band[] = ['g', 'r', 'i', 'z', 'y'];

function bandIndex(band: Band): number {
  const i = BANDS.indexOf(band);
  return i < 0 ? 0 : i;
}

/**
 * Closed-form light-curve models. All are pure functions of epoch (MJD); see
 * {@link magAt} for the exact formulas. "Brighter" always means a *smaller*
 * magnitude, per astronomical convention.
 */
export type Variability =
  | { kind: 'constant' }
  | { kind: 'sinusoid'; periodDays: number; amplitudeMag: number; phase0: number }
  | { kind: 'transient'; peakMjd: number; riseDays: number; fadeDays: number; amplitudeMag: number }
  | { kind: 'supernova'; peakMjd: number; riseDays: number; fadeDays: number; peakMag: number };

/**
 * Optional EXTENDED morphology for a source. When absent (the default for every
 * generated source), a source is a point source rendered as the seeing Gaussian —
 * so all existing tiling/light-curve/cross-section behaviour is byte-identical.
 * When present, the source is rendered as a CIRCULAR Sérsic profile (still summed
 * onto the same background with the same flux/light-curve machinery), giving the
 * offline cube a genuinely extended galaxy for the image-classifier (feature 123)
 * to exercise through the real sampling seam.
 */
export type SourceMorphology = {
  kind: 'sersic';
  /** Effective (half-light) radius in arcseconds. */
  reArcsec: number;
  /** Sérsic index n (1 ≈ exponential disk, 4 ≈ de Vaucouleurs bulge). */
  sersicN: number;
};

export interface SyntheticSource {
  id: number;
  /** degrees, [0,360) */
  ra: number;
  /** degrees, [-90,90] */
  dec: number;
  /** quiescent magnitude per band (baseline for the light curve) */
  baseMag: Record<Band, number>;
  /** point-spread FWHM in arcseconds (seeing) */
  fwhmArcsec: number;
  variability: Variability;
  /** Optional extended morphology; absent ⇒ point source (Gaussian). */
  morphology?: SourceMorphology;
}

export interface SyntheticSkyConfig {
  seed: number;
  nSources: number;
  /** RA window in degrees, default [0,360) */
  raRange?: [number, number];
  /** Dec window in degrees, default [-90,90] */
  decRange?: [number, number];
  /** Epochs (MJD) the caller intends to sample; stored for reference/tests. */
  epochsMjd: number[];
  /** Bands present in this sky, default all of {@link BANDS}. */
  bands?: Band[];
  /**
   * Per-source PSF FWHM range in arcseconds, default [0.7, 1.3] (Rubin seeing).
   * The offline BROWSING dataset overrides this to a much wider beam so point
   * sources actually cover a tile pixel (which is 12–80″ across at orders 4–6);
   * at native seeing a 1″ source point-samples to nothing between pixel centres.
   * Widening only broadens the blob — the model uses PEAK amplitude, so sources
   * stay bright — and does not move the centroid, so tiling-geometry tests hold.
   */
  fwhmArcsecRange?: [number, number];
}

export interface SyntheticSky {
  config: Required<SyntheticSkyConfig>;
  sources: SyntheticSource[];
}

/**
 * Photometric zero point (mag) for turning physical flux into detector "counts":
 * counts = 10^(0.4*(ZP - mag)). Chosen so a mag-25 source peaks at ~1 count and a
 * mag-20 source peaks at ~100 counts — a sane range for an 8-bit grayscale tile.
 */
export const COUNTS_ZERO_POINT_MAG = 25;
const COUNTS_GAIN = Math.pow(10, 0.4 * COUNTS_ZERO_POINT_MAG);

/**
 * Flat sky-background pedestal (counts) added to every raster pixel. Real sky
 * images sit on a background; here it also keeps additive Gaussian noise
 * *symmetric* (unclamped) so the mean of a flat region ≈ background + signal —
 * without it, clamping negative noise at 0 would bias empty-region means upward.
 * intensityAt() is signal-only (ground truth); the rasterizer adds this pedestal,
 * so raster ≈ SKY_BACKGROUND_COUNTS + intensityAt (+ noise).
 */
export const SKY_BACKGROUND_COUNTS = 12;

/** FWHM → Gaussian sigma. */
const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2)); // 1/2.3548...

/** Sérsic b_n (Ciotti & Bertin 1999 asymptotic; accurate for n ≳ 0.36). */
function sersicBn(n: number): number {
  return 2 * n - 1 / 3 + 4 / (405 * n) + 46 / (25515 * n * n);
}

/**
 * Peak-normalised radial profile amplitude in [0,1] at angular separation
 * `sepArcsec` from a source's centre.
 *   - Point source (no morphology): the seeing Gaussian exp(−½(θ/σ)²), σ=FWHM/2.3548.
 *   - Extended source: a CIRCULAR Sérsic peak-normalised to 1 at the centre,
 *     amp(r) = exp(−b_n·(r/re)^{1/n})  (I(r)/I(0) for the standard Sérsic law).
 * Both {@link intensityAt} (ground truth) and {@link renderSyntheticIntensityFrame}
 * (raster) call this, so displayed pixels equal the ground truth before noise.
 */
function profileAmplitude(source: SyntheticSource, sepArcsec: number): number {
  const m = source.morphology;
  if (!m) {
    const sigma = source.fwhmArcsec * FWHM_TO_SIGMA;
    const r = sepArcsec / sigma;
    return r > 6 ? 0 : Math.exp(-0.5 * r * r);
  }
  const bn = sersicBn(m.sersicN);
  const x = sepArcsec / m.reArcsec;
  return Math.exp(-bn * Math.pow(x, 1 / m.sersicN));
}

/**
 * Angular radius (arcsec) beyond which a source's profile is negligible (~1e-3 of
 * peak) — used to prefilter sources to a tile and to skip far pixels. For a
 * Gaussian this is 6σ (exactly the previous cutoff); for a Sérsic it is the radius
 * where amp falls to 1e-3.
 */
function sourceExtentArcsec(source: SyntheticSource): number {
  const m = source.morphology;
  if (!m) return 6 * source.fwhmArcsec * FWHM_TO_SIGMA;
  const bn = sersicBn(m.sersicN);
  const xCut = Math.pow(Math.log(1000) / bn, m.sersicN); // amp(xCut) ≈ 1e-3
  return xCut * m.reArcsec;
}

/** Deterministic PRNG (mulberry32) — copied from src/data/alerts.ts. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a-style mix of several numbers into a 32-bit seed. Floats (e.g. MJD) are
 * scaled so their fractional part participates, keeping per-epoch noise distinct.
 */
function hashSeed(...vals: number[]): number {
  let h = 0x811c9dc5;
  for (const v of vals) {
    const x = Math.floor(v * 1000003) | 0;
    for (let s = 0; s < 32; s += 8) {
      h ^= (x >>> s) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

function radecToVec(raDeg: number, decDeg: number): V3 {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

/** Angular separation between two unit vectors, in arcseconds. */
function angularSepArcsec(a: V3, b: V3): number {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot > 1) dot = 1;
  else if (dot < -1) dot = -1;
  return Math.acos(dot) * ARCSEC_PER_RAD;
}

/**
 * Draw a base magnitude from a realistic (Euclidean) number-count distribution
 * N(<m) ∝ 10^(0.6 m): far more faint sources than bright ones. Inverse-CDF
 * sampled so u∈[0,1) maps to [magBright, magFaint].
 */
function sampleBaseMag(u: number, magBright: number, magFaint: number): number {
  const slope = 0.6;
  const span = Math.pow(10, slope * (magFaint - magBright));
  return magBright + Math.log10(1 + u * (span - 1)) / slope;
}

/** Per-band color offsets relative to r (a plausible reddish star SED). */
const BAND_COLOR_OFFSET: Record<Band, number> = { g: 0.45, r: 0, i: -0.32, z: -0.5, y: -0.62 };

/**
 * Generate a deterministic synthetic sky. Positions are equal-area uniform
 * within the region (uniform in sin(dec)); magnitudes follow a faint-heavy
 * distribution; a small fraction of sources are variable / transient / supernova
 * and the rest constant. All ground truth is exposed on the returned sources.
 */
export function generateSyntheticSky(config: SyntheticSkyConfig): SyntheticSky {
  const raRange = config.raRange ?? [0, 360];
  const decRange = config.decRange ?? [-90, 90];
  const bands = config.bands ?? [...BANDS];
  const fwhmArcsecRange = config.fwhmArcsecRange ?? [0.7, 1.3];
  const [fwhmMin, fwhmMax] = fwhmArcsecRange;
  const full: Required<SyntheticSkyConfig> = {
    seed: config.seed,
    nSources: config.nSources,
    raRange,
    decRange,
    epochsMjd: [...config.epochsMjd],
    bands: [...bands],
    fwhmArcsecRange: [fwhmMin, fwhmMax],
  };

  const rand = mulberry32(config.seed);
  const [raMin, raMax] = raRange;
  const sinDecMin = Math.sin(decRange[0] * DEG2RAD);
  const sinDecMax = Math.sin(decRange[1] * DEG2RAD);

  // A representative epoch to anchor transient/supernova peaks near the data.
  const epochs = config.epochsMjd;
  const epochLo = epochs.length ? Math.min(...epochs) : 60000;
  const epochHi = epochs.length ? Math.max(...epochs) : 60000;
  const epochSpan = Math.max(1, epochHi - epochLo);

  const sources: SyntheticSource[] = [];
  for (let id = 0; id < config.nSources; id++) {
    const ra = raMin + rand() * (raMax - raMin);
    const dec = Math.asin(sinDecMin + rand() * (sinDecMax - sinDecMin)) * RAD2DEG;

    const rMag = sampleBaseMag(rand(), 16, 24.5);
    const baseMag = {} as Record<Band, number>;
    for (const b of BANDS) {
      // small deterministic per-band scatter around the color track
      baseMag[b] = rMag + BAND_COLOR_OFFSET[b] + (rand() - 0.5) * 0.1;
    }

    const fwhmArcsec = fwhmMin + rand() * (fwhmMax - fwhmMin); // seeing / beam width

    // Variability class: mostly constant, a few variables/transients/SNe.
    const vr = rand();
    let variability: Variability;
    if (vr < 0.85) {
      variability = { kind: 'constant' };
    } else if (vr < 0.93) {
      variability = {
        kind: 'sinusoid',
        periodDays: 2 + rand() * 60,
        amplitudeMag: 0.1 + rand() * 0.9,
        phase0: rand() * 2 * Math.PI,
      };
    } else if (vr < 0.97) {
      const peakMjd = epochLo + rand() * epochSpan;
      variability = {
        kind: 'transient',
        peakMjd,
        riseDays: 1 + rand() * 8,
        fadeDays: 5 + rand() * 30,
        amplitudeMag: 1 + rand() * 3,
      };
    } else {
      const peakMjd = epochLo + rand() * epochSpan;
      variability = {
        kind: 'supernova',
        peakMjd,
        riseDays: 3 + rand() * 12,
        fadeDays: 15 + rand() * 45,
        peakMag: rMag - (2 + rand() * 4),
      };
    }

    sources.push({ id, ra: ((ra % 360) + 360) % 360, dec, baseMag, fwhmArcsec, variability });
  }

  return { config: full, sources };
}

/**
 * A source's apparent magnitude at epoch `mjd`, in closed form (no noise).
 *  - constant  → baseMag[band].
 *  - sinusoid  → baseMag + amplitude*sin(2π·mjd/period + phase0). Exactly periodic.
 *  - transient → baseMag − amplitude·boost(t); brightest (smallest mag) at peak.
 *  - supernova → baseMag − (baseMag − peakMag)·boost(t); reaches peakMag at peak,
 *                relaxes to baseMag far from peak.
 * where boost(t) is a one-sided-exponential bump: exp(−(peak−t)/rise) before the
 * peak, exp(−(t−peak)/fade) after it, so boost(peak)=1 and decays on either side.
 */
export function magAt(source: SyntheticSource, band: Band, mjd: number): number {
  const base = source.baseMag[band];
  const v = source.variability;
  switch (v.kind) {
    case 'constant':
      return base;
    case 'sinusoid':
      return base + v.amplitudeMag * Math.sin((2 * Math.PI * mjd) / v.periodDays + v.phase0);
    case 'transient': {
      const boost = mjd <= v.peakMjd
        ? Math.exp(-(v.peakMjd - mjd) / v.riseDays)
        : Math.exp(-(mjd - v.peakMjd) / v.fadeDays);
      return base - v.amplitudeMag * boost;
    }
    case 'supernova': {
      const boost = mjd <= v.peakMjd
        ? Math.exp(-(v.peakMjd - mjd) / v.riseDays)
        : Math.exp(-(mjd - v.peakMjd) / v.fadeDays);
      return base - (base - v.peakMag) * boost;
    }
  }
}

/** Linear (relative) flux from magnitude: flux = 10^(-0.4*mag). */
export function fluxAt(source: SyntheticSource, band: Band, mjd: number): number {
  return Math.pow(10, -0.4 * magAt(source, band, mjd));
}

/** Detector "counts" a source contributes at its own center (peak amplitude). */
function peakCounts(source: SyntheticSource, band: Band, mjd: number): number {
  return COUNTS_GAIN * fluxAt(source, band, mjd);
}

/**
 * Ground-truth summed PSF intensity (in detector counts) at a sky point, with no
 * rasterization. Each source contributes peakCounts · exp(−½(θ/σ)²) where θ is
 * the angular separation to the source and σ = FWHM/2.3548. This is the exact
 * signal the rasterizer paints (before noise); tests compare raster pixels to it.
 *
 * `noiseSigma` is accepted for API symmetry with {@link renderSyntheticTile} but
 * intentionally ignored here — this is the noise-free ground truth. (Noise is
 * only well-defined per raster pixel, keyed by tile/pixel.)
 */
export function intensityAt(
  sky: SyntheticSky,
  ra: number,
  dec: number,
  band: Band,
  mjd: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for API symmetry
  noiseSigma = 0
): number {
  const p = radecToVec(ra, dec);
  let sum = 0;
  for (const s of sky.sources) {
    const sep = angularSepArcsec(p, radecToVec(s.ra, s.dec));
    if (sep > sourceExtentArcsec(s)) continue; // negligible beyond the profile cutoff
    sum += peakCounts(s, band, mjd) * profileAmplitude(s, sep);
  }
  return sum;
}

/**
 * Rasterize one HiPS tile in OFFLINE mode to a tileSize×tileSize buffer of
 * LINEAR intensity (detector counts, Float64), unclamped — the raw signal an
 * image-differencing pipeline needs (see src/utils/imageDiff.ts). This is the
 * single source of truth for the offline raster; {@link renderSyntheticTile}
 * merely clamps+packs this frame into 8-bit grayscale RGBA for display.
 *
 * Each pixel's sky position is computed EXACTLY from `pixcoord2vec_nest` with the
 * same in-tile fractional convention the live renderer uses (col→nw, row→ne), so
 * sources land where the real HiPS tile would place them. Every source within the
 * tile (plus a PSF margin) is painted as a Gaussian scaled by its epoch flux; the
 * contributions are summed onto the sky background, then per-pixel zero-mean
 * Gaussian noise (Box–Muller from a PRNG keyed by order/pix/band/mjd/pixel) is
 * added when `noiseSigma > 0`. Values are NOT clamped — negative excursions and
 * bright cores are preserved so a difference of two epochs is quantitatively
 * correct.
 *
 * Row-major (row·tileSize + col), length tileSize². Cost is
 * O(tilePixels · sourcesInTile); sources are pre-filtered to the tile footprint.
 */
export function renderSyntheticIntensityFrame(
  sky: SyntheticSky,
  order: number,
  pixelIndex: number,
  band: Band,
  mjd: number,
  tileSize: number,
  noiseSigma: number
): Float64Array {
  const nside = order2nside(order);
  const out = new Float64Array(tileSize * tileSize);

  // Tile footprint: center vector + angular radius, expanded by the widest PSF.
  const centerVec = pixcoord2vec_nest(nside, pixelIndex, 0.5, 0.5);
  const tileRadiusArcsec = max_pixrad(nside) * ARCSEC_PER_RAD;
  let maxExtentArcsec = 0;
  for (const s of sky.sources) {
    const ext = sourceExtentArcsec(s);
    if (ext > maxExtentArcsec) maxExtentArcsec = ext;
  }
  const marginArcsec = tileRadiusArcsec + maxExtentArcsec;

  // Pre-filter sources to those that can touch this tile.
  const local: { vec: V3; source: SyntheticSource; extentArcsec: number; counts: number }[] = [];
  for (const s of sky.sources) {
    const vec = radecToVec(s.ra, s.dec);
    if (angularSepArcsec(vec, centerVec) > marginArcsec) continue;
    local.push({
      vec,
      source: s,
      extentArcsec: sourceExtentArcsec(s),
      counts: peakCounts(s, band, mjd),
    });
  }

  const noiseRand = mulberry32(hashSeed(sky.config.seed, order, pixelIndex, bandIndex(band), mjd));

  for (let row = 0; row < tileSize; row++) {
    const ne = (row + 0.5) / tileSize;
    for (let col = 0; col < tileSize; col++) {
      const nw = (col + 0.5) / tileSize;
      const pv = pixcoord2vec_nest(nside, pixelIndex, ne, nw);

      let signal = 0;
      for (const s of local) {
        const sep = angularSepArcsec(pv, s.vec);
        if (sep > s.extentArcsec) continue;
        signal += s.counts * profileAmplitude(s.source, sep);
      }

      let value = SKY_BACKGROUND_COUNTS + signal;
      if (noiseSigma > 0) {
        // Box–Muller: two uniforms → one standard normal.
        const u1 = Math.max(1e-12, noiseRand());
        const u2 = noiseRand();
        const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        value += g * noiseSigma;
      }

      out[row * tileSize + col] = value;
    }
  }

  return out;
}

/**
 * Rasterize one HiPS tile in OFFLINE mode to a tileSize×tileSize RGBA buffer.
 *
 * A thin display wrapper over {@link renderSyntheticIntensityFrame}: clamps each
 * linear-intensity pixel to 0..255 and writes it as opaque grayscale RGBA. The
 * two share the exact same pixel/noise computation, so the displayed tile is the
 * clamped image of the frame that differencing operates on.
 */
export function renderSyntheticTile(
  sky: SyntheticSky,
  order: number,
  pixelIndex: number,
  band: Band,
  mjd: number,
  tileSize: number,
  noiseSigma: number
): Uint8ClampedArray {
  const frame = renderSyntheticIntensityFrame(
    sky, order, pixelIndex, band, mjd, tileSize, noiseSigma
  );
  const out = new Uint8ClampedArray(tileSize * tileSize * 4);
  for (let i = 0; i < frame.length; i++) {
    const value = frame[i]!;
    const g8 = value < 0 ? 0 : value > 255 ? 255 : value;
    const o = i * 4;
    out[o] = g8;
    out[o + 1] = g8;
    out[o + 2] = g8;
    out[o + 3] = 255;
  }
  return out;
}
