import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ImageViewer from '../../src/components/ImageViewer.svelte';

// Create mock OpenSeadragon viewer
const createMockViewer = () => {
  const handlers: Record<string, Function[]> = {};
  return {
    viewport: {
      zoomBy: vi.fn(),
      applyConstraints: vi.fn(),
      goHome: vi.fn(),
      panTo: vi.fn(),
      zoomTo: vi.fn(),
      getCenter: vi.fn(() => ({ x: 0.5, y: 0.5 })),
    },
    addHandler: vi.fn((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    destroy: vi.fn(),
    _trigger: (event: string, data?: Record<string, unknown>) => {
      (handlers[event] || []).forEach(h => h(data || {}));
    },
  };
};

let mockViewer: ReturnType<typeof createMockViewer>;

vi.mock('openseadragon', () => {
  const OpenSeadragonFn = vi.fn(() => {
    mockViewer = createMockViewer();
    return mockViewer;
  });
  // Add Point constructor to the default export
  (OpenSeadragonFn as any).Point = vi.fn((x: number, y: number) => ({ x, y }));
  return {
    default: OpenSeadragonFn,
  };
});

// Import after mock setup
import OpenSeadragon from 'openseadragon';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImageViewer', () => {
  describe('rendering', () => {
    it('renders the viewer container', () => {
      render(ImageViewer);
      const container = document.querySelector('.image-viewer');
      expect(container).toBeTruthy();
    });

    it('initializes OpenSeadragon', () => {
      render(ImageViewer);
      expect(OpenSeadragon).toHaveBeenCalled();
    });

    it('passes custom initial coordinates', () => {
      render(ImageViewer, { props: { initialRa: 180, initialDec: 45, initialZoom: 5 } });
      expect(OpenSeadragon).toHaveBeenCalled();
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(config.element).toBeTruthy();
    });

    it('uses public HiPS as default (no token)', () => {
      render(ImageViewer);
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const url = config.tileSources.getTileUrl(3, 0, 0);
      expect(url).toContain('https://alasky.cds.unistra.fr/DSS/DSSColor');
    });

    it('uses Rubin HiPS when rspToken is provided', () => {
      render(ImageViewer, { props: { rspToken: 'test-token-123' } });
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const url = config.tileSources.getTileUrl(3, 0, 0);
      expect(url).toContain('https://data.lsst.cloud/api/hips/images/color_gri');
    });

    it('includes auth header when rspToken is provided', () => {
      render(ImageViewer, { props: { rspToken: 'test-token-123' } });
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(config.tileSources.ajaxHeaders).toEqual({ 'Authorization': 'Bearer test-token-123' });
    });

    it('does not include auth header when no token', () => {
      render(ImageViewer);
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(config.tileSources.ajaxHeaders).toBeUndefined();
    });

    it('uses custom HiPS base URL when specified', () => {
      render(ImageViewer, { props: { hipsBaseUrl: 'https://example.com/hips/custom' } });
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const url = config.tileSources.getTileUrl(3, 0, 0);
      expect(url).toContain('https://example.com/hips/custom');
    });

    it('does not show error overlay initially', () => {
      render(ImageViewer);
      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeFalsy();
    });
  });

  describe('tile URL generation', () => {
    it('generates correct tile URL structure', () => {
      render(ImageViewer);
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const url = config.tileSources.getTileUrl(5, 42, 10);
      expect(url).toContain('Norder');
      expect(url).toContain('Dir');
      expect(url).toContain('Npix');
      expect(url).toMatch(/\.(png|jpg|jpeg)$/);
    });

    it('calculates order from level (level - 1)', () => {
      render(ImageViewer);
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const url = config.tileSources.getTileUrl(1, 0, 0);
      expect(url).toContain('Norder0');
    });

    it('clamps order to minimum 0', () => {
      render(ImageViewer);
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // level=0 would give order=-1, should be clamped to 0
      const url = config.tileSources.getTileUrl(0, 0, 0);
      expect(url).toContain('Norder0');
    });
  });

  describe('OpenSeadragon configuration', () => {
    it('disables default navigation controls', () => {
      render(ImageViewer);
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(config.showNavigationControl).toBe(false);
    });

    it('enables navigator', () => {
      render(ImageViewer);
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(config.showNavigator).toBe(true);
      expect(config.navigatorPosition).toBe('BOTTOM_RIGHT');
    });

    it('sets zoom limits', () => {
      render(ImageViewer);
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(config.minZoomLevel).toBe(0.5);
      expect(config.maxZoomLevel).toBe(40);
    });

    it('enables horizontal wrapping', () => {
      render(ImageViewer);
      const config = (OpenSeadragon as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(config.wrapHorizontal).toBe(true);
    });
  });

  describe('exported methods', () => {
    it('zoomIn calls viewport.zoomBy with 1.5', async () => {
      const { component } = render(ImageViewer);
      (component as unknown as ImageViewer).zoomIn();
      expect(mockViewer.viewport.zoomBy).toHaveBeenCalledWith(1.5);
      expect(mockViewer.viewport.applyConstraints).toHaveBeenCalled();
    });

    it('zoomOut calls viewport.zoomBy with 1/1.5', async () => {
      const { component } = render(ImageViewer);
      (component as unknown as ImageViewer).zoomOut();
      expect(mockViewer.viewport.zoomBy).toHaveBeenCalledWith(1 / 1.5);
      expect(mockViewer.viewport.applyConstraints).toHaveBeenCalled();
    });

    it('resetView calls viewport.goHome', async () => {
      const { component } = render(ImageViewer);
      (component as unknown as ImageViewer).resetView();
      expect(mockViewer.viewport.goHome).toHaveBeenCalled();
    });

    it('panTo calls viewport.panTo with converted coordinates', async () => {
      const { component } = render(ImageViewer);
      (component as unknown as ImageViewer).panTo(180, 45);
      expect(mockViewer.viewport.panTo).toHaveBeenCalled();
      expect(mockViewer.viewport.applyConstraints).toHaveBeenCalled();
    });

    it('setZoom calls viewport.zoomTo', async () => {
      const { component } = render(ImageViewer);
      (component as unknown as ImageViewer).setZoom(10);
      expect(mockViewer.viewport.zoomTo).toHaveBeenCalledWith(10);
      expect(mockViewer.viewport.applyConstraints).toHaveBeenCalled();
    });

    it('shows error overlay when OpenSeadragon throws', () => {
      (OpenSeadragon as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('OSD init failed');
      });

      render(ImageViewer);
      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('OSD init failed');
    });

    it('handles non-Error exception in catch block', () => {
      (OpenSeadragon as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw 'string error';
      });

      render(ImageViewer);
      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('Failed to initialize viewer');
    });
  });

  describe('event handlers', () => {
    it('registers zoom handler', () => {
      render(ImageViewer);
      expect(mockViewer.addHandler).toHaveBeenCalledWith('zoom', expect.any(Function));
    });

    it('registers pan handler', () => {
      render(ImageViewer);
      expect(mockViewer.addHandler).toHaveBeenCalledWith('pan', expect.any(Function));
    });

    it('registers open handler', () => {
      render(ImageViewer);
      expect(mockViewer.addHandler).toHaveBeenCalledWith('open', expect.any(Function));
    });

    it('registers open-failed handler', () => {
      render(ImageViewer);
      expect(mockViewer.addHandler).toHaveBeenCalledWith('open-failed', expect.any(Function));
    });

    it('registers tile-load-failed handler', () => {
      render(ImageViewer);
      expect(mockViewer.addHandler).toHaveBeenCalledWith('tile-load-failed', expect.any(Function));
    });

    it('registers tile-load-failed handler', () => {
      render(ImageViewer);
      expect(mockViewer.addHandler).toHaveBeenCalledWith('tile-load-failed', expect.any(Function));
    });

    it('calls onViewerStateChange when pan occurs', () => {
      const onViewerStateChange = vi.fn();
      render(ImageViewer, { props: { onViewerStateChange } });

      // Trigger the pan handler on the current mock viewer
      mockViewer._trigger('pan');

      expect(onViewerStateChange).toHaveBeenCalled();
    });

    it('calls onViewerStateChange when zoom occurs', () => {
      const onViewerStateChange = vi.fn();
      render(ImageViewer, { props: { onViewerStateChange } });

      mockViewer._trigger('zoom', { zoom: 5 });

      expect(onViewerStateChange).toHaveBeenCalled();
    });

    it('registers open event handler that clears errors', () => {
      render(ImageViewer);
      // Verify the handler was registered
      expect(mockViewer.addHandler).toHaveBeenCalledWith('open', expect.any(Function));
    });

    it('registers open-failed event handler', () => {
      render(ImageViewer);
      expect(mockViewer.addHandler).toHaveBeenCalledWith('open-failed', expect.any(Function));
    });

    it('registers tile-load-failed event handler', () => {
      render(ImageViewer);
      expect(mockViewer.addHandler).toHaveBeenCalledWith('tile-load-failed', expect.any(Function));
    });

    it('pans to initial position when open event fires', () => {
      render(ImageViewer, { props: { initialRa: 180, initialDec: 0, initialZoom: 5 } });

      mockViewer._trigger('open');

      expect(mockViewer.viewport.panTo).toHaveBeenCalled();
      expect(mockViewer.viewport.zoomTo).toHaveBeenCalledWith(5);
    });

    it('shows error overlay on open-failed event', async () => {
      render(ImageViewer);
      mockViewer._trigger('open-failed', { message: 'Tile server unavailable' });

      // Wait for Svelte reactivity
      await new Promise(r => setTimeout(r, 10));
      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('Tile server unavailable');
    });

    it('shows default error message on open-failed without message', async () => {
      render(ImageViewer);
      mockViewer._trigger('open-failed', {});

      await new Promise(r => setTimeout(r, 10));
      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('Failed to load image tiles');
    });

    it('shows error overlay on tile-load-failed event', async () => {
      render(ImageViewer);
      mockViewer._trigger('tile-load-failed', { message: 'Network timeout' });

      await new Promise(r => setTimeout(r, 10));
      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('Network timeout');
    });

    it('shows default error message on tile-load-failed without message', async () => {
      render(ImageViewer);
      mockViewer._trigger('tile-load-failed', {});

      await new Promise(r => setTimeout(r, 10));
      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('Failed to load tiles');
    });

    it('clears error state when open event fires after error', async () => {
      render(ImageViewer);

      // Trigger an error first
      mockViewer._trigger('tile-load-failed', { message: 'Error' });
      await new Promise(r => setTimeout(r, 10));
      expect(document.querySelector('.error-overlay')).toBeTruthy();

      // Now trigger open which should clear errors
      mockViewer._trigger('open');
      await new Promise(r => setTimeout(r, 10));
      expect(document.querySelector('.error-overlay')).toBeFalsy();
    });
  });

  describe('error display', () => {
    it('shows error overlay when OSD constructor throws', () => {
      (OpenSeadragon as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('OSD init failed');
      });

      render(ImageViewer);
      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('OSD init failed');
    });

    it('shows hint text in error overlay', () => {
      (OpenSeadragon as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('Failed');
      });

      render(ImageViewer);
      const hint = document.querySelector('.hint');
      expect(hint).toBeTruthy();
      expect(hint?.textContent).toContain('different coordinate');
    });
  });
});
