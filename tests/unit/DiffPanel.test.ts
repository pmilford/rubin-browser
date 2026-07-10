import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DiffPanel from '../../src/components/DiffPanel.svelte';
import {
  OFFLINE_EPOCHS,
  brightestOfflineVariable,
} from '../../src/data/offlineDataset.js';
import { radecToTileIndex } from '../../src/api/hips.js';

// The tile containing the known synthetic transient, at the panel's diff order.
const t = brightestOfflineVariable('r');
const pix = radecToTileIndex(t.ra, t.dec, 6);

describe('DiffPanel (feature 108)', () => {
  it('reports the detected transient(s) for faint-vs-bright epochs (real pipeline)', () => {
    render(DiffPanel, {
      props: {
        order: 6, pixelIndex: pix, band: 'r', epochs: OFFLINE_EPOCHS,
        aIndex: t.faintEpochIndex, bIndex: t.brightEpochIndex,
      },
    });
    const count = screen.getByLabelText('Transient count').textContent ?? '';
    const n = parseInt(count, 10);
    expect(n).toBeGreaterThan(0); // the known transient is detected, not a placeholder
    // The list renders at least one row with a significance readout.
    expect(screen.getByLabelText('Transient list').textContent).toMatch(/σ=/);
  });

  it('reports ZERO transients when both epochs are the same (no fabricated events)', () => {
    render(DiffPanel, {
      props: {
        order: 6, pixelIndex: pix, band: 'r', epochs: OFFLINE_EPOCHS,
        aIndex: t.brightEpochIndex, bIndex: t.brightEpochIndex,
      },
    });
    expect(screen.getByLabelText('Transient count').textContent).toContain('0 transient');
  });

  it('fires epoch-change + close callbacks', async () => {
    const onAChange = vi.fn();
    const onClose = vi.fn();
    render(DiffPanel, {
      props: {
        order: 6, pixelIndex: pix, band: 'r', epochs: OFFLINE_EPOCHS,
        aIndex: 0, bIndex: 4, onAChange, onClose,
      },
    });
    await fireEvent.change(screen.getByLabelText('Epoch A'), { target: { value: '3' } });
    expect(onAChange).toHaveBeenCalledWith(3);
    await fireEvent.click(screen.getByLabelText('Close differencing'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
