<script lang="ts">
  import { getAuthHeader } from '../api/auth.js';
  import { parseHipsProperties, radecToThetaPhi, thetaPhiToRadec } from '../api/hips.js';
  import {
    skyToCanvas,
    canvasToSky,
    zoomToFov,
    fovToOrder,
    tileImageCornerVectors,
    type ViewParams,
  } from '../utils/projection.js';
  import {
    order2nside,
    nside2npix,
    ang2vec,
    pixcoord2vec_nest,
    vec2ang,
    query_disc_inclusive_nest,
    type V3,
  } from '@hscmap/healpix';
  import { applyScaling } from '../utils/scaling.js';
  import { applyColorMap } from '../utils/colormap.js';
  import PixelReadout from './PixelReadout.svelte';
  import type { ViewerState, ScalingFunction, ColorMapName, InterpolationMethod } from '../types/image.js';

  let {
    hipsBaseUrl = '',
    rspToken = '',
    tileFormat = '',
    initialRa = 62.0,
    initialDec = -37.0,
    initialZoom = 3,
    scaling = 'linear' as ScalingFunction,
    colorMap = 'grayscale' as ColorMapName,
    interpolation = 'bilinear' as InterpolationMethod,
    invert = false,
    blackPoint = 0,
    whitePoint = 1,
    contrast = 1,
    bias = 0.5,
    onViewerStateChange,
  }: {
    hipsBaseUrl?: string;
    rspToken?: string;
    tileFormat?: string;
    initialRa?: number;
    initialDec?: number;
    initialZoom?: number;
    scaling?: ScalingFunction;
    colorMap?: ColorMapName;
    interpolation?: InterpolationMethod;
    invert?: boolean;
    /** Display black point (0-1) applied to the post-stretch value. */
    blackPoint?: number;
    /** Display white point (0-1) applied to the post-stretch value. */
    whitePoint?: number;
    /** Contrast: slope of the transfer curve about `bias` (1 = identity). */
    contrast?: number;
    /** Bias: midpoint of the transfer curve (0.5 = identity). */
    bias?: number;
    onViewerStateChange?: (state: ViewerState) => void;
  } = $props();

  const PUBLIC_HIPS = 'https://alasky.cds.unistra.fr/DSS/DSSColor';
  const RUBIN_HIPS = 'https://data.lsst.cloud/api/hips/images/color_gri';
  const DEFAULT_FORMAT = 'jpg';
  const DEFAULT_MAX_ORDER = 3;
  const TILE_SIZE = 512;
  const MAX_ZOOM = 18;
  const MIN_ZOOM = 0;
  const DEG2RAD = Math.PI / 180;

  // Survey properties resolved from `{baseUrl}/properties` on init / base-url change.
  // Fall back gracefully (jpg / order 3) when the fetch fails (e.g. CORS on public DSS).
  let surveyMaxOrder = $state(DEFAULT_MAX_ORDER);
  let surveyFormat = $state('');

  const resolvedBaseUrl = $derived(
    hipsBaseUrl || (rspToken ? RUBIN_HIPS : PUBLIC_HIPS)
  );

  let canvasEl: HTMLCanvasElement;
  let containerEl: HTMLDivElement;
  let ctx: CanvasRenderingContext2D | null = null;

  // Offscreen canvas for post-processing
  let offscreenCanvas: HTMLCanvasElement | null = null;
  let offscreenCtx: CanvasRenderingContext2D | null = null;

  // Snapshot initial values so resetView uses the actual initial props
  const initRa = initialRa;
  const initDec = initialDec;
  const initZoom = initialZoom;

  // Viewer state
  let ra = $state(initRa);
  let dec = $state(initDec);
  let zoomLevel = $state(initZoom);
  let fov = $state(zoomToFov(initZoom));
  let canvasWidth = $state(800);
  let canvasHeight = $state(600);

  // Canvas offset for smooth dragging (Issue #2, #3)
  let panOffsetX = $state(0);
  let panOffsetY = $state(0);

  // Error handling
  let hasError = $state(false);
  let errorMessage = $state('');
  let errorDismissTimer: ReturnType<typeof setTimeout> | null = null;

  // Tile cache: "order-pixelIndex" -> HTMLImageElement
  const tileCache = new Map<string, HTMLImageElement>();

  // Overlay tracking
  interface OverlayEntry {
    id: string;
    baseUrl: string;
    opacity: number;
  }
  const overlays = new Map<string, OverlayEntry>();

  // Pending image loads for cleanup
  const pendingLoads = new Set<HTMLImageElement>();

  // --- Coordinate Utilities ---
  // Projection + FOV/order math lives in src/utils/projection.ts (pure, unit-
  // tested for round-trip, zoom-centering, pan direction/magnitude, and tile
  // winding). `currentView()` snapshots the component's live view state for it.

  function currentView(): ViewParams {
    return { ra, dec, fov, canvasWidth, canvasHeight, panOffsetX, panOffsetY };
  }

  function zoomToOrder(zoom: number): number {
    return fovToOrder(zoomToFov(zoom), surveyMaxOrder);
  }

  // --- Tile URL Construction ---

  function buildUrl(order: number, pixelIndex: number, fmt: string, baseUrl: string): string {
    const dir = Math.floor(pixelIndex / 10000) * 10000;
    const cleanBase = baseUrl.replace(/\/properties$/, '').replace(/\/$/, '');
    return `${cleanBase}/Norder${order}/Dir${dir}/Npix${pixelIndex}.${fmt}`;
  }

  // Browser-renderable HiPS tile formats, in preference order. `fits` is
  // excluded because it cannot be drawn to a canvas as an <img>.
  const RENDERABLE_FORMATS = ['png', 'jpeg', 'jpg', 'webp'];

  /**
   * Map a HiPS `hips_tile_format` token to the on-disk file extension.
   * The HiPS standard token is `jpeg`, but tiles are stored with the `.jpg`
   * extension (requesting `.jpeg` 404s on CDS/alasky).
   */
  function formatToExtension(fmt: string): string {
    const f = fmt.toLowerCase();
    if (f === 'jpeg') return 'jpg';
    return f;
  }

  function resolveFormat(): string {
    if (tileFormat) return formatToExtension(tileFormat);
    if (surveyFormat) return formatToExtension(surveyFormat);
    return DEFAULT_FORMAT;
  }

  // --- Tile Discovery ---

  interface TileKey {
    order: number;
    pixelIndex: number;
  }

  /**
   * Find every HEALPix tile (at `order`) that touches the current view, using
   * an inclusive disc query centered on the view direction. This replaces the
   * old manual RA/Dec grid stepping (which broke near the poles and RA wrap).
   */
  function getVisibleTiles(centerRa: number, centerDec: number, viewFov: number, order: number): TileKey[] {
    const nside = order2nside(order);
    const tileAngularSize = 90 / nside; // degrees, approximate tile side
    // Half-diagonal of the FOV plus one tile of margin, in radians.
    const radiusDeg = (viewFov / 2) * Math.SQRT2 + tileAngularSize;
    const radiusRad = radiusDeg * DEG2RAD;

    const seen = new Set<number>();
    const tiles: TileKey[] = [];

    // @hscmap/healpix's query_disc requires radius < PI/2. For very wide fields
    // (low zoom) the disc would cover most of the sky anyway, and the tile count
    // at these low orders is small — so just enumerate every tile at this order.
    const DISC_MAX_RADIUS = Math.PI / 2 - 1e-6;
    if (radiusRad >= DISC_MAX_RADIUS) {
      const npix = nside2npix(nside);
      for (let pix = 0; pix < npix; pix++) {
        tiles.push({ order, pixelIndex: pix });
      }
      return tiles;
    }

    const { theta, phi } = radecToThetaPhi(centerRa, centerDec);
    const center: V3 = ang2vec(theta, phi);
    query_disc_inclusive_nest(nside, center, radiusRad, (pix) => {
      if (!seen.has(pix)) {
        seen.add(pix);
        tiles.push({ order, pixelIndex: pix });
      }
    });

    return tiles;
  }

  // --- Rendering ---

  /**
   * Main render function.
   * Uses canvas translate for pan offset so old tiles remain visible during drag (Issue #3).
   */
  function render() {
    if (!ctx) return;

    const needsPostProcessing =
      scaling !== 'linear' ||
      colorMap !== 'grayscale' ||
      invert ||
      blackPoint > 0 ||
      whitePoint < 1 ||
      contrast !== 1 ||
      bias !== 0.5;

    if (needsPostProcessing) {
      renderWithPostProcessing();
    } else {
      renderDirect();
    }
  }

  function renderDirect() {
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.save();
    ctx.translate(panOffsetX, panOffsetY);
    drawAllTiles(ctx);
    ctx.restore();
  }

  function renderWithPostProcessing() {
    if (!ctx) return;

    // Create/reuse offscreen canvas
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCtx = offscreenCanvas.getContext('2d');
    }
    if (offscreenCanvas.width !== canvasWidth || offscreenCanvas.height !== canvasHeight) {
      offscreenCanvas.width = canvasWidth;
      offscreenCanvas.height = canvasHeight;
    }
    if (!offscreenCtx) return;

    // Draw tiles to offscreen canvas (no pan offset — we composite with offset later)
    offscreenCtx.fillStyle = '#000';
    offscreenCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    drawAllTiles(offscreenCtx);

    // Apply post-processing
    const imageData = offscreenCtx.getImageData(0, 0, canvasWidth, canvasHeight);
    applyPostProcessing(imageData);
    offscreenCtx.putImageData(imageData, 0, 0);

    // Composite to main canvas with pan offset
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(offscreenCanvas, panOffsetX, panOffsetY);
  }

  function drawAllTiles(context: CanvasRenderingContext2D) {
    const order = zoomToOrder(zoomLevel);
    const fmt = resolveFormat();
    const visibleTiles = getVisibleTiles(ra, dec, fov, order);

    const drawn = new Set<string>();

    for (const tile of visibleTiles) {
      const cacheKey = `${tile.order}-${tile.pixelIndex}`;
      if (drawn.has(cacheKey)) continue;
      drawn.add(cacheKey);

      const img = tileCache.get(cacheKey);
      if (img && img.complete && img.naturalWidth > 0) {
        drawTile(context, img, tile);
      }
    }

    // Draw overlay tiles
    for (const [, overlay] of overlays) {
      for (const tile of visibleTiles) {
        const cacheKey = `overlay-${overlay.id}-${tile.order}-${tile.pixelIndex}`;
        if (drawn.has(cacheKey)) continue;
        drawn.add(cacheKey);

        const img = tileCache.get(cacheKey);
        if (img && img.complete && img.naturalWidth > 0) {
          context.globalAlpha = overlay.opacity / 100;
          drawTile(context, img, tile);
          context.globalAlpha = 1.0;
        }
      }
    }
  }

  /**
   * Draw a HiPS tile as a projected spherical quadrilateral.
   *
   * A HEALPix tile is a curved diamond on the sphere, not an axis-aligned
   * square. We take its 4 corner unit-vectors (corners_nest), project each
   * through the gnomonic skyToCanvas() projection, then paint the tile image
   * as a textured quad. Canvas 2D can't draw an arbitrary textured quad, so we
   * split the quad into two triangles and affine-map the image onto each.
   *
   * The image's raster corners (TL, TR, BR, BL) are mapped to sky via
   * `pixcoord2vec_nest` — the authoritative HEALPix tile-pixel→sky geometry —
   * rather than a hand-guessed `corners_nest` reordering. The old reorder
   * mis-oriented each tile's texture (it appeared reflected about the diagonal);
   * deriving the corners from the same primitive that indexes the tile pixels
   * removes the guesswork. See RASTER_CORNERS below and tests/unit/projection
   * (tileImageCornerVectors) which pins this mapping.
   */
  function drawTile(
    context: CanvasRenderingContext2D,
    img: HTMLImageElement,
    tile: TileKey
  ) {
    const nside = order2nside(tile.order);
    const totalPixels = nside2npix(nside);
    if (tile.pixelIndex < 0 || tile.pixelIndex >= totalPixels) return;

    // Image raster corners in [TL, TR, BR, BL] order → sky unit-vectors.
    // `window.__tileCorners` is a test seam used by tests/ui/tile-orientation.spec.ts
    // to compare the shipped mapping against a reflected one; unset in normal use.
    const cornerOverride = (globalThis as unknown as { __tileCorners?: readonly [number, number][] })
      .__tileCorners;
    const ordered: V3[] = tileImageCornerVectors(nside, tile.pixelIndex, cornerOverride);

    const screen: [number, number][] = [];
    let anyOnScreen = false;
    const margin = TILE_SIZE;
    const view = currentView();
    for (const v of ordered) {
      const { theta, phi } = vec2ang(v);
      const { ra: cornerRa, dec: cornerDec } = thetaPhiToRadec(theta, phi);
      const [sx, sy] = skyToCanvas(view, cornerRa, cornerDec);
      if (isNaN(sx) || isNaN(sy)) return; // corner behind viewer → skip whole tile
      screen.push([sx, sy]);
      if (sx >= -margin && sx <= canvasWidth + margin && sy >= -margin && sy <= canvasHeight + margin) {
        anyOnScreen = true;
      }
    }
    if (!anyOnScreen) return;

    const w = img.naturalWidth || TILE_SIZE;
    const h = img.naturalHeight || TILE_SIZE;

    // Image-space corners matching screen[] order: N=(0,0) E=(w,0) S=(w,h) W=(0,h)
    const imgUV: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];

    // Split quad [0,1,2,3] into triangles (0,1,2) and (0,2,3).
    const [p0, p1, p2, p3] = screen;
    const [t0, t1, t2, t3] = imgUV;
    drawTexturedTriangle(context, img, p0!, p1!, p2!, t0!, t1!, t2!);
    drawTexturedTriangle(context, img, p0!, p2!, p3!, t0!, t2!, t3!);
  }

  /**
   * Affine-map an image triangle (source, in image pixels) onto a screen
   * triangle (dest). Sets a clip path for the dest triangle, computes the
   * affine transform that carries the source triangle onto it, and draws the
   * image under that transform. Standard 2D textured-triangle technique.
   */
  function drawTexturedTriangle(
    context: CanvasRenderingContext2D,
    img: HTMLImageElement,
    d0: [number, number],
    d1: [number, number],
    d2: [number, number],
    s0: [number, number],
    s1: [number, number],
    s2: [number, number]
  ) {
    // Inflate the dest triangle slightly outward from its centroid to hide
    // sub-pixel seams between adjacent triangles/tiles.
    const [x0, y0, x1, y1, x2, y2] = inflateTriangle(d0, d1, d2, 0.5);

    context.save();
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.lineTo(x2, y2);
    context.closePath();
    context.clip();

    // Solve affine [a c e; b d f] mapping source (u,v) → dest (x,y).
    const u0 = s0[0], v0 = s0[1];
    const u1 = s1[0] - u0, v1 = s1[1] - v0;
    const u2 = s2[0] - u0, v2 = s2[1] - v0;
    const dx1 = x1 - x0, dy1 = y1 - y0;
    const dx2 = x2 - x0, dy2 = y2 - y0;

    const det = u1 * v2 - u2 * v1;
    if (det === 0) {
      context.restore();
      return;
    }
    const a = (v2 * dx1 - v1 * dx2) / det;
    const b = (v2 * dy1 - v1 * dy2) / det;
    const c = (u1 * dx2 - u2 * dx1) / det;
    const d = (u1 * dy2 - u2 * dy1) / det;
    const e = x0 - a * u0 - c * v0;
    const f = y0 - b * u0 - d * v0;

    context.transform(a, b, c, d, e, f);
    context.drawImage(img, 0, 0);
    context.restore();
  }

  /** Push each vertex outward from the triangle centroid by `pad` pixels. */
  function inflateTriangle(
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    pad: number
  ): [number, number, number, number, number, number] {
    const gx = (p0[0] + p1[0] + p2[0]) / 3;
    const gy = (p0[1] + p1[1] + p2[1]) / 3;
    const push = (p: [number, number]): [number, number] => {
      const dx = p[0] - gx;
      const dy = p[1] - gy;
      const len = Math.hypot(dx, dy) || 1;
      return [p[0] + (dx / len) * pad, p[1] + (dy / len) * pad];
    };
    const [a0, a1] = push(p0);
    const [b0, b1] = push(p1);
    const [c0, c1] = push(p2);
    return [a0, a1, b0, b1, c0, c1];
  }

  // --- Tile Loading ---

  function loadTiles() {
    if (!canvasEl) return;
    const order = zoomToOrder(zoomLevel);
    const fmt = resolveFormat();
    const visibleTiles = getVisibleTiles(ra, dec, fov, order);
    const auth = rspToken ? getAuthHeader() : {};

    let loadAttempts = 0;
    let loadFailures = 0;

    for (const tile of visibleTiles) {
      const cacheKey = `${tile.order}-${tile.pixelIndex}`;
      if (tileCache.has(cacheKey)) continue;

      loadAttempts++;
      const url = buildUrl(tile.order, tile.pixelIndex, fmt, resolvedBaseUrl);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      pendingLoads.add(img);

      img.onload = () => {
        pendingLoads.delete(img);
        tileCache.set(cacheKey, img);
        clearError();
        scheduleRender();
      };

      img.onerror = () => {
        pendingLoads.delete(img);
        loadFailures++;
        if (loadFailures > 5 && loadFailures > loadAttempts * 0.5) {
          showError('Multiple tiles failed to load. Check your connection or try different coordinates.');
        }
      };

      if (rspToken && Object.keys(auth).length > 0) {
        fetch(url, { headers: auth })
          .then(resp => {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp.blob();
          })
          .then(blob => {
            const objUrl = URL.createObjectURL(blob);
            img.src = objUrl;
          })
          .catch(() => {
            pendingLoads.delete(img);
            loadFailures++;
          });
      } else {
        img.src = url;
      }
    }

    // Also load overlay tiles for current view
    if (overlays.size > 0) {
      loadOverlayTiles();
    }
  }

  // --- RAF Debounce ---

  let rafId: number | null = null;

  function scheduleRender() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      render();
    });
  }

  // --- Error Handling ---

  function showError(msg: string): void {
    hasError = true;
    errorMessage = msg;
    if (errorDismissTimer) clearTimeout(errorDismissTimer);
    errorDismissTimer = setTimeout(() => {
      hasError = false;
      errorMessage = '';
    }, 5000);
  }

  function clearError(): void {
    hasError = false;
    errorMessage = '';
    if (errorDismissTimer) {
      clearTimeout(errorDismissTimer);
      errorDismissTimer = null;
    }
  }

  // --- Event Handlers ---

  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartOffsetX = 0;
  let dragStartOffsetY = 0;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartOffsetX = panOffsetX;
    dragStartOffsetY = panOffsetY;
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  // --- Live cursor readout (RA/Dec + sampled luminance under the pointer) ---

  interface CursorReadout {
    ra: number;
    dec: number;
    px: number;
    py: number;
    value: number | null; // 0-1 relative luminance of the displayed pixel
  }
  let cursorReadout = $state<CursorReadout | null>(null);
  let lastValueSample = 0;

  /**
   * Update the cursor readout from a pointer position. RA/Dec is recomputed
   * every move (cheap); the pixel value is sampled from the canvas at a throttled
   * ~15 Hz to avoid frequent getImageData readbacks. Value is relative luminance
   * of the DISPLAYED pixel (JPEG-derived), not calibrated flux.
   */
  function updateCursorReadout(e: PointerEvent) {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const px = Math.round(e.clientX - rect.left);
    const py = Math.round(e.clientY - rect.top);
    if (px < 0 || py < 0 || px >= canvasWidth || py >= canvasHeight) {
      cursorReadout = null;
      return;
    }
    const [cRa, cDec] = canvasToSky(currentView(), px, py);
    let value = cursorReadout?.value ?? null;
    const now = performance.now();
    if (ctx && now - lastValueSample > 66) {
      lastValueSample = now;
      try {
        const d = ctx.getImageData(px, py, 1, 1).data;
        value = (0.299 * d[0]! + 0.587 * d[1]! + 0.114 * d[2]!) / 255;
      } catch {
        value = null;
      }
    }
    cursorReadout = { ra: cRa, dec: cDec, px, py, value };
  }

  function onPointerLeave() {
    cursorReadout = null;
  }

  function onPointerMove(e: PointerEvent) {
    updateCursorReadout(e);

    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    // Update canvas offset for smooth panning
    panOffsetX = dragStartOffsetX + dx;
    panOffsetY = dragStartOffsetY + dy;

    scheduleRender();
    emitState();
  }

  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;

    // Finalize: recenter on current view position
    if (panOffsetX !== 0 || panOffsetY !== 0) {
      const [newRa, newDec] = canvasToSky(currentView(), canvasWidth / 2, canvasHeight / 2);
      ra = newRa;
      dec = newDec;
      panOffsetX = 0;
      panOffsetY = 0;
    }

    loadTiles();
    emitState();
  }

  /**
   * Zoom centered on screen center (Issue #1: zoom centering).
   * The sky point at screen center remains fixed when zooming.
   */
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.5 : 0.5;

    // Find the sky point currently at screen center (accounting for pan offset)
    const [centerRa, centerDec] = canvasToSky(currentView(), canvasWidth / 2, canvasHeight / 2);

    // Apply zoom
    zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel + delta));
    fov = zoomToFov(zoomLevel);

    // Set that sky point as the new center so it stays at screen center
    ra = centerRa;
    dec = centerDec;
    panOffsetX = 0;
    panOffsetY = 0;

    scheduleRender();
    loadTiles();
    emitState();
  }

  function onDblClick(e: MouseEvent) {
    const rect = canvasEl.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const [newRa, newDec] = canvasToSky(currentView(), px, py);
    ra = newRa;
    dec = newDec;
    panOffsetX = 0;
    panOffsetY = 0;
    scheduleRender();
    loadTiles();
    emitState();
  }

  function onKeyDown(e: KeyboardEvent) {
    const panStep = fov / 4;
    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        zoomIn();
        break;
      case '-':
        e.preventDefault();
        zoomOut();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        ra = ((ra - panStep) % 360 + 360) % 360;
        panOffsetX = 0;
        panOffsetY = 0;
        scheduleRender();
        loadTiles();
        emitState();
        break;
      case 'ArrowRight':
        e.preventDefault();
        ra = ((ra + panStep) % 360 + 360) % 360;
        panOffsetX = 0;
        panOffsetY = 0;
        scheduleRender();
        loadTiles();
        emitState();
        break;
      case 'ArrowUp':
        e.preventDefault();
        dec = Math.min(89.99, dec + panStep);
        panOffsetX = 0;
        panOffsetY = 0;
        scheduleRender();
        loadTiles();
        emitState();
        break;
      case 'ArrowDown':
        e.preventDefault();
        dec = Math.max(-89.99, dec - panStep);
        panOffsetX = 0;
        panOffsetY = 0;
        scheduleRender();
        loadTiles();
        emitState();
        break;
      case '0':
        e.preventDefault();
        resetView();
        break;
    }
  }

  // --- State Emission ---

  function emitState() {
    if (!onViewerStateChange) return;
    onViewerStateChange({
      centerRa: ra,
      centerDec: dec,
      zoomLevel,
      scaling: { method: scaling },
      colorMap,
      interpolation,
    });
  }

  // --- Exported Methods ---

  export function zoomIn() {
    setZoom(Math.min(MAX_ZOOM, zoomLevel + 1));
  }

  export function zoomOut() {
    setZoom(Math.max(MIN_ZOOM, zoomLevel - 1));
  }

  export function resetView() {
    ra = initRa;
    dec = initDec;
    panOffsetX = 0;
    panOffsetY = 0;
    setZoom(initZoom);
  }

  export function panTo(newRa: number, newDec: number) {
    ra = ((newRa % 360) + 360) % 360;
    dec = Math.max(-90, Math.min(90, newDec));
    panOffsetX = 0;
    panOffsetY = 0;
    scheduleRender();
    emitState();
  }

  export function panToAndReload(newRa: number, newDec: number) {
    panTo(newRa, newDec);
    loadTiles();
  }

  /**
   * Set zoom level, centered on screen center (Issue #1).
   */
  export function setZoom(level: number) {
    // Find the sky point at screen center
    const [centerRa, centerDec] = canvasToSky(currentView(), canvasWidth / 2, canvasHeight / 2);

    zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
    fov = zoomToFov(zoomLevel);

    // Keep the screen center sky point fixed
    ra = centerRa;
    dec = centerDec;
    panOffsetX = 0;
    panOffsetY = 0;

    scheduleRender();
    loadTiles();
    emitState();
  }

  export function addOverlay(id: string, hipsUrl: string, opacity: number = 80) {
    if (overlays.has(id)) return;
    overlays.set(id, { id, baseUrl: hipsUrl, opacity });
    loadOverlayTiles();
  }

  export function removeOverlay(id: string) {
    overlays.delete(id);
    // Remove overlay tiles from cache
    const prefix = `overlay-${id}-`;
    for (const key of tileCache.keys()) {
      if (key.startsWith(prefix)) tileCache.delete(key);
    }
    scheduleRender();
  }

  export function setOverlayOpacity(id: string, opacity: number) {
    const entry = overlays.get(id);
    if (entry) {
      entry.opacity = opacity;
      scheduleRender();
    }
  }

  function loadOverlayTiles() {
    const order = zoomToOrder(zoomLevel);
    const fmt = resolveFormat();
    const auth = rspToken ? getAuthHeader() : {};
    const useAuth = rspToken && Object.keys(auth).length > 0;

    for (const [, overlay] of overlays) {
      const visibleTiles = getVisibleTiles(ra, dec, fov, order);
      for (const tile of visibleTiles) {
        const cacheKey = `overlay-${overlay.id}-${tile.order}-${tile.pixelIndex}`;
        if (tileCache.has(cacheKey)) continue;

        const url = buildUrl(tile.order, tile.pixelIndex, fmt, overlay.baseUrl);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        pendingLoads.add(img);

        img.onload = () => {
          pendingLoads.delete(img);
          tileCache.set(cacheKey, img);
          scheduleRender();
        };
        img.onerror = () => {
          pendingLoads.delete(img);
          // Silently skip — overlay may not have tiles at this order
        };

        // Use authenticated fetch for Rubin overlays
        if (useAuth && overlay.baseUrl.includes('data.lsst.cloud')) {
          fetch(url, { headers: auth })
            .then(resp => {
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              return resp.blob();
            })
            .then(blob => {
              const objUrl = URL.createObjectURL(blob);
              img.src = objUrl;
            })
            .catch(() => {
              pendingLoads.delete(img);
            });
        } else {
          img.src = url;
        }
      }
    }
  }

  // --- Post-Processing ---

  /**
   * Apply scaling, colormap, and invert to image data.
   * Operates on RGBA ImageData in-place.
   */
  function applyPostProcessing(imageData: ImageData) {
    const pixels = imageData.data;

    // Convert RGB to grayscale luminance values
    const gray = new Float64Array(canvasWidth * canvasHeight);
    for (let i = 0; i < gray.length; i++) {
      const r = pixels[i * 4]!;
      const g = pixels[i * 4 + 1]!;
      const b = pixels[i * 4 + 2]!;
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Apply scaling (normalized output 0-1)
    const scaled = applyScaling(gray, { method: scaling });

    // DS9-style display transfer applied to the post-stretch value: a black/
    // white-point cut then a contrast/bias remap about the colormap midpoint.
    // Identity at defaults (0,1,1,0.5), so the base look is unchanged.
    const lo = blackPoint;
    const hi = whitePoint;
    const range = Math.max(1e-6, hi - lo);
    const applyTransfer = lo > 0 || hi < 1 || contrast !== 1 || bias !== 0.5;
    if (applyTransfer) {
      const d = scaled.data;
      for (let i = 0; i < d.length; i++) {
        let v = (d[i]! - lo) / range;
        v = contrast * (v - bias) + 0.5;
        d[i] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    }

    // Apply colormap (RGBA output 0-255, 4 bytes per pixel)
    const colored = applyColorMap(scaled.data, colorMap);

    // Write back to canvas
    for (let i = 0; i < gray.length; i++) {
      const srcOffset = i * 4;
      const dstOffset = i * 4;

      let r = colored[srcOffset]!;
      let g = colored[srcOffset + 1]!;
      let b = colored[srcOffset + 2]!;

      // Apply invert (Issue #5)
      if (invert) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }

      pixels[dstOffset] = r;
      pixels[dstOffset + 1] = g;
      pixels[dstOffset + 2] = b;
      // Alpha stays 255 from colormap
    }
  }

  // --- Svelte Effects ---

  $effect(() => {
    if (!containerEl) return;

    ctx = canvasEl.getContext('2d');
    resizeToContainer();

    const ro = new ResizeObserver(() => resizeToContainer());
    ro.observe(containerEl);

    loadTiles();

    return () => {
      ro.disconnect();
      if (errorDismissTimer) {
        clearTimeout(errorDismissTimer);
        errorDismissTimer = null;
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      for (const img of pendingLoads) {
        img.onload = null;
        img.onerror = null;
      }
      pendingLoads.clear();
    };
  });

  // Re-render when processing props change
  $effect(() => {
    void scaling;
    void colorMap;
    void interpolation;
    void invert;
    void blackPoint;
    void whitePoint;
    void contrast;
    void bias;
    scheduleRender();
  });

  /**
   * On init / base-url change, fetch `{baseUrl}/properties` and adopt the
   * survey's hips_order (as MAX order) and hips_tile_format (first token).
   * Falls back to jpg / order 3 on any failure (e.g. CORS on the public DSS).
   */
  $effect(() => {
    const baseUrl = resolvedBaseUrl;
    if (!baseUrl) return;

    let cancelled = false;
    const cleanBase = baseUrl.replace(/\/properties$/, '').replace(/\/$/, '');
    const auth = rspToken ? getAuthHeader() : {};

    fetch(`${cleanBase}/properties`, { headers: auth })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.text();
      })
      .then((text) => {
        if (cancelled) return;
        const props = parseHipsProperties(text);
        surveyMaxOrder = props.hipsOrder;
        // hips_tile_format may list several formats ("png jpeg fits"); pick the
        // first browser-renderable one (skip fits), falling back to the first.
        const tokens = (props.tileFormat || '').split(/\s+/).filter(Boolean);
        surveyFormat =
          tokens.find((t) => RENDERABLE_FORMATS.includes(t.toLowerCase())) ??
          tokens[0] ??
          '';
        scheduleRender();
        loadTiles();
      })
      .catch(() => {
        if (cancelled) return;
        // Graceful fallback: keep defaults (jpg / order 3).
        surveyMaxOrder = DEFAULT_MAX_ORDER;
        surveyFormat = '';
      });

    return () => {
      cancelled = true;
    };
  });

  /**
   * Resize canvas to container. Called on init, resize, and fullscreen change (Issue #8).
   */
  function resizeToContainer() {
    if (!containerEl || !canvasEl) return;
    // Use getBoundingClientRect for accurate CSS pixel dimensions
    const rect = containerEl.getBoundingClientRect();
    const w = Math.round(rect.width) || 800;
    const h = Math.round(rect.height) || 600;
    if (w > 0 && h > 0) {
      canvasWidth = w;
      canvasHeight = h;
      // Set both attribute AND style to ensure canvas pixel size matches display size
      canvasEl.width = w;
      canvasEl.height = h;
      canvasEl.style.width = w + 'px';
      canvasEl.style.height = h + 'px';
      // Safety: ensure FOV is sane after resize
      fov = zoomToFov(zoomLevel);
      // Reset offscreen canvas so it gets recreated at new size
      if (offscreenCanvas) {
        offscreenCanvas.width = w;
        offscreenCanvas.height = h;
      }
      scheduleRender();
    }
  }

  // --- Computed Properties for FOV Indicator (Issue #7) ---

  const fovDegrees = $derived(fov.toFixed(2));
  const centerRaDisplay = $derived(ra.toFixed(4));
  const centerDecDisplay = $derived(dec.toFixed(4));

  // --- FOV Minimap (Issue #2) ---

  const MINIMAP_W = 120;
  const MINIMAP_H = 60;

  const minimapRect = $derived(() => {
    // Equirectangular projection: RA 0-360 → x, Dec -90..90 → y
    // At higher declinations, a fixed FOV covers LESS RA (not more)
    const cosDec = Math.cos((dec * Math.PI) / 180) || 0.01;
    const fovRa = fov * cosDec;
    const fovDec = fov;

    const x = ((ra - fovRa / 2) / 360) * MINIMAP_W;
    const y = ((90 - dec - fovDec / 2) / 180) * MINIMAP_H;
    const w = (fovRa / 360) * MINIMAP_W;
    const h = (fovDec / 180) * MINIMAP_H;

    return { x, y, w, h };
  });

  // --- Minimap Interaction (Issue #5) ---

  function minimapPixelToSky(clientX: number, clientY: number): [number, number] {
    const minimapEl = containerEl?.querySelector('.fov-minimap');
    if (!minimapEl) return [ra, dec];
    const rect = minimapEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    // Clamp to minimap bounds
    const cx = Math.max(0, Math.min(MINIMAP_W, x));
    const cy = Math.max(0, Math.min(MINIMAP_H, y));
    // Convert pixel position to RA/Dec (equirectangular)
    const newRa = (cx / MINIMAP_W) * 360;
    const newDec = 90 - (cy / MINIMAP_H) * 180;
    return [newRa, newDec];
  }

  function onMinimapClick(e: MouseEvent) {
    e.stopPropagation();
    const [newRa, newDec] = minimapPixelToSky(e.clientX, e.clientY);
    ra = newRa;
    dec = newDec;
    panOffsetX = 0;
    panOffsetY = 0;
    scheduleRender();
    loadTiles();
    emitState();
  }

  let minimapDragging = $state(false);

  function onMinimapPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    minimapDragging = true;
    (e.target as Element).setPointerCapture(e.pointerId);

    // Navigate to clicked position immediately
    const [newRa, newDec] = minimapPixelToSky(e.clientX, e.clientY);
    ra = newRa;
    dec = newDec;
    panOffsetX = 0;
    panOffsetY = 0;
    scheduleRender();
    loadTiles();
    emitState();

    // Listen for move/up on window for drag
    const onMove = (me: PointerEvent) => {
      if (!minimapDragging) return;
      const [mra, mdec] = minimapPixelToSky(me.clientX, me.clientY);
      ra = mra;
      dec = mdec;
      panOffsetX = 0;
      panOffsetY = 0;
      scheduleRender();
    };
    const onUp = () => {
      minimapDragging = false;
      loadTiles();
      emitState();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
</script>

<div class="image-viewer" bind:this={containerEl}>
  <canvas
    bind:this={canvasEl}
    width={canvasWidth}
    height={canvasHeight}
    class="hips-canvas"
    tabindex="0"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={onPointerLeave}
    onwheel={onWheel}
    ondblclick={onDblClick}
    onkeydown={onKeyDown}
  ></canvas>

  {#if cursorReadout}
    <PixelReadout
      ra={cursorReadout.ra}
      dec={cursorReadout.dec}
      pixelValue={cursorReadout.value}
      pixelX={cursorReadout.px}
      pixelY={cursorReadout.py}
      visible={true}
    />
  {/if}

  <!-- FOV Minimap (Issue #2) -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fov-minimap"
    aria-label="Sky position minimap"
    onclick={onMinimapClick}
    onpointerdown={onMinimapPointerDown}
  >
    <svg width={MINIMAP_W} height={MINIMAP_H} viewBox={`0 0 ${MINIMAP_W} ${MINIMAP_H}`}>
      <!-- Full sky background -->
      <rect x="0" y="0" width={MINIMAP_W} height={MINIMAP_H} fill="rgba(10,10,30,0.85)" stroke="rgba(100,100,255,0.3)" stroke-width="1" rx="3" />
      <!-- Grid lines -->
      <line x1={MINIMAP_W / 2} y1="0" x2={MINIMAP_W / 2} y2={MINIMAP_H} stroke="rgba(100,100,255,0.15)" stroke-width="0.5" />
      <line x1="0" y1={MINIMAP_H / 2} x2={MINIMAP_W} y2={MINIMAP_H / 2} stroke="rgba(100,100,255,0.15)" stroke-width="0.5" />
      <!-- Equator -->
      <line x1="0" y1={MINIMAP_H / 2} x2={MINIMAP_W} y2={MINIMAP_H / 2} stroke="rgba(100,100,255,0.25)" stroke-width="0.5" stroke-dasharray="2,2" />
      <!-- Current FOV rectangle -->
      <rect
        x={Math.max(0, minimapRect().x)}
        y={Math.max(0, minimapRect().y)}
        width={Math.min(MINIMAP_W - Math.max(0, minimapRect().x), Math.max(1, minimapRect().w))}
        height={Math.min(MINIMAP_H - Math.max(0, minimapRect().y), Math.max(1, minimapRect().h))}
        fill="rgba(100,100,255,0.2)"
        stroke="rgba(150,150,255,0.8)"
        stroke-width="1"
        rx="1"
        style="cursor: move;"
      />
    </svg>
  </div>

  <!-- FOV Indicator (Issue #7) -->
  <div class="fov-indicator" aria-label="Field of view indicator">
    <div class="fov-row">
      <span class="fov-label">FOV</span>
      <span class="fov-value">{fovDegrees}°</span>
    </div>
    <div class="fov-row">
      <span class="fov-label">RA</span>
      <span class="fov-value">{centerRaDisplay}°</span>
    </div>
    <div class="fov-row">
      <span class="fov-label">Dec</span>
      <span class="fov-value">{centerDecDisplay}°</span>
    </div>
  </div>

  {#if hasError}
    <div class="error-overlay" role="alert">
      <p>⚠️ {errorMessage}</p>
      <p class="hint">Try a different coordinate or check your connection.</p>
    </div>
  {/if}
</div>

<style>
  .image-viewer {
    width: 100%;
    height: 100%;
    min-height: 400px;
    background: #000;
    position: relative;
    overflow: hidden;
  }

  .hips-canvas {
    display: block;
    cursor: grab;
    image-rendering: pixelated;
    outline: none;
  }

  .hips-canvas:active {
    cursor: grabbing;
  }

  .fov-minimap {
    position: absolute;
    bottom: 88px;
    right: 12px;
    z-index: 5;
    pointer-events: auto;
    cursor: crosshair;
    border-radius: 5px;
    overflow: hidden;
  }

  .fov-indicator {
    position: absolute;
    bottom: 12px;
    right: 12px;
    background: rgba(10, 10, 30, 0.8);
    border: 1px solid rgba(100, 100, 255, 0.3);
    border-radius: 6px;
    padding: 6px 10px;
    color: #aac;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    z-index: 5;
    pointer-events: none;
    line-height: 1.5;
  }

  .fov-row {
    display: flex;
    gap: 8px;
    justify-content: space-between;
  }

  .fov-label {
    color: #88a;
    min-width: 24px;
  }

  .fov-value {
    color: #ccf;
    text-align: right;
  }

  .error-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(30, 0, 0, 0.85);
    border: 1px solid #c44;
    border-radius: 8px;
    padding: 24px 32px;
    color: #faa;
    text-align: center;
    z-index: 10;
  }

  .hint {
    color: #a88;
    font-size: 13px;
    margin-top: 8px;
  }
</style>
