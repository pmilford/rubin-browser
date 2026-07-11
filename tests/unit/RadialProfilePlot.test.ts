import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RadialProfilePlot from '../../src/components/RadialProfilePlot.svelte';
import type { RadialProfileResult } from '../../src/utils/photometry.js';

/**
 * Presentational tests for the radial-profile plot. It draws two SVG polylines
 * from an already-computed profile; here we assert the DOM reflects the data —
 * a real point count per curve, NaN bins skipped in the mean line, an honest
 * empty state for null, and the close callback. A plot that ignored its data
 * (drew nothing, or a fixed shape) would fail the point-count assertions.
 */

function profile(n: number): RadialProfileResult {
  const radius: number[] = [];
  const meanFlux: number[] = [];
  const encircledFlux: number[] = [];
  let cum = 0;
  for (let k = 0; k < n; k++) {
    radius.push(k + 1);
    meanFlux.push(n - k); // decreasing outward
    cum += n - k;
    encircledFlux.push(cum);
  }
  return { radius, meanFlux, encircledFlux };
}

describe('RadialProfilePlot', () => {
  it('renders one point per bin on the curve-of-growth polyline', () => {
    render(RadialProfilePlot, { props: { profile: profile(6) } });
    const enc = screen.getByLabelText('Curve of growth line') as unknown as SVGPolylineElement;
    const pts = (enc.getAttribute('points') ?? '').trim().split(/\s+/).filter(Boolean);
    expect(pts.length).toBe(6);
  });

  it('skips NaN mean-flux bins so a gap does not draw to zero', () => {
    const p = profile(6);
    p.meanFlux[2] = NaN;
    render(RadialProfilePlot, { props: { profile: p } });
    const mean = screen.getByLabelText('Radial profile line') as unknown as SVGPolylineElement;
    const pts = (mean.getAttribute('points') ?? '').trim().split(/\s+/).filter(Boolean);
    expect(pts.length).toBe(5); // one NaN bin skipped
  });

  it('shows an honest empty state when the profile is null', () => {
    render(RadialProfilePlot, { props: { profile: null } });
    expect(screen.getByLabelText('Radial profile empty')).toBeTruthy();
    expect(screen.queryByLabelText('Radial profile plot')).toBeNull();
  });

  it('fires onClose', async () => {
    const onClose = vi.fn();
    render(RadialProfilePlot, { props: { profile: profile(3), onClose } });
    await fireEvent.click(screen.getByLabelText('Close radial profile'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
