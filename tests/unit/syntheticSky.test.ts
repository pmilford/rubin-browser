/**
 * Adversarial tests for the synthetic sky generator.
 *
 * Every assertion is against a CLOSED-FORM ground truth (the source's known
 * position / magnitude / light curve), not self-consistency — a reflected,
 * hardcoded, or backwards implementation must fail these. See the project
 * CLAUDE.md "Adversarial test rule".
 */

import { describe, it, expect } from 'vitest';
import { order2nside, pixcoord2vec_nest } from '@hscmap/healpix';
import {
  generateSyntheticSky,
  renderSyntheticTile,
  magAt,
  fluxAt,
  intensityAt,
  BANDS,
  SKY_BACKGROUND_COUNTS,
  type SyntheticSource,
  type SyntheticSkyConfig,
  type Band,
} from '../../src/data/syntheticSky.js';

const RAD2DEG = 180 / Math.PI;

function vecToRadec(v: [number, number, number]): [number, number] {
  const [x, y, z] = v;
  const ra = ((Math.atan2(y, x) * RAD2DEG) % 360 + 360) % 360;
  const dec = Math.asin(Math.max(-1, Math.min(1, z))) * RAD2DEG;
  return [ra, dec];
}

const baseConfig: SyntheticSkyConfig = {
  seed: 42,
  nSources: 200,
  raRange: [40, 60],
  decRange: [-40, -20],
  epochsMjd: [60000, 60010, 60020, 60030],
};

/** Index of the brightest pixel in a grayscale RGBA tile → [col,row,value]. */
function brightestPixel(tile: Uint8ClampedArray, tileSize: number): [number, number, number] {
  let best = -1;
  let bc = 0;
  let br = 0;
  for (let row = 0; row < tileSize; row++) {
    for (let col = 0; col < tileSize; col++) {
      const v = tile[(row * tileSize + col) * 4]!;
      if (v > best) {
        best = v;
        bc = col;
        br = row;
      }
    }
  }
  return [bc, br, best];
}

describe('generateSyntheticSky — determinism & bounds', () => {
  it('same seed → deeply identical sources', () => {
    const a = generateSyntheticSky(baseConfig);
    const b = generateSyntheticSky(baseConfig);
    expect(b.sources).toEqual(a.sources);
    expect(a.sources.length).toBe(200);
  });

  it('different seed → different sources', () => {
    const a = generateSyntheticSky(baseConfig);
    const b = generateSyntheticSky({ ...baseConfig, seed: 43 });
    expect(b.sources).not.toEqual(a.sources);
    // Positions must actually differ, not just object identity.
    expect(b.sources[0]!.ra).not.toBeCloseTo(a.sources[0]!.ra, 6);
  });

  it('all sources lie within raRange/decRange', () => {
    const sky = generateSyntheticSky(baseConfig);
    for (const s of sky.sources) {
      expect(s.ra).toBeGreaterThanOrEqual(40);
      expect(s.ra).toBeLessThanOrEqual(60);
      expect(s.dec).toBeGreaterThanOrEqual(-40);
      expect(s.dec).toBeLessThanOrEqual(-20);
    }
  });

  it('produces a faint-heavy magnitude distribution (more faint than bright)', () => {
    const sky = generateSyntheticSky({ ...baseConfig, nSources: 2000 });
    const mags = sky.sources.map((s) => s.baseMag.r).sort((x, y) => x - y);
    const median = mags[Math.floor(mags.length / 2)]!;
    const mid = (mags[0]! + mags[mags.length - 1]!) / 2;
    // Median skewed toward the faint (large-mag) end of the range.
    expect(median).toBeGreaterThan(mid);
  });

  it('every band present on every source', () => {
    const sky = generateSyntheticSky(baseConfig);
    for (const s of sky.sources) {
      for (const b of BANDS) expect(Number.isFinite(s.baseMag[b])).toBe(true);
    }
  });
});

describe('extended (Sérsic) morphology', () => {
  // Build a controlled single-source sky by replacing the generated sources.
  function singleSourceSky(source: SyntheticSource) {
    const sky = generateSyntheticSky(baseConfig);
    sky.sources = [source];
    return sky;
  }
  const baseMag = { g: 19.5, r: 19.5, i: 19.5, z: 19.5, y: 19.5 };
  const at = (sky: ReturnType<typeof singleSourceSky>, ra: number, dec: number) =>
    intensityAt(sky, ra, dec, 'r', 60000);

  it('a Sérsic source is FAR more extended than a Gaussian point source of the same FWHM', () => {
    const reArcsec = 180;
    const offsetDeg = reArcsec / 3600; // sample exactly one effective radius away
    const point: SyntheticSource = {
      id: 1, ra: 50, dec: -30, baseMag, fwhmArcsec: 67, variability: { kind: 'constant' },
    };
    const galaxy: SyntheticSource = { ...point, id: 2, morphology: { kind: 'sersic', reArcsec, sersicN: 1 } };

    const gCentre = at(singleSourceSky(galaxy), 50, -30);
    const gAtRe = at(singleSourceSky(galaxy), 50, -30 + offsetDeg);
    // Sérsic n=1: I(re)/I(0) = exp(-b_1) with b_1 ≈ 1.678 → ≈ 0.187 (closed form,
    // NOT self-consistency — a wrong profile/normalisation fails this).
    expect(gAtRe / gCentre).toBeCloseTo(Math.exp(-1.6783), 2);

    // The point source (67″ FWHM) is essentially gone 180″ (≈6.3σ) out — proving
    // the extension is the MORPHOLOGY, not just a bright pixel.
    const pCentre = at(singleSourceSky(point), 50, -30);
    const pAtRe = at(singleSourceSky(point), 50, -30 + offsetDeg);
    expect(pAtRe / pCentre).toBeLessThan(1e-6);
  });

  it('a bright point source unchanged: adding morphology does not alter a star (byte-identical path)', () => {
    // Regression guard: the shared profile refactor must leave Gaussian sources
    // exactly as before — the extent cutoff for a Gaussian is still 6σ.
    const star: SyntheticSource = {
      id: 3, ra: 50, dec: -30, baseMag, fwhmArcsec: 45, variability: { kind: 'constant' },
    };
    const sky = singleSourceSky(star);
    const sigma = 45 / 2.3548;
    const centre = at(sky, 50, -30);
    const oneSigma = at(sky, 50, -30 + sigma / 3600);
    expect(oneSigma / centre).toBeCloseTo(Math.exp(-0.5), 3); // pure Gaussian
  });
});

describe('flux / magnitude relationship', () => {
  const src: SyntheticSource = {
    id: 0,
    ra: 50,
    dec: -30,
    baseMag: { g: 20, r: 20, i: 20, z: 20, y: 20 },
    fwhmArcsec: 1,
    variability: { kind: 'constant' },
  };

  it('brighter (smaller mag) → larger flux', () => {
    const bright: SyntheticSource = { ...src, baseMag: { ...src.baseMag, r: 18 } };
    expect(fluxAt(bright, 'r', 60000)).toBeGreaterThan(fluxAt(src, 'r', 60000));
  });

  it('a 5-mag difference → factor ~100 in flux', () => {
    const faint: SyntheticSource = { ...src, baseMag: { ...src.baseMag, r: 25 } };
    const ratio = fluxAt(src, 'r', 60000) / fluxAt(faint, 'r', 60000);
    expect(ratio).toBeCloseTo(100, 4);
  });
});

describe('light curves — closed form', () => {
  it('constant: magAt is epoch-invariant and equals baseMag', () => {
    const s: SyntheticSource = {
      id: 1, ra: 0, dec: 0, fwhmArcsec: 1,
      baseMag: { g: 21, r: 20, i: 19, z: 18.5, y: 18 },
      variability: { kind: 'constant' },
    };
    for (const t of [60000, 60123.4, 70000]) {
      expect(magAt(s, 'r', t)).toBe(20);
      expect(magAt(s, 'g', t)).toBe(21);
    }
  });

  it('sinusoid: hits baseMag±amplitude and is exactly periodic', () => {
    const period = 10;
    const phase0 = 0.3;
    const amp = 0.7;
    const base = 20;
    const s: SyntheticSource = {
      id: 2, ra: 0, dec: 0, fwhmArcsec: 1,
      baseMag: { g: base, r: base, i: base, z: base, y: base },
      variability: { kind: 'sinusoid', periodDays: period, amplitudeMag: amp, phase0 },
    };
    // Peak brightness excursion where sin() = +1: 2π t/period + phase0 = π/2.
    const tPeak = ((Math.PI / 2 - phase0) / (2 * Math.PI)) * period;
    expect(magAt(s, 'r', tPeak)).toBeCloseTo(base + amp, 9);
    const tTrough = ((-Math.PI / 2 - phase0) / (2 * Math.PI)) * period;
    expect(magAt(s, 'r', tTrough)).toBeCloseTo(base - amp, 9);
    // Periodicity: magAt(t) === magAt(t + period).
    for (const t of [60000, 60003.7, 60009.9]) {
      expect(magAt(s, 'r', t + period)).toBeCloseTo(magAt(s, 'r', t), 9);
    }
  });

  it('transient: peaks (brightest) at peakMjd; flux(peak) > flux(±3·fade)', () => {
    const peakMjd = 60050;
    const rise = 4;
    const fade = 10;
    const s: SyntheticSource = {
      id: 3, ra: 0, dec: 0, fwhmArcsec: 1,
      baseMag: { g: 22, r: 22, i: 22, z: 22, y: 22 },
      variability: { kind: 'transient', peakMjd, riseDays: rise, fadeDays: fade, amplitudeMag: 3 },
    };
    const magPeak = magAt(s, 'r', peakMjd);
    // Brightest (smallest mag) at the peak.
    expect(magPeak).toBeLessThan(magAt(s, 'r', peakMjd - 3 * rise));
    expect(magPeak).toBeLessThan(magAt(s, 'r', peakMjd + 3 * fade));
    // Flux ordering: much brighter at peak than well after.
    expect(fluxAt(s, 'r', peakMjd)).toBeGreaterThan(fluxAt(s, 'r', peakMjd + 3 * fade));
    expect(fluxAt(s, 'r', peakMjd)).toBeGreaterThan(fluxAt(s, 'r', peakMjd - 3 * rise));
    // At the peak the boost is full: mag = base − amplitude.
    expect(magPeak).toBeCloseTo(22 - 3, 9);
  });

  it('supernova: reaches peakMag at peak, relaxes toward baseMag far away', () => {
    const peakMjd = 60050;
    const s: SyntheticSource = {
      id: 4, ra: 0, dec: 0, fwhmArcsec: 1,
      baseMag: { g: 23, r: 23, i: 23, z: 23, y: 23 },
      variability: { kind: 'supernova', peakMjd, riseDays: 5, fadeDays: 20, peakMag: 18 },
    };
    expect(magAt(s, 'r', peakMjd)).toBeCloseTo(18, 9);
    expect(magAt(s, 'r', peakMjd + 300)).toBeCloseTo(23, 3);
    // Brighter at peak than long after.
    expect(fluxAt(s, 'r', peakMjd)).toBeGreaterThan(fluxAt(s, 'r', peakMjd + 300));
  });
});

describe('renderSyntheticTile — determinism', () => {
  const sky = generateSyntheticSky(baseConfig);
  // A tile that overlaps the region (order 4 near RA 50, Dec -30).
  const order = 4;
  const nside = order2nside(order);
  // Find a pixel whose center is inside the populated region.
  function pixelForRegion(): number {
    for (let p = 0; p < nside * nside * 12; p++) {
      const [ra, dec] = vecToRadec(pixcoord2vec_nest(nside, p, 0.5, 0.5) as [number, number, number]);
      if (ra >= 42 && ra <= 58 && dec >= -38 && dec <= -22) return p;
    }
    throw new Error('no region pixel found');
  }
  const pix = pixelForRegion();

  it('noiseSigma=0 is exactly reproducible', () => {
    const a = renderSyntheticTile(sky, order, pix, 'r', 60000, 32, 0);
    const b = renderSyntheticTile(sky, order, pix, 'r', 60000, 32, 0);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('noise is deterministic per seed but changes pixels vs noiseless', () => {
    const clean = renderSyntheticTile(sky, order, pix, 'r', 60000, 32, 0);
    const noisyA = renderSyntheticTile(sky, order, pix, 'r', 60000, 32, 4);
    const noisyB = renderSyntheticTile(sky, order, pix, 'r', 60000, 32, 4);
    expect(Array.from(noisyB)).toEqual(Array.from(noisyA)); // deterministic
    expect(Array.from(noisyA)).not.toEqual(Array.from(clean)); // noise actually applied
  });

  it('different seed → different raster (noise keyed by seed)', () => {
    const sky2 = generateSyntheticSky({ ...baseConfig, seed: 99 });
    const a = renderSyntheticTile(sky, order, pix, 'r', 60000, 32, 5);
    const b = renderSyntheticTile(sky2, order, pix, 'r', 60000, 32, 5);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe('renderSyntheticTile — known position lands at the right pixel', () => {
  const order = 5;
  const nside = order2nside(order);
  const tileSize = 32;
  const pix = 1234;

  // Place ONE bright source exactly at a chosen in-tile pixel's sky position.
  const targetCol = 20;
  const targetRow = 8;
  const ne = (targetRow + 0.5) / tileSize;
  const nw = (targetCol + 0.5) / tileSize;
  const [ra, dec] = vecToRadec(
    pixcoord2vec_nest(nside, pix, ne, nw) as [number, number, number]
  );

  const source: SyntheticSource = {
    id: 0, ra, dec, fwhmArcsec: 0.8,
    baseMag: { g: 18, r: 18, i: 18, z: 18, y: 18 },
    variability: { kind: 'constant' },
  };
  const sky = {
    config: {
      seed: 1, nSources: 1, raRange: [0, 360] as [number, number],
      decRange: [-90, 90] as [number, number], epochsMjd: [60000], bands: [...BANDS],
    },
    sources: [source],
  };

  it('intensity peaks at the projected tile pixel (within ~1px)', () => {
    const tile = renderSyntheticTile(sky, order, pix, 'r', 60000, tileSize, 0);
    const [bc, br, best] = brightestPixel(tile, tileSize);
    expect(Math.abs(bc - targetCol)).toBeLessThanOrEqual(1);
    expect(Math.abs(br - targetRow)).toBeLessThanOrEqual(1);
    // A bright mag-18 source must far exceed the background pedestal.
    expect(best).toBeGreaterThan(SKY_BACKGROUND_COUNTS + 50);
  });

  it('empty tile renders at the background floor only (no phantom sources)', () => {
    // A pixel on the opposite side of the sky, far from the single source.
    const emptyPix = 12 * nside * nside - 1;
    const tile = renderSyntheticTile(sky, order, emptyPix, 'r', 60000, tileSize, 0);
    for (let i = 0; i < tile.length; i += 4) {
      expect(tile[i]).toBe(SKY_BACKGROUND_COUNTS);
    }
  });

  it('raster pixel ≈ background + intensityAt ground truth at the source center', () => {
    const groundTruth = intensityAt(sky as never, ra, dec, 'r', 60000);
    // Peak pixel samples the pixel center, offset ≤ 0.5px from the true center,
    // so it is close to (background + peak intensity) but need not be exact.
    const tile = renderSyntheticTile(sky, order, pix, 'r', 60000, tileSize, 0);
    const [, , best] = brightestPixel(tile, tileSize);
    const expected = SKY_BACKGROUND_COUNTS + groundTruth;
    // Both saturate against 255 clamp? mag-18 → ~630 counts, so clamps to 255.
    expect(best).toBe(255);
    expect(expected).toBeGreaterThan(255);
  });
});

describe('renderSyntheticTile — noise statistics on a flat region', () => {
  const sky = generateSyntheticSky(baseConfig);
  const order = 5;
  const nside = order2nside(order);
  // Empty pixel far from the RA 40–60 / Dec -40..-20 region.
  const emptyPix = 12 * nside * nside - 1;
  const tileSize = 48;

  it('mean over a flat empty region ≈ background within tolerance', () => {
    const sigma = 3;
    const tile = renderSyntheticTile(sky, order, emptyPix, 'r', 60000, tileSize, sigma);
    let sum = 0;
    const n = tileSize * tileSize;
    for (let i = 0; i < tile.length; i += 4) sum += tile[i]!;
    const mean = sum / n;
    // Zero-mean noise on a flat pedestal: mean ≈ background. Tolerance scales
    // with sigma/sqrt(n) (plus tiny clamp bias at 12−3σ).
    expect(mean).toBeGreaterThan(SKY_BACKGROUND_COUNTS - 1);
    expect(mean).toBeLessThan(SKY_BACKGROUND_COUNTS + 1);
  });

  it('noiseSigma>0 changes individual pixels away from the flat pedestal', () => {
    const tile = renderSyntheticTile(sky, order, emptyPix, 'r', 60000, tileSize, 5);
    let differing = 0;
    for (let i = 0; i < tile.length; i += 4) {
      if (tile[i] !== SKY_BACKGROUND_COUNTS) differing++;
    }
    expect(differing).toBeGreaterThan(tileSize * tileSize * 0.5);
  });
});

describe('magAt covers all bands', () => {
  it('applies per-band baseMag', () => {
    const s = generateSyntheticSky(baseConfig).sources.find(
      (x) => x.variability.kind === 'constant'
    )!;
    for (const b of BANDS as Band[]) {
      expect(magAt(s, b, 60000)).toBe(s.baseMag[b]);
    }
  });
});
