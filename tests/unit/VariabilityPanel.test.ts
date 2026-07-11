import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import VariabilityPanel from '../../src/components/VariabilityPanel.svelte';
import { OFFLINE_EPOCHS, brightestOfflineVariable } from '../../src/data/offlineDataset.js';
import { radecToTileIndex } from '../../src/api/hips.js';

// The tile containing the known synthetic transient, at the panel's order.
const t = brightestOfflineVariable('r');
const pixWithTransient = radecToTileIndex(t.ra, t.dec, 6);
// A tile far from the transient (opposite point on the sky) — should be quiet.
const quietRa = (t.ra + 180) % 360;
const quietDec = -t.dec;
const pixQuiet = radecToTileIndex(quietRa, quietDec, 6);

describe('VariabilityPanel (feature 124 display)', () => {
  it('detects the variable source in the tile containing the known transient (real pipeline)', () => {
    render(VariabilityPanel, {
      props: { order: 6, pixelIndex: pixWithTransient, band: 'r', epochs: OFFLINE_EPOCHS },
    });
    const count = screen.getByLabelText('Variable source count').textContent ?? '';
    const n = parseInt(count, 10);
    expect(n).toBeGreaterThan(0); // the KNOWN transient surfaces — not a placeholder
    // The list renders a σ significance readout for the detection.
    expect(screen.getByLabelText('Variable source list').textContent).toMatch(/σ=/);
  });

  it('reports ZERO variable sources in a quiet tile (no fabricated detections)', () => {
    // A constant/reflected implementation that always "finds" something fails here.
    render(VariabilityPanel, {
      props: { order: 6, pixelIndex: pixQuiet, band: 'r', epochs: OFFLINE_EPOCHS },
    });
    expect(screen.getByLabelText('Variable source count').textContent).toContain('0 variable');
  });

  it('fires the close callback', async () => {
    const onClose = vi.fn();
    render(VariabilityPanel, {
      props: { order: 6, pixelIndex: pixWithTransient, band: 'r', epochs: OFFLINE_EPOCHS, onClose },
    });
    await fireEvent.click(screen.getByLabelText('Close variability'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
