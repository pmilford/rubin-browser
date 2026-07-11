import { describe, it, expect } from 'vitest';
import {
  sampleProfile,
  luminance,
  profilePath,
  channelValues,
  temporalCrossSectionGrid,
  type PixelGetter,
  type LineEndpoints,
} from '../../src/utils/crossSection.js';

/** Index of the maximum finite value in a row (argmax), -1 if the row is all NaN. */
function argmax(row: number[]): number {
  let best = -1, bestV = -Infinity;
  for (let i = 0; i < row.length; i++) {
    const v = row[i]!;
    if (Number.isFinite(v) && v > bestV) { bestV = v; best = i; }
  }
  return best;
}

/** A W×H buffer whose pixel value is a pure function of (x,y), for ground truth. */
function makeGetter(w: number, h: number, fn: (x: number, y: number) => [number, number, number] | null): PixelGetter {
  return (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : fn(x, y));
}

describe('luminance', () => {
  it('uses the Rec.601 weights normalised to 0..1', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 6);
    expect(luminance(0, 0, 0)).toBe(0);
    // A known pixel — kills wrong/placeholder weights.
    expect(luminance(100, 150, 200)).toBeCloseTo((0.299 * 100 + 0.587 * 150 + 0.114 * 200) / 255, 6);
  });
});

describe('sampleProfile — gradient direction (kills axis-swap / all-zero)', () => {
  const W = 100;
  const H = 100;
  // Intensity increases with x, constant in y.
  const getter = makeGetter(W, H, (x) => {
    const v = Math.round((x / (W - 1)) * 255);
    return [v, v, v];
  });

  it('a horizontal cut is STRICTLY monotonic increasing', () => {
    const p = sampleProfile(getter, 2, 50, 97, 50, 10, 0, 10.1, 0, 40);
    for (let i = 1; i < p.lum.length; i++) {
      expect(p.gap[i]).toBe(false);
      expect(p.lum[i]!).toBeGreaterThan(p.lum[i - 1]!);
    }
  });

  it('a vertical cut is CONSTANT (intensity does not depend on y)', () => {
    const p = sampleProfile(getter, 50, 2, 50, 97, 10, 0, 10, 0.1, 40);
    const first = p.lum[0]!;
    for (const v of p.lum) expect(v).toBeCloseTo(first, 6);
  });
});

describe('sampleProfile — gaps are never silent zeros', () => {
  const W = 40;
  const H = 40;
  // Left half has data; right half returns null (no tile).
  const getter = makeGetter(W, H, (x) => (x < 20 ? [128, 128, 128] : null));

  it('flags no-data samples as gaps with NaN, not 0', () => {
    const p = sampleProfile(getter, 2, 20, 38, 20, 10, 0, 10.1, 0, 30);
    const gapCount = p.gap.filter(Boolean).length;
    expect(gapCount).toBeGreaterThan(0);
    for (let i = 0; i < p.lum.length; i++) {
      if (p.gap[i]) expect(Number.isNaN(p.lum[i]!)).toBe(true);
      else expect(p.lum[i]!).toBeCloseTo(128 / 255, 6);
    }
    // A gap must NEVER read as a real 0 intensity.
    for (let i = 0; i < p.lum.length; i++) if (p.gap[i]) expect(p.lum[i]).not.toBe(0);
  });

  it('off-canvas endpoints are gaps, no throw, no NaN coords', () => {
    const p = sampleProfile(getter, -50, -50, -10, -10, 10, 0, 10, 0.1, 10);
    expect(p.gap.every(Boolean)).toBe(true);
    expect(p.lum.length).toBe(10);
  });
});

describe('sampleProfile — degenerate + distance axis', () => {
  const getter = makeGetter(50, 50, () => [200, 200, 200]);

  it('a zero-length line is finite (no NaN, length ≥ 1)', () => {
    const p = sampleProfile(getter, 25, 25, 25, 25, 10, 0, 10, 0, 8);
    expect(p.lum.length).toBeGreaterThanOrEqual(2);
    for (const v of p.lum) expect(Number.isFinite(v)).toBe(true);
    expect(p.distanceArcmin[p.distanceArcmin.length - 1]).toBe(0);
  });

  it('distance axis is great-circle arcmin between endpoints (not pixels)', () => {
    // 0.1° apart on the equator → 6 arcmin at the far end.
    const p = sampleProfile(getter, 0, 25, 49, 25, 10, 0, 10.1, 0, 20);
    expect(p.distanceArcmin[p.distanceArcmin.length - 1]).toBeCloseTo(6, 3);
    expect(p.distanceArcmin[0]).toBe(0);
  });
});

describe('sampleProfile — per-channel R/G/B (not just luminance)', () => {
  const W = 100;
  const H = 10;
  // A pure-RED horizontal gradient: red rises with x, green/blue stay 0.
  const redGrad = makeGetter(W, H, (x) => [Math.round((x / (W - 1)) * 255), 0, 0]);

  it('separates channels: R tracks red, G/B stay ~0, lum = 0.299·R', () => {
    const p = sampleProfile(redGrad, 1, 5, W - 2, 5, 10, 0, 10, 1, 40);
    // R channel is monotonic increasing (the red gradient).
    const r = channelValues(p, 'r');
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeGreaterThanOrEqual(r[i - 1]!);
    // G and B are flat zero — a "luminance only" impl (r===lum) would fail this.
    for (const v of channelValues(p, 'g')) expect(v).toBeCloseTo(0, 6);
    for (const v of channelValues(p, 'b')) expect(v).toBeCloseTo(0, 6);
    // Luminance is the red channel weighted by 0.299 — so lum < r wherever r>0,
    // proving lum and r are distinct series (not a copy).
    const mid = Math.floor(r.length / 2);
    expect(p.lum[mid]!).toBeCloseTo(0.299 * r[mid]!, 5);
    expect(r[mid]!).toBeGreaterThan(p.lum[mid]! + 0.05);
  });

  it('gaps set every channel to NaN, never 0', () => {
    const p = sampleProfile(makeGetter(4, 4, () => null), 0, 0, 3, 3, 0, 0, 1, 1, 6);
    for (const ch of ['lum', 'r', 'g', 'b'] as const) {
      for (const v of channelValues(p, ch)) expect(Number.isNaN(v)).toBe(true);
    }
  });

  it('profilePath draws distinct curves per channel', () => {
    const p = sampleProfile(redGrad, 1, 5, W - 2, 5, 10, 0, 10, 1, 40);
    const rPath = profilePath(p, 100, 50, false, 1e-3, 'r');
    const lumPath = profilePath(p, 100, 50, false, 1e-3, 'lum');
    const bPath = profilePath(p, 100, 50, false, 1e-3, 'b');
    expect(rPath).not.toBe(lumPath); // red ≠ luminance shape
    expect(rPath.length).toBeGreaterThan(0);
    expect(bPath.length).toBeGreaterThan(0); // blue is flat-zero but still a valid path
  });
});

describe('sampleProfile — carries the sky endpoints for re-sampling', () => {
  const getter = makeGetter(50, 50, () => [200, 200, 200]);
  it('reports the line endpoints (start → end) that were passed in', () => {
    const p = sampleProfile(getter, 0, 25, 49, 25, 62, -37, 62.5, -36.5, 20);
    expect(p.endpoints).toEqual({ ra0: 62, dec0: -37, ra1: 62.5, dec1: -36.5 });
  });
});

describe('temporalCrossSectionGrid — position × time waterfall', () => {
  const line: LineEndpoints = { ra0: 10, dec0: 0, ra1: 10.1, dec1: 0 };

  it('is position×time: a feature at the START in epoch 0 and the END in epoch 1 → peak COLUMN shifts between the two ROWS', () => {
    const COLS = 7;
    // Epoch 0: brightest at sample 0 (line start). Epoch 1: brightest at sample n-1
    // (line end). A ramp so there is a single unambiguous peak per row.
    const grid = temporalCrossSectionGrid(line, 2, COLS, (_ra, _dec, epoch, s) =>
      epoch === 0 ? COLS - 1 - s : s,
    );
    // Shape proves rows=epochs, cols=positions (a TRANSPOSED impl would be 7×2).
    expect(grid.length).toBe(2);
    expect(grid[0]!.length).toBe(COLS);
    // The load-bearing assertion: the bright feature MOVES along the line with time.
    // A static / spatial / epoch-ignoring impl would give equal peak columns → fail.
    expect(argmax(grid[0]!)).toBe(0);
    expect(argmax(grid[1]!)).toBe(COLS - 1);
    expect(argmax(grid[0]!)).not.toBe(argmax(grid[1]!));
  });

  it('row order is TIME, earliest first (row 0 = epoch 0)', () => {
    // Value depends ONLY on the epoch index → after normalisation, row e is all e/max.
    const rows = 4;
    const grid = temporalCrossSectionGrid(line, rows, 3, (_ra, _dec, epoch) => epoch);
    for (const v of grid[0]!) expect(v).toBe(0); // earliest epoch → 0
    for (const v of grid[rows - 1]!) expect(v).toBeCloseTo(1, 6); // latest → normalised peak
    // Strictly increasing back→front proves the axis is not reversed.
    for (let e = 1; e < rows; e++) expect(grid[e]![0]!).toBeGreaterThan(grid[e - 1]![0]!);
  });

  it('normalises the grid peak to 1.0', () => {
    const grid = temporalCrossSectionGrid(line, 3, 4, (_ra, _dec, epoch, s) => epoch * 10 + s);
    let max = -Infinity;
    for (const row of grid) for (const v of row) max = Math.max(max, v);
    expect(max).toBeCloseTo(1, 6);
  });

  it('propagates NaN gaps — a no-data sample never becomes a real 0 height', () => {
    const grid = temporalCrossSectionGrid(line, 2, 5, (_ra, _dec, _epoch, s) =>
      s === 2 ? NaN : 1,
    );
    for (const row of grid) {
      expect(Number.isNaN(row[2]!)).toBe(true); // the gap stays a gap
      expect(row[0]).not.toBe(0); // real data is not zeroed by the gap
    }
  });

  it('feeds the sampler the SAME position for every epoch (columns are fixed on-sky)', () => {
    // Record the (ra,dec) seen per sample index across both epochs; they must match.
    const seen = new Map<number, string>();
    let mismatched = false;
    temporalCrossSectionGrid(line, 3, 6, (ra, dec, _epoch, s) => {
      const key = `${ra.toFixed(9)},${dec.toFixed(9)}`;
      const prev = seen.get(s);
      if (prev !== undefined && prev !== key) mismatched = true;
      seen.set(s, key);
      return 1;
    });
    expect(mismatched).toBe(false);
  });

  it('returns empty when there are fewer than 2 epochs (no time axis)', () => {
    expect(temporalCrossSectionGrid(line, 1, 5, () => 1)).toEqual([]);
    expect(temporalCrossSectionGrid(line, 0, 5, () => 1)).toEqual([]);
  });

  it('interpolates RA the short way across the 0/360° wrap', () => {
    // A line from RA 359.9 → 0.1 should sweep 0.2°, not ~359.8°. Sample the middle
    // column's RA via the sampler and assert it is near the wrap (≈0/360), not ≈180.
    let midRa = NaN;
    const wrapLine: LineEndpoints = { ra0: 359.9, dec0: 0, ra1: 0.1, dec1: 0 };
    temporalCrossSectionGrid(wrapLine, 2, 3, (ra, _dec, epoch, s) => {
      if (epoch === 0 && s === 1) midRa = ra;
      return 1;
    });
    // Midpoint should be 0 (mod 360), i.e. ≈0 or ≈360 — NOT 180.
    const distTo0 = Math.min(Math.abs(midRa % 360), 360 - Math.abs(midRa % 360));
    expect(distTo0).toBeLessThan(1);
  });
});

describe('profilePath', () => {
  it('breaks the trace across gap runs (no line drawn through no-data)', () => {
    const profile = {
      t: [0, 0.25, 0.5, 0.75, 1],
      distanceArcmin: [0, 1, 2, 3, 4],
      lum: [0.2, NaN, NaN, 0.8, 0.9],
      gap: [false, true, true, false, false],
    };
    const d = profilePath(profile, 100, 50, false);
    // Two subpaths → two 'M' move commands (one before the gap, one after).
    expect((d.match(/M/g) || []).length).toBe(2);
  });

  it('returns empty string when fully gapped', () => {
    const profile = { t: [0, 1], distanceArcmin: [0, 1], lum: [NaN, NaN], gap: [true, true] };
    expect(profilePath(profile, 100, 50, false)).toBe('');
  });

  it('log scale changes the mapped shape vs linear', () => {
    const profile = {
      t: [0, 0.5, 1],
      distanceArcmin: [0, 1, 2],
      lum: [0.01, 0.1, 1],
      gap: [false, false, false],
    };
    const lin = profilePath(profile, 100, 50, false);
    const log = profilePath(profile, 100, 50, true);
    expect(lin).not.toBe(log);
  });
});
