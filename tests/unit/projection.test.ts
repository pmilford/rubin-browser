/**
 * Pure geometric-invariant tests for the projection/tiling math.
 *
 * These run with NO DOM, NO canvas, and NO mocks — they exercise the real
 * functions in src/utils/projection.ts and real @hscmap/healpix output. This is
 * the layer the previous suite lacked entirely: pan, zoom, and tile placement
 * had zero pure coverage, so a sign-flip, a wrong FOV scale, an un-centered
 * zoom, or a mirror-flipped tile could not fail a test. Every test here would
 * have caught one of the reported tiling/zoom/pan bugs.
 */

import { describe, it, expect } from 'vitest';
import {
  skyToCanvas,
  canvasToSky,
  zoomToFov,
  fovToOrder,
  type ViewParams,
} from '../../src/utils/projection.js';
import { order2nside, corners_nest, vec2ang, type V3 } from '@hscmap/healpix';
import { thetaPhiToRadec } from '../../src/api/hips.js';

const view = (over: Partial<ViewParams> = {}): ViewParams => ({
  ra: 62,
  dec: -37,
  fov: 22.5,
  canvasWidth: 800,
  canvasHeight: 600,
  panOffsetX: 0,
  panOffsetY: 0,
  ...over,
});

describe('projection: round-trip invariance', () => {
  it('canvasToSky(skyToCanvas(p)) === p for points inside the FOV', () => {
    const v = view();
    for (const dRa of [-8, -3, 0, 3, 8]) {
      for (const dDec of [-8, -3, 0, 3, 8]) {
        const skyRa = v.ra + dRa;
        const skyDec = v.dec + dDec;
        const [px, py] = skyToCanvas(v, skyRa, skyDec);
        expect(Number.isNaN(px)).toBe(false);
        const [rtRa, rtDec] = canvasToSky(v, px, py);
        expect(rtRa).toBeCloseTo(((skyRa % 360) + 360) % 360, 6);
        expect(rtDec).toBeCloseTo(skyDec, 6);
      }
    }
  });

  it('view center sky point projects exactly to canvas center at every FOV', () => {
    // Zoom-centering invariant: setZoom keeps ra/dec = the center sky point, so
    // that point MUST stay at (W/2, H/2) for all fov, or zooming visibly jumps.
    for (const fov of [180, 90, 22.5, 5, 0.5, 0.05]) {
      const v = view({ fov });
      const [cx, cy] = skyToCanvas(v, v.ra, v.dec);
      expect(cx).toBeCloseTo(v.canvasWidth / 2, 9);
      expect(cy).toBeCloseTo(v.canvasHeight / 2, 9);
    }
  });

  it('a point behind the tangent-plane horizon returns NaN', () => {
    const v = view({ ra: 62, dec: -37, fov: 60 });
    // The antipode is always behind the viewer.
    const [px, py] = skyToCanvas(v, (62 + 180) % 360, 37);
    expect(Number.isNaN(px) || Number.isNaN(py)).toBe(true);
  });
});

describe('projection: orientation (catches inverted-axis bugs)', () => {
  it('increasing RA (east) moves right on screen', () => {
    const v = view();
    const [xEast] = skyToCanvas(v, v.ra + 2, v.dec);
    expect(xEast).toBeGreaterThan(v.canvasWidth / 2);
  });

  it('increasing Dec (north) moves up on screen', () => {
    const v = view();
    const [, yNorth] = skyToCanvas(v, v.ra, v.dec + 2);
    expect(yNorth).toBeLessThan(v.canvasHeight / 2);
  });
});

describe('projection: pan direction + magnitude (catches wrong-direction drag)', () => {
  it('panning the canvas right (grab-and-drag) DECREASES center RA', () => {
    const base = view();
    const [ra0] = canvasToSky(base, base.canvasWidth / 2, base.canvasHeight / 2);
    const dragged = view({ panOffsetX: 100 }); // drag content 100px to the right
    const [ra1] = canvasToSky(dragged, base.canvasWidth / 2, base.canvasHeight / 2);
    expect(ra1).toBeLessThan(ra0);
  });

  it('panning the canvas down INCREASES center Dec', () => {
    const base = view();
    const [, dec0] = canvasToSky(base, base.canvasWidth / 2, base.canvasHeight / 2);
    const dragged = view({ panOffsetY: 100 });
    const [, dec1] = canvasToSky(dragged, base.canvasWidth / 2, base.canvasHeight / 2);
    expect(dec1).toBeGreaterThan(dec0);
  });

  it('pan magnitude matches the FOV scale (deg-per-pixel)', () => {
    const v = view();
    const dxPx = 80;
    const [ra0] = canvasToSky(v, v.canvasWidth / 2, v.canvasHeight / 2);
    const [ra1] = canvasToSky(view({ panOffsetX: dxPx }), v.canvasWidth / 2, v.canvasHeight / 2);
    const measured = Math.abs(ra1 - ra0);
    // Near center: ΔRA ≈ (dx * fov / width) / cos(dec).
    const expected = (dxPx * v.fov) / v.canvasWidth / Math.cos((v.dec * Math.PI) / 180);
    expect(measured).toBeGreaterThan(expected * 0.6);
    expect(measured).toBeLessThan(expected * 1.6);
  });
});

describe('zoomToFov / fovToOrder mapping', () => {
  it('FOV is strictly decreasing in zoom and always positive', () => {
    let prev = Infinity;
    for (let z = 0; z <= 18; z++) {
      const f = zoomToFov(z);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
    expect(zoomToFov(0)).toBeCloseTo(180, 6);
    expect(zoomToFov(3)).toBeCloseTo(22.5, 6);
  });

  it('order is monotonic non-increasing as FOV grows, clamped to [0, maxOrder]', () => {
    const maxOrder = 11;
    let prev = Infinity;
    for (const fov of [0.01, 0.1, 1, 5, 22.5, 45, 90, 180]) {
      const o = fovToOrder(fov, maxOrder);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(maxOrder);
      expect(o).toBeLessThanOrEqual(prev);
      prev = o;
    }
  });

  it('a narrower FOV never selects a coarser order', () => {
    const maxOrder = 11;
    expect(fovToOrder(1, maxOrder)).toBeGreaterThanOrEqual(fovToOrder(10, maxOrder));
  });
});

describe('tile-quad winding (catches warped / flipped tiles + gross gaps)', () => {
  // corners_nest returns [N, W, S, E]; ImageViewer reorders to [N, E, S, W].
  const projectTileQuad = (v: ViewParams, order: number, pix: number): [number, number][] => {
    const nside = order2nside(order);
    const c = corners_nest(nside, pix); // [N, W, S, E]
    const ordered: V3[] = [c[0]!, c[3]!, c[2]!, c[1]!]; // [N, E, S, W]
    return ordered.map((vec) => {
      const { theta, phi } = vec2ang(vec);
      const { ra, dec } = thetaPhiToRadec(theta, phi);
      return skyToCanvas(v, ra, dec);
    });
  };
  const signedArea = (q: [number, number][]): number => {
    let a = 0;
    for (let i = 0; i < q.length; i++) {
      const [x0, y0] = q[i]!;
      const [x1, y1] = q[(i + 1) % q.length]!;
      a += x0 * y1 - x1 * y0;
    }
    return a / 2;
  };

  it('every on-screen tile projects to a non-degenerate quad with consistent winding', () => {
    const order = 3;
    const nside = order2nside(order);
    const npix = 12 * nside * nside;
    const v = view({ ra: 62, dec: -37, fov: 22.5 });
    const areas: number[] = [];
    for (let pix = 0; pix < npix; pix++) {
      const quad = projectTileQuad(v, order, pix);
      if (quad.some(([x, y]) => Number.isNaN(x) || Number.isNaN(y))) continue;
      const onScreen = quad.some(
        ([x, y]) => x > -512 && x < v.canvasWidth + 512 && y > -512 && y < v.canvasHeight + 512
      );
      if (!onScreen) continue;
      areas.push(signedArea(quad));
    }
    expect(areas.length).toBeGreaterThan(0);
    // All visible tiles must wind the same way (no mirror-flip → no warping)...
    const positive = areas.filter((a) => a > 0).length;
    expect(positive === 0 || positive === areas.length).toBe(true);
    // ...and none may collapse to ~0 area (which would draw a sliver / gap).
    for (const a of areas) expect(Math.abs(a)).toBeGreaterThan(1);
  });
});
