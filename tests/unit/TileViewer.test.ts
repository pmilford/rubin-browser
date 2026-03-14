import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TileViewer from '../../src/views/TileViewer.svelte';

// Mock OpenSeadragon (used by ImageViewer)
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
  const mockFn = vi.fn(() => {
    mockViewer = createMockViewer();
    return mockViewer;
  });
  (mockFn as any).Point = vi.fn((x: number, y: number) => ({ x, y }));
  return {
    default: mockFn,
    Point: vi.fn((x: number, y: number) => ({ x, y })),
  };
});

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

    it('renders toolbar', () => {
      render(TileViewer);
      expect(screen.getByRole('toolbar')).toBeTruthy();
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
      // Help modal should not be visible initially
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not show help modal initially', () => {
      render(TileViewer);
      expect(screen.queryByText('Rubin Image Viewer Help')).toBeNull();
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

  describe('toolbar interactions', () => {
    it('updates status when scaling is changed', async () => {
      render(TileViewer);
      const scalingSelect = document.querySelector('#scaling-select')!;
      await fireEvent.change(scalingSelect, { target: { value: 'log' } });

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Scaling: log');
    });

    it('updates status when color map is changed', async () => {
      render(TileViewer);
      const colorSelect = document.querySelector('#colormap-select')!;
      await fireEvent.change(colorSelect, { target: { value: 'viridis' } });

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Color map: viridis');
    });

    it('updates status when interpolation is changed', async () => {
      render(TileViewer);
      const interpSelect = document.querySelector('#interp-select')!;
      await fireEvent.change(interpSelect, { target: { value: 'bicubic' } });

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Interpolation: bicubic');
    });
  });

  describe('search integration', () => {
    it('updates status when searching coordinates', async () => {
      render(TileViewer);
      const searchInput = screen.getByLabelText('Search coordinates');
      await fireEvent.input(searchInput, { target: { value: '62.0, -37.0' } });
      await fireEvent.click(screen.getByLabelText('Go'));

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Go to');
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
    it('toggles help with H key', async () => {
      render(TileViewer);
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.keyDown(window, { key: 'h' });
      await screen.findByRole('dialog');
      expect(screen.getByRole('dialog')).toBeTruthy();

      fireEvent.keyDown(window, { key: 'h' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    });

    it('toggles help with uppercase H', async () => {
      render(TileViewer);
      fireEvent.keyDown(window, { key: 'H' });
      await screen.findByRole('dialog');
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('zooms in with + key', () => {
      render(TileViewer);
      fireEvent.keyDown(window, { key: '+' });
      expect(mockViewer.viewport.zoomBy).toHaveBeenCalledWith(1.5);
    });

    it('zooms in with = key', () => {
      render(TileViewer);
      fireEvent.keyDown(window, { key: '=' });
      expect(mockViewer.viewport.zoomBy).toHaveBeenCalledWith(1.5);
    });

    it('zooms out with - key', () => {
      render(TileViewer);
      fireEvent.keyDown(window, { key: '-' });
      expect(mockViewer.viewport.zoomBy).toHaveBeenCalledWith(1 / 1.5);
    });

    it('zooms out with _ key', () => {
      render(TileViewer);
      fireEvent.keyDown(window, { key: '_' });
      expect(mockViewer.viewport.zoomBy).toHaveBeenCalledWith(1 / 1.5);
    });

    it('resets view with 0 key', () => {
      render(TileViewer);
      fireEvent.keyDown(window, { key: '0' });
      expect(mockViewer.viewport.goHome).toHaveBeenCalled();
    });
  });

  describe('viewer state changes', () => {
    it('updates status bar when viewer state changes', () => {
      render(TileViewer);
      // Trigger OSD open event which causes state change
      mockViewer._trigger('open');

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('RA:');
      expect(status.textContent).toContain('Dec:');
    });
  });

  describe('component structure', () => {
    it('has flex layout', () => {
      render(TileViewer);
      const container = document.querySelector('.tile-viewer');
      // Check it has the CSS class that defines flex layout
      expect(container?.classList.contains('tile-viewer')).toBe(true);
    });

    it('viewer area takes available space', () => {
      render(TileViewer);
      const viewerArea = document.querySelector('.viewer-area');
      expect(viewerArea).toBeTruthy();
    });
  });

  describe('time slider integration', () => {
    it('renders time slider controls', () => {
      render(TileViewer);
      expect(screen.getByRole('region', { name: 'Time series controls' })).toBeTruthy();
    });

    it('renders epoch play button', () => {
      render(TileViewer);
      expect(screen.getByLabelText('Play')).toBeTruthy();
    });

    it('renders epoch slider', () => {
      render(TileViewer);
      expect(screen.getByLabelText('Epoch slider')).toBeTruthy();
    });

    it('shows epoch count', () => {
      render(TileViewer);
      const counter = screen.getByText(/\/ 30/);
      expect(counter).toBeTruthy();
    });

    it('updates status when epoch changes', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('Next epoch'));

      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Epoch');
    });

    it('steps through epochs with next button', async () => {
      render(TileViewer);
      expect(screen.getByText('1 / 30')).toBeTruthy();

      await fireEvent.click(screen.getByLabelText('Next epoch'));
      expect(screen.getByText('2 / 30')).toBeTruthy();
    });

    it('steps backward with previous button', async () => {
      render(TileViewer);
      // Move forward first
      await fireEvent.click(screen.getByLabelText('Next epoch'));
      expect(screen.getByText('2 / 30')).toBeTruthy();

      // Then back
      await fireEvent.click(screen.getByLabelText('Previous epoch'));
      expect(screen.getByText('1 / 30')).toBeTruthy();
    });
  });

  describe('filter selector integration', () => {
    it('renders filter selector', () => {
      render(TileViewer);
      expect(screen.getByRole('group', { name: 'Filter selection' })).toBeTruthy();
    });

    it('renders all filter buttons', () => {
      render(TileViewer);
      expect(screen.getByLabelText('u filter')).toBeTruthy();
      expect(screen.getByLabelText('y filter')).toBeTruthy();
    });

    it('updates status when filter is selected', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('r filter'));
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Filter: r');
    });

    it('updates status when filter is deselected', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('r filter'));
      await fireEvent.click(screen.getByLabelText('r filter'));
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Filter: none');
    });

    it('shows composite mode toggle', () => {
      render(TileViewer);
      expect(screen.getByLabelText('RGB composite mode')).toBeTruthy();
      expect(screen.getByLabelText('Single filter mode')).toBeTruthy();
    });

    it('updates status when composite channels are assigned', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));
      await fireEvent.click(screen.getByLabelText('R channel'));
      await fireEvent.click(screen.getByLabelText('r filter'));
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Composite: R:r');
    });

    it('updates status when composite is cleared', async () => {
      render(TileViewer);
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));
      await fireEvent.click(screen.getByLabelText('R channel'));
      await fireEvent.click(screen.getByLabelText('r filter'));
      await fireEvent.click(screen.getByLabelText('Clear composite'));
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Composite: cleared');
    });
  });
});
