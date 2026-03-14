import { describe, it, expect } from 'vitest';
import {
  getColorMap,
  getColorMapNames,
  applyColorMap,
  generateColorBar,
  interpolateColorMap,
} from '../../src/utils/colormap.js';

describe('interpolateColorMap', () => {
  const stops = [
    { t: 0, color: { r: 0, g: 0, b: 0 } },
    { t: 0.5, color: { r: 100, g: 200, b: 50 } },
    { t: 1, color: { r: 255, g: 255, b: 255 } },
  ];

  it('returns first stop color at t=0', () => {
    expect(interpolateColorMap(stops, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns last stop color at t=1', () => {
    expect(interpolateColorMap(stops, 1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('interpolates between stops at t=0.25', () => {
    const color = interpolateColorMap(stops, 0.25);
    expect(color.r).toBe(50);
    expect(color.g).toBe(100);
    expect(color.b).toBe(25);
  });

  it('clamps t < 0 to first stop', () => {
    expect(interpolateColorMap(stops, -0.5)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('clamps t > 1 to last stop', () => {
    expect(interpolateColorMap(stops, 1.5)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('treats NaN as 0', () => {
    expect(interpolateColorMap(stops, NaN)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns exact stop color when value matches a stop', () => {
    expect(interpolateColorMap(stops, 0.5)).toEqual({ r: 100, g: 200, b: 50 });
  });
});

describe('getColorMapNames', () => {
  it('returns all 9 color map names', () => {
    const names = getColorMapNames();
    expect(names).toHaveLength(9);
    expect(names).toContain('grayscale');
    expect(names).toContain('viridis');
    expect(names).toContain('plasma');
    expect(names).toContain('inferno');
    expect(names).toContain('hot');
    expect(names).toContain('cool');
    expect(names).toContain('red');
    expect(names).toContain('green');
    expect(names).toContain('blue');
  });
});

describe('getColorMap', () => {
  it('returns a valid ColorMap for each name', () => {
    for (const name of getColorMapNames()) {
      const cm = getColorMap(name);
      expect(cm.name).toBe(name);
      expect(typeof cm.lookup).toBe('function');
    }
  });
});

describe('grayscale color map', () => {
  const cm = getColorMap('grayscale');

  it('returns black at t=0', () => {
    expect(cm.lookup(0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns white at t=1', () => {
    expect(cm.lookup(1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns mid-gray at t=0.5', () => {
    const color = cm.lookup(0.5);
    expect(color.r).toBe(color.g);
    expect(color.g).toBe(color.b);
    expect(color.r).toBe(128);
  });

  it('maintains r === g === b at all points', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const color = cm.lookup(t);
      expect(color.r).toBe(color.g);
      expect(color.g).toBe(color.b);
    }
  });
});

describe('viridis color map', () => {
  const cm = getColorMap('viridis');

  it('returns dark purple at t=0', () => {
    expect(cm.lookup(0)).toEqual({ r: 68, g: 1, b: 84 });
  });

  it('returns yellow at t=1', () => {
    expect(cm.lookup(1)).toEqual({ r: 253, g: 231, b: 37 });
  });

  it('returns teal-green at t=0.5', () => {
    expect(cm.lookup(0.5)).toEqual({ r: 31, g: 161, b: 135 });
  });
});

describe('plasma color map', () => {
  const cm = getColorMap('plasma');

  it('returns dark blue at t=0', () => {
    expect(cm.lookup(0)).toEqual({ r: 13, g: 8, b: 135 });
  });

  it('returns yellow at t=1', () => {
    expect(cm.lookup(1)).toEqual({ r: 240, g: 249, b: 33 });
  });

  it('returns pink-red at t=0.5', () => {
    expect(cm.lookup(0.5)).toEqual({ r: 219, g: 92, b: 104 });
  });
});

describe('inferno color map', () => {
  const cm = getColorMap('inferno');

  it('returns near-black at t=0', () => {
    expect(cm.lookup(0)).toEqual({ r: 0, g: 0, b: 4 });
  });

  it('returns pale yellow at t=1', () => {
    expect(cm.lookup(1)).toEqual({ r: 252, g: 255, b: 164 });
  });

  it('returns red-orange at t=0.5', () => {
    expect(cm.lookup(0.5)).toEqual({ r: 212, g: 72, b: 66 });
  });
});

describe('hot color map', () => {
  const cm = getColorMap('hot');

  it('returns black at t=0', () => {
    expect(cm.lookup(0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns white at t=1', () => {
    expect(cm.lookup(1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns red at t=0.33', () => {
    expect(cm.lookup(0.33)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('returns yellow at t=0.67', () => {
    expect(cm.lookup(0.67)).toEqual({ r: 255, g: 255, b: 0 });
  });
});

describe('cool color map', () => {
  const cm = getColorMap('cool');

  it('returns cyan at t=0', () => {
    expect(cm.lookup(0)).toEqual({ r: 0, g: 255, b: 255 });
  });

  it('returns magenta at t=1', () => {
    expect(cm.lookup(1)).toEqual({ r: 255, g: 0, b: 255 });
  });

  it('returns middle blend at t=0.5', () => {
    const color = cm.lookup(0.5);
    expect(color.r).toBe(128);
    expect(color.g).toBe(128);
    expect(color.b).toBe(255);
  });
});

describe('red color map (RGB channel)', () => {
  const cm = getColorMap('red');

  it('returns black at t=0', () => {
    expect(cm.lookup(0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns pure red at t=1', () => {
    expect(cm.lookup(1)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('only has red channel active', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const color = cm.lookup(t);
      expect(color.g).toBe(0);
      expect(color.b).toBe(0);
    }
  });
});

describe('green color map (RGB channel)', () => {
  const cm = getColorMap('green');

  it('returns black at t=0', () => {
    expect(cm.lookup(0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns pure green at t=1', () => {
    expect(cm.lookup(1)).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('only has green channel active', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const color = cm.lookup(t);
      expect(color.r).toBe(0);
      expect(color.b).toBe(0);
    }
  });
});

describe('blue color map (RGB channel)', () => {
  const cm = getColorMap('blue');

  it('returns black at t=0', () => {
    expect(cm.lookup(0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns pure blue at t=1', () => {
    expect(cm.lookup(1)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('only has blue channel active', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const color = cm.lookup(t);
      expect(color.r).toBe(0);
      expect(color.g).toBe(0);
    }
  });
});

describe('applyColorMap', () => {
  it('produces correct length output (4 bytes per pixel)', () => {
    const data = new Float64Array([0, 0.5, 1]);
    const result = applyColorMap(data, 'grayscale');
    expect(result.length).toBe(12);
  });

  it('sets alpha to 255 for every pixel', () => {
    const data = new Float64Array([0, 0.25, 0.5, 0.75, 1]);
    const result = applyColorMap(data, 'viridis');
    for (let i = 0; i < data.length; i++) {
      expect(result[i * 4 + 3]).toBe(255);
    }
  });

  it('produces correct RGBA values for grayscale', () => {
    const data = new Float64Array([0, 1]);
    const result = applyColorMap(data, 'grayscale');
    // Pixel 0: black
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(255);
    // Pixel 1: white
    expect(result[4]).toBe(255);
    expect(result[5]).toBe(255);
    expect(result[6]).toBe(255);
    expect(result[7]).toBe(255);
  });

  it('handles NaN values as 0 (black for grayscale)', () => {
    const data = new Float64Array([NaN]);
    const result = applyColorMap(data, 'grayscale');
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(255);
  });

  it('clamps out-of-range values', () => {
    const data = new Float64Array([-1, 2]);
    const result = applyColorMap(data, 'grayscale');
    // -1 clamped to 0 → black
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    // 2 clamped to 1 → white
    expect(result[4]).toBe(255);
    expect(result[5]).toBe(255);
    expect(result[6]).toBe(255);
  });

  it('returns empty Uint8ClampedArray for empty data', () => {
    const data = new Float64Array(0);
    const result = applyColorMap(data, 'grayscale');
    expect(result.length).toBe(0);
    expect(result).toBeInstanceOf(Uint8ClampedArray);
  });
});

describe('generateColorBar', () => {
  it('produces 1024 bytes (256 pixels * 4 RGBA)', () => {
    const bar = generateColorBar('grayscale');
    expect(bar.length).toBe(1024);
  });

  it('sets alpha to 255 for all pixels', () => {
    const bar = generateColorBar('hot');
    for (let i = 0; i < 256; i++) {
      expect(bar[i * 4 + 3]).toBe(255);
    }
  });

  it('starts with first color and ends with last color for grayscale', () => {
    const bar = generateColorBar('grayscale');
    // First pixel: black
    expect(bar[0]).toBe(0);
    expect(bar[1]).toBe(0);
    expect(bar[2]).toBe(0);
    // Last pixel: white
    expect(bar[1020]).toBe(255);
    expect(bar[1021]).toBe(255);
    expect(bar[1022]).toBe(255);
  });

  it('starts with cyan and ends with magenta for cool', () => {
    const bar = generateColorBar('cool');
    expect(bar[0]).toBe(0);
    expect(bar[1]).toBe(255);
    expect(bar[2]).toBe(255);
    expect(bar[1020]).toBe(255);
    expect(bar[1021]).toBe(0);
    expect(bar[1022]).toBe(255);
  });

  it('works for all color maps', () => {
    for (const name of getColorMapNames()) {
      const bar = generateColorBar(name);
      expect(bar.length).toBe(1024);
    }
  });
});
