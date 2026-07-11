import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RgbCompositePanel from '../../src/components/RgbCompositePanel.svelte';
import type { FitsImage, FitsHeader } from '../../src/utils/fits.js';

/**
 * Presentational tests for the RGB composite panel. The canvas 2D context is
 * mocked in tests/setup.ts, so the COLOURED-pixel outcome (a red-dominant pixel,
 * mapping swaps changing the image) is asserted in the Playwright spec
 * (tests/ui/rgb-composite.spec.ts). Here we assert the DOM the panel presents:
 * the default i→R r→G g→B mapping, the Q/stretch sliders, the honest
 * differing-size error path, and the close callback.
 */

function header(w: number, h: number): FitsHeader {
  return { simple: true, bitpix: -32, naxis: 2, naxis1: w, naxis2: h, bscale: 1, bzero: 0, cards: {} };
}
function img(w: number, h: number, fill: number): FitsImage {
  return { header: header(w, h), width: w, height: h, data: Float64Array.from({ length: w * h }, () => fill) };
}

function threeBands() {
  return { i: img(8, 8, 30), r: img(8, 8, 20), g: img(8, 8, 10) };
}

describe('RgbCompositePanel (feature 120)', () => {
  it('defaults the mapping to i→R, r→G, g→B', () => {
    render(RgbCompositePanel, { props: { images: threeBands(), ra: 150, dec: 2 } });
    expect((screen.getByLabelText('R channel band') as HTMLSelectElement).value).toBe('i');
    expect((screen.getByLabelText('G channel band') as HTMLSelectElement).value).toBe('r');
    expect((screen.getByLabelText('B channel band') as HTMLSelectElement).value).toBe('g');
  });

  it('renders the composite canvas and Q/stretch sliders when the bands align', () => {
    render(RgbCompositePanel, { props: { images: threeBands(), ra: 150, dec: 2 } });
    expect(screen.getByLabelText('RGB composite image')).toBeTruthy();
    expect(screen.getByLabelText('Q parameter')).toBeTruthy();
    expect(screen.getByLabelText('Stretch parameter')).toBeTruthy();
    // No error path when the bands are the same size.
    expect(screen.queryByLabelText('RGB composite error')).toBeNull();
  });

  it('shows an honest error (no canvas) when the chosen bands differ in size', () => {
    // g is a different size → cannot combine.
    const images = { i: img(8, 8, 30), r: img(8, 8, 20), g: img(4, 4, 10) };
    render(RgbCompositePanel, { props: { images, ra: 150, dec: 2 } });
    const err = screen.getByLabelText('RGB composite error');
    expect(err.textContent).toMatch(/differ in size|cannot be combined/);
    expect(screen.queryByLabelText('RGB composite image')).toBeNull();
  });

  it('lists every available band as an option in each channel selector', () => {
    render(RgbCompositePanel, { props: { images: threeBands(), ra: 150, dec: 2 } });
    const rSelect = screen.getByLabelText('R channel band') as HTMLSelectElement;
    const opts = Array.from(rSelect.options).map((o) => o.value).sort();
    expect(opts).toEqual(['g', 'i', 'r']);
  });

  it('falls back to the available bands in order when i/r/g are not all present', () => {
    // Bands u, z, y → defaults fall back to order (u→R, z→G, y→B).
    const images = { u: img(8, 8, 30), z: img(8, 8, 20), y: img(8, 8, 10) };
    render(RgbCompositePanel, { props: { images, ra: 150, dec: 2 } });
    expect((screen.getByLabelText('R channel band') as HTMLSelectElement).value).toBe('u');
    expect((screen.getByLabelText('G channel band') as HTMLSelectElement).value).toBe('z');
    expect((screen.getByLabelText('B channel band') as HTMLSelectElement).value).toBe('y');
    // Still composites (canvas present, no error) with the fallback mapping.
    expect(screen.getByLabelText('RGB composite image')).toBeTruthy();
  });

  it('re-renders without error when the mapping and Q/stretch change', async () => {
    render(RgbCompositePanel, { props: { images: threeBands(), ra: 150, dec: 2 } });
    await fireEvent.change(screen.getByLabelText('B channel band'), { target: { value: 'i' } });
    await fireEvent.input(screen.getByLabelText('Q parameter'), { target: { value: '15' } });
    await fireEvent.input(screen.getByLabelText('Stretch parameter'), { target: { value: '2' } });
    // The composite canvas is still present (no throw from re-composite).
    expect(screen.getByLabelText('RGB composite image')).toBeTruthy();
    expect(screen.queryByLabelText('RGB composite error')).toBeNull();
  });

  it('fires onClose', async () => {
    const onClose = vi.fn();
    render(RgbCompositePanel, { props: { images: threeBands(), ra: 150, dec: 2, onClose } });
    await fireEvent.click(screen.getByLabelText('Close RGB composite'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
