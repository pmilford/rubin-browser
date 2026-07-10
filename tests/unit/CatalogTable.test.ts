import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import CatalogTable from '../../src/components/CatalogTable.svelte';
import type { CatalogSet } from '../../src/data/catalog.js';

const cat: CatalogSet = {
  count: 2,
  ra: new Float32Array([10.1, 10.2]),
  dec: new Float32Array([41.0, 41.1]),
  label: ['gaia-1', 'gaia-2'],
  records: [
    { Catalog: 'Gaia DR3', 'Source ID': 'gaia-1', 'G (mag)': 18.2, 'BP−RP': 1.1 },
    { Catalog: 'Gaia DR3', 'Source ID': 'gaia-2', 'G (mag)': 19.5, 'BP−RP': 0.8 },
  ],
};

describe('CatalogTable (feature 101)', () => {
  it('renders rows + column headers from the records (real data, not placeholder)', () => {
    render(CatalogTable, { props: { catalog: cat, title: 'Gaia DR3' } });
    const t = screen.getByLabelText('Catalog table');
    expect(within(t).getByText('gaia-1')).toBeTruthy();
    expect(within(t).getByText('18.2')).toBeTruthy();
    expect(within(t).getByText('G (mag)')).toBeTruthy(); // header from the record key
  });

  it('fires onSelect with the clicked row index (links to the marker)', async () => {
    const onSelect = vi.fn();
    render(CatalogTable, { props: { catalog: cat, onSelect } });
    await fireEvent.click(screen.getByLabelText('Catalog row 1'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('marks the selected row aria-selected', () => {
    render(CatalogTable, { props: { catalog: cat, selectedIndex: 1 } });
    expect(screen.getByLabelText('Catalog row 1').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Catalog row 0').getAttribute('aria-selected')).toBe('false');
  });

  it('shows an honest status (not fake rows) when empty', () => {
    render(CatalogTable, {
      props: {
        catalog: { count: 0, ra: new Float32Array(), dec: new Float32Array(), label: [], records: [] },
        status: 'No Gaia sources here.',
      },
    });
    expect(screen.queryByLabelText('Catalog row 0')).toBeNull();
    expect(screen.getByLabelText('Catalog status').textContent).toContain('No Gaia');
  });
});
