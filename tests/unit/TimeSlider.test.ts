import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TimeSlider from '../../src/components/TimeSlider.svelte';
import type { Epoch } from '../../src/types/image.js';

const mockEpochs: Epoch[] = [
  { mjd: 60000.0, isoDate: '2023-02-25', filter: 'g', exposureId: 'exp-001' },
  { mjd: 60025.5, isoDate: '2023-03-22', filter: 'r', exposureId: 'exp-002' },
  { mjd: 60050.0, isoDate: '2023-04-16', filter: 'i', exposureId: 'exp-003' },
  { mjd: 60075.5, isoDate: '2023-05-11', filter: 'g', exposureId: 'exp-004' },
  { mjd: 60100.0, isoDate: '2023-06-05', filter: 'r', exposureId: 'exp-005' },
];

describe('TimeSlider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('renders the time slider container', () => {
      render(TimeSlider, { props: { epochs: mockEpochs } });
      const region = screen.getByRole('region', { name: 'Time series controls' });
      expect(region).toBeTruthy();
    });

    it('renders play button', () => {
      render(TimeSlider, { props: { epochs: mockEpochs } });
      expect(screen.getByLabelText('Play')).toBeTruthy();
    });

    it('renders previous epoch button', () => {
      render(TimeSlider, { props: { epochs: mockEpochs } });
      expect(screen.getByLabelText('Previous epoch')).toBeTruthy();
    });

    it('renders next epoch button', () => {
      render(TimeSlider, { props: { epochs: mockEpochs } });
      expect(screen.getByLabelText('Next epoch')).toBeTruthy();
    });

    it('renders epoch slider', () => {
      render(TimeSlider, { props: { epochs: mockEpochs } });
      expect(screen.getByLabelText('Epoch slider')).toBeTruthy();
    });

    it('renders interval input', () => {
      render(TimeSlider, { props: { epochs: mockEpochs } });
      expect(screen.getByLabelText('Playback interval in milliseconds')).toBeTruthy();
    });

    it('displays initial epoch info', () => {
      render(TimeSlider, { props: { epochs: mockEpochs, currentIndex: 0 } });
      expect(screen.getByText('1 / 5')).toBeTruthy();
      expect(screen.getByText('MJD 60000.00')).toBeTruthy();
      expect(screen.getByText('2023-02-25')).toBeTruthy();
      expect(screen.getByText('g')).toBeTruthy();
    });

    it('displays current epoch info for non-zero index', () => {
      render(TimeSlider, { props: { epochs: mockEpochs, currentIndex: 2 } });
      expect(screen.getByText('3 / 5')).toBeTruthy();
      expect(screen.getByText('MJD 60050.00')).toBeTruthy();
      expect(screen.getByText('2023-04-16')).toBeTruthy();
      expect(screen.getByText('i')).toBeTruthy();
    });

    it('renders with empty epochs', () => {
      render(TimeSlider, { props: { epochs: [] } });
      const region = screen.getByRole('region', { name: 'Time series controls' });
      expect(region).toBeTruthy();
      expect(screen.getByText('1 / 0')).toBeTruthy();
    });
  });

  describe('step controls', () => {
    it('previous button is disabled at first epoch', () => {
      render(TimeSlider, { props: { epochs: mockEpochs, currentIndex: 0 } });
      const prevBtn = screen.getByLabelText('Previous epoch');
      expect(prevBtn.hasAttribute('disabled')).toBe(true);
    });

    it('next button is disabled at last epoch', () => {
      render(TimeSlider, { props: { epochs: mockEpochs, currentIndex: 4 } });
      const nextBtn = screen.getByLabelText('Next epoch');
      expect(nextBtn.hasAttribute('disabled')).toBe(true);
    });

    it('calls onEpochChange when clicking next', async () => {
      const onEpochChange = vi.fn();
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 0, onEpochChange },
      });

      await fireEvent.click(screen.getByLabelText('Next epoch'));
      expect(onEpochChange).toHaveBeenCalledWith(1, mockEpochs[1]);
    });

    it('calls onEpochChange when clicking previous', async () => {
      const onEpochChange = vi.fn();
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 2, onEpochChange },
      });

      await fireEvent.click(screen.getByLabelText('Previous epoch'));
      expect(onEpochChange).toHaveBeenCalledWith(1, mockEpochs[1]);
    });

    it('does not go below index 0', async () => {
      const onEpochChange = vi.fn();
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 0, onEpochChange },
      });

      const prevBtn = screen.getByLabelText('Previous epoch');
      await fireEvent.click(prevBtn);
      expect(onEpochChange).not.toHaveBeenCalled();
    });

    it('does not go above last index', async () => {
      const onEpochChange = vi.fn();
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 4, onEpochChange },
      });

      const nextBtn = screen.getByLabelText('Next epoch');
      await fireEvent.click(nextBtn);
      expect(onEpochChange).not.toHaveBeenCalled();
    });
  });

  describe('slider input', () => {
    it('calls onEpochChange when slider value changes', async () => {
      const onEpochChange = vi.fn();
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 0, onEpochChange },
      });

      const slider = screen.getByLabelText('Epoch slider');
      await fireEvent.input(slider, { target: { value: '3' } });
      expect(onEpochChange).toHaveBeenCalledWith(3, mockEpochs[3]);
    });

    it('updates display when slider changes', async () => {
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 0 },
      });

      const slider = screen.getByLabelText('Epoch slider');
      await fireEvent.input(slider, { target: { value: '2' } });
      expect(screen.getByText('3 / 5')).toBeTruthy();
    });
  });

  describe('playback', () => {
    it('toggles play state when clicking play button', async () => {
      const onPlayStateChange = vi.fn();
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 0, onPlayStateChange },
      });

      await fireEvent.click(screen.getByLabelText('Play'));
      expect(onPlayStateChange).toHaveBeenCalledWith(true);
    });

    it('changes button label to Pause when playing', async () => {
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 0, playing: false },
      });

      await fireEvent.click(screen.getByLabelText('Play'));
      expect(screen.getByLabelText('Pause')).toBeTruthy();
    });

    it('advances epoch during playback', async () => {
      const onEpochChange = vi.fn();
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 0, interval: 200, onEpochChange },
      });

      await fireEvent.click(screen.getByLabelText('Play'));

      vi.advanceTimersByTime(250);
      await waitFor(() => {
        expect(onEpochChange).toHaveBeenCalledWith(1, mockEpochs[1]);
      });

      vi.advanceTimersByTime(200);
      await waitFor(() => {
        expect(onEpochChange).toHaveBeenCalledWith(2, mockEpochs[2]);
      });
    });

    it('stops at last epoch during playback', async () => {
      const shortEpochs = mockEpochs.slice(0, 2);
      const onEpochChange = vi.fn();
      render(TimeSlider, {
        props: {
          epochs: shortEpochs,
          currentIndex: 0,
          interval: 100,
          onEpochChange,
        },
      });

      // Start playback by clicking play
      await fireEvent.click(screen.getByLabelText('Play'));

      // Advance past the tick - should advance to last epoch
      vi.advanceTimersByTime(150);
      await waitFor(() => {
        expect(onEpochChange).toHaveBeenCalledWith(1, shortEpochs[1]);
      });

      // Advance another tick - should auto-stop since at last epoch
      vi.advanceTimersByTime(100);
      await waitFor(() => {
        expect(screen.getByLabelText('Play')).toBeTruthy();
      });
    });

    it('toggles off with pause button', async () => {
      const onPlayStateChange = vi.fn();
      render(TimeSlider, {
        props: {
          epochs: mockEpochs,
          currentIndex: 0,
          playing: false,
          interval: 100,
          onPlayStateChange,
        },
      });

      // Start playing first
      await fireEvent.click(screen.getByLabelText('Play'));
      expect(onPlayStateChange).toHaveBeenCalledWith(true);

      // Then pause
      await fireEvent.click(screen.getByLabelText('Pause'));
      expect(onPlayStateChange).toHaveBeenCalledWith(false);
    });

    it('play is disabled with no epochs', () => {
      render(TimeSlider, { props: { epochs: [] } });
      const playBtn = screen.getByLabelText('Play');
      expect(playBtn.hasAttribute('disabled')).toBe(true);
    });

    it('restarts playback with new interval', async () => {
      const onEpochChange = vi.fn();
      render(TimeSlider, {
        props: { epochs: mockEpochs, currentIndex: 0, interval: 1000, onEpochChange },
      });

      // Start playback
      await fireEvent.click(screen.getByLabelText('Play'));

      // Change interval
      const intervalInput = screen.getByLabelText('Playback interval in milliseconds');
      await fireEvent.input(intervalInput, { target: { value: '200' } });

      // Should advance faster now
      vi.advanceTimersByTime(250);
      await waitFor(() => {
        expect(onEpochChange).toHaveBeenCalled();
      });
    });
  });

  describe('interval control', () => {
    it('displays default interval', () => {
      render(TimeSlider, { props: { epochs: mockEpochs } });
      const input = screen.getByLabelText('Playback interval in milliseconds') as HTMLInputElement;
      expect(input.value).toBe('1000');
    });

    it('displays custom interval', () => {
      render(TimeSlider, { props: { epochs: mockEpochs, interval: 500 } });
      const input = screen.getByLabelText('Playback interval in milliseconds') as HTMLInputElement;
      expect(input.value).toBe('500');
    });

    it('ignores intervals below 100ms', async () => {
      render(TimeSlider, { props: { epochs: mockEpochs, interval: 1000 } });
      const input = screen.getByLabelText('Playback interval in milliseconds');
      await fireEvent.input(input, { target: { value: '50' } });
      // Interval should not change
      expect((input as HTMLInputElement).value).toBe('50');
    });
  });

  describe('cleanup', () => {
    it('clears interval on unmount after starting playback', async () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const { unmount } = render(TimeSlider, {
        props: { epochs: mockEpochs, playing: false, interval: 100 },
      });

      // Start playback to create a timer
      await fireEvent.click(screen.getByLabelText('Play'));

      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
