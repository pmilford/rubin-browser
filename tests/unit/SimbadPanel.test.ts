import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/svelte';
import SimbadPanel from '../../src/components/SimbadPanel.svelte';
import type { SimbadObject } from '../../src/api/simbad.js';

const M31: SimbadObject = { mainId: 'M 31', ra: 10.6847, dec: 41.269, objectType: 'AGN', separationArcsec: 3.2 };
const NGC: SimbadObject = { mainId: 'NGC 205', ra: 10.09, dec: 41.68, objectType: 'Galaxy', separationArcsec: 41.0 };

describe('SimbadPanel (feature 103)', () => {
  it('lists matched objects nearest-first with name, type, and separation', () => {
    render(SimbadPanel, { props: { ra: 10.68, dec: 41.27, results: [M31, NGC] } });
    const list = screen.getByLabelText('SIMBAD matches');
    expect(within(list).getByText('M 31')).toBeTruthy();
    expect(within(list).getByText('AGN')).toBeTruthy();
    expect(within(list).getByText('3.2″')).toBeTruthy();
    expect(within(list).getByText('NGC 205')).toBeTruthy();
    // Query position is shown (so the user knows what was asked).
    expect(screen.getByLabelText('SIMBAD query position').textContent).toContain('10.6800');
  });

  it('shows the honest status message (not a fake result) when there are no matches', () => {
    render(SimbadPanel, { props: { ra: 0, dec: 0, results: [], status: 'No catalogued SIMBAD object within 1′.' } });
    expect(screen.queryByLabelText('SIMBAD matches')).toBeNull();
    expect(screen.getByLabelText('SIMBAD status').textContent).toContain('No catalogued');
  });

  it('surfaces an error status rather than swallowing it', () => {
    render(SimbadPanel, { props: { ra: 5, dec: 5, results: null, status: 'SIMBAD query failed (500).' } });
    expect(screen.getByLabelText('SIMBAD status').textContent).toContain('failed');
  });

  it('fires onSelect with the clicked object and onClose', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(SimbadPanel, { props: { ra: 10.68, dec: 41.27, results: [M31, NGC], onSelect, onClose } });
    await fireEvent.click(screen.getByText('NGC 205'));
    expect(onSelect).toHaveBeenCalledWith(NGC);
    await fireEvent.click(screen.getByLabelText('Close SIMBAD'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
