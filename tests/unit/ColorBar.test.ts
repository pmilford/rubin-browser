import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ColorBar from '../../src/components/ColorBar.svelte';

// Mock canvas context for jsdom
const mockCtx = {
  imageSmoothingEnabled: true,
  drawImage: vi.fn(),
  putImageData: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
};

beforeEach(() => {
  vi.restoreAllMocks();
  // Override getContext to return our mock
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
    return mockCtx as unknown as CanvasRenderingContext2D;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe('ColorBar', () => {
  describe('rendering', () => {
    it('renders the color bar container', () => {
      render(ColorBar);
      const container = document.querySelector('.color-bar');
      expect(container).toBeTruthy();
    });

    it('renders a canvas element', () => {
      render(ColorBar);
      const canvas = screen.getByLabelText('Color map legend');
      expect(canvas).toBeTruthy();
      expect(canvas.tagName).toBe('CANVAS');
    });

    it('displays default min value', () => {
      render(ColorBar);
      const container = document.querySelector('.color-bar');
      expect(container?.textContent).toContain('0.00');
    });

    it('displays default max value', () => {
      render(ColorBar);
      const container = document.querySelector('.color-bar');
      expect(container?.textContent).toContain('1.00');
    });

    it('displays default color map name', () => {
      render(ColorBar);
      const container = document.querySelector('.color-bar');
      expect(container?.textContent).toContain('grayscale');
    });

    it('displays custom min/max values', () => {
      render(ColorBar, { props: { minValue: -5.5, maxValue: 100.25 } });
      const container = document.querySelector('.color-bar');
      expect(container?.textContent).toContain('-5.50');
      expect(container?.textContent).toContain('100.25');
    });

    it('displays custom color map name', () => {
      render(ColorBar, { props: { colorMap: 'viridis' } });
      const container = document.querySelector('.color-bar');
      expect(container?.textContent).toContain('viridis');
    });

    it('renders labels section', () => {
      render(ColorBar);
      const labels = document.querySelector('.labels');
      expect(labels).toBeTruthy();
    });

    it('renders map name with uppercase styling', () => {
      render(ColorBar, { props: { colorMap: 'plasma' } });
      const mapName = document.querySelector('.map-name');
      expect(mapName).toBeTruthy();
      expect(mapName?.textContent).toBe('plasma');
    });
  });

  describe('canvas interaction', () => {
    it('attempts to get 2d context', () => {
      render(ColorBar);
      expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d');
    });

    it('calls drawImage on canvas context', () => {
      render(ColorBar);
      // The $effect should have called drawImage
      expect(mockCtx.drawImage).toHaveBeenCalled();
    });
  });

  describe('with different color maps', () => {
    it.each(['grayscale', 'viridis', 'plasma', 'inferno', 'hot', 'cool'] as const)(
      'renders with %s color map',
      (name) => {
        render(ColorBar, { props: { colorMap: name } });
        const container = document.querySelector('.color-bar');
        expect(container?.textContent).toContain(name);
      }
    );
  });

  describe('edge cases', () => {
    it('handles zero min and max', () => {
      render(ColorBar, { props: { minValue: 0, maxValue: 0 } });
      const container = document.querySelector('.color-bar');
      expect(container?.textContent).toContain('0.00');
    });

    it('handles negative min and max', () => {
      render(ColorBar, { props: { minValue: -10, maxValue: -1 } });
      const container = document.querySelector('.color-bar');
      expect(container?.textContent).toContain('-10.00');
      expect(container?.textContent).toContain('-1.00');
    });

    it('handles very large values', () => {
      render(ColorBar, { props: { minValue: 1e6, maxValue: 1e7 } });
      const container = document.querySelector('.color-bar');
      expect(container?.textContent).toContain('1000000.00');
    });

    it('handles when getContext returns null', () => {
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
      // Should not throw when context is null
      render(ColorBar);
      const container = document.querySelector('.color-bar');
      expect(container).toBeTruthy();
      HTMLCanvasElement.prototype.getContext = origGetContext;
    });
  });
});
