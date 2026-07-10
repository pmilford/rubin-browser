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
  tileImageCornerVectors,
  tileSubdivision,
  tileSubQuads,
  TILE_RASTER_CORNERS,
  type ViewParams,
} from '../../src/utils/projection.js';
import { order2nside, corners_nest, vec2ang, pixcoord2vec_nest, type V3 } from '@hscmap/healpix';
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

describe('tile subdivision fixes wide-FOV ancestor-preview misregistration (B-b)', () => {
  // Faithfully model the renderer's per-triangle affine texture map: a quad with
  // screen corners [TL,TR,BR,BL] and image-UV [(0,0),(1,0),(1,1),(0,1)] is split
  // into tris (0,1,2) and (0,2,3); a UV point is mapped by the affine of its tri.
  const affineFill = (
    sc: [number, number][],
    u: number,
    v: number
  ): [number, number] => {
    let A: [number, number], B: [number, number], C: [number, number];
    let a: [number, number], b: [number, number], c: [number, number];
    if (v <= u) { A = sc[0]!; B = sc[1]!; C = sc[2]!; a = [0, 0]; b = [1, 0]; c = [1, 1]; }
    else { A = sc[0]!; B = sc[2]!; C = sc[3]!; a = [0, 0]; b = [1, 1]; c = [0, 1]; }
    const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    const l1 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / det;
    const l2 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / det;
    const l3 = 1 - l1 - l2;
    return [l1 * A[0] + l2 * B[0] + l3 * C[0], l1 * A[1] + l2 * B[1] + l3 * C[1]];
  };

  const project = (v: ViewParams, vec: V3): [number, number] => {
    const { theta, phi } = vec2ang(vec);
    const { ra, dec } = thetaPhiToRadec(theta, phi);
    return skyToCanvas(v, ra, dec);
  };

  // Max interior registration error (px) between the piecewise-affine mesh of n×n
  // sub-quads and the TRUE gnomonic projection, over a grid of interior points.
  const maxInteriorError = (v: ViewParams, nside: number, pix: number, n: number): number => {
    const quads = tileSubQuads(n).map((q) => ({
      uv: q.uv,
      sc: tileImageCornerVectors(nside, pix, q.hpx).map((vec) => project(v, vec)) as [number, number][],
    }));
    let maxErr = 0;
    for (let su = 1; su < 10; su++) {
      for (let sv = 1; sv < 10; sv++) {
        const u = su / 10, vv = sv / 10;
        // truth: the tile's own HEALPix point at image-uv (u,vv) → sky → screen.
        // The renderer's raster convention maps image-uv (u,v) → HEALPix frac (v,u).
        const truth = project(v, pixcoord2vec_nest(nside, pix, vv, u));
        // find containing sub-quad and its local uv
        const i = Math.min(n - 1, Math.floor(u * n));
        const j = Math.min(n - 1, Math.floor(vv * n));
        const q = quads[j * n + i]!;
        const lu = u * n - i, lv = vv * n - j;
        const est = affineFill(q.sc, lu, lv);
        const err = Math.hypot(est[0] - truth[0], est[1] - truth[1]);
        if (err > maxErr) maxErr = err;
      }
    }
    return maxErr;
  };

  it('a large low-order ancestor tile warps badly at n=1 and subdivision fixes it', () => {
    // Order-2 tile (nside 4, ~15° across) previewed under a 30° FOV whose tangent
    // point is OFFSET from the tile — the real ancestor-preview case where the tile
    // extends far from the tangent and gnomonic non-affinity is worst (~10–45° band).
    const nside = order2nside(2);
    const pix = 40;
    const c = pixcoord2vec_nest(nside, pix, 0.5, 0.5);
    const { theta, phi } = vec2ang(c);
    const { ra, dec } = thetaPhiToRadec(theta, phi);
    const v = view({ ra: ra + 10, dec: dec + 6, fov: 30 });

    const sc = tileImageCornerVectors(nside, pix).map((vec) => project(v, vec)) as [number, number][];
    expect(tileSubdivision(sc)).toBeGreaterThan(1); // a wide tile must be subdivided

    const err1 = maxInteriorError(v, nside, pix, 1);
    const err2 = maxInteriorError(v, nside, pix, 2);
    const err8 = maxInteriorError(v, nside, pix, 8);

    // The single 2-triangle map misplaces interior features by many pixels — the bug.
    expect(err1).toBeGreaterThan(10);
    // Subdivision reduces the error monotonically and drives it sub-pixel. A
    // reverted (un-subdivided) renderer stays at err1 and fails err8's bound.
    expect(err2).toBeLessThan(err1);
    expect(err8).toBeLessThan(err1 / 8);
    expect(err8).toBeLessThan(1.5);
  });

  it('tileSubdivision: small screen quads → n=1 (zero cost), large → subdivided', () => {
    // A ~150px on-screen tile (typical sharp target tile) is not subdivided.
    const small: [number, number][] = [[100, 100], [250, 100], [250, 250], [100, 250]];
    expect(tileSubdivision(small)).toBe(1);
    // A tile spanning most of the canvas (a low-order preview) is subdivided.
    const large: [number, number][] = [[-100, -100], [900, -100], [900, 800], [-100, 800]];
    expect(tileSubdivision(large)).toBeGreaterThan(1);
    // Degenerate/NaN corners (behind horizon) must not crash or over-subdivide.
    const nan: [number, number][] = [[NaN, NaN], [0, 0], [10, 10], [0, 10]];
    expect(tileSubdivision(nan)).toBe(1);
  });
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

describe('tileImageCornerVectors memoization (perf: computed once per tile, not per frame)', () => {
  it('returns the SAME cached array for repeated (nside,pix) with default corners', () => {
    const nside = order2nside(4);
    const a = tileImageCornerVectors(nside, 123);
    const b = tileImageCornerVectors(nside, 123);
    // Reference identity proves it was memoized rather than recomputed — a
    // per-frame recompute (the old behavior) would return a fresh array.
    expect(a).toBe(b);
    expect(a).toHaveLength(4);
  });

  it('does not collide across different tiles', () => {
    const nside = order2nside(4);
    expect(tileImageCornerVectors(nside, 100)).not.toBe(tileImageCornerVectors(nside, 101));
  });

  it('BYPASSES the cache when a custom corner override is passed (test seam intact)', () => {
    const nside = order2nside(4);
    const override: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const a = tileImageCornerVectors(nside, 123, override);
    const b = tileImageCornerVectors(nside, 123, override);
    // Override path must not be memoized (tile-orientation.spec.ts compares
    // alternative mappings for the same tile) and must differ from default.
    expect(a).not.toBe(b);
    expect(a).not.toEqual(tileImageCornerVectors(nside, 123, TILE_RASTER_CORNERS));
  });
});
