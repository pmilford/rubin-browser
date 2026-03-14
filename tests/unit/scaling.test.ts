import { describe, it, expect } from 'vitest';
import {
  linearScale,
  logScale,
  sqrtScale,
  asinhScale,
  histogramEqualize,
  zscaleRange,
  percentileRange,
  applyScaling,
} from '../../src/utils/scaling.js';

describe('linearScale', () => {
  it('normalizes mid-range value', () => {
    expect(linearScale(5, 0, 10)).toBeCloseTo(0.5);
  });

  it('returns 0 for min value', () => {
    expect(linearScale(0, 0, 10)).toBeCloseTo(0);
  });

  it('returns 1 for max value', () => {
    expect(linearScale(10, 0, 10)).toBeCloseTo(1);
  });

  it('clamps values below min to 0', () => {
    expect(linearScale(-5, 0, 10)).toBe(0);
  });

  it('clamps values above max to 1', () => {
    expect(linearScale(15, 0, 10)).toBe(1);
  });

  it('returns 0 when min >= max', () => {
    expect(linearScale(5, 10, 10)).toBe(0);
    expect(linearScale(5, 10, 5)).toBe(0);
  });

  it('handles negative ranges', () => {
    expect(linearScale(-5, -10, 0)).toBeCloseTo(0.5);
  });

  it('handles very small range', () => {
    expect(linearScale(0.5, 0, 1)).toBeCloseTo(0.5);
  });
});

describe('linearScale — additional edge cases for branch coverage', () => {
  it('value exactly at min returns 0', () => {
    expect(linearScale(5, 5, 10)).toBeCloseTo(0);
  });
});

describe('logScale', () => {
  it('returns 0 for min value', () => {
    expect(logScale(0, 0, 100)).toBe(0);
  });

  it('returns 1 for max value', () => {
    expect(logScale(100, 0, 100)).toBeCloseTo(1);
  });

  it('returns value between 0 and 1 for mid-range', () => {
    const result = logScale(50, 0, 100);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('log scale compresses high values', () => {
    const logMid = logScale(50, 0, 100);
    const linMid = linearScale(50, 0, 100);
    expect(logMid).toBeGreaterThan(linMid);
  });

  it('returns 0 when value <= min', () => {
    expect(logScale(-5, 0, 100)).toBe(0);
  });

  it('returns 0 when min >= max', () => {
    expect(logScale(5, 10, 10)).toBe(0);
    expect(logScale(5, 10, 5)).toBe(0);
  });

  it('clamps output to [0, 1]', () => {
    expect(logScale(200, 0, 100)).toBeLessThanOrEqual(1);
  });
});

describe('sqrtScale', () => {
  it('returns 0 for min value', () => {
    expect(sqrtScale(0, 0, 100)).toBe(0);
  });

  it('returns 1 for max value', () => {
    expect(sqrtScale(100, 0, 100)).toBeCloseTo(1);
  });

  it('sqrt(25/100) = 0.5', () => {
    expect(sqrtScale(25, 0, 100)).toBeCloseTo(0.5);
  });

  it('returns 0 when value <= min', () => {
    expect(sqrtScale(-5, 0, 100)).toBe(0);
  });

  it('returns 0 when min >= max', () => {
    expect(sqrtScale(5, 10, 10)).toBe(0);
    expect(sqrtScale(5, 10, 5)).toBe(0);
  });

  it('clamps above max to 1', () => {
    expect(sqrtScale(200, 0, 100)).toBe(1);
  });
});

describe('asinhScale', () => {
  it('returns 0 for min value', () => {
    expect(asinhScale(0, 0, 100)).toBeCloseTo(0);
  });

  it('returns 1 for max value', () => {
    expect(asinhScale(100, 0, 100)).toBeCloseTo(1);
  });

  it('returns value between 0 and 1 for mid-range', () => {
    const result = asinhScale(50, 0, 100);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('returns 0 when max == min', () => {
    expect(asinhScale(5, 5, 5)).toBe(0);
  });

  it('returns 0 when min > max', () => {
    expect(asinhScale(5, 10, 5)).toBe(0);
  });

  it('clamps below min to 0', () => {
    expect(asinhScale(-10, 0, 100)).toBe(0);
  });

  it('clamps above max to 1', () => {
    expect(asinhScale(200, 0, 100)).toBe(1);
  });
});

describe('histogramEqualize', () => {
  it('returns empty array for empty input', () => {
    const result = histogramEqualize(new Float64Array(0));
    expect(result.length).toBe(0);
  });

  it('returns 0.5 for all-same-value input', () => {
    const result = histogramEqualize(new Float64Array([5, 5, 5, 5]));
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeCloseTo(0.5);
    }
  });

  it('produces values in [0, 1]', () => {
    const pixels = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = histogramEqualize(pixels);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(1);
    }
  });

  it('highest value maps close to 1', () => {
    const pixels = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = histogramEqualize(pixels);
    expect(result[9]).toBeCloseTo(1, 1);
  });

  it('lowest value has smallest equalized value', () => {
    const pixels = new Float64Array([10, 20, 30, 40, 50]);
    const result = histogramEqualize(pixels);
    expect(result[0]).toBeLessThan(result[4]);
  });

  it('preserves monotonic ordering', () => {
    const pixels = new Float64Array([1, 3, 5, 7, 9]);
    const result = histogramEqualize(pixels);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
    }
  });

  it('handles NaN in input by treating as 0', () => {
    const pixels = new Float64Array([NaN, 1, 2, 3]);
    const result = histogramEqualize(pixels);
    expect(result.length).toBe(4);
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('handles single-element array', () => {
    const result = histogramEqualize(new Float64Array([42]));
    expect(result.length).toBe(1);
    expect(result[0]).toBeCloseTo(0.5);
  });

  it('excludes zero pixels from histogram computation', () => {
    // Many zeros (background) + few signal pixels
    const pixels = new Float64Array([0, 0, 0, 0, 0, 0, 0, 0, 50, 100, 200]);
    const result = histogramEqualize(pixels);
    // Zero pixels should map to 0
    expect(result[0]).toBe(0);
    expect(result[7]).toBe(0);
    // Signal pixels should be spread across [0, 1]
    expect(result[8]).toBeGreaterThan(0);
    expect(result[10]).toBeCloseTo(1, 1);
  });

  it('returns all zeros when all pixels are zero', () => {
    const pixels = new Float64Array([0, 0, 0, 0]);
    const result = histogramEqualize(pixels);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(0);
    }
  });

  it('does not let zero pixels skew the histogram', () => {
    // 90% zeros, 10% real signal — equalization should work on signal only
    const pixels = new Float64Array(100);
    for (let i = 0; i < 90; i++) pixels[i] = 0;
    for (let i = 90; i < 100; i++) pixels[i] = (i - 89) * 10; // 10, 20, ..., 100
    const result = histogramEqualize(pixels);
    // Zeros stay at 0
    expect(result[0]).toBe(0);
    expect(result[89]).toBe(0);
    // Non-zeros get proper equalization
    expect(result[90]).toBeGreaterThan(0);
    expect(result[99]).toBeCloseTo(1, 1);
  });
});

describe('zscaleRange', () => {
  it('returns {0, 0} for empty input', () => {
    const { min, max } = zscaleRange(new Float64Array(0));
    expect(min).toBe(0);
    expect(max).toBe(0);
  });

  it('returns same min/max for single value', () => {
    const { min, max } = zscaleRange(new Float64Array([42]));
    expect(min).toBe(42);
    expect(max).toBe(42);
  });

  it('returns a narrower range than full min/max', () => {
    const pixels = new Float64Array(1000);
    for (let i = 0; i < 1000; i++) pixels[i] = i;
    const { min, max } = zscaleRange(pixels);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(999);
  });

  it('handles all-same values', () => {
    const pixels = new Float64Array([5, 5, 5, 5, 5]);
    const { min, max } = zscaleRange(pixels);
    expect(min).toBe(5);
    expect(max).toBe(5);
  });

  it('uses default contrast of 0.25', () => {
    const pixels = new Float64Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const defaultResult = zscaleRange(pixels);
    const explicitResult = zscaleRange(pixels, 0.25);
    expect(defaultResult.min).toBeCloseTo(explicitResult.min);
    expect(defaultResult.max).toBeCloseTo(explicitResult.max);
  });

  it('higher contrast gives wider range', () => {
    const pixels = new Float64Array(100);
    for (let i = 0; i < 100; i++) pixels[i] = i;
    const narrow = zscaleRange(pixels, 0.1);
    const wide = zscaleRange(pixels, 0.5);
    expect(wide.max - wide.min).toBeGreaterThanOrEqual(narrow.max - narrow.min);
  });

  it('handles large arrays by sampling', () => {
    const pixels = new Float64Array(20000);
    for (let i = 0; i < 20000; i++) pixels[i] = Math.sin(i) * 100;
    const { min, max } = zscaleRange(pixels);
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(max).toBeGreaterThanOrEqual(min);
  });

  it('handles NaN values', () => {
    const pixels = new Float64Array([NaN, 1, 2, 3, NaN, 5, 6, 7, 8, 9]);
    const { min, max } = zscaleRange(pixels);
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
  });

  it('handles two-element array', () => {
    const { min, max } = zscaleRange(new Float64Array([10, 20]));
    expect(min).toBeGreaterThanOrEqual(10);
    expect(max).toBeLessThanOrEqual(20);
  });

  it('handles three-element array (small central portion)', () => {
    const { min, max } = zscaleRange(new Float64Array([1, 2, 3]));
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
  });

  it('excludes zero pixels from range computation', () => {
    // Many zeros + real signal
    const pixels = new Float64Array([0, 0, 0, 0, 0, 50, 60, 70, 80, 90, 100]);
    const { min, max } = zscaleRange(pixels);
    // Range should be based on non-zero values only
    expect(min).toBeGreaterThanOrEqual(50);
    expect(max).toBeLessThanOrEqual(100);
  });

  it('returns {0, 0} when all pixels are zero', () => {
    const { min, max } = zscaleRange(new Float64Array([0, 0, 0, 0]));
    expect(min).toBe(0);
    expect(max).toBe(0);
  });

  it('handles array with mostly zeros and sparse signal', () => {
    const pixels = new Float64Array(1000);
    for (let i = 0; i < 950; i++) pixels[i] = 0;
    for (let i = 950; i < 1000; i++) pixels[i] = 100 + Math.random() * 100;
    const { min, max } = zscaleRange(pixels);
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(min).toBeGreaterThanOrEqual(100);
  });
});

describe('percentileRange', () => {
  it('returns {0, 0} for empty input', () => {
    const { min, max } = percentileRange(new Float64Array(0), 5, 95);
    expect(min).toBe(0);
    expect(max).toBe(0);
  });

  it('0th and 100th percentile gives full range', () => {
    const pixels = new Float64Array([10, 20, 30, 40, 50]);
    const { min, max } = percentileRange(pixels, 0, 100);
    expect(min).toBe(10);
    expect(max).toBe(50);
  });

  it('narrows range for interior percentiles', () => {
    const pixels = new Float64Array(100);
    for (let i = 0; i < 100; i++) pixels[i] = i;
    const { min, max } = percentileRange(pixels, 10, 90);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeLessThan(99);
  });

  it('handles single element', () => {
    const { min, max } = percentileRange(new Float64Array([42]), 5, 95);
    expect(min).toBe(42);
    expect(max).toBe(42);
  });

  it('handles NaN by treating as 0', () => {
    const pixels = new Float64Array([NaN, 10, 20, 30]);
    const { min, max } = percentileRange(pixels, 0, 100);
    expect(min).toBe(0); // NaN sanitized to 0
    expect(max).toBe(30);
  });

  it('same percentile returns same value', () => {
    const pixels = new Float64Array([1, 2, 3, 4, 5]);
    const { min, max } = percentileRange(pixels, 50, 50);
    expect(min).toBe(max);
  });
});

describe('applyScaling', () => {
  it('returns empty result for empty input', () => {
    const result = applyScaling(new Float64Array(0), { method: 'linear' });
    expect(result.data.length).toBe(0);
    expect(result.actualMin).toBe(0);
    expect(result.actualMax).toBe(0);
    expect(result.underflow).toEqual([]);
    expect(result.overflow).toEqual([]);
  });

  it('dispatches to linear scaling', () => {
    const pixels = new Float64Array([0, 25, 50, 75, 100]);
    const result = applyScaling(pixels, { method: 'linear' });
    expect(result.data[0]).toBeCloseTo(0);
    expect(result.data[2]).toBeCloseTo(0.5);
    expect(result.data[4]).toBeCloseTo(1);
    expect(result.actualMin).toBe(0);
    expect(result.actualMax).toBe(100);
  });

  it('dispatches to log scaling', () => {
    const pixels = new Float64Array([0, 50, 100]);
    const result = applyScaling(pixels, { method: 'log' });
    expect(result.data[0]).toBeCloseTo(0);
    expect(result.data[2]).toBeCloseTo(1);
    // Log compresses high values
    expect(result.data[1]).toBeGreaterThan(0.5);
  });

  it('dispatches to sqrt scaling', () => {
    const pixels = new Float64Array([0, 25, 100]);
    const result = applyScaling(pixels, { method: 'sqrt' });
    expect(result.data[0]).toBeCloseTo(0);
    expect(result.data[1]).toBeCloseTo(0.5);
    expect(result.data[2]).toBeCloseTo(1);
  });

  it('dispatches to asinh scaling', () => {
    const pixels = new Float64Array([0, 50, 100]);
    const result = applyScaling(pixels, { method: 'asinh' });
    expect(result.data[0]).toBeCloseTo(0);
    expect(result.data[2]).toBeCloseTo(1);
    expect(result.data[1]).toBeGreaterThan(0);
    expect(result.data[1]).toBeLessThan(1);
  });

  it('dispatches to histogram equalization', () => {
    const pixels = new Float64Array([1, 2, 3, 4, 5]);
    const result = applyScaling(pixels, { method: 'histogram' });
    expect(result.data.length).toBe(5);
    // Histogram: no underflow/overflow tracking
    expect(result.underflow).toEqual([]);
    expect(result.overflow).toEqual([]);
    expect(result.actualMin).toBe(1);
    expect(result.actualMax).toBe(5);
  });

  it('dispatches to zscale', () => {
    const pixels = new Float64Array(100);
    for (let i = 0; i < 100; i++) pixels[i] = i;
    const result = applyScaling(pixels, { method: 'zscale' });
    expect(result.data.length).toBe(100);
    for (let i = 0; i < result.data.length; i++) {
      expect(result.data[i]).toBeGreaterThanOrEqual(0);
      expect(result.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('dispatches to percentile with custom bounds', () => {
    const pixels = new Float64Array(100);
    for (let i = 0; i < 100; i++) pixels[i] = i;
    const result = applyScaling(pixels, {
      method: 'percentile',
      percentileLow: 10,
      percentileHigh: 90,
    });
    expect(result.actualMin).toBeGreaterThan(0);
    expect(result.actualMax).toBeLessThan(99);
    expect(result.underflow.length).toBeGreaterThan(0);
    expect(result.overflow.length).toBeGreaterThan(0);
  });

  it('uses default percentile bounds (0, 100) when not specified', () => {
    const pixels = new Float64Array([10, 20, 30, 40, 50]);
    const result = applyScaling(pixels, { method: 'percentile' });
    expect(result.actualMin).toBe(10);
    expect(result.actualMax).toBe(50);
    expect(result.underflow).toEqual([]);
    expect(result.overflow).toEqual([]);
  });

  it('respects explicit min/max override', () => {
    const pixels = new Float64Array([0, 50, 100]);
    const result = applyScaling(pixels, { method: 'linear', min: 20, max: 80 });
    expect(result.actualMin).toBe(20);
    expect(result.actualMax).toBe(80);
    expect(result.underflow).toEqual([0]); // 0 < 20
    expect(result.overflow).toEqual([2]); // 100 > 80
  });

  it('tracks underflow and overflow indices', () => {
    const pixels = new Float64Array([0, 5, 10, 15, 20]);
    const result = applyScaling(pixels, { method: 'linear', min: 5, max: 15 });
    expect(result.underflow).toEqual([0]);
    expect(result.overflow).toEqual([4]);
  });

  it('handles NaN and Infinity in input', () => {
    const pixels = new Float64Array([NaN, Infinity, -Infinity, 5, 10]);
    const result = applyScaling(pixels, { method: 'linear' });
    expect(result.data.length).toBe(5);
    for (let i = 0; i < result.data.length; i++) {
      expect(Number.isFinite(result.data[i])).toBe(true);
      expect(result.data[i]).toBeGreaterThanOrEqual(0);
      expect(result.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('handles all-same-value input', () => {
    const pixels = new Float64Array([7, 7, 7, 7]);
    const result = applyScaling(pixels, { method: 'linear' });
    for (let i = 0; i < result.data.length; i++) {
      expect(result.data[i]).toBe(0);
    }
  });

  it('zscale respects contrast parameter', () => {
    const pixels = new Float64Array(100);
    for (let i = 0; i < 100; i++) pixels[i] = i;
    const result = applyScaling(pixels, { method: 'zscale', zscaleContrast: 0.5 });
    expect(result.data.length).toBe(100);
    expect(Number.isFinite(result.actualMin)).toBe(true);
    expect(Number.isFinite(result.actualMax)).toBe(true);
  });

  it('zscale with explicit min/max overrides computed range', () => {
    const pixels = new Float64Array([0, 50, 100]);
    const result = applyScaling(pixels, { method: 'zscale', min: 10, max: 90 });
    expect(result.actualMin).toBe(10);
    expect(result.actualMax).toBe(90);
  });

  it('percentile with explicit min/max overrides computed range', () => {
    const pixels = new Float64Array([0, 50, 100]);
    const result = applyScaling(pixels, { method: 'percentile', min: 10, max: 90 });
    expect(result.actualMin).toBe(10);
    expect(result.actualMax).toBe(90);
  });

  it('histogram equalization with all same values returns 0.5', () => {
    const pixels = new Float64Array([3, 3, 3]);
    const result = applyScaling(pixels, { method: 'histogram' });
    for (let i = 0; i < result.data.length; i++) {
      expect(result.data[i]).toBeCloseTo(0.5);
    }
  });

  it('all scaling methods produce output in [0, 1]', () => {
    const methods = ['linear', 'log', 'sqrt', 'asinh'] as const;
    const pixels = new Float64Array([0, 1, 5, 10, 50, 100, 500, 1000]);
    for (const method of methods) {
      const result = applyScaling(pixels, { method });
      for (let i = 0; i < result.data.length; i++) {
        expect(result.data[i]).toBeGreaterThanOrEqual(0);
        expect(result.data[i]).toBeLessThanOrEqual(1);
      }
    }
  });
});
