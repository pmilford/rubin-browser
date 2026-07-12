/**
 * Unit tests for the SVG/DOM presentational components. These render real markup
 * (no canvas), so unlike the canvas viewers they ARE meaningfully unit-testable:
 * we assert the computed output (labels, paths, honest empty states) and exercise
 * the event handlers. (The canvas ImageViewer/TileViewer are covered by the
 * Playwright visual/interaction suite instead — see vitest.config coverage note.)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import LightCurvePlot from '../../src/components/LightCurvePlot.svelte';
import SurfacePlot from '../../src/components/SurfacePlot.svelte';
import CrossSectionPlot from '../../src/components/CrossSectionPlot.svelte';
import ObjectInfoPanel from '../../src/components/ObjectInfoPanel.svelte';
import StretchControls from '../../src/components/StretchControls.svelte';
import type { IdentifyInfo, AstroObject } from '../../src/data/objects.js';
import type { LineProfile } from '../../src/utils/crossSection.js';

describe('LightCurvePlot', () => {
  const curve = [
    { mjd: 60000, intensity: 1 },
    { mjd: 60010, intensity: 3 },
    { mjd: 60020, intensity: 2 },
  ];

  it('plots a curve and fires refresh/close', async () => {
    const onRefresh = vi.fn();
    const onClose = vi.fn();
    render(LightCurvePlot, { curve, currentIndex: 1, band: 'r', onRefresh, onClose });
    // The plot SVG is present (path drawn from the data).
    expect(screen.getByLabelText('Intensity vs time')).toBeTruthy();
    await fireEvent.click(screen.getByLabelText('Refresh light curve'));
    await fireEvent.click(screen.getByLabelText('Close light curve'));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the status message (not a fake plot) when there is no curve', () => {
    render(LightCurvePlot, { curve: null, status: 'Fetching…' });
    expect(screen.getByLabelText('Light curve status').textContent).toContain('Fetching…');
  });
});

describe('LightCurvePlot — time-proportional axis, overlay, expand, hover', () => {
  const seriesCircles = (c: Element): SVGCircleElement[] => [...c.querySelectorAll('g.series circle')] as SVGCircleElement[];
  const cx = (el: Element): number => parseFloat(el.getAttribute('cx') ?? 'NaN');
  const cy = (el: Element): number => parseFloat(el.getAttribute('cy') ?? 'NaN');

  it('maps x by TIME not index: a 3× longer temporal gap is 3× wider on screen', () => {
    // Index-based x (the old bug) would make both gaps equal (ratio 1) — this fails it.
    const { container } = render(LightCurvePlot, {
      series: [{ band: 'r', points: [
        { mjd: 60000, intensity: 1 }, { mjd: 60010, intensity: 2 }, { mjd: 60040, intensity: 1.5 },
      ] }],
    });
    const cs = seriesCircles(container);
    expect(cs.length).toBe(3);
    expect((cx(cs[2]!) - cx(cs[1]!)) / (cx(cs[1]!) - cx(cs[0]!))).toBeCloseTo(3, 4);
  });

  it('overlays one <g data-band> per filter (multi-band)', () => {
    const { container } = render(LightCurvePlot, {
      series: [
        { band: 'g', points: [{ mjd: 1, intensity: 1 }, { mjd: 2, intensity: 2 }] },
        { band: 'r', points: [{ mjd: 1, intensity: 3 }, { mjd: 2, intensity: 4 }] },
        { band: 'i', points: [{ mjd: 1, intensity: 5 }, { mjd: 2, intensity: 6 }] },
      ],
    });
    const bands = [...container.querySelectorAll('g.series[data-band]')].map((g) => g.getAttribute('data-band'));
    expect(bands).toEqual(['g', 'r', 'i']);
  });

  it('legend toggle removes a band AND recomputes the shared y-domain', async () => {
    const { container, getByLabelText } = render(LightCurvePlot, {
      series: [
        { band: 'g', points: [{ mjd: 1, intensity: 1000 }, { mjd: 2, intensity: 900 }] }, // dominates the scale
        { band: 'r', points: [{ mjd: 1, intensity: 10 }, { mjd: 2, intensity: 20 }] },
      ],
    });
    // r's brightest epoch (intensity 20) — near the axis floor while g dominates the scale.
    const rMax = (c: Element): SVGCircleElement => c.querySelectorAll('g.series[data-band="r"] circle')[1] as SVGCircleElement;
    const rBefore = cy(rMax(container));
    await fireEvent.click(getByLabelText('Toggle band g'));
    // g's group is gone…
    expect(container.querySelector('g.series[data-band="g"]')).toBeNull();
    // …and r re-scaled because vMax dropped from 1000 to 20 (real recompute, not just removal).
    const rAfter = cy(rMax(container));
    expect(rAfter).not.toBeCloseTo(rBefore, 1);
  });

  it('expand re-projects the data (rightmost point moves right), not just resizes the box', async () => {
    const { container, getByLabelText } = render(LightCurvePlot, {
      series: [{ band: 'r', points: [{ mjd: 60000, intensity: 1 }, { mjd: 60100, intensity: 2 }] }],
    });
    const svg = () => container.querySelector('svg[aria-label="Intensity vs time"]')!;
    const rightmost = () => Math.max(...seriesCircles(container).map(cx));
    const wBefore = parseFloat(svg().getAttribute('width')!);
    const xBefore = rightmost();
    await fireEvent.click(getByLabelText('Expand light curve'));
    expect(parseFloat(svg().getAttribute('width')!)).toBeGreaterThan(wBefore);
    expect(rightmost()).toBeGreaterThan(xBefore);
  });

  it('dashes only the segment that spans a real temporal gap (mid-series, not the last one)', () => {
    // deltas 10,70,10,10 → the GAP is the 2nd segment; a "dash the last segment" impl fails.
    const { container } = render(LightCurvePlot, {
      series: [{ band: 'r', points: [0, 10, 80, 90, 100].map((mjd) => ({ mjd, intensity: 1 })) }],
    });
    const lines = [...container.querySelectorAll('g.series line')] as SVGLineElement[];
    const dashed = lines.filter((l) => l.getAttribute('stroke-dasharray'));
    expect(dashed.length).toBe(1);
    const span = (l: SVGLineElement): number =>
      Math.abs(parseFloat(l.getAttribute('x2')!) - parseFloat(l.getAttribute('x1')!));
    expect(span(dashed[0]!)).toBe(Math.max(...lines.map(span))); // the widest = the gap
  });

  it('keeps negative-flux points inside the canvas (difference-image flux) — B5', () => {
    const { container } = render(LightCurvePlot, {
      series: [{ band: 'r', points: [{ mjd: 1, intensity: -50 }, { mjd: 2, intensity: 0 }, { mjd: 3, intensity: 100 }] }],
    });
    for (const c of seriesCircles(container)) {
      expect(cy(c)).toBeGreaterThanOrEqual(0);
      expect(cy(c)).toBeLessThanOrEqual(150);
    }
  });

  it('renders finite coords for a degenerate all-equal-MJD series (no NaN)', () => {
    const { container } = render(LightCurvePlot, {
      series: [{ band: 'r', points: [{ mjd: 60000, intensity: 1 }, { mjd: 60000, intensity: 2 }] }],
    });
    expect(container.querySelector('svg[aria-label="Intensity vs time"]')!.innerHTML).not.toContain('NaN');
  });

  it('hover read-out reflects the hovered datum (different points → different MJDs)', async () => {
    const { container } = render(LightCurvePlot, {
      series: [{ band: 'r', points: [{ mjd: 60000, intensity: 1 }, { mjd: 60010, intensity: 2 }] }],
    });
    const cs = seriesCircles(container);
    const readout = () => container.querySelector('[aria-label="Light curve readout"]')!.textContent ?? '';
    await fireEvent.mouseEnter(cs[0]!);
    const first = readout();
    await fireEvent.mouseEnter(cs[1]!);
    const second = readout();
    expect(first).toContain('60000.000');
    expect(second).toContain('60010.000');
    expect(first).not.toBe(second);
  });

  it('reports "all bands hidden" honestly instead of a blank axis box', async () => {
    const { container, getByLabelText } = render(LightCurvePlot, {
      series: [
        { band: 'g', points: [{ mjd: 1, intensity: 1 }, { mjd: 2, intensity: 2 }] },
        { band: 'r', points: [{ mjd: 1, intensity: 3 }, { mjd: 2, intensity: 4 }] },
      ],
    });
    await fireEvent.click(getByLabelText('Toggle band g'));
    await fireEvent.click(getByLabelText('Toggle band r'));
    expect(container.querySelector('[aria-label="Light curve status"]')!.textContent).toContain('all bands hidden');
  });

  it('compresses a long gap to a short on-screen break (opt-in) without moving intra-cluster spacing', async () => {
    // Two dense clusters separated by a 98-day void.
    const pts = [0, 1, 2, 100, 101, 102].map((mjd) => ({ mjd, intensity: 1 + (mjd % 3) }));
    const { container, getByLabelText } = render(LightCurvePlot, { series: [{ band: 'r', points: pts }] });
    const cxs = (): number[] => seriesCircles(container).map(cx);

    const full = cxs();
    const fullStep = full[1]! - full[0]!; // intra-cluster (1 day)
    const fullAcross = full[3]! - full[2]!; // across the void (98 days)
    expect(fullAcross / fullStep).toBeGreaterThan(20); // full-time: the void dominates

    // Toggle compression → the across-void gap shrinks to ~one intra-cluster step,
    // and a break glyph appears; a screen-pinned/no-op impl fails this ratio.
    await fireEvent.click(getByLabelText('Compress time gaps'));
    const comp = cxs();
    const compStep = comp[1]! - comp[0]!;
    const compAcross = comp[3]! - comp[2]!;
    expect(compAcross / compStep).toBeCloseTo(1, 1);
    expect(container.querySelectorAll('[aria-label="Time gap break"]').length).toBe(1);
  });

  it('hides the compress toggle when there is no large gap (uniform cadence)', () => {
    const { queryByLabelText } = render(LightCurvePlot, {
      series: [{ band: 'r', points: [0, 10, 20, 30].map((mjd) => ({ mjd, intensity: 1 })) }],
    });
    expect(queryByLabelText('Compress time gaps')).toBeNull();
  });

  it('draws exactly one <circle> per epoch (preserves the Playwright marker contract)', () => {
    const { container } = render(LightCurvePlot, {
      series: [{ band: 'r', points: [0, 1, 2, 3].map((mjd) => ({ mjd, intensity: mjd })) }],
    });
    expect(container.querySelectorAll('[aria-label="Intensity vs time"] circle').length).toBe(4);
  });
});

describe('SurfacePlot', () => {
  it('renders a grid, adjusts exaggeration, and closes', async () => {
    const onClose = vi.fn();
    render(SurfacePlot, { grid: [[0, 0.5], [0.5, 1]], onClose });
    expect(screen.getByLabelText('3D surface plot')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Vertical exaggeration'), { target: { value: '0.7' } });
    await fireEvent.click(screen.getByLabelText('Close 3D surface'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('CrossSectionPlot', () => {
  const profile: LineProfile = {
    t: [0, 0.5, 1],
    distanceArcmin: [0, 2.5, 5],
    lum: [0.1, 0.6, 0.2],
    r: [0.1, 0.7, 0.2],
    g: [0.1, 0.6, 0.2],
    b: [0.1, 0.5, 0.2],
    gap: [false, false, false],
  };

  it('renders the profile, toggles a channel + log axis, and closes', async () => {
    const onClose = vi.fn();
    render(CrossSectionPlot, { profile, onClose });
    expect(screen.getByLabelText('Intensity vs position')).toBeTruthy();
    // Toggle the log axis and a channel (exercises the handlers).
    await fireEvent.click(screen.getByLabelText('Toggle logarithmic intensity axis'));
    const chanButtons = screen.getAllByLabelText(/Toggle .* channel/);
    await fireEvent.click(chanButtons[0]!);
    await fireEvent.click(screen.getByLabelText('Close cross-section'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('ObjectInfoPanel', () => {
  const obj: AstroObject = {
    id: 'm31', name: 'M31', ra: 10.68, dec: 41.27,
    category: 'Messier', type: 'galaxy', magnitude: 3.44,
    spectralType: undefined, description: 'Andromeda Galaxy',
  };

  it('shows the matched object (name, type, magnitude) and closes', async () => {
    const onClose = vi.fn();
    const info = {
      ra: 10.68, dec: 41.27, constellation: 'Andromeda', matchRadiusDeg: 0.5,
      match: { object: obj, separationDeg: 0.01, positionAngleDeg: 90 },
      nearest: { object: obj, separationDeg: 0.01, positionAngleDeg: 90 },
    } as unknown as IdentifyInfo;
    render(ObjectInfoPanel, { info, onClose });
    expect(screen.getByLabelText('Object name').textContent).toContain('M31');
    expect(screen.getByLabelText('Object type').textContent).toContain('Galaxy');
    expect(screen.getByLabelText('Object magnitude').textContent).toContain('3.44');
    await fireEvent.click(screen.getByLabelText('Close object info'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('honestly reports no catalogued object when there is no match', () => {
    const info = {
      ra: 0, dec: 0, constellation: 'Sextans', matchRadiusDeg: 0.5,
      match: null, nearest: null,
    } as unknown as IdentifyInfo;
    render(ObjectInfoPanel, { info, onClose: () => {} });
    expect(screen.getByText('No catalogued object here')).toBeTruthy();
  });
});

describe('StretchControls', () => {
  it('emits on a slider change and on reset', async () => {
    const onChange = vi.fn();
    render(StretchControls, { blackPoint: 0, whitePoint: 1, contrast: 1, bias: 0.5, onChange });
    const sliders = screen.getAllByRole('slider');
    await fireEvent.input(sliders[0]!, { target: { value: '0.2' } });
    expect(onChange).toHaveBeenCalled();
    // Reset restores identity values.
    const reset = screen.getByRole('button', { name: /reset/i });
    await fireEvent.click(reset);
    expect(onChange).toHaveBeenCalledWith({ blackPoint: 0, whitePoint: 1, contrast: 1, bias: 0.5 });
  });
});
