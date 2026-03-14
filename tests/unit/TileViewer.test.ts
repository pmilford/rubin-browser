import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TileViewer from '../../src/views/TileViewer.svelte';

// Mock Aladin Lite (used by ImageViewer)
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

const { tileMockAladinFn } = vi.hoisted(() => {
  return {
    tileMockAladinFn: vi.fn(() => {
      mockAladinInstance = createMockAladin();
      return mockAladinInstance;
    }),
  };
});

vi.mock('aladin-lite', () => {
  return {
    default: {
      init: vi.fn(async () => {}),
      aladin: tileMockAladinFn,
    },
  };
});

// Mock auth module
vi.mock('../../src/api/auth.js', () => ({
  getToken: vi.fn(() => null),
  isAuthenticated: vi.fn(() => false),
  getAuthHeader: vi.fn(() => ({})),
}));

// Mock canvas context for ColorBar
const mockCtx = {
  imageSmoothingEnabled: true,
  drawImage: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TileViewer', () => {
  describe('rendering', () => {
    it('renders the main container', () => {
      render(TileViewer);
      const container = document.querySelector('.tile-viewer');
      expect(container).toBeTruthy();
    });

    it('renders compact toolbar', () => {
      render(TileViewer);
      expect(screen.getByRole('toolbar', { name: 'Compact controls' })).toBeTruthy();
    });

    it('renders status bar', () => {
      render(TileViewer);
      expect(screen.getByRole('status')).toBeTruthy();
    });

    it('renders color bar canvas', () => {
      render(TileViewer);
      expect(screen.getByLabelText('Color map legend')).toBeTruthy();
    });

    it('renders image viewer container', () => {
      render(TileViewer);
      expect(document.querySelector('.image-viewer')).toBeTruthy();
    });

    it('renders help modal (hidden)', () => {
      render(TileViewer);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not show help modal initially', () => {
      render(TileViewer);
      expect(screen.queryByText('Rubin Image Viewer Help')).toBeNull();
    });

    it('renders menu toggle button', () => {
      render(TileViewer);
      expect(screen.getByLabelText('Toggle controls panel')).toBeTruthy();
    });

    it('renders zoom controls', () => {
      render(TileViewer);
      expect(screen.getByLabelText('Zoom in')).toBeTruthy();
      expect(screen.getByLabelText('Zoom out')).toBeTruthy();
      expect(screen.getByLabelText('Reset view')).toBeTruthy();
    });

    it('renders fullscreen toggle', () => {
      render(TileViewer);
      expect(screen.getByLabelText('Toggle fullscreen')).toBeTruthy();
    });

    it('does not render side panel initially', () => {
      render(TileViewer);
      expect(screen.queryByRole('complementary', { name: 'Controls panel' })).toBeNull();
    });
  });

  describe('status bar initial state', () => {
    it('shows initial RA', () => {
      render(TileViewer);
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('RA:');
    });

    it('shows initial Dec', () => {
      render(TileViewer);
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Dec:');
    });

    it('shows initial zoom', () => {
      render(TileViewer);
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Zoom:');
    });

    it('shows Ready message initially', () => {
      render(TileViewer);
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Ready');
    });
  });

  describe('side panel toggle', () => {
    it('opens side panel when menu button is clicked', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByRole('complementary', { name: 'Controls panel' })).toBeTruthy();
    });

    it('closes side panel when close button is clicked', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByRole('complementary')).toBeTruthy();

      await fireEvent.click(screen.getByLabelText('Close panel'));
      await waitFor(() => {
        expect(screen.queryByRole('complementary')).toBeNull();
      });
    });

    it('closes side panel when Escape is pressed', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByRole('complementary')).toBeTruthy();

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('complementary')).toBeNull();
      });
    });

    it('marks menu button as active when panel is open', async () => {
      render(TileViewer);
      const menuButton = screen.getByLabelText('Toggle controls panel');
      await fireEvent.click(menuButton);
      expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('side panel display settings', () => {
    it('shows display settings section when panel opens', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByText('Display Settings')).toBeTruthy();
    });

    it('shows scaling select in panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByLabelText('Scaling')).toBeTruthy();
    });

    it('shows color map select in panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByLabelText('Color Map')).toBeTruthy();
    });

    it('shows interpolation select in panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByLabelText('Interpolation')).toBeTruthy();
    });

    it('updates status when scaling is changed in panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      const scalingSelect = screen.getByLabelText('Scaling');
      await fireEvent.change(scalingSelect, { target: { value: 'log' } });

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Scaling: log');
    });

    it('updates status when color map is changed in panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      const colorSelect = screen.getByLabelText('Color Map');
      await fireEvent.change(colorSelect, { target: { value: 'viridis' } });

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Color map: viridis');
    });

    it('updates status when interpolation is changed in panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      const interpSelect = screen.getByLabelText('Interpolation');
      await fireEvent.change(interpSelect, { target: { value: 'bicubic' } });

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Interpolation: bicubic');
    });
  });

  describe('search integration', () => {
    it('accepts coordinate input in search bar', async () => {
      render(TileViewer);
      const searchInput = screen.getByLabelText('Search coordinates') as HTMLInputElement;
      await fireEvent.input(searchInput, { target: { value: '62.0, -37.0' } });
      expect(searchInput.value).toBe('62.0, -37.0');

      // Clicking Go should not throw
      await fireEvent.click(screen.getByLabelText('Go'));
    });
  });

  describe('help modal integration', () => {
    it('opens help modal when help button is clicked', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Help'));

      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByText('Rubin Image Viewer Help')).toBeTruthy();
    });

    it('closes help modal when close button is clicked', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Help'));
      expect(screen.getByRole('dialog')).toBeTruthy();

      await fireEvent.click(screen.getByLabelText('Close help'));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('keyboard shortcuts', () => {
    it('opens help with H key', async () => {
      render(TileViewer);
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.keyDown(window, { key: 'h' });
      await screen.findByRole('dialog');
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('closes help with H key when open', async () => {
      render(TileViewer);
      fireEvent.keyDown(window, { key: 'h' });
      await screen.findByRole('dialog');

      fireEvent.keyDown(window, { key: 'h' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    });

    it('zooms in with + key', async () => {
      vi.useRealTimers();
      render(TileViewer);
      // Flush microtasks to let Svelte effect run
      await new Promise(r => setTimeout(r, 10));
      fireEvent.keyDown(window, { key: '+' });
      expect(mockAladinInstance.increaseZoom).toHaveBeenCalled();
      vi.useFakeTimers();
    });

    it('zooms in with = key', async () => {
      vi.useRealTimers();
      render(TileViewer);
      await new Promise(r => setTimeout(r, 10));
      fireEvent.keyDown(window, { key: '=' });
      expect(mockAladinInstance.increaseZoom).toHaveBeenCalled();
      vi.useFakeTimers();
    });

    it('zooms out with - key', async () => {
      vi.useRealTimers();
      render(TileViewer);
      await new Promise(r => setTimeout(r, 10));
      fireEvent.keyDown(window, { key: '-' });
      expect(mockAladinInstance.decreaseZoom).toHaveBeenCalled();
      vi.useFakeTimers();
    });

    it('zooms out with _ key', async () => {
      vi.useRealTimers();
      render(TileViewer);
      await new Promise(r => setTimeout(r, 10));
      fireEvent.keyDown(window, { key: '_' });
      expect(mockAladinInstance.decreaseZoom).toHaveBeenCalled();
      vi.useFakeTimers();
    });

    it('resets view with 0 key', async () => {
      vi.useRealTimers();
      render(TileViewer);
      await new Promise(r => setTimeout(r, 10));
      fireEvent.keyDown(window, { key: '0' });
      expect(mockAladinInstance.gotoRaDec).toHaveBeenCalled();
      expect(mockAladinInstance.setZoom).toHaveBeenCalled();
      vi.useFakeTimers();
    });

    it('toggles UI visibility with Escape when panel is closed', async () => {
      render(TileViewer);
      expect(screen.getByRole('toolbar')).toBeTruthy();

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('toolbar')).toBeNull();
      });

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.getByRole('toolbar')).toBeTruthy();
      });
    });
  });

  describe('viewer state changes', () => {
    it('updates status bar when viewer state changes', async () => {
      vi.useRealTimers();
      render(TileViewer);
      await new Promise(r => setTimeout(r, 10));
      mockAladinInstance._trigger('positionChanged', { ra: 62.0, dec: -37.0 });

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('RA:');
      expect(status.textContent).toContain('Dec:');
      vi.useFakeTimers();
    });
  });

  describe('component structure', () => {
    it('has flex layout', () => {
      render(TileViewer);
      const container = document.querySelector('.tile-viewer');
      expect(container?.classList.contains('tile-viewer')).toBe(true);
    });

    it('viewer area takes available space', () => {
      render(TileViewer);
      const viewerArea = document.querySelector('.viewer-area');
      expect(viewerArea).toBeTruthy();
    });
  });

  describe('side panel sections', () => {
    it('shows filters section in side panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByText('Filters')).toBeTruthy();
    });

    it('shows survey overlays section in side panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByText('Survey Overlays')).toBeTruthy();
    });

    it('shows time series section in side panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByText('Time Series')).toBeTruthy();
    });

    it('shows blink section in side panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByText('Blink')).toBeTruthy();
    });

    it('shows pixel readout section in side panel', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(screen.getByText('Pixel Readout')).toBeTruthy();
    });
  });
});
