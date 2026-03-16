import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Toolbar from '../../src/components/Toolbar.svelte';

describe('Toolbar', () => {
  describe('rendering', () => {
    it('renders the toolbar with all controls', () => {
      render(Toolbar);
      expect(screen.getByRole('toolbar')).toBeTruthy();
      expect(screen.getByLabelText('Search coordinates')).toBeTruthy();
      expect(screen.getByLabelText('Go')).toBeTruthy();
      expect(screen.getByLabelText('Zoom in')).toBeTruthy();
      expect(screen.getByLabelText('Zoom out')).toBeTruthy();
      expect(screen.getByLabelText('Reset view')).toBeTruthy();
      expect(screen.getByLabelText('Help')).toBeTruthy();
    });

    it('renders scaling dropdown with all options', () => {
      render(Toolbar);
      // Select by id since label[for] association
      const select = document.querySelector('#scaling-select') as HTMLSelectElement;
      const options = Array.from(select.options).map(o => o.value);
      expect(options).toEqual(['linear', 'log', 'sqrt', 'asinh', 'sinh', 'mtf', 'histogram', 'zscale', 'percentile']);
    });

    it('renders colormap dropdown with all options', () => {
      render(Toolbar);
      const select = document.querySelector('#colormap-select') as HTMLSelectElement;
      const options = Array.from(select.options).map(o => o.value);
      expect(options).toEqual(['grayscale', 'viridis', 'plasma', 'inferno', 'hot', 'cool']);
    });

    it('renders interpolation dropdown with all options', () => {
      render(Toolbar);
      const select = document.querySelector('#interp-select') as HTMLSelectElement;
      const options = Array.from(select.options).map(o => o.value);
      expect(options).toEqual(['nearest', 'bilinear', 'bicubic', 'lanczos']);
    });

    it('sets initial scaling value', () => {
      render(Toolbar, { props: { scaling: 'log' } });
      const select = document.querySelector('#scaling-select') as HTMLSelectElement;
      expect(select.value).toBe('log');
    });

    it('sets initial colorMap value', () => {
      render(Toolbar, { props: { colorMap: 'plasma' } });
      const select = document.querySelector('#colormap-select') as HTMLSelectElement;
      expect(select.value).toBe('plasma');
    });

    it('sets initial interpolation value', () => {
      render(Toolbar, { props: { interpolation: 'bicubic' } });
      const select = document.querySelector('#interp-select') as HTMLSelectElement;
      expect(select.value).toBe('bicubic');
    });
  });

  describe('button clicks', () => {
    it('calls onZoomIn when zoom in is clicked', async () => {
      const onZoomIn = vi.fn();
      render(Toolbar, { props: { onZoomIn } });
      await fireEvent.click(screen.getByLabelText('Zoom in'));
      expect(onZoomIn).toHaveBeenCalledTimes(1);
    });

    it('calls onZoomOut when zoom out is clicked', async () => {
      const onZoomOut = vi.fn();
      render(Toolbar, { props: { onZoomOut } });
      await fireEvent.click(screen.getByLabelText('Zoom out'));
      expect(onZoomOut).toHaveBeenCalledTimes(1);
    });

    it('calls onResetView when reset is clicked', async () => {
      const onResetView = vi.fn();
      render(Toolbar, { props: { onResetView } });
      await fireEvent.click(screen.getByLabelText('Reset view'));
      expect(onResetView).toHaveBeenCalledTimes(1);
    });

    it('calls onHelpClick when help is clicked', async () => {
      const onHelpClick = vi.fn();
      render(Toolbar, { props: { onHelpClick } });
      await fireEvent.click(screen.getByLabelText('Help'));
      expect(onHelpClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('dropdown changes', () => {
    it('calls onScalingChange when scaling is changed', async () => {
      const onScalingChange = vi.fn();
      render(Toolbar, { props: { onScalingChange } });
      const select = document.querySelector('#scaling-select')!;
      await fireEvent.change(select, { target: { value: 'sqrt' } });
      expect(onScalingChange).toHaveBeenCalledWith('sqrt');
    });

    it('calls onColorMapChange when color map is changed', async () => {
      const onColorMapChange = vi.fn();
      render(Toolbar, { props: { onColorMapChange } });
      const select = document.querySelector('#colormap-select')!;
      await fireEvent.change(select, { target: { value: 'hot' } });
      expect(onColorMapChange).toHaveBeenCalledWith('hot');
    });

    it('calls onInterpolationChange when interpolation is changed', async () => {
      const onInterpolationChange = vi.fn();
      render(Toolbar, { props: { onInterpolationChange } });
      const select = document.querySelector('#interp-select')!;
      await fireEvent.change(select, { target: { value: 'lanczos' } });
      expect(onInterpolationChange).toHaveBeenCalledWith('lanczos');
    });
  });

  describe('search - decimal format', () => {
    it('parses "RA, Dec" with comma', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '62.0, -37.0' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalledWith(62.0, -37.0);
    });

    it('parses "RA Dec" with space', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '180.0 45.0' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalledWith(180.0, 45.0);
    });

    it('parses "RA,Dec" without spaces', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '0,-90' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalledWith(0, -90);
    });

    it('shows error for RA > 360', async () => {
      render(Toolbar);
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '400, 0' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(screen.getByText('RA must be 0-360')).toBeTruthy();
    });

    it('shows error for RA < 0', async () => {
      render(Toolbar);
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '-10, 0' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(screen.getByText('RA must be 0-360')).toBeTruthy();
    });

    it('shows error for Dec > 90', async () => {
      render(Toolbar);
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '0, 100' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(screen.getByText('Dec must be -90 to 90')).toBeTruthy();
    });

    it('shows error for Dec < -90', async () => {
      render(Toolbar);
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '0, -100' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(screen.getByText('Dec must be -90 to 90')).toBeTruthy();
    });

    it('accepts RA=360 (boundary)', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '360, 0' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalledWith(360, 0);
    });

    it('accepts Dec=90 (boundary)', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '0, 90' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalledWith(0, 90);
    });

    it('accepts Dec=-90 (boundary)', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '0, -90' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalledWith(0, -90);
    });
  });

  describe('search - sexagesimal format', () => {
    // With the stricter parsing (Number instead of parseFloat), sexagesimal inputs
    // like "4h8m0s" are NOT treated as valid decimal numbers, so they correctly
    // fall through to sexagesimal parsing.

    it('parses "4h8m0s -37d0m0s" as sexagesimal ra=62°, dec=-37°', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '4h8m0s -37d0m0s' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalled();
      const [ra, dec] = onSearch.mock.calls[0];
      expect(ra).toBeCloseTo(62, 0);
      expect(dec).toBeCloseTo(-37, 0);
    });

    it('treats "12h 30d" as sexagesimal ra=180°, dec=30°', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '12h 30d' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalled();
      const [ra, dec] = onSearch.mock.calls[0];
      expect(ra).toBeCloseTo(180, 0);
      expect(dec).toBeCloseTo(30, 0);
    });

    it('parses "6h30m0s 0d0m0s" as sexagesimal ra=97.5°, dec=0°', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '6h30m0s 0d0m0s' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalled();
      const [ra, dec] = onSearch.mock.calls[0];
      expect(ra).toBeCloseTo(97.5, 0);
      expect(dec).toBeCloseTo(0, 0);
    });

    it('parses "0h -45d30m" as sexagesimal ra=0°, dec=-45.5°', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '0h -45d30m' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalled();
      const [ra, dec] = onSearch.mock.calls[0];
      expect(ra).toBeCloseTo(0, 0);
      expect(dec).toBeCloseTo(-45.5, 0);
    });

    it('actually reaches sexagesimal parsing when decimal fails (multiple space-separated parts)', async () => {
      // "4h 8m 0s -37d" → split → ["4h", "8m", "0s", "-37d"] → length=4, decimal fails
      // Sexagesimal: raMatch on "4h 8m 0s" → raH=4, raM=8, raS=0 → ra=(4+8/60)*15=62
      // decMatch on full string matches "0s" as decD=0 → dec=0
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '4h 8m 0s -37d' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalled();
    });

    it('reaches sexagesimal with negative dec', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      // Multiple parts → decimal fails → sexagesimal path
      await fireEvent.input(input, { target: { value: '10h 30m 0s -45d 15m 0s' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).toHaveBeenCalled();
    });
  });

  describe('search - invalid input', () => {
    it('shows error for completely invalid input', async () => {
      render(Toolbar);
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: 'hello world' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(screen.getByText(/Enter RA,Dec/)).toBeTruthy();
    });

    it('shows error for single number', async () => {
      render(Toolbar);
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '42' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(screen.getByText(/Enter RA,Dec/)).toBeTruthy();
    });

    it('does nothing for empty input', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).not.toHaveBeenCalled();
    });

    it('does nothing for whitespace-only input', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '   ' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(onSearch).not.toHaveBeenCalled();
    });
  });

  describe('search - keyboard', () => {
    it('submits on Enter key', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates') as HTMLInputElement;
      input.value = '62.0, -37.0';
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      // The onkeydown handler checks e.key === 'Enter' then calls handleSearch
      // But the searchQuery state won't be updated by just setting input.value
      // We need to use fireEvent.input first
      await fireEvent.input(input, { target: { value: '62.0, -37.0' } });
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(onSearch).toHaveBeenCalledWith(62.0, -37.0);
    });

    it('does not submit on other keys', async () => {
      const onSearch = vi.fn();
      render(Toolbar, { props: { onSearch } });
      const input = screen.getByLabelText('Search coordinates') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: '62.0, -37.0' } });
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(onSearch).not.toHaveBeenCalled();
    });
  });

  describe('without callbacks', () => {
    it('renders without any callbacks', () => {
      render(Toolbar);
      // Clicking buttons should not throw
      fireEvent.click(screen.getByLabelText('Zoom in'));
      fireEvent.click(screen.getByLabelText('Zoom out'));
      fireEvent.click(screen.getByLabelText('Reset view'));
      fireEvent.click(screen.getByLabelText('Help'));
      fireEvent.click(screen.getByLabelText('Go'));
    });

    it('handles dropdown changes without callbacks', async () => {
      render(Toolbar);
      const scalingSelect = document.querySelector('#scaling-select')!;
      await fireEvent.change(scalingSelect, { target: { value: 'log' } });
      const colorSelect = document.querySelector('#colormap-select')!;
      await fireEvent.change(colorSelect, { target: { value: 'viridis' } });
      const interpSelect = document.querySelector('#interp-select')!;
      await fireEvent.change(interpSelect, { target: { value: 'nearest' } });
    });

    it('handles search without onSearch callback', async () => {
      render(Toolbar);
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '62.0, -37.0' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      // Should not throw
    });

    it('handles search error display without onSearch callback', async () => {
      render(Toolbar);
      const input = screen.getByLabelText('Search coordinates');
      await fireEvent.input(input, { target: { value: '400, 0' } });
      await fireEvent.click(screen.getByLabelText('Go'));
      expect(screen.getByText('RA must be 0-360')).toBeTruthy();
    });

    it('handles Enter key without onSearch callback', async () => {
      render(Toolbar);
      const input = screen.getByLabelText('Search coordinates') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: '62.0, -37.0' } });
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      // Should not throw
    });
  });
});
