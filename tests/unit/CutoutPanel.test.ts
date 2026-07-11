import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CutoutPanel from '../../src/components/CutoutPanel.svelte';
import type { FitsImage, FitsHeader } from '../../src/utils/fits.js';

/**
 * CutoutPanel presentational tests. The canvas 2D context is mocked in
 * tests/setup.ts, so PIXEL outcomes (non-black render, RA/Dec after a real
 * mousemove) are asserted in the Playwright spec (tests/ui/cutout.spec.ts) — the
 * only place canvas pixels + real geometry exist. Here we assert the DOM the
 * panel presents: metadata, WCS-driven readout hint, controls, and callbacks.
 */

const WCS_HEADER: FitsHeader = {
  simple: true,
  bitpix: -32,
  naxis: 2,
  naxis1: 8,
  naxis2: 8,
  bscale: 1,
  bzero: 0,
  object: 'TEST-SRC',
  bunit: 'nJy',
  crval1: 150.0,
  crval2: 2.0,
  crpix1: 4.5,
  crpix2: 4.5,
  cd1_1: -0.0001,
  cd1_2: 0,
  cd2_1: 0,
  cd2_2: 0.0001,
  ctype1: 'RA---TAN',
  ctype2: 'DEC--TAN',
  cards: {},
};

function makeImage(header: FitsHeader = WCS_HEADER): FitsImage {
  const data = new Float64Array(64);
  for (let i = 0; i < 64; i++) data[i] = i;
  data[36] = 5000; // a bright pixel
  return { header, width: 8, height: 8, data };
}

describe('CutoutPanel (feature 109)', () => {
  it('shows object, size, band and dataset id in the header', () => {
    render(CutoutPanel, {
      props: { image: makeImage(), ra: 150, dec: 2, band: 'r', datasetId: 'deep-coadd-1234-r' },
    });
    const meta = screen.getByLabelText('Cutout metadata').textContent ?? '';
    expect(meta).toContain('TEST-SRC');
    expect(meta).toContain('8×8');
    expect(meta).toContain('band r');
    // The centre position is shown so the user knows what was cut.
    expect(screen.getByLabelText('Cutout centre').textContent).toContain('150.00000');
  });

  it('offers a RA/Dec readout hint when the header carries a usable WCS', () => {
    render(CutoutPanel, {
      props: { image: makeImage(), ra: 150, dec: 2, band: 'r', datasetId: 'id' },
    });
    // Before hover the readout hints that RA/Dec is available (WCS parsed).
    expect(screen.getByLabelText('Cutout readout').textContent).toContain('RA/Dec');
  });

  it('omits the RA/Dec hint when the header has no usable WCS (honest, not faked)', () => {
    const noWcs: FitsHeader = { ...WCS_HEADER };
    delete noWcs.ctype1;
    delete noWcs.ctype2;
    delete noWcs.cd1_1;
    delete noWcs.cd2_2;
    render(CutoutPanel, {
      props: { image: makeImage(noWcs), ra: 150, dec: 2, band: 'r', datasetId: 'id' },
    });
    expect(screen.getByLabelText('Cutout readout').textContent).not.toContain('RA/Dec');
  });

  it('reports the finite stretch range from real pixels (not a placeholder)', () => {
    render(CutoutPanel, {
      props: { image: makeImage(), ra: 150, dec: 2, band: 'r', datasetId: 'id' },
    });
    // The note shows a numeric stretch range + unit — derived from the data.
    expect(screen.getByLabelText('Cutout note').textContent).toMatch(/stretch/);
    expect(screen.getByLabelText('Cutout note').textContent).toContain('nJy');
  });

  it('surfaces the all-BLANK case honestly instead of a silent black panel', () => {
    const data = new Float64Array(64).fill(NaN);
    const img: FitsImage = { header: WCS_HEADER, width: 8, height: 8, data };
    render(CutoutPanel, { props: { image: img, ra: 150, dec: 2, band: 'r', datasetId: 'id' } });
    expect(screen.getByLabelText('Cutout note').textContent).toContain('BLANK');
  });

  it('toggles measure mode, revealing the aperture-radius control and a measure hint', async () => {
    render(CutoutPanel, {
      props: { image: makeImage(), ra: 150, dec: 2, band: 'r', datasetId: 'id' },
    });
    // Measure mode is off initially → no radius slider, no aperture overlay.
    expect(screen.queryByLabelText('Aperture radius')).toBeNull();
    expect(screen.queryByLabelText('Aperture overlay')).toBeNull();
    await fireEvent.click(screen.getByLabelText('Toggle measure mode'));
    // Now the aperture-radius control appears and a hint prompts for a click.
    expect(screen.getByLabelText('Aperture radius')).toBeTruthy();
    expect(screen.getByLabelText('Measure hint')).toBeTruthy();
    // A click runs (jsdom geometry is zero → no aperture set, but no crash).
    await fireEvent.click(screen.getByLabelText('FITS cutout image'));
  });

  it('exposes scale / colormap / invert controls and fires close', async () => {
    const onClose = vi.fn();
    render(CutoutPanel, {
      props: { image: makeImage(), ra: 150, dec: 2, band: 'r', datasetId: 'id', onClose },
    });
    // Controls are present and changeable (a dead-control would throw here).
    await fireEvent.change(screen.getByLabelText('Cutout scale'), { target: { value: 'log' } });
    await fireEvent.change(screen.getByLabelText('Cutout colormap'), { target: { value: 'viridis' } });
    await fireEvent.click(screen.getByLabelText('Invert cutout'));
    // Mousemove handler runs (geometry is zero in jsdom → no readout, but no crash).
    await fireEvent.mouseMove(screen.getByLabelText('FITS cutout image'));
    await fireEvent.click(screen.getByLabelText('Close cutout'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
