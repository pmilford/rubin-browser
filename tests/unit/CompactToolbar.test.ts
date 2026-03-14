import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CompactToolbar from '../../src/components/CompactToolbar.svelte';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CompactToolbar', () => {
  describe('rendering', () => {
    it('renders the toolbar', () => {
      render(CompactToolbar);
      expect(screen.getByRole('toolbar', { name: 'Compact controls' })).toBeTruthy();
    });

    it('renders menu toggle button', () => {
      render(CompactToolbar);
      expect(screen.getByLabelText('Toggle controls panel')).toBeTruthy();
    });

    it('renders search input', () => {
      render(CompactToolbar);
      expect(screen.getByLabelText('Search coordinates')).toBeTruthy();
    });

    it('renders go button', () => {
      render(CompactToolbar);
      expect(screen.getByLabelText('Go')).toBeTruthy();
    });

    it('renders zoom in button', () => {
      render(CompactToolbar);
      expect(screen.getByLabelText('Zoom in')).toBeTruthy();
    });

    it('renders zoom out button', () => {
      render(CompactToolbar);
      expect(screen.getByLabelText('Zoom out')).toBeTruthy();
    });

    it('renders reset view button', () => {
      render(CompactToolbar);
      expect(screen.getByLabelText('Reset view')).toBeTruthy();
    });

    it('renders fullscreen toggle button', () => {
      render(CompactToolbar);
      expect(screen.getByLabelText('Toggle fullscreen')).toBeTruthy();
    });

    it('renders help button', () => {
      render(CompactToolbar);
      expect(screen.getByLabelText('Help')).toBeTruthy();
    });
  });

  describe('search', () => {
    it('calls onSearch with valid RA,Dec', async () => {
      const onSearch = vi.fn();
      render(CompactToolbar, { props: { onSearch } });

      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '62.0, -37.0' } });
      await fireEvent.click(screen.getByLabelText('Go'));

      expect(onSearch).toHaveBeenCalledWith(62.0, -37.0);
    });

    it('shows error for invalid RA', async () => {
      render(CompactToolbar);

      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '400, -37.0' } });
      await fireEvent.click(screen.getByLabelText('Go'));

      expect(document.querySelector('.search-error')?.textContent).toContain('RA must be 0-360');
    });

    it('shows error for invalid Dec', async () => {
      render(CompactToolbar);

      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '62.0, -100' } });
      await fireEvent.click(screen.getByLabelText('Go'));

      expect(document.querySelector('.search-error')?.textContent).toContain('Dec must be -90 to 90');
    });

    it('searches on Enter key', async () => {
      const onSearch = vi.fn();
      render(CompactToolbar, { props: { onSearch } });

      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '180.0, 45.0' } });
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(onSearch).toHaveBeenCalledWith(180.0, 45.0);
    });

    it('parses sexagesimal format', async () => {
      const onSearch = vi.fn();
      render(CompactToolbar, { props: { onSearch } });

      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '04h08m00s -37d00m00s' } });
      await fireEvent.click(screen.getByLabelText('Go'));

      expect(onSearch).toHaveBeenCalled();
      const [ra, dec] = onSearch.mock.calls[0];
      expect(ra).toBeCloseTo(62.0, 1);
      expect(dec).toBeCloseTo(-37.0, 1);
    });

    it('shows error for unrecognized format', async () => {
      render(CompactToolbar);

      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: 'invalid' } });
      await fireEvent.click(screen.getByLabelText('Go'));

      expect(document.querySelector('.search-error')).toBeTruthy();
    });
  });

  describe('button callbacks', () => {
    it('calls onZoomIn when zoom in clicked', async () => {
      const onZoomIn = vi.fn();
      render(CompactToolbar, { props: { onZoomIn } });

      await fireEvent.click(screen.getByLabelText('Zoom in'));
      expect(onZoomIn).toHaveBeenCalled();
    });

    it('calls onZoomOut when zoom out clicked', async () => {
      const onZoomOut = vi.fn();
      render(CompactToolbar, { props: { onZoomOut } });

      await fireEvent.click(screen.getByLabelText('Zoom out'));
      expect(onZoomOut).toHaveBeenCalled();
    });

    it('calls onResetView when reset clicked', async () => {
      const onResetView = vi.fn();
      render(CompactToolbar, { props: { onResetView } });

      await fireEvent.click(screen.getByLabelText('Reset view'));
      expect(onResetView).toHaveBeenCalled();
    });

    it('calls onTogglePanel when menu clicked', async () => {
      const onTogglePanel = vi.fn();
      render(CompactToolbar, { props: { onTogglePanel } });

      await fireEvent.click(screen.getByLabelText('Toggle controls panel'));
      expect(onTogglePanel).toHaveBeenCalled();
    });

    it('calls onToggleFullscreen when fullscreen clicked', async () => {
      const onToggleFullscreen = vi.fn();
      render(CompactToolbar, { props: { onToggleFullscreen } });

      await fireEvent.click(screen.getByLabelText('Toggle fullscreen'));
      expect(onToggleFullscreen).toHaveBeenCalled();
    });

    it('calls onToggleHelp when help clicked', async () => {
      const onToggleHelp = vi.fn();
      render(CompactToolbar, { props: { onToggleHelp } });

      await fireEvent.click(screen.getByLabelText('Help'));
      expect(onToggleHelp).toHaveBeenCalled();
    });

    it('calls onToggleInvert when invert button clicked', async () => {
      const onToggleInvert = vi.fn();
      render(CompactToolbar, { props: { onToggleInvert } });

      await fireEvent.click(screen.getByLabelText('Invert image'));
      expect(onToggleInvert).toHaveBeenCalled();
    });
  });

  describe('panel state', () => {
    it('marks menu button as active when panelOpen is true', () => {
      render(CompactToolbar, { props: { panelOpen: true } });
      const menuButton = screen.getByLabelText('Toggle controls panel');
      expect(menuButton.classList.contains('active')).toBe(true);
    });

    it('does not mark menu button as active when panelOpen is false', () => {
      render(CompactToolbar, { props: { panelOpen: false } });
      const menuButton = screen.getByLabelText('Toggle controls panel');
      expect(menuButton.classList.contains('active')).toBe(false);
    });
  });

  describe('fullscreen state', () => {
    it('shows collapse icon when fullscreen', () => {
      render(CompactToolbar, { props: { isFullscreen: true } });
      // The button should be present and show the collapse icon
      expect(screen.getByLabelText('Toggle fullscreen')).toBeTruthy();
    });

    it('shows expand icon when not fullscreen', () => {
      render(CompactToolbar, { props: { isFullscreen: false } });
      expect(screen.getByLabelText('Toggle fullscreen')).toBeTruthy();
    });
  });

  describe('invert state', () => {
    it('invert button is not active by default', () => {
      render(CompactToolbar);
      const button = screen.getByLabelText('Invert image');
      expect(button.classList.contains('active')).toBe(false);
    });

    it('invert button is active when invert=true', () => {
      render(CompactToolbar, { props: { invert: true } });
      const button = screen.getByLabelText('Invert image');
      expect(button.classList.contains('active')).toBe(true);
    });

    it('invert button has aria-pressed attribute', () => {
      render(CompactToolbar, { props: { invert: true } });
      const button = screen.getByLabelText('Invert image');
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('aria attributes', () => {
    it('has correct aria-expanded when panel is open', () => {
      render(CompactToolbar, { props: { panelOpen: true } });
      expect(screen.getByLabelText('Toggle controls panel').getAttribute('aria-expanded')).toBe('true');
    });

    it('has correct aria-expanded when panel is closed', () => {
      render(CompactToolbar, { props: { panelOpen: false } });
      expect(screen.getByLabelText('Toggle controls panel').getAttribute('aria-expanded')).toBe('false');
    });
  });
});
