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
