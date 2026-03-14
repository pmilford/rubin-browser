import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import ImageViewer from '../../src/components/ImageViewer.svelte';

// Create mock Aladin viewer
const createMockAladin = () => {
  const listeners: Record<string, Function[]> = {};
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    gotoRaDec: vi.fn(),
    setZoom: vi.fn(),
    increaseZoom: vi.fn(),
    decreaseZoom: vi.fn(),
    getRaDec: vi.fn(() => [62.0, -37.0]),
    destroy: vi.fn(),
    newImageSurvey: vi.fn((url: string) => ({ url, setOpacity: vi.fn() })),
    addImageSurvey: vi.fn(),
    removeImageSurvey: vi.fn(),
    setImageSurvey: vi.fn(),
    _trigger: (event: string, data?: any) => {
      (listeners[event] || []).forEach(h => h(data));
    },
  };
};

let mockAladinInstance: ReturnType<typeof createMockAladin>;
let mockInitCalled = false;

const { mockAladinFn, mockInitFn } = vi.hoisted(() => {
  return {
    mockAladinFn: vi.fn(() => {
      mockAladinInstance = createMockAladin();
      return mockAladinInstance;
    }),
    mockInitFn: vi.fn(async () => {
      mockInitCalled = true;
    }),
  };
});

vi.mock('aladin-lite', () => {
  return {
    default: {
      init: mockInitFn,
      aladin: mockAladinFn,
    },
  };
});

// Import after mock setup
import A from 'aladin-lite';

beforeEach(() => {
  vi.clearAllMocks();
  mockInitCalled = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ImageViewer', () => {
  describe('rendering', () => {
    it('renders the viewer container', () => {
      render(ImageViewer);
      const container = document.querySelector('.image-viewer');
      expect(container).toBeTruthy();
    });

    it('initializes Aladin Lite', async () => {
      render(ImageViewer);
      // Wait for async init
      await new Promise(r => setTimeout(r, 50));
      expect(A.init).toHaveBeenCalled();
      expect(mockAladinFn).toHaveBeenCalled();
    });

    it('passes custom initial coordinates', async () => {
      render(ImageViewer, { props: { initialRa: 180, initialDec: 45, initialZoom: 5 } });
      await new Promise(r => setTimeout(r, 50));
      expect(mockAladinFn).toHaveBeenCalled();
      const config = mockAladinFn.mock.calls[0][1];
      expect(config.target).toBe('180 45');
      expect(config.zoom).toBe(5);
    });

    it('uses public HiPS as default (no token)', async () => {
      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      const config = mockAladinFn.mock.calls[0][1];
      expect(config.survey).toBe('https://alasky.cds.unistra.fr/DSS/DSSColor');
    });

    it('uses Rubin HiPS when rspToken is provided', async () => {
      render(ImageViewer, { props: { rspToken: 'test-token-123' } });
      await new Promise(r => setTimeout(r, 50));
      const config = mockAladinFn.mock.calls[0][1];
      expect(config.survey).toBe('https://data.lsst.cloud/api/hips/images/color_gri');
    });

    it('uses custom HiPS base URL when specified', async () => {
      render(ImageViewer, { props: { hipsBaseUrl: 'https://example.com/hips/custom' } });
      await new Promise(r => setTimeout(r, 50));
      const config = mockAladinFn.mock.calls[0][1];
      expect(config.survey).toBe('https://example.com/hips/custom');
    });

    it('does not show error overlay initially', () => {
      render(ImageViewer);
      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeFalsy();
    });
  });

  describe('Aladin configuration', () => {
    it('disables all UI controls', async () => {
      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      const config = mockAladinFn.mock.calls[0][1];
      expect(config.showFullscreenControl).toBe(false);
      expect(config.showZoomControl).toBe(false);
      expect(config.showLayersControl).toBe(false);
      expect(config.showGotoControl).toBe(false);
      expect(config.showSimbadPointerControl).toBe(false);
      expect(config.showCooGrid).toBe(false);
    });

    it('uses J2000 coordinate frame', async () => {
      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      const config = mockAladinFn.mock.calls[0][1];
      expect(config.cooFrame).toBe('J2000');
    });
  });

  describe('exported methods', () => {
    it('zoomIn calls aladin.increaseZoom', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      (component as unknown as ImageViewer).zoomIn();
      expect(mockAladinInstance.increaseZoom).toHaveBeenCalled();
    });

    it('zoomOut calls aladin.decreaseZoom', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      (component as unknown as ImageViewer).zoomOut();
      expect(mockAladinInstance.decreaseZoom).toHaveBeenCalled();
    });

    it('resetView calls aladin.gotoRaDec and setZoom', async () => {
      const { component } = render(ImageViewer, { props: { initialRa: 100, initialDec: 20, initialZoom: 7 } });
      await new Promise(r => setTimeout(r, 50));
      (component as unknown as ImageViewer).resetView();
      expect(mockAladinInstance.gotoRaDec).toHaveBeenCalledWith(100, 20);
      expect(mockAladinInstance.setZoom).toHaveBeenCalledWith(7);
    });

    it('panTo calls aladin.gotoRaDec', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      (component as unknown as ImageViewer).panTo(180, 45);
      expect(mockAladinInstance.gotoRaDec).toHaveBeenCalledWith(180, 45);
    });

    it('panToAndReload calls aladin.gotoRaDec', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      (component as unknown as ImageViewer).panToAndReload(180, 45);
      expect(mockAladinInstance.gotoRaDec).toHaveBeenCalledWith(180, 45);
    });

    it('setZoom calls aladin.setZoom', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      (component as unknown as ImageViewer).setZoom(10);
      expect(mockAladinInstance.setZoom).toHaveBeenCalledWith(10);
    });

    it('handles error when Aladin init fails', async () => {
      (A.init as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Aladin init failed'));

      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('Aladin init failed');
    });

    it('handles non-Error exception', async () => {
      (A.init as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string error');

      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('Failed to initialize viewer');
    });

    it('does not throw when methods called before init', () => {
      const { component } = render(ImageViewer);
      // Methods should not throw before Aladin is initialized
      expect(() => (component as unknown as ImageViewer).zoomIn()).not.toThrow();
      expect(() => (component as unknown as ImageViewer).zoomOut()).not.toThrow();
      expect(() => (component as unknown as ImageViewer).resetView()).not.toThrow();
      expect(() => (component as unknown as ImageViewer).panTo(0, 0)).not.toThrow();
      expect(() => (component as unknown as ImageViewer).setZoom(5)).not.toThrow();
      expect(() => (component as unknown as ImageViewer).panToAndReload(0, 0)).not.toThrow();
    });
  });

  describe('overlay methods', () => {
    it('addOverlay creates new image survey', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      (component as unknown as ImageViewer).addOverlay('test', 'https://example.com/hips/', 80);
      expect(mockAladinInstance.newImageSurvey).toHaveBeenCalledWith('https://example.com/hips/');
      expect(mockAladinInstance.addImageSurvey).toHaveBeenCalled();
    });

    it('addOverlay does not add duplicate', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      (component as unknown as ImageViewer).addOverlay('test', 'https://example.com/hips/', 80);
      (component as unknown as ImageViewer).addOverlay('test', 'https://example.com/hips/', 80);
      expect(mockAladinInstance.newImageSurvey).toHaveBeenCalledTimes(1);
    });

    it('removeOverlay removes existing overlay', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      (component as unknown as ImageViewer).addOverlay('test', 'https://example.com/hips/', 80);
      (component as unknown as ImageViewer).removeOverlay('test');
      expect(mockAladinInstance.removeImageSurvey).toHaveBeenCalled();
    });

    it('removeOverlay does nothing for non-existent overlay', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      (component as unknown as ImageViewer).removeOverlay('nonexistent');
      expect(mockAladinInstance.removeImageSurvey).not.toHaveBeenCalled();
    });

    it('setOverlayOpacity changes opacity of existing overlay', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      const mockSurvey = { setOpacity: vi.fn() };
      mockAladinInstance.newImageSurvey.mockReturnValueOnce(mockSurvey);

      (component as unknown as ImageViewer).addOverlay('test', 'https://example.com/hips/', 80);
      (component as unknown as ImageViewer).setOverlayOpacity('test', 50);
      expect(mockSurvey.setOpacity).toHaveBeenCalledWith(0.5);
    });

    it('setOverlayOpacity does nothing for non-existent overlay', async () => {
      const { component } = render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      // Should not throw
      expect(() => (component as unknown as ImageViewer).setOverlayOpacity('nonexistent', 50)).not.toThrow();
    });
  });

  describe('event handlers', () => {
    it('registers positionChanged handler', async () => {
      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      expect(mockAladinInstance.on).toHaveBeenCalledWith('positionChanged', expect.any(Function));
    });

    it('registers zoomChanged handler', async () => {
      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));
      expect(mockAladinInstance.on).toHaveBeenCalledWith('zoomChanged', expect.any(Function));
    });

    it('calls onViewerStateChange when position changes', async () => {
      const onViewerStateChange = vi.fn();
      render(ImageViewer, { props: { onViewerStateChange } });
      await new Promise(r => setTimeout(r, 50));

      mockAladinInstance._trigger('positionChanged', { ra: 180, dec: 45 });

      expect(onViewerStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          centerRa: 180,
          centerDec: 45,
        })
      );
    });

    it('calls onViewerStateChange when zoom changes', async () => {
      const onViewerStateChange = vi.fn();
      render(ImageViewer, { props: { onViewerStateChange } });
      await new Promise(r => setTimeout(r, 50));

      mockAladinInstance._trigger('zoomChanged', 5);

      expect(onViewerStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          zoomLevel: 5,
        })
      );
    });
  });

  describe('error display', () => {
    it('shows error overlay when Aladin init throws', async () => {
      (A.init as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('OSD init failed'));

      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay).toBeTruthy();
      expect(errorOverlay?.textContent).toContain('OSD init failed');
    });

    it('shows hint text in error overlay', async () => {
      (A.init as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Failed'));

      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      const hint = document.querySelector('.hint');
      expect(hint).toBeTruthy();
      expect(hint?.textContent).toContain('different coordinate');
    });

    it('error overlay has role=alert for accessibility', async () => {
      (A.init as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Test error'));

      render(ImageViewer);
      await new Promise(r => setTimeout(r, 50));

      const errorOverlay = document.querySelector('.error-overlay');
      expect(errorOverlay?.getAttribute('role')).toBe('alert');
    });

    it('auto-dismisses error overlay after timeout', async () => {
      vi.useFakeTimers();
      (A.init as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Temp error'));

      render(ImageViewer);

      // Flush all microtasks (for the async effect)
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
      // Also flush any pending macrotasks
      await vi.advanceTimersByTimeAsync(0);

      expect(document.querySelector('.error-overlay')).toBeTruthy();

      // Fast-forward past the 5 second auto-dismiss
      await vi.advanceTimersByTimeAsync(5000);

      expect(document.querySelector('.error-overlay')).toBeFalsy();
    });
  });

  describe('cleanup', () => {
    it('destroys aladin viewer on unmount', async () => {
      const { unmount } = render(ImageViewer);
      await Promise.resolve();
      await Promise.resolve();

      unmount();
      expect(mockAladinInstance.destroy).toHaveBeenCalled();
    });

    it('clears error dismiss timer on unmount', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      (A.init as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Timer test'));

      const { unmount } = render(ImageViewer);

      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
      await vi.advanceTimersByTimeAsync(0);

      // Error is shown, timer is active
      expect(document.querySelector('.error-overlay')).toBeTruthy();

      unmount();

      // clearTimeout should have been called during cleanup
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });
});
