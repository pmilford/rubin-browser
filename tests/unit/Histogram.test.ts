import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Histogram from '../../src/components/Histogram.svelte';

describe('Histogram', () => {
  describe('rendering', () => {
    it('renders the histogram region', () => {
      render(Histogram);
      expect(screen.getByRole('region', { name: 'Pixel histogram' })).toBeTruthy();
    });

    it('renders histogram title', () => {
      render(Histogram);
      expect(screen.getByText('Histogram')).toBeTruthy();
    });

    it('renders range display', () => {
      render(Histogram, { props: { min: 0, max: 1 } });
      expect(screen.getByText('[0.00, 1.00]')).toBeTruthy();
    });

    it('shows pixel count', () => {
      const data = [0.1, 0.2, 0.3, 0.4, 0.5];
      render(Histogram, { props: { data } });
      expect(screen.getByText('5 px')).toBeTruthy();
    });

    it('shows 0 px for empty data', () => {
      render(Histogram);
      expect(screen.getByText('0 px')).toBeTruthy();
    });

    it('shows "No pixel data" when no data', () => {
      render(Histogram);
      expect(screen.getByText('No pixel data')).toBeTruthy();
    });

    it('renders chart when data is provided', () => {
      const data = Array.from({ length: 100 }, (_, i) => i / 100);
      render(Histogram, { props: { data } });
      expect(screen.getByRole('img', { name: 'Histogram chart' })).toBeTruthy();
    });
  });

  describe('stretch controls', () => {
    it('renders stretch min slider', () => {
      render(Histogram);
      expect(screen.getByLabelText('Stretch minimum')).toBeTruthy();
    });

    it('renders stretch max slider', () => {
      render(Histogram);
      expect(screen.getByLabelText('Stretch maximum')).toBeTruthy();
    });

    it('displays initial stretch values', () => {
      render(Histogram, { props: { stretchMin: 0.2, stretchMax: 0.8 } });
      expect(screen.getByText('0.200')).toBeTruthy();
      expect(screen.getByText('0.800')).toBeTruthy();
    });

    it('calls onStretchChange when min slider changes', async () => {
      const onStretchChange = vi.fn();
      render(Histogram, { props: { onStretchChange, min: 0, max: 1 } });

      const slider = screen.getByLabelText('Stretch minimum');
      await fireEvent.input(slider, { target: { value: '0.3' } });
      expect(onStretchChange).toHaveBeenCalledWith(0.3, 1);
    });

    it('calls onStretchChange when max slider changes', async () => {
      const onStretchChange = vi.fn();
      render(Histogram, { props: { onStretchChange, min: 0, max: 1 } });

      const slider = screen.getByLabelText('Stretch maximum');
      await fireEvent.input(slider, { target: { value: '0.7' } });
      expect(onStretchChange).toHaveBeenCalledWith(0, 0.7);
    });

    it('clamps stretchMin to not exceed stretchMax', async () => {
      const onStretchChange = vi.fn();
      render(Histogram, { props: { onStretchChange, stretchMin: 0.3, stretchMax: 0.7, min: 0, max: 1 } });

      const slider = screen.getByLabelText('Stretch minimum');
      await fireEvent.input(slider, { target: { value: '0.9' } });
      expect(onStretchChange).toHaveBeenCalledWith(0.7, 0.7);
    });

    it('clamps stretchMax to not go below stretchMin', async () => {
      const onStretchChange = vi.fn();
      render(Histogram, { props: { onStretchChange, stretchMin: 0.3, stretchMax: 0.7, min: 0, max: 1 } });

      const slider = screen.getByLabelText('Stretch maximum');
      await fireEvent.input(slider, { target: { value: '0.1' } });
      expect(onStretchChange).toHaveBeenCalledWith(0.3, 0.3);
    });
  });

  describe('histogram computation', () => {
    it('computes histogram bins correctly', () => {
      const data = [0, 0, 0.5, 0.5, 1, 1];
      render(Histogram, { props: { data, bins: 4, min: 0, max: 1 } });
      expect(screen.getByText('6 px')).toBeTruthy();
    });

    it('handles custom min/max range', () => {
      const data = [100, 200, 300, 400, 500];
      render(Histogram, { props: { data, min: 0, max: 1000 } });
      expect(screen.getByText('[0.00, 1000.00]')).toBeTruthy();
      expect(screen.getByText('5 px')).toBeTruthy();
    });

    it('handles data outside range', () => {
      const data = [-1, 0.5, 2, 0.7];
      render(Histogram, { props: { data, min: 0, max: 1 } });
      expect(screen.getByText('4 px')).toBeTruthy();
    });
  });

  describe('without callbacks', () => {
    it('handles slider changes without onStretchChange', async () => {
      render(Histogram, { props: { min: 0, max: 1 } });
      const slider = screen.getByLabelText('Stretch minimum');
      await fireEvent.input(slider, { target: { value: '0.5' } });
      expect(screen.getByText('0.500')).toBeTruthy();
    });
  });
});
