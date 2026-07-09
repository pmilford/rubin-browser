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

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

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
