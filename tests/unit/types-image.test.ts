import { describe, it, expect } from 'vitest';
import {
  isScalingFunction,
  isColorMapName,
  isInterpolationMethod,
  isValidScalingParams,
  isHipsTile,
  isHipsProperties,
  isViewerState,
} from '../../src/types/image.js';

describe('isScalingFunction', () => {
  it.each(['linear', 'log', 'sqrt', 'asinh', 'sinh', 'mtf', 'histogram', 'zscale', 'percentile'] as const)(
    'accepts %s',
    (name) => {
      expect(isScalingFunction(name)).toBe(true);
    }
  );

  it('rejects empty string', () => {
    expect(isScalingFunction('')).toBe(false);
  });

  it('rejects unknown function', () => {
    expect(isScalingFunction('power')).toBe(false);
  });

  it('rejects uppercase variant', () => {
    expect(isScalingFunction('Linear')).toBe(false);
  });
});

describe('isColorMapName', () => {
  it.each(['grayscale', 'viridis', 'plasma', 'inferno', 'hot', 'cool'] as const)(
    'accepts %s',
    (name) => {
      expect(isColorMapName(name)).toBe(true);
    }
  );

  it('rejects empty string', () => {
    expect(isColorMapName('')).toBe(false);
  });

  it('rejects unknown colormap', () => {
    expect(isColorMapName('jet')).toBe(false);
  });
});

describe('isInterpolationMethod', () => {
  it.each(['nearest', 'bilinear', 'bicubic', 'lanczos'] as const)(
    'accepts %s',
    (name) => {
      expect(isInterpolationMethod(name)).toBe(true);
    }
  );

  it('rejects empty string', () => {
    expect(isInterpolationMethod('')).toBe(false);
  });

  it('rejects unknown method', () => {
    expect(isInterpolationMethod('spline')).toBe(false);
  });
});

describe('isValidScalingParams', () => {
  it('accepts valid params with just method', () => {
    expect(isValidScalingParams({ method: 'linear' })).toBe(true);
  });

  it('accepts params with min/max', () => {
    expect(isValidScalingParams({ method: 'log', min: 0, max: 100 })).toBe(true);
  });

  it('accepts params with percentile fields', () => {
    expect(isValidScalingParams({
      method: 'percentile',
      percentileLow: 1,
      percentileHigh: 99,
    })).toBe(true);
  });

  it('accepts params with zscale contrast', () => {
    expect(isValidScalingParams({ method: 'zscale', zscaleContrast: 0.25 })).toBe(true);
  });

  it('accepts params with all optional fields', () => {
    expect(isValidScalingParams({
      method: 'linear',
      min: 0,
      max: 100,
      percentileLow: 5,
      percentileHigh: 95,
      zscaleContrast: 0.5,
    })).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidScalingParams(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidScalingParams(undefined)).toBe(false);
  });

  it('rejects invalid method', () => {
    expect(isValidScalingParams({ method: 'invalid' })).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidScalingParams('linear')).toBe(false);
  });

  it('rejects missing method', () => {
    expect(isValidScalingParams({ min: 0 })).toBe(false);
  });

  it('rejects string min', () => {
    expect(isValidScalingParams({ method: 'linear', min: '0' })).toBe(false);
  });

  it('rejects string max', () => {
    expect(isValidScalingParams({ method: 'linear', max: '100' })).toBe(false);
  });

  it('rejects string percentileLow', () => {
    expect(isValidScalingParams({ method: 'percentile', percentileLow: '1' })).toBe(false);
  });

  it('rejects string percentileHigh', () => {
    expect(isValidScalingParams({ method: 'percentile', percentileHigh: '99' })).toBe(false);
  });

  it('rejects string zscaleContrast', () => {
    expect(isValidScalingParams({ method: 'zscale', zscaleContrast: '0.25' })).toBe(false);
  });

  it('accepts params with softening', () => {
    expect(isValidScalingParams({ method: 'asinh', softening: 0.1 })).toBe(true);
  });

  it('rejects string softening', () => {
    expect(isValidScalingParams({ method: 'asinh', softening: '0.1' })).toBe(false);
  });

  it('accepts params with midtone', () => {
    expect(isValidScalingParams({ method: 'mtf', midtone: 0.3 })).toBe(true);
  });

  it('rejects string midtone', () => {
    expect(isValidScalingParams({ method: 'mtf', midtone: '0.3' })).toBe(false);
  });

  it('accepts params with logBase', () => {
    expect(isValidScalingParams({ method: 'log', logBase: 1000 })).toBe(true);
  });

  it('rejects string logBase', () => {
    expect(isValidScalingParams({ method: 'log', logBase: '1000' })).toBe(false);
  });
});

describe('isHipsTile', () => {
  const validTile = { order: 3, pixelIndex: 42, url: 'https://example.com/tile.png', format: 'png' as const };

  it('accepts valid tile', () => {
    expect(isHipsTile(validTile)).toBe(true);
  });

  it('accepts jpg format', () => {
    expect(isHipsTile({ ...validTile, format: 'jpg' })).toBe(true);
  });

  it('accepts fits format', () => {
    expect(isHipsTile({ ...validTile, format: 'fits' })).toBe(true);
  });

  it('rejects null', () => {
    expect(isHipsTile(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isHipsTile(undefined)).toBe(false);
  });

  it('rejects invalid format', () => {
    expect(isHipsTile({ ...validTile, format: 'gif' })).toBe(false);
  });

  it('rejects non-numeric order', () => {
    expect(isHipsTile({ ...validTile, order: '3' })).toBe(false);
  });

  it('rejects non-string url', () => {
    expect(isHipsTile({ ...validTile, url: 42 })).toBe(false);
  });

  it('rejects empty object', () => {
    expect(isHipsTile({})).toBe(false);
  });
});

describe('isHipsProperties', () => {
  const validProps = {
    title: 'Test Survey',
    hipsOrder: 7,
    tileFormat: 'png',
    frame: 'equatorial',
    tileWidth: 512,
  };

  it('accepts valid properties', () => {
    expect(isHipsProperties(validProps)).toBe(true);
  });

  it('rejects null', () => {
    expect(isHipsProperties(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isHipsProperties(undefined)).toBe(false);
  });

  it('rejects non-string title', () => {
    expect(isHipsProperties({ ...validProps, title: 42 })).toBe(false);
  });

  it('rejects non-numeric hipsOrder', () => {
    expect(isHipsProperties({ ...validProps, hipsOrder: '7' })).toBe(false);
  });

  it('rejects non-numeric tileWidth', () => {
    expect(isHipsProperties({ ...validProps, tileWidth: '512' })).toBe(false);
  });

  it('rejects empty object', () => {
    expect(isHipsProperties({})).toBe(false);
  });
});

describe('isViewerState', () => {
  const validState = {
    centerRa: 62.0,
    centerDec: -37.0,
    zoomLevel: 3,
    scaling: { method: 'linear' },
    colorMap: 'grayscale',
    interpolation: 'bilinear',
  };

  it('accepts valid viewer state', () => {
    expect(isViewerState(validState)).toBe(true);
  });

  it('accepts state with full scaling params', () => {
    expect(isViewerState({
      ...validState,
      scaling: { method: 'log', min: 0, max: 100 },
    })).toBe(true);
  });

  it('rejects null', () => {
    expect(isViewerState(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isViewerState(undefined)).toBe(false);
  });

  it('rejects non-numeric centerRa', () => {
    expect(isViewerState({ ...validState, centerRa: '62' })).toBe(false);
  });

  it('rejects non-numeric centerDec', () => {
    expect(isViewerState({ ...validState, centerDec: '-37' })).toBe(false);
  });

  it('rejects non-numeric zoomLevel', () => {
    expect(isViewerState({ ...validState, zoomLevel: '3' })).toBe(false);
  });

  it('rejects invalid scaling', () => {
    expect(isViewerState({ ...validState, scaling: 'linear' })).toBe(false);
  });

  it('rejects invalid colorMap', () => {
    expect(isViewerState({ ...validState, colorMap: 'invalid' })).toBe(false);
  });

  it('rejects invalid interpolation', () => {
    expect(isViewerState({ ...validState, interpolation: 'invalid' })).toBe(false);
  });

  it('rejects empty object', () => {
    expect(isViewerState({})).toBe(false);
  });
});
