import { describe, it, expect, beforeEach } from 'vitest';
import {
  resample,
  samplePixel,
  registerAiUpscaleHook,
  getAiUpscaleHooks,
  clearAiUpscaleHooks,
  cubicWeight,
  sinc,
  lanczosWeight,
} from '../../src/utils/interpolation.js';
import type { InterpolationMethod, AiUpscaleHook } from '../../src/types/image.js';

/** Helper: create a 2x2 image with known values */
function make2x2(): Float64Array {
  // [10, 20]
  // [30, 40]
  return new Float64Array([10, 20, 30, 40]);
}

/** Helper: create a 3x3 gradient image */
function make3x3(): Float64Array {
  // [0, 1, 2]
  // [3, 4, 5]
  // [6, 7, 8]
  return new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
}

/** Helper: create a 1x1 image */
function make1x1(value = 42): Float64Array {
  return new Float64Array([value]);
}

const allMethods: InterpolationMethod[] = ['nearest', 'bilinear', 'bicubic', 'lanczos'];

describe('samplePixel', () => {
  describe('at integer coordinates', () => {
    it.each(allMethods)('%s returns exact pixel value at integer coords', (method) => {
      const data = make3x3();
      expect(samplePixel(data, 3, 3, 0, 0, method)).toBeCloseTo(0, 5);
      expect(samplePixel(data, 3, 3, 1, 0, method)).toBeCloseTo(1, 5);
      expect(samplePixel(data, 3, 3, 2, 2, method)).toBeCloseTo(8, 5);
      expect(samplePixel(data, 3, 3, 1, 1, method)).toBeCloseTo(4, 5);
    });
  });

  describe('nearest neighbor', () => {
    it('rounds to nearest pixel', () => {
      const data = make2x2();
      // (0.3, 0.3) rounds to (0,0) = 10
      expect(samplePixel(data, 2, 2, 0.3, 0.3, 'nearest')).toBe(10);
      // (0.6, 0.6) rounds to (1,1) = 40
      expect(samplePixel(data, 2, 2, 0.6, 0.6, 'nearest')).toBe(40);
      // (1.4, 0.4) rounds to (1,0) = 20
      expect(samplePixel(data, 2, 2, 1.4, 0.4, 'nearest')).toBe(20);
    });

    it('produces blocky results — same value in blocks', () => {
      const data = make2x2();
      const upscaled = resample(data, 2, 2, 4, 4, 'nearest');
      // Top-left 2x2 block should all be 10
      expect(upscaled[0]).toBe(10);
      expect(upscaled[1]).toBe(10);
      expect(upscaled[4]).toBe(10);
      expect(upscaled[5]).toBe(10);
      // Top-right 2x2 block should all be 20
      expect(upscaled[2]).toBe(20);
      expect(upscaled[3]).toBe(20);
      expect(upscaled[6]).toBe(20);
      expect(upscaled[7]).toBe(20);
      // Bottom-left 2x2 block should all be 30
      expect(upscaled[8]).toBe(30);
      expect(upscaled[9]).toBe(30);
      expect(upscaled[12]).toBe(30);
      expect(upscaled[13]).toBe(30);
      // Bottom-right 2x2 block should all be 40
      expect(upscaled[10]).toBe(40);
      expect(upscaled[11]).toBe(40);
      expect(upscaled[14]).toBe(40);
      expect(upscaled[15]).toBe(40);
    });
  });

  describe('bilinear', () => {
    it('interpolates between four pixels', () => {
      const data = make2x2();
      // Center of 2x2: average of all four = 25
      const center = samplePixel(data, 2, 2, 0.5, 0.5, 'bilinear');
      expect(center).toBeCloseTo(25, 5);
    });

    it('produces smooth gradients', () => {
      const data = make2x2();
      const v1 = samplePixel(data, 2, 2, 0.25, 0, 'bilinear');
      const v2 = samplePixel(data, 2, 2, 0.5, 0, 'bilinear');
      const v3 = samplePixel(data, 2, 2, 0.75, 0, 'bilinear');
      // Should increase monotonically from 10 toward 20
      expect(v1).toBeGreaterThan(10);
      expect(v2).toBeGreaterThan(v1);
      expect(v3).toBeGreaterThan(v2);
      expect(v3).toBeLessThan(20);
    });

    it('returns exact value at pixel center', () => {
      const data = make2x2();
      expect(samplePixel(data, 2, 2, 0, 0, 'bilinear')).toBeCloseTo(10, 5);
      expect(samplePixel(data, 2, 2, 1, 1, 'bilinear')).toBeCloseTo(40, 5);
    });
  });

  describe('bicubic', () => {
    it('interpolates smoothly with 4x4 neighborhood', () => {
      const data = make3x3();
      const center = samplePixel(data, 3, 3, 1, 1, 'bicubic');
      expect(center).toBeCloseTo(4, 5);
    });

    it('produces values at fractional coordinates', () => {
      const data = make3x3();
      const val = samplePixel(data, 3, 3, 0.5, 0.5, 'bicubic');
      // Should be close to bilinear result for smooth data
      expect(val).toBeGreaterThan(0);
      expect(val).toBeLessThan(8);
    });
  });

  describe('lanczos', () => {
    it('returns exact value at integer coordinates', () => {
      const data = make3x3();
      expect(samplePixel(data, 3, 3, 1, 1, 'lanczos')).toBeCloseTo(4, 4);
    });

    it('produces interpolated values at fractional coordinates', () => {
      const data = make3x3();
      const val = samplePixel(data, 3, 3, 0.5, 0.5, 'lanczos');
      expect(val).toBeGreaterThan(0);
      expect(val).toBeLessThan(8);
    });

    it('handles edges gracefully', () => {
      const data = make3x3();
      // Near edge — should not throw
      const val = samplePixel(data, 3, 3, 0, 0, 'lanczos');
      expect(val).toBeCloseTo(0, 3);
    });
  });

  describe('edge clamping', () => {
    it.each(allMethods)('%s clamps negative coordinates to 0', (method) => {
      const data = make2x2();
      const atOrigin = samplePixel(data, 2, 2, 0, 0, method);
      const atNegative = samplePixel(data, 2, 2, -5, -5, method);
      expect(atNegative).toBeCloseTo(atOrigin, 3);
    });

    it.each(allMethods)('%s clamps coordinates beyond image bounds', (method) => {
      const data = make2x2();
      const atCorner = samplePixel(data, 2, 2, 1, 1, method);
      const atBeyond = samplePixel(data, 2, 2, 10, 10, method);
      expect(atBeyond).toBeCloseTo(atCorner, 3);
    });
  });

  describe('empty and degenerate inputs', () => {
    it.each(allMethods)('%s returns 0 for empty data', (method) => {
      expect(samplePixel(new Float64Array(0), 0, 0, 0, 0, method)).toBe(0);
    });

    it.each(allMethods)('%s handles 1x1 image', (method) => {
      const data = make1x1(42);
      expect(samplePixel(data, 1, 1, 0, 0, method)).toBeCloseTo(42, 3);
    });

    it.each(allMethods)('%s returns same value for 1x1 at any coordinate', (method) => {
      const data = make1x1(7);
      expect(samplePixel(data, 1, 1, 5, 5, method)).toBeCloseTo(7, 3);
      expect(samplePixel(data, 1, 1, -3, -3, method)).toBeCloseTo(7, 3);
    });
  });
});

describe('resample', () => {
  describe('upscaling', () => {
    it.each(allMethods)('%s upscales 2x2 to 4x4', (method) => {
      const data = make2x2();
      const result = resample(data, 2, 2, 4, 4, method);
      expect(result).toHaveLength(16);
    });

    it('nearest neighbor upscale preserves block structure', () => {
      const data = make2x2();
      const result = resample(data, 2, 2, 4, 4, 'nearest');
      // Each source pixel maps to a 2x2 block
      expect(result[0]).toBe(10);
      expect(result[1]).toBe(10);
      expect(result[4]).toBe(10);
      expect(result[5]).toBe(10);
    });

    it('bilinear upscale produces smooth intermediate values', () => {
      const data = make2x2();
      const result = resample(data, 2, 2, 4, 4, 'bilinear');
      // Interior pixels should be between min and max of source
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(9);
        expect(result[i]).toBeLessThanOrEqual(41);
      }
    });
  });

  describe('downscaling', () => {
    it.each(allMethods)('%s downscales 4x4 to 2x2', (method) => {
      // Uniform 4x4 image with value 5
      const data = new Float64Array(16).fill(5);
      const result = resample(data, 4, 4, 2, 2, method);
      expect(result).toHaveLength(4);
      // Uniform image should remain uniform after downscaling
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeCloseTo(5, 3);
      }
    });

    it('nearest downscale picks representative pixels', () => {
      const data = make3x3();
      const result = resample(data, 3, 3, 2, 2, 'nearest');
      expect(result).toHaveLength(4);
    });
  });

  describe('identity', () => {
    it.each(allMethods)('%s resampling to same size preserves values approximately', (method) => {
      const data = make3x3();
      const result = resample(data, 3, 3, 3, 3, method);
      expect(result).toHaveLength(9);
      for (let i = 0; i < data.length; i++) {
        expect(result[i]).toBeCloseTo(data[i], 1);
      }
    });
  });

  describe('empty and degenerate inputs', () => {
    it.each(allMethods)('%s returns empty for empty input', (method) => {
      const result = resample(new Float64Array(0), 0, 0, 4, 4, method);
      expect(result).toHaveLength(0);
    });

    it.each(allMethods)('%s returns empty for zero destination width', (method) => {
      const result = resample(make2x2(), 2, 2, 0, 4, method);
      expect(result).toHaveLength(0);
    });

    it.each(allMethods)('%s returns empty for zero destination height', (method) => {
      const result = resample(make2x2(), 2, 2, 4, 0, method);
      expect(result).toHaveLength(0);
    });

    it.each(allMethods)('%s returns empty for zero source dimensions', (method) => {
      const result = resample(new Float64Array(0), 0, 0, 2, 2, method);
      expect(result).toHaveLength(0);
    });

    it.each(allMethods)('%s handles 1x1 upscale', (method) => {
      const data = make1x1(42);
      const result = resample(data, 1, 1, 3, 3, method);
      expect(result).toHaveLength(9);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeCloseTo(42, 3);
      }
    });
  });

  describe('non-square resampling', () => {
    it('handles non-square source to non-square dest', () => {
      // 3x2 image
      const data = new Float64Array([1, 2, 3, 4, 5, 6]);
      const result = resample(data, 3, 2, 6, 4, 'bilinear');
      expect(result).toHaveLength(24);
    });
  });
});

describe('cubicWeight', () => {
  it('returns 1 at t=0', () => {
    expect(cubicWeight(0)).toBeCloseTo(1, 10);
  });

  it('returns correct value for |t| <= 1', () => {
    const w = cubicWeight(0.5);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
  });

  it('returns correct value for 1 < |t| <= 2', () => {
    const w = cubicWeight(1.5);
    expect(typeof w).toBe('number');
    // Catmull-Rom at 1.5 should be negative (overshoot)
    expect(w).toBeLessThan(0);
  });

  it('returns 0 for |t| > 2', () => {
    expect(cubicWeight(2.5)).toBe(0);
    expect(cubicWeight(3)).toBe(0);
    expect(cubicWeight(-2.5)).toBe(0);
  });

  it('is symmetric', () => {
    expect(cubicWeight(0.7)).toBeCloseTo(cubicWeight(-0.7), 10);
    expect(cubicWeight(1.3)).toBeCloseTo(cubicWeight(-1.3), 10);
  });
});

describe('sinc', () => {
  it('returns 1 at x=0', () => {
    expect(sinc(0)).toBe(1);
  });

  it('returns 0 at integer values', () => {
    expect(sinc(1)).toBeCloseTo(0, 10);
    expect(sinc(2)).toBeCloseTo(0, 10);
    expect(sinc(-3)).toBeCloseTo(0, 10);
  });

  it('returns non-zero at fractional values', () => {
    expect(sinc(0.5)).not.toBe(0);
  });
});

describe('lanczosWeight', () => {
  it('returns 1 at x=0', () => {
    expect(lanczosWeight(0)).toBeCloseTo(1, 10);
  });

  it('returns 0 at |x| >= 3', () => {
    expect(lanczosWeight(3)).toBe(0);
    expect(lanczosWeight(-3)).toBe(0);
    expect(lanczosWeight(4)).toBe(0);
  });

  it('returns non-zero for |x| < 3', () => {
    expect(lanczosWeight(0.5)).not.toBe(0);
    expect(lanczosWeight(2.5)).not.toBe(0);
  });
});

describe('AI upscale hooks', () => {
  beforeEach(() => {
    clearAiUpscaleHooks();
  });

  it('starts with no hooks', () => {
    expect(getAiUpscaleHooks()).toHaveLength(0);
  });

  it('registers a hook', () => {
    const hook: AiUpscaleHook = {
      name: 'test-upscaler',
      upscale: async (data) => data,
    };
    registerAiUpscaleHook(hook);
    const hooks = getAiUpscaleHooks();
    expect(hooks).toHaveLength(1);
    expect(hooks[0].name).toBe('test-upscaler');
  });

  it('registers multiple hooks', () => {
    registerAiUpscaleHook({ name: 'hook1', upscale: async (d) => d });
    registerAiUpscaleHook({ name: 'hook2', upscale: async (d) => d });
    expect(getAiUpscaleHooks()).toHaveLength(2);
  });

  it('returns a copy of hooks array (not mutable reference)', () => {
    registerAiUpscaleHook({ name: 'hook1', upscale: async (d) => d });
    const hooks = getAiUpscaleHooks();
    hooks.push({ name: 'rogue', upscale: async (d) => d });
    expect(getAiUpscaleHooks()).toHaveLength(1);
  });

  it('clears all hooks', () => {
    registerAiUpscaleHook({ name: 'hook1', upscale: async (d) => d });
    registerAiUpscaleHook({ name: 'hook2', upscale: async (d) => d });
    clearAiUpscaleHooks();
    expect(getAiUpscaleHooks()).toHaveLength(0);
  });

  it('hook upscale function is callable', async () => {
    const hook: AiUpscaleHook = {
      name: 'doubler',
      upscale: async (data, width, height, scaleFactor) => {
        const newWidth = width * scaleFactor;
        const newHeight = height * scaleFactor;
        return new Float64Array(newWidth * newHeight);
      },
    };
    registerAiUpscaleHook(hook);
    const result = await getAiUpscaleHooks()[0].upscale(
      new Float64Array([1, 2, 3, 4]),
      2,
      2,
      2
    );
    expect(result).toHaveLength(16);
  });
});
