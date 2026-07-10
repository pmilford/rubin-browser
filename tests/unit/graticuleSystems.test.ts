/**
 * Coordinate-system graticule test (feature 105). A galactic/ecliptic grid line
 * must be a genuine iso-coordinate line: unprojecting its canvas points back to
 * RA/Dec and converting to the target system must yield a CONSTANT l (or b). This
 * kills a stub that just relabels the equatorial grid.
 */

import { describe, it, expect } from 'vitest';
import { graticuleLines, formatGridLabel } from '../../src/utils/graticule.js';
import { canvasToSky, type ViewParams } from '../../src/utils/projection.js';
import { fromEquatorial } from '../../src/utils/coords.js';

const view: ViewParams = {
  ra: 180, dec: 0, fov: 40, canvasWidth: 800, canvasHeight: 600, panOffsetX: 0, panOffsetY: 0,
};

describe('graticule coordinate systems', () => {
  it('galactic parallels hold constant b and meridians hold constant l', () => {
    const lines = graticuleLines(view, { system: 'galactic' });
    expect(lines.length).toBeGreaterThan(0);

    const parallel = lines.find((l) => l.kind === 'dec' && l.points.length >= 4);
    const meridian = lines.find((l) => l.kind === 'ra' && l.points.length >= 4);
    expect(parallel).toBeTruthy();
    expect(meridian).toBeTruthy();

    // Every point on a parallel converts back to the same galactic latitude b.
    for (const p of parallel!.points) {
      const [ra, dec] = canvasToSky(view, p.x, p.y);
      const g = fromEquatorial(ra, dec, 'galactic');
      expect(Math.abs(g.lat - parallel!.value)).toBeLessThan(0.5);
    }
    // Every point on a meridian converts back to the same galactic longitude l.
    for (const p of meridian!.points) {
      const [ra, dec] = canvasToSky(view, p.x, p.y);
      const g = fromEquatorial(ra, dec, 'galactic');
      const dl = Math.abs(((g.lon - meridian!.value + 540) % 360) - 180);
      expect(dl).toBeLessThan(0.5);
    }
  });

  it('the galactic grid differs from the equatorial grid (not a relabel)', () => {
    const eq = graticuleLines(view, { system: 'equatorial' });
    const gal = graticuleLines(view, { system: 'galactic' });
    // The equatorial parallels are constant Dec; converting a galactic parallel's
    // point to Dec would NOT be constant — so the two line sets can't coincide.
    const eqDec = eq.filter((l) => l.kind === 'dec').map((l) => l.value).sort();
    const galDec = gal.filter((l) => l.kind === 'dec').map((l) => l.value).sort();
    expect(JSON.stringify(eqDec)).not.toBe(JSON.stringify(galDec));
  });

  it('formatGridLabel uses the right axis letters per system', () => {
    expect(formatGridLabel('ra', 120, 'galactic')).toBe('l 120°');
    expect(formatGridLabel('dec', 30, 'galactic')).toBe('b +30°');
    expect(formatGridLabel('ra', 90, 'ecliptic')).toBe('λ 90°');
    expect(formatGridLabel('dec', -15, 'ecliptic')).toBe('β -15°');
    // Equatorial keeps the sexagesimal h:m / °:′ forms.
    expect(formatGridLabel('ra', 180, 'equatorial')).toMatch(/h/);
    expect(formatGridLabel('dec', 30, 'equatorial')).toMatch(/°/);
  });
});
