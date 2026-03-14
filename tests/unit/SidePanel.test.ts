import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SidePanel from '../../src/components/SidePanel.svelte';

// Mock canvas context for child components
const mockCtx = {
  imageSmoothingEnabled: true,
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx as unknown as CanvasRenderingContext2D);
});

describe('SidePanel', () => {
  describe('rendering', () => {
    it('does not render when closed', () => {
      render(SidePanel, { props: { open: false } });
      expect(screen.queryByRole('complementary')).toBeNull();
    });

    it('renders when open', () => {
      render(SidePanel, { props: { open: true } });
      expect(screen.getByRole('complementary', { name: 'Controls panel' })).toBeTruthy();
    });

    it('renders panel header', () => {
      render(SidePanel, { props: { open: true } });
      expect(screen.getByText('Controls')).toBeTruthy();
    });

    it('renders close button', () => {
      render(SidePanel, { props: { open: true } });
      expect(screen.getByLabelText('Close panel')).toBeTruthy();
    });

    it('renders overlay when open', () => {
      render(SidePanel, { props: { open: true } });
      expect(document.querySelector('.side-panel-overlay')).toBeTruthy();
    });

    it('does not render overlay when closed', () => {
      render(SidePanel, { props: { open: false } });
      expect(document.querySelector('.side-panel-overlay')).toBeNull();
    });
  });

  describe('close', () => {
    it('calls onClose when close button clicked', async () => {
      const onClose = vi.fn();
      render(SidePanel, { props: { open: true, onClose } });

      await fireEvent.click(screen.getByLabelText('Close panel'));
      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when overlay clicked', async () => {
      const onClose = vi.fn();
      render(SidePanel, { props: { open: true, onClose } });

      await fireEvent.click(document.querySelector('.side-panel-overlay')!);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('sections', () => {
    it('renders display settings section', () => {
      render(SidePanel, { props: { open: true } });
      expect(screen.getByText('Display Settings')).toBeTruthy();
    });

    it('renders filters section', () => {
      render(SidePanel, { props: { open: true } });
      expect(screen.getByText('Filters')).toBeTruthy();
    });

    it('renders survey overlays section', () => {
      render(SidePanel, { props: { open: true } });
      expect(screen.getByText('Survey Overlays')).toBeTruthy();
    });

    it('renders pixel readout section', () => {
      render(SidePanel, { props: { open: true } });
      expect(screen.getByText('Pixel Readout')).toBeTruthy();
    });

    it('does not render time series section without epochs', () => {
      render(SidePanel, { props: { open: true, epochs: [] } });
      expect(screen.queryByText('Time Series')).toBeNull();
    });

    it('renders time series section with epochs', () => {
      render(SidePanel, {
        props: {
          open: true,
          epochs: [{ mjd: 60000, isoDate: '2023-04-01', filter: 'r' }],
        },
      });
      expect(screen.getByText('Time Series')).toBeTruthy();
    });

    it('does not render blink section without targets', () => {
      render(SidePanel, { props: { open: true, blinkTargets: [] } });
      expect(screen.queryByText('Blink')).toBeNull();
    });

    it('renders blink section with targets', () => {
      render(SidePanel, {
        props: {
          open: true,
          blinkTargets: [{ id: '1', label: 'Target 1' }],
        },
      });
      expect(screen.getByText('Blink')).toBeTruthy();
    });
  });

  describe('section toggling', () => {
    it('expands display settings by default', () => {
      render(SidePanel, { props: { open: true } });
      expect(screen.getByLabelText('Scaling')).toBeTruthy();
    });

    it('collapses section when toggle clicked', async () => {
      render(SidePanel, { props: { open: true } });

      // Display settings is open by default, click to collapse
      const toggle = screen.getByText('Display Settings').closest('button')!;
      await fireEvent.click(toggle);

      expect(screen.queryByLabelText('Scaling')).toBeNull();
    });

    it('expands section when toggle clicked', async () => {
      render(SidePanel, { props: { open: true } });

      // Filters section should be collapsed by default
      const toggle = screen.getByText('Filters').closest('button')!;
      await fireEvent.click(toggle);

      // Filter selector should now be visible
      expect(screen.getByRole('group', { name: 'Filter selection' })).toBeTruthy();
    });
  });

  describe('display controls', () => {
    it('shows scaling dropdown', () => {
      render(SidePanel, { props: { open: true } });
      const select = screen.getByLabelText('Scaling');
      expect(select).toBeTruthy();
      expect(select.tagName).toBe('SELECT');
    });

    it('shows color map dropdown', () => {
      render(SidePanel, { props: { open: true } });
      const select = screen.getByLabelText('Color Map');
      expect(select).toBeTruthy();
    });

    it('shows interpolation dropdown', () => {
      render(SidePanel, { props: { open: true } });
      const select = screen.getByLabelText('Interpolation');
      expect(select).toBeTruthy();
    });

    it('calls onScalingChange when scaling changed', async () => {
      const onScalingChange = vi.fn();
      render(SidePanel, { props: { open: true, onScalingChange } });

      await fireEvent.change(screen.getByLabelText('Scaling'), { target: { value: 'log' } });
      expect(onScalingChange).toHaveBeenCalledWith('log');
    });

    it('calls onColorMapChange when color map changed', async () => {
      const onColorMapChange = vi.fn();
      render(SidePanel, { props: { open: true, onColorMapChange } });

      await fireEvent.change(screen.getByLabelText('Color Map'), { target: { value: 'viridis' } });
      expect(onColorMapChange).toHaveBeenCalledWith('viridis');
    });

    it('calls onInterpolationChange when interpolation changed', async () => {
      const onInterpolationChange = vi.fn();
      render(SidePanel, { props: { open: true, onInterpolationChange } });

      await fireEvent.change(screen.getByLabelText('Interpolation'), { target: { value: 'bicubic' } });
      expect(onInterpolationChange).toHaveBeenCalledWith('bicubic');
    });
  });

  describe('overlay click-through', () => {
    it('does not close when panel body is clicked', async () => {
      const onClose = vi.fn();
      render(SidePanel, { props: { open: true, onClose } });

      // Click inside the panel (not the overlay)
      const panel = document.querySelector('.side-panel')!;
      await fireEvent.click(panel);
      // onClose should NOT have been called
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
