import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PixelReadout from '../../src/components/PixelReadout.svelte';

describe('PixelReadout', () => {
  describe('rendering', () => {
    it('renders when visible is true', () => {
      render(PixelReadout, { props: { visible: true, ra: 62.0, dec: -37.0, pixelValue: 0.5 } });
      expect(screen.getByRole('status', { name: 'Pixel readout' })).toBeTruthy();
    });

    it('does not render when visible is false', () => {
      render(PixelReadout, { props: { visible: false } });
      expect(screen.queryByRole('status', { name: 'Pixel readout' })).toBeNull();
    });

    it('renders RA label and value', () => {
      render(PixelReadout, { props: { visible: true, ra: 62.0 } });
      expect(screen.getByText('RA')).toBeTruthy();
      expect(screen.getByText('62.0000°')).toBeTruthy();
    });

    it('renders Dec label and value', () => {
      render(PixelReadout, { props: { visible: true, dec: -37.0 } });
      expect(screen.getByText('Dec')).toBeTruthy();
      expect(screen.getByText('-37.0000°')).toBeTruthy();
    });

    it('renders pixel value', () => {
      render(PixelReadout, { props: { visible: true, pixelValue: 0.1234 } });
      expect(screen.getByText('Value')).toBeTruthy();
      expect(screen.getByText('0.1234')).toBeTruthy();
    });

    it('shows dash for null pixel value', () => {
      render(PixelReadout, { props: { visible: true, pixelValue: null } });
      expect(screen.getByText('—')).toBeTruthy();
    });

    it('formats RA in sexagesimal', () => {
      render(PixelReadout, { props: { visible: true, ra: 90.0 } });
      // 90° / 15 = 6h
      expect(screen.getByText('06h00m00.00s')).toBeTruthy();
    });

    it('formats Dec in sexagesimal with sign', () => {
      render(PixelReadout, { props: { visible: true, dec: 45.5 } });
      expect(screen.getByText('+45d30m00.0s')).toBeTruthy();
    });

    it('formats negative Dec', () => {
      render(PixelReadout, { props: { visible: true, dec: -12.5 } });
      expect(screen.getByText('-12d30m00.0s')).toBeTruthy();
    });

    it('shows pixel coordinates when provided', () => {
      render(PixelReadout, { props: { visible: true, ra: 0, dec: 0, pixelX: 128, pixelY: 256 } });
      expect(screen.getByText('X,Y')).toBeTruthy();
      expect(screen.getByText('128, 256')).toBeTruthy();
    });

    it('hides pixel coordinates when null', () => {
      render(PixelReadout, { props: { visible: true, ra: 0, dec: 0, pixelX: null, pixelY: null } });
      expect(screen.queryByText('X,Y')).toBeNull();
    });

    it('defaults to ra=0, dec=0', () => {
      render(PixelReadout, { props: { visible: true } });
      expect(screen.getByText('00h00m00.00s')).toBeTruthy();
      expect(screen.getByText('+00d00m00.0s')).toBeTruthy();
    });
  });
});
