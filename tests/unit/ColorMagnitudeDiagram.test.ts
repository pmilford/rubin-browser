import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import ColorMagnitudeDiagram from '../../src/components/ColorMagnitudeDiagram.svelte';
import type { GaiaCatalog } from '../../src/api/gaia.js';

/** Build a GaiaCatalog fixture; unspecified columns default to NaN. */
function gaiaFixture(
  cols: Partial<{ bpRp: number[]; gMag: number[]; parallax: number[] }>,
  n: number
): GaiaCatalog {
  const f = (a?: number[]) => {
    const arr = new Float32Array(n).fill(NaN);
    a?.forEach((v, i) => (arr[i] = v));
    return arr;
  };
  return {
    count: n,
    sourceId: Array.from({ length: n }, (_, i) => `id-${i}`),
    ra: f(),
    dec: f(),
    gMag: f(cols.gMag),
    bpRp: f(cols.bpRp),
    pmRa: f(),
    pmDec: f(),
    parallax: f(cols.parallax),
    radialVelocity: f(),
    teff: f(),
  };
}

describe('ColorMagnitudeDiagram (Gaia rich visualization)', () => {
  it('renders exactly one point per FINITE source (real data, not a placeholder scatter)', () => {
    // 3 sources: two plottable, one with no colour → must yield 2 points, not 3 and not a fixed count.
    const cat = gaiaFixture(
      { bpRp: [1.0, 0.5, NaN], gMag: [15, 18, 16], parallax: [10, 5, 5] },
      3
    );
    render(ColorMagnitudeDiagram, { props: { catalog: cat } });
    const diagram = screen.getByLabelText('Colour-magnitude diagram');
    const points = diagram.querySelectorAll('circle');
    expect(points.length).toBe(2);
    // Points carry the real source index (so selection links back to the marker).
    const indices = Array.from(points).map((c) => c.getAttribute('data-index'));
    expect(indices).toEqual(['0', '1']);
  });

  it('places points at DATA-DEPENDENT positions (a bluer/brighter source is left/up)', () => {
    // Source 0 is blue (BP−RP 0.2) and bright; source 1 is red (2.4) and faint.
    const cat = gaiaFixture({ bpRp: [0.2, 2.4], gMag: [8, 20], parallax: [10, 10] }, 2);
    render(ColorMagnitudeDiagram, { props: { catalog: cat } });
    const circles = screen.getByLabelText('Colour-magnitude diagram').querySelectorAll('circle');
    const c0 = circles[0]!;
    const c1 = circles[1]!;
    // Blue source sits LEFT of the red source (x = BP−RP).
    expect(parseFloat(c0.getAttribute('cx')!)).toBeLessThan(parseFloat(c1.getAttribute('cx')!));
    // Brighter (smaller absolute mag) source sits ABOVE (smaller y) — axis inverted.
    expect(parseFloat(c0.getAttribute('cy')!)).toBeLessThan(parseFloat(c1.getAttribute('cy')!));
  });

  it('fires onSelect with the clicked point index (links to the sky marker)', async () => {
    const onSelect = vi.fn();
    const cat = gaiaFixture({ bpRp: [1.0, 0.5], gMag: [15, 18], parallax: [10, 5] }, 2);
    render(ColorMagnitudeDiagram, { props: { catalog: cat, onSelect } });
    const circles = screen.getByLabelText('Colour-magnitude diagram').querySelectorAll('circle');
    await fireEvent.click(circles[1]!);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('highlights the externally selected source (sky marker → CMD point link)', () => {
    const cat = gaiaFixture({ bpRp: [1.0, 0.5], gMag: [15, 18], parallax: [10, 5] }, 2);
    render(ColorMagnitudeDiagram, { props: { catalog: cat, selectedIndex: 1 } });
    const circles = screen.getByLabelText('Colour-magnitude diagram').querySelectorAll('circle');
    expect(circles[0]!.classList.contains('selected')).toBe(false);
    expect(circles[1]!.classList.contains('selected')).toBe(true);
  });

  it('shows an honest empty state (NO points) when every source is unplottable', () => {
    const cat = gaiaFixture({ bpRp: [NaN, NaN] }, 2);
    render(ColorMagnitudeDiagram, { props: { catalog: cat } });
    const diagram = screen.getByLabelText('Colour-magnitude diagram');
    expect(diagram.querySelectorAll('circle').length).toBe(0);
    expect(within(diagram).getByLabelText('Colour-magnitude empty state').textContent).toContain('No source');
  });

  it('discloses when apparent G is used (no usable parallax)', () => {
    const cat = gaiaFixture({ bpRp: [1.0], gMag: [18], parallax: [-1] }, 1);
    render(ColorMagnitudeDiagram, { props: { catalog: cat } });
    const note = screen.getByLabelText('Colour-magnitude note');
    expect(note.textContent).toContain('Apparent G');
  });

  it('renders nothing plottable for a null catalog (no crash, no fake points)', () => {
    render(ColorMagnitudeDiagram, { props: { catalog: null } });
    const diagram = screen.getByLabelText('Colour-magnitude diagram');
    expect(diagram.querySelectorAll('circle').length).toBe(0);
  });
});
