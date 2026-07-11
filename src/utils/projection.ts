/**
 * Pure gnomonic-projection + tiling geometry for the HiPS viewer.
 *
 * This math used to live inside `ImageViewer.svelte` as closures over component
 * `$state`, which made it impossible to unit-test — pan, zoom, and tile
 * placement had zero pure coverage. It is extracted here as pure functions that
 * take an explicit {@link ViewParams} so the geometric invariants (round-trip,
 * zoom-centering, pan direction/magnitude, FOV↔order mapping, tile winding) can
 * be tested with no DOM and no canvas. `ImageViewer.svelte` imports these and
 * passes its current view; there is intentionally no second copy of the math.
 */

import { pixcoord2vec_nest, type V3 } from '@hscmap/healpix';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * HiPS in-tile raster-corner positions as (x, y) fractions, in image
 * [TL, TR, BR, BL] order, mapped through `pixcoord2vec_nest` (the authoritative
 * HEALPix tile-pixel geometry). x/y are the library's in-pixel fractions where
 * (0,0)=S, (1,0)=E, (1,1)=N, (0,1)=W corners.
 *
 * This "SWNE" mapping (TL→S, TR→W, BR→N, BL→E) was determined empirically and
 * confirmed both by an objective smoothness metric and visually (M31 renders as
 * one continuous galaxy with no per-tile zigzag). The previous hand-guessed
 * `corners_nest` reorder reflected each tile about its diagonal. Regression-
 * guarded by tests/ui/tile-orientation.spec.ts, which fails if a reflected
 * mapping (higher cross-tile discontinuity) is reintroduced.
 */
export const TILE_RASTER_CORNERS: readonly [number, number][] = [
  [0, 0], // TL → S
  [0, 1], // TR → W
  [1, 1], // BR → N
  [1, 0], // BL → E
];

/**
 * Sky unit-vectors for a tile's four image raster corners (TL, TR, BR, BL),
 * computed with the authoritative `pixcoord2vec_nest` HEALPix geometry — the
 * same primitive that indexes the tile's pixels. Used to texture-map the tile
 * onto the canvas without guessing the corner orientation.
 *
 * The corners depend only on (nside, pix), never on the view, so the default-
 * mapping result is memoized — `drawTile` calls this every frame for every
 * visible tile, and each call is 4× `pixcoord2vec_nest` (trig-heavy). A custom
 * `corners` override (the `__tileCorners` test seam) BYPASSES the cache so
 * tile-orientation.spec.ts can still compare alternative mappings.
 */
const cornerVectorCache = new Map<string, V3[]>();

export function tileImageCornerVectors(
  nside: number,
  pix: number,
  corners: readonly [number, number][] = TILE_RASTER_CORNERS
): V3[] {
  if (corners !== TILE_RASTER_CORNERS) {
    return corners.map(([x, y]) => pixcoord2vec_nest(nside, pix, x, y));
  }
  const key = `${nside}-${pix}`;
  const cached = cornerVectorCache.get(key);
  if (cached) return cached;
  const vecs = corners.map(([x, y]) => pixcoord2vec_nest(nside, pix, x, y));
  cornerVectorCache.set(key, vecs);
  return vecs;
}

/**
 * How many sub-quads per side to split a tile into so that each sub-quad's screen
 * edge is ≲ `maxSidePx`. A tile is texture-mapped with a per-triangle AFFINE
 * transform, which is exact only where the gnomonic projection is locally linear.
 * Across a small (target-order) tile the non-linearity is sub-pixel → n=1 (no
 * cost). Across a large low-order ANCESTOR-PREVIEW tile (tens of degrees) a single
 * affine map displaces interior features by many pixels — the wide-FOV
 * misregistration bug — so it must be subdivided into a piecewise-affine grid.
 */
export function tileSubdivision(
  screenCorners: readonly [number, number][],
  maxSidePx = 220,
  nMax = 8
): number {
  let maxLen = 0;
  for (let i = 0; i < 4; i++) {
    const a = screenCorners[i]!;
    const b = screenCorners[(i + 1) % 4]!;
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (len > maxLen) maxLen = len;
  }
  if (!Number.isFinite(maxLen) || maxLen <= maxSidePx) return 1;
  return Math.max(1, Math.min(nMax, Math.ceil(maxLen / maxSidePx)));
}

/**
 * The n×n sub-quads of a tile, each with its fractional HEALPix corner coords
 * (`hpx`, to feed `pixcoord2vec_nest`) and its fractional image-UV corners (`uv`,
 * in [0,1]), both in the same [TL,TR,BR,BL] order `drawTile` uses. The HEALPix
 * fractions are bilinearly interpolated from the tile's four corner fractions
 * (default {@link TILE_RASTER_CORNERS}), so the mapping stays authoritative if
 * that corner convention ever changes. Pure — unit-tested against skyToCanvas.
 */
export function tileSubQuads(
  n: number,
  cornerFracs: readonly [number, number][] = TILE_RASTER_CORNERS
): { hpx: [number, number][]; uv: [number, number][] }[] {
  const c = cornerFracs;
  // Bilinear over the 4 corners, whose UV positions are TL(0,0) TR(1,0) BR(1,1) BL(0,1).
  const bil = (u: number, v: number): [number, number] => {
    const w0 = (1 - u) * (1 - v), w1 = u * (1 - v), w2 = u * v, w3 = (1 - u) * v;
    return [
      c[0]![0] * w0 + c[1]![0] * w1 + c[2]![0] * w2 + c[3]![0] * w3,
      c[0]![1] * w0 + c[1]![1] * w1 + c[2]![1] * w2 + c[3]![1] * w3,
    ];
  };
  const out: { hpx: [number, number][]; uv: [number, number][] }[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
      const uv: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      const hpx = uv.map(([u, v]) => bil(u, v)) as [number, number][];
      out.push({ hpx, uv });
    }
  }
  return out;
}

export interface ViewParams {
  /** view-center RA (deg) */
  ra: number;
  /** view-center Dec (deg) */
  dec: number;
  /** field of view across canvas width (deg) */
  fov: number;
  canvasWidth: number;
  canvasHeight: number;
  /** transient pan offset applied during a drag (px); 0 when settled */
  panOffsetX?: number;
  panOffsetY?: number;
}

/** Zoom level → FOV (deg). Halves the FOV per zoom step. */
export function zoomToFov(zoom: number): number {
  return 180 / Math.pow(2, zoom);
}

/**
 * FOV (deg) → zoom level. Exact inverse of zoomToFov (zoom = log2(180 / fov)),
 * so fovToZoom(zoomToFov(z)) === z. Used to frame a target of a known angular
 * size (e.g. a ~1 deg² DP1 field) at an appropriate zoom.
 */
export function fovToZoom(fov: number): number {
  return Math.log2(180 / Math.max(fov, 1e-6));
}

/**
 * FOV (deg) → HiPS order, clamped to [0, maxOrder].
 *
 * A HEALPix tile at order N spans ~ (90 / Nside) degrees on a side, Nside = 2^N.
 * We aim for ~TILES_ACROSS tiles across the FOV: solving 90/2^N ≈ fov/TILES_ACROSS
 * gives N ≈ log2(90 * TILES_ACROSS / fov).
 */
export function fovToOrder(viewFov: number, maxOrder: number): number {
  const TILES_ACROSS = 4;
  const raw = Math.log2((90 * TILES_ACROSS) / Math.max(viewFov, 1e-6));
  const order = Math.round(raw);
  return Math.max(0, Math.min(maxOrder, order));
}

/**
 * Gnomonic projection: sky coords (deg) → canvas coords (px).
 *
 * Pure projection WITHOUT the pan offset — during a drag the offset is applied
 * once via a canvas translate, not per-point. Returns [NaN, NaN] when the point
 * is at/behind the tangent-plane horizon (cosC <= 0.01) so callers can skip it.
 */
export function skyToCanvas(view: ViewParams, skyRa: number, skyDec: number): [number, number] {
  const { ra, dec, fov, canvasWidth, canvasHeight } = view;
  const cosDec0 = Math.cos(dec * DEG2RAD);
  const sinDec0 = Math.sin(dec * DEG2RAD);
  const cosDec = Math.cos(skyDec * DEG2RAD);
  const sinDec = Math.sin(skyDec * DEG2RAD);
  const dRa = (skyRa - ra) * DEG2RAD;
  const cosDRa = Math.cos(dRa);

  const cosC = sinDec0 * sinDec + cosDec0 * cosDec * cosDRa;
  if (cosC <= 0.01) return [NaN, NaN];

  const k = 1 / cosC;
  const u = k * cosDec * Math.sin(dRa);
  const v = k * (cosDec0 * sinDec - sinDec0 * cosDec * cosDRa);
  const scale = canvasWidth / (fov * DEG2RAD);

  return [canvasWidth / 2 + u * scale, canvasHeight / 2 - v * scale];
}

/**
 * Inverse gnomonic: canvas coords (px) → sky coords (deg).
 *
 * Applies the pan offset so the coordinate readout stays correct mid-drag.
 * RA is normalised to [0, 360).
 */
export function canvasToSky(view: ViewParams, px: number, py: number): [number, number] {
  const { ra, dec, fov, canvasWidth, canvasHeight } = view;
  const panOffsetX = view.panOffsetX ?? 0;
  const panOffsetY = view.panOffsetY ?? 0;

  // Undo pan offset to get the logical (un-dragged) canvas position.
  const logicalX = px - panOffsetX;
  const logicalY = py - panOffsetY;

  const scale = canvasWidth / (fov * DEG2RAD);
  const u = (logicalX - canvasWidth / 2) / scale;
  const v = -(logicalY - canvasHeight / 2) / scale;
  const rho = Math.sqrt(u * u + v * v);
  const c = Math.atan(rho);
  const cosDec0 = Math.cos(dec * DEG2RAD);
  const sinDec0 = Math.sin(dec * DEG2RAD);
  const cosC = Math.cos(c);
  const sinC = Math.sin(c);

  const newDec = Math.asin(cosC * sinDec0 + (v * sinC * cosDec0) / (rho || 1));
  const newRa =
    ra + Math.atan2(u * sinC, rho * cosC * cosDec0 - v * sinC * sinDec0) * RAD2DEG;

  return [((newRa % 360) + 360) % 360, newDec * RAD2DEG];
}
