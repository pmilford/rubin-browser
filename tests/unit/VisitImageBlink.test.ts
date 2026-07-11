import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import VisitImageBlink from '../../src/components/VisitImageBlink.svelte';
import type { EpochImage } from '../../src/api/visitImageSeries.js';
import type { FitsImage } from '../../src/utils/fits.js';

/** A tiny finite 2×2 image with a known gradient (renderCutout is real, not mocked). */
function image(seed: number): FitsImage {
  return {
    header: { simple: true, bitpix: -32, naxis: 2, naxis1: 2, naxis2: 2, bscale: 1, bzero: 0, cards: {} },
    width: 2,
    height: 2,
    data: new Float64Array([seed, seed + 1, seed + 2, seed + 3]),
  };
}

function epoch(mjd: number, band: string, seed: number): EpochImage {
  return {
    mjd,
    band,
    accessUrl: `https://data.lsst.cloud/api/datalink/links?ID=img-${seed}`,
    id: `img-${seed}`,
    ra: 59.27,
    dec: -48.79,
    image: image(seed),
  };
}

const epochs: EpochImage[] = [
  epoch(60000.5, 'g', 0),
  epoch(60010.5, 'r', 10),
  epoch(60020.5, 'i', 20),
];

describe('VisitImageBlink', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders the frame canvas + stable aria-labels for play/pause and slider', () => {
    render(VisitImageBlink, { props: { epochs } });
    expect(screen.getByLabelText('Visit image frame')).toBeTruthy();
    expect(screen.getByLabelText('Play/pause visit-image blink')).toBeTruthy();
    expect(screen.getByLabelText('Visit image epoch')).toBeTruthy();
  });

  it('shows the FIRST epoch MJD + band initially', () => {
    render(VisitImageBlink, { props: { epochs } });
    expect(screen.getByText(/MJD 60000\.5000/)).toBeTruthy();
    expect(screen.getByText(/band g/)).toBeTruthy();
    expect(screen.getByText(/epoch 1 \/ 3/)).toBeTruthy();
  });

  // ADVERSARIAL: the whole point is the frame CHANGES with the slider. A static
  // impl that ignores the epoch index shows the same MJD/band and fails here.
  it('updates the displayed MJD + band when the slider moves to another epoch', async () => {
    render(VisitImageBlink, { props: { epochs } });
    const slider = screen.getByLabelText('Visit image epoch');

    await fireEvent.input(slider, { target: { value: '2' } });
    expect(screen.getByText(/MJD 60020\.5000/)).toBeTruthy();
    expect(screen.getByText(/band i/)).toBeTruthy();
    expect(screen.getByText(/epoch 3 \/ 3/)).toBeTruthy();
    // The first epoch's readout is gone — the frame genuinely moved.
    expect(screen.queryByText(/MJD 60000\.5000/)).toBeNull();
  });

  it('auto-advances the epoch while playing and wraps around', async () => {
    render(VisitImageBlink, { props: { epochs, rate: 0.5 } });
    await fireEvent.click(screen.getByLabelText('Play/pause visit-image blink'));

    vi.advanceTimersByTime(500);
    await waitFor(() => expect(screen.getByText(/MJD 60010\.5000/)).toBeTruthy());

    vi.advanceTimersByTime(500);
    await waitFor(() => expect(screen.getByText(/MJD 60020\.5000/)).toBeTruthy());

    // Wrap back to the first epoch.
    vi.advanceTimersByTime(500);
    await waitFor(() => expect(screen.getByText(/MJD 60000\.5000/)).toBeTruthy());
  });

  it('slider range spans exactly the epochs (0 … n-1)', () => {
    render(VisitImageBlink, { props: { epochs } });
    const slider = screen.getByLabelText('Visit image epoch') as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('2');
  });

  it('shows a DISTINCT loading state (not empty, not error)', () => {
    render(VisitImageBlink, { props: { epochs: [], loading: true } });
    expect(screen.getByLabelText('Visit image blink loading')).toBeTruthy();
    expect(screen.queryByLabelText('Visit image blink empty')).toBeNull();
    expect(screen.queryByLabelText('Visit image frame')).toBeNull();
  });

  it('shows a DISTINCT error state with the message', () => {
    render(VisitImageBlink, { props: { epochs: [], error: 'Sign-in required' } });
    const err = screen.getByLabelText('Visit image blink error');
    expect(err.textContent).toContain('Sign-in required');
  });

  it('shows a DISTINCT empty state when there are no epochs and not loading', () => {
    render(VisitImageBlink, { props: { epochs: [] } });
    expect(screen.getByLabelText('Visit image blink empty')).toBeTruthy();
    expect(screen.queryByLabelText('Play/pause visit-image blink')).toBeNull();
  });

  it('surfaces truncation + failed-epoch counts honestly', () => {
    render(VisitImageBlink, {
      props: { epochs, truncated: true, totalEpochs: 20, failedEpochs: 2 },
    });
    const note = screen.getByLabelText('Visit image blink note');
    expect(note.textContent).toContain('3 of 20');
    expect(note.textContent).toContain('2 epochs failed');
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(VisitImageBlink, { props: { epochs, onClose } });
    await fireEvent.click(screen.getByLabelText('Close visit-image blink'));
    expect(onClose).toHaveBeenCalled();
  });
});
