import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FilterSelector from '../../src/components/FilterSelector.svelte';

describe('FilterSelector', () => {
  describe('rendering', () => {
    it('renders the filter selector group', () => {
      render(FilterSelector);
      expect(screen.getByRole('group', { name: 'Filter selection' })).toBeTruthy();
    });

    it('renders all 6 LSST filter buttons', () => {
      render(FilterSelector);
      expect(screen.getByLabelText('u filter')).toBeTruthy();
      expect(screen.getByLabelText('g filter')).toBeTruthy();
      expect(screen.getByLabelText('r filter')).toBeTruthy();
      expect(screen.getByLabelText('i filter')).toBeTruthy();
      expect(screen.getByLabelText('z filter')).toBeTruthy();
      expect(screen.getByLabelText('y filter')).toBeTruthy();
    });

    it('renders filter wavelengths', () => {
      render(FilterSelector);
      expect(screen.getByText('367 nm')).toBeTruthy();
      expect(screen.getByText('482 nm')).toBeTruthy();
      expect(screen.getByText('622 nm')).toBeTruthy();
      expect(screen.getByText('754 nm')).toBeTruthy();
      expect(screen.getByText('869 nm')).toBeTruthy();
      expect(screen.getByText('971 nm')).toBeTruthy();
    });

    it('renders single and RGB mode buttons', () => {
      render(FilterSelector);
      expect(screen.getByLabelText('Single filter mode')).toBeTruthy();
      expect(screen.getByLabelText('RGB composite mode')).toBeTruthy();
    });

    it('starts in single mode by default', () => {
      render(FilterSelector);
      const singleBtn = screen.getByLabelText('Single filter mode');
      expect(singleBtn.getAttribute('aria-pressed')).toBe('true');
      const rgbBtn = screen.getByLabelText('RGB composite mode');
      expect(rgbBtn.getAttribute('aria-pressed')).toBe('false');
    });

    it('renders no filter as active by default', () => {
      render(FilterSelector);
      const uBtn = screen.getByLabelText('u filter');
      expect(uBtn.getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('single filter mode', () => {
    it('activates filter on click', async () => {
      render(FilterSelector);
      const gBtn = screen.getByLabelText('g filter');
      await fireEvent.click(gBtn);
      expect(gBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onFilterChange when filter is clicked', async () => {
      const onFilterChange = vi.fn();
      render(FilterSelector, { props: { onFilterChange } });
      await fireEvent.click(screen.getByLabelText('r filter'));
      expect(onFilterChange).toHaveBeenCalledWith('r');
    });

    it('deactivates filter when clicking the active filter again', async () => {
      const onFilterChange = vi.fn();
      render(FilterSelector, { props: { onFilterChange } });
      const rBtn = screen.getByLabelText('r filter');
      await fireEvent.click(rBtn);
      expect(onFilterChange).toHaveBeenCalledWith('r');
      await fireEvent.click(rBtn);
      expect(onFilterChange).toHaveBeenCalledWith(null);
    });

    it('only one filter active at a time', async () => {
      render(FilterSelector);
      await fireEvent.click(screen.getByLabelText('u filter'));
      expect(screen.getByLabelText('u filter').getAttribute('aria-pressed')).toBe('true');

      await fireEvent.click(screen.getByLabelText('z filter'));
      expect(screen.getByLabelText('z filter').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByLabelText('u filter').getAttribute('aria-pressed')).toBe('false');
    });

    it('accepts initial activeFilter prop', () => {
      render(FilterSelector, { props: { activeFilter: 'i' } });
      expect(screen.getByLabelText('i filter').getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('RGB composite mode', () => {
    it('switches to RGB mode when RGB button is clicked', async () => {
      render(FilterSelector);
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));
      expect(screen.getByLabelText('RGB composite mode').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByLabelText('Single filter mode').getAttribute('aria-pressed')).toBe('false');
    });

    it('shows composite channel buttons in RGB mode', async () => {
      render(FilterSelector);
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));
      expect(screen.getByLabelText('R channel')).toBeTruthy();
      expect(screen.getByLabelText('G channel')).toBeTruthy();
      expect(screen.getByLabelText('B channel')).toBeTruthy();
    });

    it('hides composite channels in single mode', () => {
      render(FilterSelector);
      expect(screen.queryByLabelText('R channel')).toBeNull();
      expect(screen.queryByLabelText('G channel')).toBeNull();
      expect(screen.queryByLabelText('B channel')).toBeNull();
    });

    it('selects a composite channel on click', async () => {
      render(FilterSelector);
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));
      const rChannel = screen.getByLabelText('R channel');
      await fireEvent.click(rChannel);
      expect(rChannel.getAttribute('aria-pressed')).toBe('true');
    });

    it('assigns filter to selected composite channel', async () => {
      const onCompositeChange = vi.fn();
      render(FilterSelector, { props: { onCompositeChange } });
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));

      // Select R channel
      await fireEvent.click(screen.getByLabelText('R channel'));
      // Click filter to assign
      await fireEvent.click(screen.getByLabelText('r filter'));

      expect(onCompositeChange).toHaveBeenCalledWith({ r: 'r', g: null, b: null });
      expect(screen.getByText('R: r')).toBeTruthy();
    });

    it('assigns different filters to R, G, B channels', async () => {
      const onCompositeChange = vi.fn();
      render(FilterSelector, { props: { onCompositeChange } });
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));

      await fireEvent.click(screen.getByLabelText('R channel'));
      await fireEvent.click(screen.getByLabelText('r filter'));

      await fireEvent.click(screen.getByLabelText('G channel'));
      await fireEvent.click(screen.getByLabelText('g filter'));

      await fireEvent.click(screen.getByLabelText('B channel'));
      await fireEvent.click(screen.getByLabelText('i filter'));

      expect(onCompositeChange).toHaveBeenLastCalledWith({ r: 'r', g: 'g', b: 'i' });
    });

    it('shows clear button when channels are assigned', async () => {
      render(FilterSelector);
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));
      expect(screen.queryByLabelText('Clear composite')).toBeNull();

      await fireEvent.click(screen.getByLabelText('R channel'));
      await fireEvent.click(screen.getByLabelText('r filter'));
      expect(screen.getByLabelText('Clear composite')).toBeTruthy();
    });

    it('clears all channels when clear is clicked', async () => {
      const onCompositeChange = vi.fn();
      render(FilterSelector, { props: { onCompositeChange } });
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));

      await fireEvent.click(screen.getByLabelText('R channel'));
      await fireEvent.click(screen.getByLabelText('r filter'));
      await fireEvent.click(screen.getByLabelText('Clear composite'));

      expect(onCompositeChange).toHaveBeenLastCalledWith({ r: null, g: null, b: null });
    });

    it('toggles composite channel selection off on second click', async () => {
      render(FilterSelector);
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));
      const rChannel = screen.getByLabelText('R channel');
      await fireEvent.click(rChannel);
      expect(rChannel.getAttribute('aria-pressed')).toBe('true');
      await fireEvent.click(rChannel);
      expect(rChannel.getAttribute('aria-pressed')).toBe('false');
    });

    it('accepts initial compositeChannels prop', () => {
      render(FilterSelector, {
        props: {
          compositeMode: true,
          compositeChannels: { r: 'r', g: 'g', b: 'i' },
        },
      });
      expect(screen.getByText('R: r')).toBeTruthy();
      expect(screen.getByText('G: g')).toBeTruthy();
      expect(screen.getByText('B: i')).toBeTruthy();
    });

    it('switching back to single mode deselects composite channel', async () => {
      render(FilterSelector);
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));
      await fireEvent.click(screen.getByLabelText('R channel'));
      await fireEvent.click(screen.getByLabelText('Single filter mode'));
      expect(screen.queryByLabelText('R channel')).toBeNull();
    });
  });

  describe('without callbacks', () => {
    it('handles clicks without onFilterChange', async () => {
      render(FilterSelector);
      await fireEvent.click(screen.getByLabelText('u filter'));
      expect(screen.getByLabelText('u filter').getAttribute('aria-pressed')).toBe('true');
    });

    it('handles RGB mode without onCompositeChange', async () => {
      render(FilterSelector);
      await fireEvent.click(screen.getByLabelText('RGB composite mode'));
      await fireEvent.click(screen.getByLabelText('R channel'));
      await fireEvent.click(screen.getByLabelText('r filter'));
      expect(screen.getByText('R: r')).toBeTruthy();
    });

    it('handles clear without onCompositeChange', async () => {
      render(FilterSelector, {
        props: {
          compositeMode: true,
          compositeChannels: { r: 'r', g: null, b: null },
        },
      });
      await fireEvent.click(screen.getByLabelText('Clear composite'));
      expect(screen.getByText('R: —')).toBeTruthy();
    });
  });
});
