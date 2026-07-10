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
  import {
    queryViewport,
    typeVisible,
    ALERT_TYPE_COLORS,
    type AlertSet,
    type AlertIndex,
  } from '../data/alerts.js';
  import {
    resolveActiveBaseUrl,
    isRubinUrl,
    activeBaseLabel,
    type BaseMode,
  } from '../utils/baseLayer.js';
  import { constellationFor } from '../utils/constellation.js';
  import { cardinalDirection, formatSeparation } from '../utils/skyGeom.js';
  import { nearestObject } from '../data/objects.js';
  import { sampleProfile, type LineProfile } from '../utils/crossSection.js';
  import type { ViewerState, ScalingFunction, ColorMapName, InterpolationMethod } from '../types/image.js';

  let {
    hipsBaseUrl = '',
    baseMode = 'auto' as BaseMode,
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
    alerts = null as AlertSet | null,
    alertIndex = null as AlertIndex | null,
    showAlerts = false,
    alertTypeMask = 0x1f,
    crossSectionMode = false,
    onViewerStateChange,
    onBaseResolved,
    onProfileChange,
  }: {
    /** Explicit base URL override (mainly for tests). When empty, `baseMode` + token drive resolution. */
    hipsBaseUrl?: string;
    /** Base-layer selection: 'auto' | 'dss' | 'rubin'. Auto degrades to DSS on Rubin failure. */
    baseMode?: BaseMode;
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
    /** Alert/DIA events to overlay (columnar TypedArrays). */
    alerts?: AlertSet | null;
    /** Prebuilt spatial index for `alerts` (viewport culling). */
    alertIndex?: AlertIndex | null;
    /** Whether to draw the alert overlay. */
    showAlerts?: boolean;
    /** Bitmask of visible AlertTypes. */
    alertTypeMask?: number;
    /** When true, the viewer is in cross-section mode: dragging draws/edits a
     *  line profile instead of panning the sky. */
    crossSectionMode?: boolean;
    onViewerStateChange?: (state: ViewerState) => void;
    /** Fired with the human label of the actually-resolved base survey (reflects auto-fallback). */
    onBaseResolved?: (label: string) => void;
    /** Fired with the sampled line profile whenever the cross-section changes. */
    onProfileChange?: (profile: LineProfile | null) => void;
  } = $props();

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

  // Auto-fallback: when Base=Auto and Rubin tiles fail, the viewer degrades to
  // public DSS WITHOUT user action. `autoFellBack` latches that; it is reset when
  // the user changes the base selection or the token (see the reset $effect).
  let autoFellBack = $state(false);

  const resolvedBaseUrl = $derived(
    hipsBaseUrl || resolveActiveBaseUrl(baseMode, !!rspToken, autoFellBack)
  );

  let canvasEl: HTMLCanvasElement;
  let containerEl: HTMLDivElement;
  let ctx: CanvasRenderingContext2D | null = null;

  // Alert overlay canvas (separate layer over the tile canvas).
  let alertCanvasEl: HTMLCanvasElement | undefined;
  let alertCtx: CanvasRenderingContext2D | null = null;

  // Cross-section overlay canvas (interactive: pointer-events on only in mode).
  // Endpoints are stored as RA/Dec and reprojected every render so the line
  // stays pinned to the sky through pan/zoom.
  let xsectionCanvasEl: HTMLCanvasElement | undefined;
  let xsectionCtx: CanvasRenderingContext2D | null = null;
  let xsP0 = $state<{ ra: number; dec: number } | null>(null);
  let xsP1 = $state<{ ra: number; dec: number } | null>(null);
  let xsDragHandle: 0 | 1 | null = null;
  // Private scratch canvas for honest PRE-colormap luminance sampling: base tiles
  // are drawn to it raw (no scaling/colormap/invert), so the profile reflects the
  // displayed image intensity, never the post-processed/colormapped pixels.
  let xsScratch: HTMLCanvasElement | null = null;
  let xsScratchCtx: CanvasRenderingContext2D | null = null;
  let xsLastKey = '';
  const XS_SAMPLES = 200;

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

  // Bumped whenever a tile finishes loading, so the post-processing memo (below)
  // knows the composited content changed even though ra/dec/fov didn't.
  let contentVersion = 0;

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
  // Above this many culled candidates, switch from individual markers to a
  // screen-space density heatmap so a frame is O(cells), not O(events).
  const ALERT_POINT_LIMIT = 4000;
  const ALERT_DENSITY_CELL = 6; // px

  /**
   * Draw the alert overlay onto its own canvas. Culls to the viewport via the
   * spatial index, then either plots individual markers (sparse) or a density
   * heatmap (dense). Kept aligned with the tiles by the same pan translate.
   */
  function renderAlerts() {
    if (!alertCtx || !alertCanvasEl) return;
    alertCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    if (!showAlerts || !alerts || !alertIndex || alerts.count === 0) return;

    // Generous sky bounds for culling (over-covers slightly; cheap + safe).
    const halfDec = Math.min(89, fov * 0.8);
    const decMin = Math.max(-90, dec - halfDec);
    const decMax = Math.min(90, dec + halfDec);
    const cosD = Math.max(0.02, Math.cos(dec * DEG2RAD));
    const halfRa = (fov * 0.8) / cosD;
    let raMin: number;
    let raMax: number;
    if (halfRa >= 180) {
      raMin = 0;
      raMax = 360;
    } else {
      raMin = ((ra - halfRa) % 360 + 360) % 360;
      raMax = ((ra + halfRa) % 360 + 360) % 360;
    }

    const view = currentView();
    const { ra: aRa, dec: aDec, type: aType } = alerts;

    // First pass: project + accumulate a screen-space density grid, and collect
    // marker points until the limit. One index query, one projection per point.
    const gridW = Math.max(1, Math.ceil(canvasWidth / ALERT_DENSITY_CELL));
    const gridH = Math.max(1, Math.ceil(canvasHeight / ALERT_DENSITY_CELL));
    const density = new Int32Array(gridW * gridH);
    let maxDensity = 0;
    const px: number[] = [];
    const py: number[] = [];
    const pType: number[] = [];
    let overLimit = false;

    queryViewport(alertIndex, alerts, raMin, raMax, decMin, decMax, (i) => {
      const t = aType[i]!;
      if (!typeVisible(alertTypeMask, t)) return;
      const [sx, sy] = skyToCanvas(view, aRa[i]!, aDec[i]!);
      if (Number.isNaN(sx) || sx < 0 || sy < 0 || sx >= canvasWidth || sy >= canvasHeight) return;
      const gx = (sx / ALERT_DENSITY_CELL) | 0;
      const gy = (sy / ALERT_DENSITY_CELL) | 0;
      const cell = gy * gridW + gx;
      const c = ++density[cell]!;
      if (c > maxDensity) maxDensity = c;
      if (!overLimit) {
        px.push(sx);
        py.push(sy);
        pType.push(t);
        if (px.length > ALERT_POINT_LIMIT) overLimit = true;
      }
    });

    alertCtx.save();
    alertCtx.translate(panOffsetX, panOffsetY);

    if (overLimit) {
      // Density heatmap (log-scaled intensity).
      const logMax = Math.log(maxDensity + 1) || 1;
      for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
          const c = density[gy * gridW + gx]!;
          if (c === 0) continue;
          const a = 0.15 + 0.75 * (Math.log(c + 1) / logMax);
          alertCtx.fillStyle = `rgba(255,180,60,${a.toFixed(3)})`;
          alertCtx.fillRect(gx * ALERT_DENSITY_CELL, gy * ALERT_DENSITY_CELL, ALERT_DENSITY_CELL, ALERT_DENSITY_CELL);
        }
      }
    } else {
      // Individual markers colored by type.
      for (let k = 0; k < px.length; k++) {
        alertCtx.fillStyle = ALERT_TYPE_COLORS[pType[k]!] ?? '#fff';
        alertCtx.beginPath();
        alertCtx.arc(px[k]!, py[k]!, 3, 0, Math.PI * 2);
        alertCtx.fill();
      }
    }
    alertCtx.restore();
  }

  // --- Cross-section line profile ------------------------------------------

  /** Draw the cross-section line + endpoint handles on the interactive overlay. */
  function renderCrossSection() {
    if (!xsectionCtx || !xsectionCanvasEl) return;
    xsectionCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    if (!crossSectionMode || !xsP0 || !xsP1) return;
    const view = currentView();
    const [x0, y0] = skyToCanvas(view, xsP0.ra, xsP0.dec);
    const [x1, y1] = skyToCanvas(view, xsP1.ra, xsP1.dec);
    if ([x0, y0, x1, y1].some((n) => Number.isNaN(n))) return;

    xsectionCtx.save();
    xsectionCtx.translate(panOffsetX, panOffsetY); // stay aligned with the tiles
    xsectionCtx.strokeStyle = 'rgba(120,220,255,0.9)';
    xsectionCtx.lineWidth = 1.5;
    xsectionCtx.beginPath();
    xsectionCtx.moveTo(x0, y0);
    xsectionCtx.lineTo(x1, y1);
    xsectionCtx.stroke();
    for (const [hx, hy] of [[x0, y0], [x1, y1]] as const) {
      xsectionCtx.beginPath();
      xsectionCtx.arc(hx, hy, 6, 0, Math.PI * 2);
      xsectionCtx.fillStyle = 'rgba(20,30,50,0.9)';
      xsectionCtx.fill();
      xsectionCtx.strokeStyle = '#7cf';
      xsectionCtx.lineWidth = 2;
      xsectionCtx.stroke();
    }
    xsectionCtx.restore();
  }

  // Cached pre-colormap luminance raster. Rebuilt only when the view/content
  // changes (keyed); endpoint drags re-walk the line over this buffer cheaply.
  let xsScratchData: Uint8ClampedArray | null = null;
  let xsScratchKey = '';
  let xsScratchTainted = false;

  /** Ensure the scratch grayscale raster is current; false if pixels are unreadable. */
  function ensureScratch(): boolean {
    const key = `${ra}|${dec}|${fov}|${zoomLevel}|${canvasWidth}x${canvasHeight}|${contentVersion}`;
    if (key === xsScratchKey && xsScratchData) return true;
    if (!xsScratch) {
      xsScratch = document.createElement('canvas');
      xsScratchCtx = xsScratch.getContext('2d', { willReadFrequently: true });
    }
    if (xsScratch.width !== canvasWidth || xsScratch.height !== canvasHeight) {
      xsScratch.width = canvasWidth;
      xsScratch.height = canvasHeight;
    }
    if (!xsScratchCtx) return false;
    // Base tiles only, drawn RAW (no pan, no colormap/scaling/invert) — this is
    // the honest displayed-luminance source the profile samples.
    xsScratchCtx.fillStyle = '#000';
    xsScratchCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    drawAllTiles(xsScratchCtx);
    try {
      xsScratchData = xsScratchCtx.getImageData(0, 0, canvasWidth, canvasHeight).data;
      xsScratchKey = key;
      return true;
    } catch {
      // Never fabricate zeros — surface the failure and render "no data".
      if (!xsScratchTainted) {
        xsScratchTainted = true;
        showError('Cross-section unavailable: the image is cross-origin protected (cannot read pixels).');
      }
      xsScratchData = null;
      return false;
    }
  }

  /** Sample the current line and push the profile to the parent. */
  function sampleCurrentProfile() {
    if (!crossSectionMode || !xsP0 || !xsP1) {
      onProfileChange?.(null);
      return;
    }
    if (!ensureScratch() || !xsScratchData) {
      onProfileChange?.(null);
      return;
    }
    const data = xsScratchData;
    const W = canvasWidth;
    const H = canvasHeight;
    const getPixel = (x: number, y: number): [number, number, number] | null => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= W || y >= H) return null;
      const i = (y * W + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r === 0 && g === 0 && b === 0) return null; // uncovered / no tile → gap, not 0
      return [r, g, b];
    };
    const view = currentView();
    const [x0, y0] = skyToCanvas(view, xsP0.ra, xsP0.dec);
    const [x1, y1] = skyToCanvas(view, xsP1.ra, xsP1.dec);
    const profile = sampleProfile(getPixel, x0, y0, x1, y1, xsP0.ra, xsP0.dec, xsP1.ra, xsP1.dec, XS_SAMPLES);
    onProfileChange?.(profile);
  }

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

    renderAlerts();
    renderCrossSection();
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

  // Key describing everything the post-processed offscreen depends on. During a
  // pan drag only panOffsetX/Y change (they are NOT in the key), so the expensive
  // redraw+getImageData+applyPostProcessing is skipped and we just re-composite.
  let ppLastKey = '';

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
      ppLastKey = ''; // resized buffer → force a redraw
    }
    if (!offscreenCtx) return;

    const key = `${ra}|${dec}|${fov}|${zoomLevel}|${canvasWidth}x${canvasHeight}|${scaling}|${colorMap}|${invert}|${blackPoint}|${whitePoint}|${contrast}|${bias}|${contentVersion}`;
    if (key !== ppLastKey) {
      ppLastKey = key;
      // Draw tiles to offscreen (no pan offset — we composite with offset below).
      offscreenCtx.fillStyle = '#000';
      offscreenCtx.fillRect(0, 0, canvasWidth, canvasHeight);
      drawAllTiles(offscreenCtx);

      const imageData = offscreenCtx.getImageData(0, 0, canvasWidth, canvasHeight);
      applyPostProcessing(imageData);
      offscreenCtx.putImageData(imageData, 0, 0);
    }

    // Composite to main canvas with pan offset (cheap; runs every frame).
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(offscreenCanvas, panOffsetX, panOffsetY);
  }

  function drawAllTiles(context: CanvasRenderingContext2D) {
    const order = zoomToOrder(zoomLevel);
    const view = currentView();
    const visibleTiles = getVisibleTiles(ra, dec, fov, order);

    const isLoaded = (key: string): boolean => {
      const img = tileCache.get(key);
      return !!img && img.complete && img.naturalWidth > 0;
    };

    // Pass 1 — ancestor (lower-order) backdrop. For every target tile that hasn't
    // loaded yet, draw the nearest already-cached NESTED-parent tile (pix >> 2k)
    // upscaled underneath. This is what makes zoom/pan feel instant: a blurry but
    // correct image is always painted instead of a black flash while the new
    // order streams in. A parent covers ≥ the child's sky, so the sharp pass
    // simply overwrites it. Same drawTile machinery → identical orientation.
    const drawnAncestors = new Set<string>();
    for (const tile of visibleTiles) {
      if (isLoaded(`${tile.order}-${tile.pixelIndex}`)) continue;
      for (let k = 1; k <= tile.order; k++) {
        const ancestorOrder = tile.order - k;
        const ancestorPix = tile.pixelIndex >> (2 * k);
        const aKey = `${ancestorOrder}-${ancestorPix}`;
        if (drawnAncestors.has(aKey)) break; // already painted this ancestor
        if (isLoaded(aKey)) {
          drawnAncestors.add(aKey);
          drawTile(context, tileCache.get(aKey)!, { order: ancestorOrder, pixelIndex: ancestorPix }, view);
          break;
        }
      }
    }

    // Pass 2 — sharp target-order tiles on top.
    const drawn = new Set<string>();
    for (const tile of visibleTiles) {
      const cacheKey = `${tile.order}-${tile.pixelIndex}`;
      if (drawn.has(cacheKey)) continue;
      drawn.add(cacheKey);
      if (isLoaded(cacheKey)) {
        drawTile(context, tileCache.get(cacheKey)!, tile, view);
      }
    }

    // Draw overlay tiles
    for (const [, overlay] of overlays) {
      for (const tile of visibleTiles) {
        const cacheKey = `overlay-${overlay.id}-${tile.order}-${tile.pixelIndex}`;
        if (drawn.has(cacheKey)) continue;
        drawn.add(cacheKey);
        if (isLoaded(cacheKey)) {
          context.globalAlpha = overlay.opacity / 100;
          drawTile(context, tileCache.get(cacheKey)!, tile, view);
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
    tile: TileKey,
    view: ViewParams = currentView()
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

  // Minimum failures before auto-fallback / error. Capped by the batch's attempt
  // count so it still fires at high zoom where only a few tiles are visible.
  const FALLBACK_MIN_FAILURES = 3;

  function loadTiles() {
    if (!canvasEl) return;
    const order = zoomToOrder(zoomLevel);
    const fmt = resolveFormat();
    const visibleTiles = getVisibleTiles(ra, dec, fov, order);

    // Capture the base context for THIS batch. resolvedBaseUrl is a $derived that
    // can flip mid-batch (once autoFellBack latches), so every async callback in
    // this batch must read these locals, not the live derived — otherwise the
    // failure that triggers the fallback would misreport its own host.
    const batchBaseUrl = resolvedBaseUrl;
    const batchIsRubin = isRubinUrl(batchBaseUrl);
    // Only send the Bearer token to the Rubin host — never to public CDS/DSS
    // (a credentialed cross-origin request there triggers a CORS preflight CDS
    // rejects, which would make the DSS fallback itself fail).
    const useAuth = !!rspToken && batchIsRubin;
    const auth = useAuth ? getAuthHeader() : {};
    const canAutoFallback = baseMode === 'auto' && !autoFellBack && batchIsRubin;

    let loadAttempts = 0;
    let loadFailures = 0;
    let loadSuccesses = 0;

    // Shared failure accounting for BOTH the <img> path and the authenticated
    // fetch path — previously the fetch path incremented a counter but never
    // surfaced anything, so Rubin failures were completely silent.
    const recordFailure = () => {
      loadFailures++;
      if (loadSuccesses > 0) return; // some tiles rendered → not a wholesale failure
      if (loadFailures < Math.min(FALLBACK_MIN_FAILURES, loadAttempts)) return;

      if (canAutoFallback) {
        // Degrade to public DSS automatically. Latching autoFellBack flips
        // resolvedBaseUrl → the base-change $effect clears the cache and reloads
        // DSS tiles. A persistent info banner (not the red error) explains it.
        autoFellBack = true;
      } else if (batchIsRubin) {
        // Explicit Rubin choice (or DSS already failed after fallback): the user
        // picked Rubin deliberately, so tell them to switch rather than silently
        // swapping their chosen layer.
        showError(
          'Rubin tiles unavailable here — your token may lack data rights for this survey/region, or the service is down. Switch the Base layer to “DSS2 Color” to use public imagery.'
        );
      } else {
        showError(
          'Multiple tiles failed to load. Check your connection or try different coordinates.'
        );
      }
    };

    for (const tile of visibleTiles) {
      const cacheKey = `${tile.order}-${tile.pixelIndex}`;
      if (tileCache.has(cacheKey)) continue;

      loadAttempts++;
      const url = buildUrl(tile.order, tile.pixelIndex, fmt, batchBaseUrl);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      pendingLoads.add(img);

      img.onload = () => {
        pendingLoads.delete(img);
        loadSuccesses++;
        tileCache.set(cacheKey, img);
        contentVersion++;
        clearError();
        scheduleRender();
      };

      img.onerror = () => {
        pendingLoads.delete(img);
        recordFailure();
      };

      if (useAuth) {
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
            recordFailure();
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

  // Coalesce tile FETCHES during a rapid gesture (wheel/keyboard zoom) to the
  // gesture's final view — otherwise every intermediate order fires a burst of
  // requests for tiles the user scrolls straight past. Rendering stays immediate
  // (RAF) so the ancestor-preview paints instantly; only the network is delayed.
  let loadTilesTimer: ReturnType<typeof setTimeout> | null = null;
  function loadTilesSoon(delay = 150) {
    if (loadTilesTimer) clearTimeout(loadTilesTimer);
    loadTilesTimer = setTimeout(() => {
      loadTilesTimer = null;
      loadTiles();
    }, delay);
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
    if (crossSectionMode) return; // in cross-section mode the overlay handles drags
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
    constellation: string | null;
    nearestName: string | null;
    nearestDetail: string | null; // e.g. "12.3′ NE"
  }
  let cursorReadout = $state<CursorReadout | null>(null);
  let lastValueSample = 0;
  let lastContextSample = 0;
  // Constellation + nearest-object refresh at a coarser rate than the pointer
  // move (they scan the catalog / boundary table); cached between refreshes.
  let cachedConstellation: string | null = null;
  let cachedNearestName: string | null = null;
  let cachedNearestDetail: string | null = null;

  /**
   * Update the cursor readout from a pointer position. RA/Dec is recomputed
   * every move (cheap); the pixel value (getImageData) and the sky-context
   * (constellation + nearest catalog object) are refreshed at a throttled ~15 Hz.
   * Value is relative luminance of the DISPLAYED pixel (JPEG-derived), not flux.
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
    if (now - lastContextSample > 100 && Number.isFinite(cRa) && Number.isFinite(cDec)) {
      lastContextSample = now;
      cachedConstellation = constellationFor(cRa, cDec).name;
      const near = nearestObject(cRa, cDec);
      if (near) {
        cachedNearestName = near.object.name;
        cachedNearestDetail = `${formatSeparation(near.separationDeg)} ${cardinalDirection(near.positionAngleDeg)}`;
      } else {
        cachedNearestName = null;
        cachedNearestDetail = null;
      }
    }
    cursorReadout = {
      ra: cRa,
      dec: cDec,
      px,
      py,
      value,
      constellation: cachedConstellation,
      nearestName: cachedNearestName,
      nearestDetail: cachedNearestDetail,
    };
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

  // --- Cross-section overlay pointer handlers (own the drag; never pan) ---

  /** Which endpoint handle (0 or 1) is within grab range of a screen point, else null. */
  function xsHandleAt(px: number, py: number): 0 | 1 | null {
    if (!xsP0 || !xsP1) return null;
    const view = currentView();
    const screen = (p: { ra: number; dec: number }): [number, number] => {
      const [x, y] = skyToCanvas(view, p.ra, p.dec);
      return [x + panOffsetX, y + panOffsetY];
    };
    const [ax, ay] = screen(xsP0);
    const [bx, by] = screen(xsP1);
    const d0 = Math.hypot(px - ax, py - ay);
    const d1 = Math.hypot(px - bx, py - by);
    if (Math.min(d0, d1) > 14) return null;
    return d0 <= d1 ? 0 : 1;
  }

  function onXsPointerDown(e: PointerEvent) {
    if (!crossSectionMode || !xsectionCanvasEl || e.button !== 0) return;
    e.stopPropagation();
    const rect = xsectionCanvasEl.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const handle = xsHandleAt(px, py);
    if (handle === null) {
      // Not on a handle → start a fresh line at the click; drag defines the far end.
      const [r, d] = canvasToSky(currentView(), px, py);
      if (!Number.isFinite(r) || !Number.isFinite(d)) return;
      xsP0 = { ra: r, dec: d };
      xsP1 = { ra: r, dec: d };
      xsDragHandle = 1;
    } else {
      xsDragHandle = handle;
    }
    xsectionCanvasEl.setPointerCapture(e.pointerId);
    scheduleRender();
  }

  function onXsPointerMove(e: PointerEvent) {
    if (xsDragHandle === null) return;
    const rect = xsectionCanvasEl!.getBoundingClientRect();
    const [r, d] = canvasToSky(currentView(), e.clientX - rect.left, e.clientY - rect.top);
    if (!Number.isFinite(r) || !Number.isFinite(d)) return;
    if (xsDragHandle === 0) xsP0 = { ra: r, dec: d };
    else xsP1 = { ra: r, dec: d };
    scheduleRender();
  }

  function onXsPointerUp(e: PointerEvent) {
    if (xsDragHandle === null) return;
    xsDragHandle = null;
    xsectionCanvasEl?.releasePointerCapture?.(e.pointerId);
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
    loadTilesSoon();
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
        loadTilesSoon();
        emitState();
        break;
      case 'ArrowRight':
        e.preventDefault();
        ra = ((ra + panStep) % 360 + 360) % 360;
        panOffsetX = 0;
        panOffsetY = 0;
        scheduleRender();
        loadTilesSoon();
        emitState();
        break;
      case 'ArrowUp':
        e.preventDefault();
        dec = Math.min(89.99, dec + panStep);
        panOffsetX = 0;
        panOffsetY = 0;
        scheduleRender();
        loadTilesSoon();
        emitState();
        break;
      case 'ArrowDown':
        e.preventDefault();
        dec = Math.max(-89.99, dec - panStep);
        panOffsetX = 0;
        panOffsetY = 0;
        scheduleRender();
        loadTilesSoon();
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
    loadTilesSoon();
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
          contentVersion++;
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

    ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    if (alertCanvasEl) alertCtx = alertCanvasEl.getContext('2d');
    if (xsectionCanvasEl) xsectionCtx = xsectionCanvasEl.getContext('2d');
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
      if (loadTilesTimer) {
        clearTimeout(loadTilesTimer);
        loadTilesTimer = null;
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
    void alerts;
    void alertIndex;
    void showAlerts;
    void alertTypeMask;
    void crossSectionMode;
    void xsP0;
    void xsP1;
    scheduleRender();
  });

  // Seed a default horizontal cross-section through the view center the first
  // time the tool is enabled (so there's always a line to grab).
  $effect(() => {
    if (crossSectionMode && (!xsP0 || !xsP1)) {
      const half = fov / 4;
      const cosd = Math.max(0.02, Math.cos(dec * DEG2RAD));
      xsP0 = { ra: ra - half / cosd, dec };
      xsP1 = { ra: ra + half / cosd, dec };
    }
  });

  // Resample the profile whenever the line, the view, or the tile content
  // changes. ensureScratch() only rebuilds the raster on view/content change, so
  // endpoint drags just re-walk the cached buffer (cheap).
  $effect(() => {
    void crossSectionMode;
    void xsP0;
    void xsP1;
    void ra;
    void dec;
    void fov;
    void zoomLevel;
    void contentVersion;
    void canvasWidth;
    void canvasHeight;
    sampleCurrentProfile();
  });

  // Reset the auto-fallback latch whenever the user changes the base selection or
  // the token — a fresh choice deserves a fresh Rubin attempt.
  let lastBaseMode = baseMode;
  let lastToken = rspToken;
  $effect(() => {
    const m = baseMode;
    const t = rspToken;
    if (m !== lastBaseMode || t !== lastToken) {
      lastBaseMode = m;
      lastToken = t;
      autoFellBack = false;
    }
  });

  // On an actual base-survey change (manual switch OR auto-fallback), drop the
  // base tile cache — keys are `order-pixelIndex` with no survey namespace, so a
  // cached Rubin tile would otherwise be reused for the same DSS pixel — then
  // reload. The properties $effect below also reloads on success, but it does NOT
  // on a CORS-failed /properties (public DSS), so we reload here to be safe.
  let lastLoadedBaseUrl = '';
  $effect(() => {
    const url = resolvedBaseUrl;
    if (!url) return;
    if (lastLoadedBaseUrl === '') {
      lastLoadedBaseUrl = url; // first run — the mount effect performs the initial load
      return;
    }
    if (url === lastLoadedBaseUrl) return;
    lastLoadedBaseUrl = url;
    for (const key of tileCache.keys()) {
      if (!key.startsWith('overlay-')) tileCache.delete(key);
    }
    clearError();
    scheduleRender();
    loadTiles();
  });

  // Report the actually-resolved base label to the parent so the active-layers
  // indicator reflects a silent auto-fallback (Auto → DSS2), not the nominal pick.
  $effect(() => {
    const url = resolvedBaseUrl;
    onBaseResolved?.(activeBaseLabel(url));
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
      // Keep the alert overlay canvas the same size as the tile canvas.
      if (alertCanvasEl) {
        alertCanvasEl.width = w;
        alertCanvasEl.height = h;
        alertCanvasEl.style.width = w + 'px';
        alertCanvasEl.style.height = h + 'px';
      }
      if (xsectionCanvasEl) {
        xsectionCanvasEl.width = w;
        xsectionCanvasEl.height = h;
        xsectionCanvasEl.style.width = w + 'px';
        xsectionCanvasEl.style.height = h + 'px';
      }
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

  <!-- Alert/DIA overlay: a separate, non-interactive canvas kept pixel-aligned
       with the tile canvas. Pointer events pass through to the tile canvas. -->
  <canvas bind:this={alertCanvasEl} class="alert-canvas" aria-hidden="true"></canvas>

  <!-- Cross-section overlay: interactive ONLY in mode (pointer-events toggled),
       so it structurally steals the drag from the tile canvas → no sky pan. -->
  <canvas
    bind:this={xsectionCanvasEl}
    class="xsection-canvas"
    class:active={crossSectionMode}
    aria-hidden="true"
    onpointerdown={onXsPointerDown}
    onpointermove={onXsPointerMove}
    onpointerup={onXsPointerUp}
    onpointercancel={onXsPointerUp}
  ></canvas>

  {#if cursorReadout}
    <PixelReadout
      ra={cursorReadout.ra}
      dec={cursorReadout.dec}
      pixelValue={cursorReadout.value}
      pixelX={cursorReadout.px}
      pixelY={cursorReadout.py}
      constellation={cursorReadout.constellation}
      nearestName={cursorReadout.nearestName}
      nearestDetail={cursorReadout.nearestDetail}
      visible={true}
    />
  {/if}

  {#if autoFellBack}
    <div class="info-banner" role="status">
      Rubin imagery unavailable — showing public DSS2 preview. Pick a Base layer to override.
    </div>
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

  .alert-canvas {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 4;
  }

  .xsection-canvas {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 6;
  }

  .xsection-canvas.active {
    pointer-events: auto;
    cursor: crosshair;
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

  .info-banner {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(20, 30, 50, 0.92);
    border: 1px solid #57c;
    border-radius: 6px;
    padding: 6px 14px;
    color: #bcf;
    font-size: 12px;
    z-index: 8;
    pointer-events: none;
    max-width: 80%;
    text-align: center;
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
