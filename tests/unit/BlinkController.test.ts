import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import BlinkController from '../../src/components/BlinkController.svelte';

const mockTargets = [
  { id: 'epoch-1', label: 'Epoch 1 (g)' },
  { id: 'epoch-2', label: 'Epoch 2 (r)' },
  { id: 'epoch-3', label: 'Epoch 3 (i)' },
  { id: 'epoch-4', label: 'Epoch 4 (g)' },
  { id: 'epoch-5', label: 'Epoch 5 (r)' },
];

describe('BlinkController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('renders the blink controller region', () => {
      render(BlinkController, { props: { targets: mockTargets } });
      expect(screen.getByRole('region', { name: 'Blink controls' })).toBeTruthy();
    });

    it('renders step back button', () => {
      render(BlinkController, { props: { targets: mockTargets } });
      expect(screen.getByLabelText('Blink step back')).toBeTruthy();
    });

    it('renders step forward button', () => {
      render(BlinkController, { props: { targets: mockTargets } });
      expect(screen.getByLabelText('Blink step forward')).toBeTruthy();
    });

    it('renders play button', () => {
      render(BlinkController, { props: { targets: mockTargets } });
      expect(screen.getByLabelText('Start blink')).toBeTruthy();
    });

    it('renders rate slider', () => {
      render(BlinkController, { props: { targets: mockTargets } });
      expect(screen.getByLabelText('Blink rate')).toBeTruthy();
    });

    it('displays initial target info', () => {
      render(BlinkController, { props: { targets: mockTargets, currentIndex: 0 } });
      expect(screen.getByText('1 / 5')).toBeTruthy();
      const label = screen.getByTitle('Current target');
      expect(label.textContent).toBe('Epoch 1 (g)');
    });

    it('displays current target info for non-zero index', () => {
      render(BlinkController, { props: { targets: mockTargets, currentIndex: 2 } });
      expect(screen.getByText('3 / 5')).toBeTruthy();
      const label = screen.getByTitle('Current target');
      expect(label.textContent).toBe('Epoch 3 (i)');
    });

    it('renders target list', () => {
      render(BlinkController, { props: { targets: mockTargets } });
      expect(screen.getByRole('list', { name: 'Blink targets' })).toBeTruthy();
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(5);
    });

    it('highlights current target in list', () => {
      render(BlinkController, { props: { targets: mockTargets, currentIndex: 1 } });
      const activeBtn = screen.getByLabelText('Target: Epoch 2 (r)');
      expect(activeBtn.getAttribute('aria-current')).toBe('true');
    });

    it('shows default rate', () => {
      render(BlinkController, { props: { targets: mockTargets } });
      expect(screen.getByText('1.0s')).toBeTruthy();
    });

    it('shows custom rate', () => {
      render(BlinkController, { props: { targets: mockTargets, rate: 2.5 } });
      expect(screen.getByText('2.5s')).toBeTruthy();
    });
  });

  describe('empty targets', () => {
    it('shows "No targets" when empty', () => {
      render(BlinkController);
      expect(screen.getByText('No targets')).toBeTruthy();
    });

    it('disables play button with no targets', () => {
      render(BlinkController);
      expect(screen.getByLabelText('Start blink').hasAttribute('disabled')).toBe(true);
    });

    it('does not render target list when empty', () => {
      render(BlinkController);
      expect(screen.queryByRole('list', { name: 'Blink targets' })).toBeNull();
    });
  });

  describe('step controls', () => {
    it('step back is disabled at first target', () => {
      render(BlinkController, { props: { targets: mockTargets, currentIndex: 0 } });
      expect(screen.getByLabelText('Blink step back').hasAttribute('disabled')).toBe(true);
    });

    it('step forward is disabled at last target', () => {
      render(BlinkController, { props: { targets: mockTargets, currentIndex: 4 } });
      expect(screen.getByLabelText('Blink step forward').hasAttribute('disabled')).toBe(true);
    });

    it('calls onTargetChange when clicking step forward', async () => {
      const onTargetChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 0, onTargetChange },
      });

      await fireEvent.click(screen.getByLabelText('Blink step forward'));
      expect(onTargetChange).toHaveBeenCalledWith(1, mockTargets[1]);
    });

    it('calls onTargetChange when clicking step back', async () => {
      const onTargetChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 2, onTargetChange },
      });

      await fireEvent.click(screen.getByLabelText('Blink step back'));
      expect(onTargetChange).toHaveBeenCalledWith(1, mockTargets[1]);
    });

    it('does not step back at first target', async () => {
      const onTargetChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 0, onTargetChange },
      });

      await fireEvent.click(screen.getByLabelText('Blink step back'));
      expect(onTargetChange).not.toHaveBeenCalled();
    });

    it('does not step forward at last target', async () => {
      const onTargetChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 4, onTargetChange },
      });

      await fireEvent.click(screen.getByLabelText('Blink step forward'));
      expect(onTargetChange).not.toHaveBeenCalled();
    });
  });

  describe('target list clicks', () => {
    it('calls onTargetChange when clicking a target in list', async () => {
      const onTargetChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 0, onTargetChange },
      });

      await fireEvent.click(screen.getByLabelText('Target: Epoch 3 (i)'));
      expect(onTargetChange).toHaveBeenCalledWith(2, mockTargets[2]);
    });

    it('updates display when clicking target in list', async () => {
      render(BlinkController, { props: { targets: mockTargets, currentIndex: 0 } });
      await fireEvent.click(screen.getByLabelText('Target: Epoch 4 (g)'));
      expect(screen.getByText('4 / 5')).toBeTruthy();
    });
  });

  describe('playback', () => {
    it('toggles play state when clicking play button', async () => {
      const onPlayStateChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 0, onPlayStateChange },
      });

      await fireEvent.click(screen.getByLabelText('Start blink'));
      expect(onPlayStateChange).toHaveBeenCalledWith(true);
    });

    it('shows stop button when playing', async () => {
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 0, playing: false },
      });

      await fireEvent.click(screen.getByLabelText('Start blink'));
      expect(screen.getByLabelText('Stop blink')).toBeTruthy();
    });

    it('advances targets during blink', async () => {
      const onTargetChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 0, rate: 0.5, onTargetChange },
      });

      await fireEvent.click(screen.getByLabelText('Start blink'));

      vi.advanceTimersByTime(600);
      await waitFor(() => {
        expect(onTargetChange).toHaveBeenCalledWith(1, mockTargets[1]);
      });

      vi.advanceTimersByTime(500);
      await waitFor(() => {
        expect(onTargetChange).toHaveBeenCalledWith(2, mockTargets[2]);
      });
    });

    it('wraps around at the end during blink', async () => {
      const onTargetChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 4, rate: 0.3, onTargetChange },
      });

      await fireEvent.click(screen.getByLabelText('Start blink'));

      vi.advanceTimersByTime(400);
      await waitFor(() => {
        // Should wrap to index 0
        expect(onTargetChange).toHaveBeenCalledWith(0, mockTargets[0]);
      });
    });

    it('toggles off with stop button', async () => {
      const onPlayStateChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 0, playing: false, onPlayStateChange },
      });

      await fireEvent.click(screen.getByLabelText('Start blink'));
      expect(onPlayStateChange).toHaveBeenCalledWith(true);

      await fireEvent.click(screen.getByLabelText('Stop blink'));
      expect(onPlayStateChange).toHaveBeenCalledWith(false);
    });

    it('does not start blink with no targets', async () => {
      const onPlayStateChange = vi.fn();
      render(BlinkController, { props: { onPlayStateChange } });

      await fireEvent.click(screen.getByLabelText('Start blink'));
      expect(onPlayStateChange).not.toHaveBeenCalled();
    });
  });

  describe('rate control', () => {
    it('calls onRateChange when rate slider changes', async () => {
      const onRateChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, onRateChange },
      });

      const slider = screen.getByLabelText('Blink rate');
      await fireEvent.input(slider, { target: { value: '2.5' } });
      expect(onRateChange).toHaveBeenCalledWith(2.5);
    });

    it('updates display when rate changes', async () => {
      render(BlinkController, { props: { targets: mockTargets } });
      const slider = screen.getByLabelText('Blink rate');
      await fireEvent.input(slider, { target: { value: '3.0' } });
      expect(screen.getByText('3.0s')).toBeTruthy();
    });

    it('restarts blink with new rate when playing', async () => {
      const onTargetChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, currentIndex: 0, rate: 1.0, onTargetChange },
      });

      // Start blink
      await fireEvent.click(screen.getByLabelText('Start blink'));

      // Change rate while playing
      const slider = screen.getByLabelText('Blink rate');
      await fireEvent.input(slider, { target: { value: '0.3' } });

      // Should use new rate
      vi.advanceTimersByTime(400);
      await waitFor(() => {
        expect(onTargetChange).toHaveBeenCalled();
      });
    });

    it('rate slider range is 0.2-5', () => {
      render(BlinkController, { props: { targets: mockTargets } });
      const slider = screen.getByLabelText('Blink rate') as HTMLInputElement;
      expect(slider.min).toBe('0.2');
      expect(slider.max).toBe('5');
    });
  });

  describe('keyboard', () => {
    it('toggles blink with B key', async () => {
      const onPlayStateChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, onPlayStateChange },
      });

      fireEvent.keyDown(window, { key: 'b' });
      expect(onPlayStateChange).toHaveBeenCalledWith(true);
    });

    it('toggles blink off with B key', async () => {
      const onPlayStateChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, playing: true, onPlayStateChange },
      });

      fireEvent.keyDown(window, { key: 'b' });
      expect(onPlayStateChange).toHaveBeenCalledWith(false);
    });

    it('handles uppercase B key', async () => {
      const onPlayStateChange = vi.fn();
      render(BlinkController, {
        props: { targets: mockTargets, onPlayStateChange },
      });

      fireEvent.keyDown(window, { key: 'B' });
      expect(onPlayStateChange).toHaveBeenCalledWith(true);
    });
  });

  describe('cleanup', () => {
    it('clears interval on unmount', async () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const { unmount } = render(BlinkController, {
        props: { targets: mockTargets, playing: false, rate: 0.5 },
      });

      await fireEvent.click(screen.getByLabelText('Start blink'));
      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('without callbacks', () => {
    it('handles clicks without callbacks', async () => {
      render(BlinkController, { props: { targets: mockTargets } });
      await fireEvent.click(screen.getByLabelText('Start blink'));
      await fireEvent.click(screen.getByLabelText('Stop blink'));
      await fireEvent.click(screen.getByLabelText('Blink step forward'));
      await fireEvent.click(screen.getByLabelText('Blink step back'));
      // Should not throw
    });

    it('handles rate change without onRateChange', async () => {
      render(BlinkController, { props: { targets: mockTargets } });
      const slider = screen.getByLabelText('Blink rate');
      await fireEvent.input(slider, { target: { value: '2.0' } });
      expect(screen.getByText('2.0s')).toBeTruthy();
    });

    it('handles keyboard without callbacks', () => {
      render(BlinkController, { props: { targets: mockTargets } });
      fireEvent.keyDown(window, { key: 'b' });
      // Should not throw
    });

    it('handles target click without onTargetChange', async () => {
      render(BlinkController, { props: { targets: mockTargets } });
      await fireEvent.click(screen.getByLabelText('Target: Epoch 2 (r)'));
      expect(screen.getByText('2 / 5')).toBeTruthy();
    });
  });
});
