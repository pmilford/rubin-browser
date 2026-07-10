<script lang="ts">
  import { getAuthHeader } from '../api/auth.js';
  import { parseHipsProperties, radecToThetaPhi, thetaPhiToRadec } from '../api/hips.js';
  import {
    skyToCanvas,
    canvasToSky,
    zoomToFov,
    fovToOrder,
    tileImageCornerVectors,
    tileSubdivision,
    tileSubQuads,
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
    nearestAlert,
    timeWindowPredicate,
    ALERT_TYPE_COLORS,
    type AlertSet,
    type AlertIndex,
    type AlertHit,
  } from '../data/alerts.js';
  import {
    resolveActiveBaseUrl,
    isRubinUrl,
    isOfflineUrl,
    activeBaseLabel,
    type BaseMode,
  } from '../utils/baseLayer.js';
  import { offlineTileRGBA, OFFLINE_TILE_SIZE, OFFLINE_MJD } from '../data/offlineDataset.js';
  import { touchLru, evictLru } from '../utils/tileCache.js';
  import type { Band } from '../data/syntheticSky.js';
  import { constellationFor } from '../utils/constellation.js';
  import { cardinalDirection, formatSeparation } from '../utils/skyGeom.js';
  import {
    graticuleLines,
    compassRose,
    scaleBar,
    formatRa,
    formatDec,
  } from '../utils/graticule.js';
  import { nearestObject, identifyAt, type IdentifyInfo } from '../data/objects.js';
  import { sampleProfile, type LineProfile } from '../utils/crossSection.js';
  import type { ViewerState, ScalingFunction, ColorMapName, InterpolationMethod } from '../types/image.js';

  let {
    hipsBaseUrl = '',
    baseMode = 'auto' as BaseMode,
    rubinDataset = 'color_gri',
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
    alertTimeWindow = null as { min: number; max: number } | null,
    crossSectionMode = false,
    surfaceMode = false,
    showGraticule = false,
    offlineBand = 'r' as Band,
    offlineMjd = OFFLINE_MJD,
    onViewerStateChange,
    onBaseResolved,
    onProfileChange,
    onSurfaceChange,
    onIdentify,
    onAlertHover,
  }: {
    /** Explicit base URL override (mainly for tests). When empty, `baseMode` + token drive resolution. */
    hipsBaseUrl?: string;
    /** Base-layer selection: 'auto' | 'dss' | 'rubin'. Auto degrades to DSS on Rubin failure. */
    baseMode?: BaseMode;
    /** Rubin DP1 dataset id (colour composite or single band) for the multi-filter switch. */
    rubinDataset?: string;
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
    /** Only render / hit-test alerts whose time (MJD) is in this window (null = all). */
    alertTimeWindow?: { min: number; max: number } | null;
    /** When true, the viewer is in cross-section mode: dragging draws/edits a
     *  line profile instead of panning the sky. */
    crossSectionMode?: boolean;
    /** When true, draw the curved RA/Dec coordinate graticule + compass + scale bar. */
    showGraticule?: boolean;
    /** OFFLINE mode only: wavelength band to synthesize (g/r/i/z/y). */
    offlineBand?: Band;
    /** OFFLINE mode only: epoch (MJD) to synthesize — drives light curves + noise. */
    offlineMjd?: number;
    onViewerStateChange?: (state: ViewerState) => void;
    /** Fired with the human label of the actually-resolved base survey (reflects auto-fallback). */
    onBaseResolved?: (label: string) => void;
    /** Fired with the sampled line profile whenever the cross-section changes. */
    onProfileChange?: (profile: LineProfile | null) => void;
    /** When true, sample a region grid for the 3D surface plot. */
    surfaceMode?: boolean;
    /** Fired with the sampled NxN luminance grid for the 3D surface plot. */
    onSurfaceChange?: (grid: number[][] | null) => void;
    /** Fired when the user CLICKS (not drags) to identify the object at a sky point. */
    onIdentify?: (info: IdentifyInfo) => void;
    /** Fired on hover over the alert overlay with the nearest alert (or null). */
    onAlertHover?: (hit: AlertHit | null) => void;
  } = $props();

  const DEFAULT_FORMAT = 'jpg';
  const DEFAULT_MAX_ORDER = 3;
  // LRU cap on the tile cache. Chosen well above the largest visible set (a few
  // hundred at the lowest order) AND above a full offline blink at one band
  // (OFFLINE_EPOCHS × visible tiles ≈ 12 × ~60), so scrubbing the demo cube stays
  // instant while long browsing sessions / epochs×bands growth stay bounded.
  const MAX_TILE_CACHE = 1500;
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
  // Concrete reason (host + HTTP status) for the auto-fallback, shown in the info
  // banner so a silent degrade to DSS still tells the user WHY Rubin failed.
  let autoFallbackReason = $state('');

  const resolvedBaseUrl = $derived(
    hipsBaseUrl || resolveActiveBaseUrl(baseMode, !!rspToken, autoFellBack, rubinDataset)
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

  // Tile cache: tileKey(order,pixelIndex) -> HTMLImageElement
  const tileCache = new Map<string, HTMLImageElement>();

  // Allsky backdrop: a full-sky set of low-order tiles, prefetched once per base
  // and PINNED (never LRU-evicted) so the ancestor-preview pass always has a
  // coarse image to paint — no black flash when jumping to an unvisited region or
  // on first load. Drawn (subdivided) by the existing Pass-1 machinery.
  const ALLSKY_ORDER = 1; // nside 2 → 48 tiles cover the whole sky
  const pinnedTiles = new Set<string>();
  let allskySig = '';

  // Whether the active base is the OFFLINE synthetic layer. When offline, base
  // tile-cache keys are namespaced by (band, mjd) so different epochs/bands never
  // collide AND already-synthesized epochs stay cached for instant blinking.
  const offlineActive = $derived(isOfflineUrl(resolvedBaseUrl));

  // Signature of the currently-displayed base layer for render-memo keys. In
  // offline mode it folds in band+mjd so blinking to an ALREADY-CACHED epoch (no
  // new tile load → no contentVersion bump) still invalidates the memo and
  // repaints. Empty for network layers (their identity is already in the cache).
  const layerSignature = $derived(offlineActive ? `off|${offlineBand}|${offlineMjd}` : '');

  /** Cache key for a BASE tile. Offline tiles are namespaced by band+mjd so the
   *  same (order,pix) at a different epoch/band is a distinct cache entry. */
  function tileKey(order: number, pixelIndex: number): string {
    return offlineActive
      ? `off|${offlineBand}|${offlineMjd}|${order}-${pixelIndex}`
      : `${order}-${pixelIndex}`;
  }

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
    // Rubin DP1 tiles are PNG — return it even before the properties effect runs,
    // so the very first (auto-mode) request isn't a jpg that 404s every DP1 tile.
    if (isRubinUrl(resolvedBaseUrl)) return 'png';
    return DEFAULT_FORMAT; // public DSS is jpg
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

    const inWindow = alertTimeWindow
      ? timeWindowPredicate(alerts, alertTimeWindow.min, alertTimeWindow.max)
      : null;
    queryViewport(alertIndex, alerts, raMin, raMax, decMin, decMax, (i) => {
      const t = aType[i]!;
      if (!typeVisible(alertTypeMask, t)) return;
      if (inWindow && !inWindow(i)) return; // outside the selected time window
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

  const XS_HANDLE_MARGIN = 10;

  /** Absolute on-screen position of an endpoint handle, CLAMPED into the canvas so
   *  a handle whose sky point has scrolled off-screen (e.g. after a zoom-in) stays
   *  visible and grabbable. `clamped` is true when the true point is off-canvas. */
  function xsEndpointScreen(p: { ra: number; dec: number }): { x: number; y: number; clamped: boolean } {
    const [sx, sy] = skyToCanvas(currentView(), p.ra, p.dec);
    const x = sx + panOffsetX;
    const y = sy + panOffsetY;
    if (Number.isNaN(x) || Number.isNaN(y)) {
      // Behind the projection horizon: park the handle at the canvas centre edge.
      return { x: canvasWidth / 2, y: XS_HANDLE_MARGIN, clamped: true };
    }
    const cx = Math.max(XS_HANDLE_MARGIN, Math.min(canvasWidth - XS_HANDLE_MARGIN, x));
    const cy = Math.max(XS_HANDLE_MARGIN, Math.min(canvasHeight - XS_HANDLE_MARGIN, y));
    return { x: cx, y: cy, clamped: cx !== x || cy !== y };
  }

  /** Draw the cross-section line + endpoint handles on the interactive overlay. */
  function renderCrossSection() {
    if (!xsectionCtx || !xsectionCanvasEl) return;
    xsectionCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    if (!crossSectionMode || !xsP0 || !xsP1) return;
    const view = currentView();
    const [x0, y0] = skyToCanvas(view, xsP0.ra, xsP0.dec);
    const [x1, y1] = skyToCanvas(view, xsP1.ra, xsP1.dec);

    // The LINE follows the true (pan-translated) endpoints so it stays pinned to
    // the sky; handles are drawn in absolute, edge-clamped screen space so they are
    // always grabbable even when an endpoint has scrolled off-canvas.
    if (![x0, y0, x1, y1].some((n) => Number.isNaN(n))) {
      xsectionCtx.save();
      xsectionCtx.translate(panOffsetX, panOffsetY);
      xsectionCtx.strokeStyle = 'rgba(120,220,255,0.9)';
      xsectionCtx.lineWidth = 1.5;
      xsectionCtx.beginPath();
      xsectionCtx.moveTo(x0, y0);
      xsectionCtx.lineTo(x1, y1);
      xsectionCtx.stroke();
      xsectionCtx.restore();
    }

    for (const p of [xsP0, xsP1]) {
      const { x, y, clamped } = xsEndpointScreen(p);
      xsectionCtx.beginPath();
      xsectionCtx.arc(x, y, 6, 0, Math.PI * 2);
      xsectionCtx.fillStyle = clamped ? 'rgba(60,40,20,0.95)' : 'rgba(20,30,50,0.9)';
      xsectionCtx.fill();
      xsectionCtx.strokeStyle = clamped ? '#fb7' : '#7cf'; // amber ring = off-screen endpoint
      xsectionCtx.lineWidth = 2;
      xsectionCtx.stroke();
    }
  }

  // Cached pre-colormap luminance raster. Rebuilt only when the view/content
  // changes (keyed); endpoint drags re-walk the line over this buffer cheaply.
  let xsScratchData: Uint8ClampedArray | null = null;
  let xsScratchKey = '';
  let xsScratchTainted = false;

  /** Ensure the scratch grayscale raster is current; false if pixels are unreadable. */
  function ensureScratch(): boolean {
    const key = `${ra}|${dec}|${fov}|${zoomLevel}|${canvasWidth}x${canvasHeight}|${layerSignature}|${contentVersion}`;
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

  const SURFACE_N = 28; // grid resolution of the 3D surface region

  /** Sample an N×N luminance grid over the central region for the 3D surface plot,
   *  from the same honest pre-colormap scratch raster the cross-section uses. */
  function sampleSurfaceGrid() {
    if (!surfaceMode) { onSurfaceChange?.(null); return; }
    if (!ensureScratch() || !xsScratchData) { onSurfaceChange?.(null); return; }
    const data = xsScratchData;
    const W = canvasWidth;
    const H = canvasHeight;
    // Central square box, ~60% of the smaller dimension.
    const box = Math.floor(Math.min(W, H) * 0.6);
    const x0 = Math.floor((W - box) / 2);
    const y0 = Math.floor((H - box) / 2);
    const grid: number[][] = [];
    for (let r = 0; r < SURFACE_N; r++) {
      const row: number[] = [];
      const py = Math.min(H - 1, y0 + Math.round((r / (SURFACE_N - 1)) * (box - 1)));
      for (let c = 0; c < SURFACE_N; c++) {
        const px = Math.min(W - 1, x0 + Math.round((c / (SURFACE_N - 1)) * (box - 1)));
        const i = (py * W + px) * 4;
        const rr = data[i]!, gg = data[i + 1]!, bb = data[i + 2]!;
        // Gaps (pure black / no tile) → 0 height, not a fake value.
        row.push(rr === 0 && gg === 0 && bb === 0 ? 0 : (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255);
      }
      grid.push(row);
    }
    onSurfaceChange?.(grid);
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

    renderGraticule();
    renderAlerts();
    renderCrossSection();
  }

  /** A short screen-space compass ray (screen +y points down, so the angle from
   *  compassRose maps straight to cos/sin). */
  function drawCompassRay(cx: number, cy: number, angle: number, len: number, color: string, label: string) {
    if (!ctx) return;
    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx + dx * 1.35, cy + dy * 1.35 + 3);
    ctx.textAlign = 'left';
  }

  /**
   * Draw the curved RA/Dec graticule (projected polylines that follow the real
   * gnomonic curve), a true N/E compass, and a scale bar sized from the actual
   * projected pixels-per-degree — on the MAIN canvas, over the image. Grid lines
   * track the pan offset like the tiles; the compass and scale bar are screen-
   * anchored. Replaces the old decorative WcsOverlay.
   */
  function renderGraticule() {
    if (!ctx || !showGraticule) return;
    const view = currentView();

    // Grid lines follow the sky → apply the same pan translate the image uses.
    ctx.save();
    ctx.translate(panOffsetX, panOffsetY);
    const lines = graticuleLines(view);
    ctx.lineWidth = 1;
    for (const line of lines) {
      if (line.points.length < 2) continue;
      ctx.strokeStyle = line.kind === 'ra' ? 'rgba(120,200,255,0.32)' : 'rgba(120,255,180,0.28)';
      ctx.beginPath();
      ctx.moveTo(line.points[0]!.x, line.points[0]!.y);
      for (let i = 1; i < line.points.length; i++) ctx.lineTo(line.points[i]!.x, line.points[i]!.y);
      ctx.stroke();
    }
    // One label per distinct isoline value, near the middle of a run.
    ctx.fillStyle = 'rgba(210,235,255,0.85)';
    ctx.font = '10px monospace';
    const labeled = new Set<string>();
    for (const line of lines) {
      const key = `${line.kind}:${line.value}`;
      if (labeled.has(key)) continue;
      labeled.add(key);
      const p = line.points[Math.floor(line.points.length / 2)];
      if (!p) continue;
      ctx.fillText(line.kind === 'ra' ? formatRa(line.value) : formatDec(line.value), p.x + 3, p.y - 3);
    }
    ctx.restore();

    // Compass (screen-anchored, bottom-left) — TRUE north/east from the projection.
    const compass = compassRose(view);
    const cx = 48;
    const cy = canvasHeight - 64;
    drawCompassRay(cx, cy, compass.northAngleRad, 26, '#f88', 'N');
    drawCompassRay(cx, cy, compass.eastAngleRad, 26, '#8cf', 'E');

    // Scale bar (screen-anchored, bottom-right) — real pixels-per-degree.
    const bar = scaleBar(view);
    const bx2 = canvasWidth - 24;
    const bx1 = bx2 - bar.lengthPx;
    const by = canvasHeight - 26;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx1, by);
    ctx.lineTo(bx2, by);
    ctx.moveTo(bx1, by - 4); ctx.lineTo(bx1, by + 4);
    ctx.moveTo(bx2, by - 4); ctx.lineTo(bx2, by + 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(bar.label, (bx1 + bx2) / 2, by - 6);
    ctx.textAlign = 'left';
  }

  // Repaint when the graticule is toggled on/off.
  $effect(() => {
    void showGraticule;
    scheduleRender();
  });

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

    const key = `${ra}|${dec}|${fov}|${zoomLevel}|${canvasWidth}x${canvasHeight}|${scaling}|${colorMap}|${invert}|${blackPoint}|${whitePoint}|${contrast}|${bias}|${layerSignature}|${contentVersion}`;
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
      if (isLoaded(tileKey(tile.order, tile.pixelIndex))) continue;
      for (let k = 1; k <= tile.order; k++) {
        const ancestorOrder = tile.order - k;
        const ancestorPix = tile.pixelIndex >> (2 * k);
        const aKey = tileKey(ancestorOrder, ancestorPix);
        if (drawnAncestors.has(aKey)) break; // already painted this ancestor
        if (isLoaded(aKey)) {
          drawnAncestors.add(aKey);
          touchLru(tileCache, aKey);
          drawTile(context, tileCache.get(aKey)!, { order: ancestorOrder, pixelIndex: ancestorPix }, view);
          break;
        }
      }
    }

    // Pass 2 — sharp target-order tiles on top.
    const drawn = new Set<string>();
    for (const tile of visibleTiles) {
      const cacheKey = tileKey(tile.order, tile.pixelIndex);
      if (drawn.has(cacheKey)) continue;
      drawn.add(cacheKey);
      if (isLoaded(cacheKey)) {
        touchLru(tileCache, cacheKey);
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
          touchLru(tileCache, cacheKey);
          context.globalAlpha = overlay.opacity / 100;
          drawTile(context, tileCache.get(cacheKey)!, tile, view);
          context.globalAlpha = 1.0;
        }
      }
    }

    // LRU cap: after painting, evict the least-recently-DRAWN tiles beyond the cap
    // — but never a tile visible in THIS frame (drawn ∪ ancestors), so the cap can
    // never drop a tile the current view needs. Bounds the offline epochs×bands×
    // tiles growth and long browsing sessions.
    for (const a of drawnAncestors) drawn.add(a);
    for (const p of pinnedTiles) drawn.add(p); // never evict the allsky backdrop
    evictLru(tileCache, MAX_TILE_CACHE, drawn);
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

    // Subdivide only when the tile projects large on screen (a low-order ancestor
    // preview): a single affine map over a wide gnomonic quad warps the interior
    // "by a lot" vs the sharp small tiles on top. Small tiles → n=1 (unchanged,
    // zero cost). The test corner-override seam always uses the single-quad path.
    const n = cornerOverride ? 1 : tileSubdivision(screen);

    if (n === 1) {
      // Image-space corners matching screen[] order: N=(0,0) E=(w,0) S=(w,h) W=(0,h)
      const imgUV: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
      const [p0, p1, p2, p3] = screen;
      const [t0, t1, t2, t3] = imgUV;
      drawTexturedTriangle(context, img, p0!, p1!, p2!, t0!, t1!, t2!);
      drawTexturedTriangle(context, img, p0!, p2!, p3!, t0!, t2!, t3!);
      return;
    }

    // Piecewise-affine: project each sub-quad's own HEALPix corners so the interior
    // follows the true gnomonic projection, and texture the matching image sub-rect.
    for (const sub of tileSubQuads(n)) {
      const vecs = tileImageCornerVectors(nside, tile.pixelIndex, sub.hpx);
      const scr: [number, number][] = [];
      let ok = true;
      for (const v of vecs) {
        const { theta, phi } = vec2ang(v);
        const { ra: sRa, dec: sDec } = thetaPhiToRadec(theta, phi);
        const [sx, sy] = skyToCanvas(view, sRa, sDec);
        if (isNaN(sx) || isNaN(sy)) { ok = false; break; }
        scr.push([sx, sy]);
      }
      if (!ok) continue;
      const uv = sub.uv.map(([u, v]) => [u * w, v * h] as [number, number]);
      drawTexturedTriangle(context, img, scr[0]!, scr[1]!, scr[2]!, uv[0]!, uv[1]!, uv[2]!);
      drawTexturedTriangle(context, img, scr[0]!, scr[2]!, scr[3]!, uv[0]!, uv[2]!, uv[3]!);
    }
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
    const offline = isOfflineUrl(batchBaseUrl);
    const canAutoFallback = baseMode === 'auto' && !autoFellBack && batchIsRubin;

    let loadAttempts = 0;
    let loadFailures = 0;
    let loadSuccesses = 0;
    // First failure's host + HTTP status, so the user SEES 404-wrong-path vs.
    // 401/403-no-rights vs. network/CORS instead of a generic "unavailable".
    let firstFailHost = '';
    let firstFailStatus: number | null = null;

    const hostOf = (u: string): string => {
      try { return new URL(u).host; } catch { return u; }
    };
    const statusHint = (status: number | null): string => {
      if (status === 404) return `not found (HTTP 404) — the survey path may be wrong (DP0.2 vs DP1)`;
      if (status === 401 || status === 403) return `rejected your token (HTTP ${status}) — sign in again or your account may lack data rights`;
      if (status === null) return `could not be reached (network or CORS)`;
      return `failed (HTTP ${status})`;
    };

    // Shared failure accounting for BOTH the <img> path (no status available) and
    // the authenticated fetch path (real HTTP status) — previously the fetch path
    // incremented a counter but never surfaced anything, so Rubin failures were
    // completely silent, and a 404-wrong-path looked identical to a 401/no-rights.
    const recordFailure = (url: string, status: number | null) => {
      loadFailures++;
      if (!firstFailHost) { firstFailHost = hostOf(url); firstFailStatus = status; }
      if (loadSuccesses > 0) return; // some tiles rendered → not a wholesale failure
      if (loadFailures < Math.min(FALLBACK_MIN_FAILURES, loadAttempts)) return;

      const detail = `${firstFailHost} ${statusHint(firstFailStatus)}`;
      if (canAutoFallback) {
        // Degrade to public DSS automatically, but SURFACE the swallowed Rubin
        // error (host + status) so a wrong path can't masquerade as "no rights".
        autoFallbackReason = detail;
        autoFellBack = true;
      } else if (batchIsRubin) {
        // Explicit Rubin choice (or DSS already failed after fallback): the user
        // picked Rubin deliberately, so tell them to switch rather than silently
        // swapping their chosen layer — with the concrete host + status.
        showError(
          `Rubin tiles ${detail}. Switch the Base layer to “DSS2 Color” to use public imagery.`
        );
      } else {
        showError(
          `Tiles from ${detail}. Check your connection or try different coordinates.`
        );
      }
    };

    for (const tile of visibleTiles) {
      const cacheKey = tileKey(tile.order, tile.pixelIndex);
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
        recordFailure(url, null); // <img> path exposes no HTTP status
      };

      if (offline) {
        // Synthesize the tile locally from the bundled synthetic sky — no network.
        try {
          const rgba = offlineTileRGBA(tile.order, tile.pixelIndex, offlineBand, offlineMjd);
          const oc = document.createElement('canvas');
          oc.width = OFFLINE_TILE_SIZE;
          oc.height = OFFLINE_TILE_SIZE;
          const octx = oc.getContext('2d');
          if (octx) {
            octx.putImageData(new ImageData(rgba, OFFLINE_TILE_SIZE, OFFLINE_TILE_SIZE), 0, 0);
            img.src = oc.toDataURL(); // fires img.onload → cache
          } else {
            recordFailure(url, null);
          }
        } catch {
          recordFailure(url, null);
        }
      } else if (useAuth) {
        fetch(url, { headers: auth })
          .then(resp => {
            if (!resp.ok) {
              const e = new Error(`HTTP ${resp.status}`) as Error & { status?: number };
              e.status = resp.status;
              throw e;
            }
            return resp.blob();
          })
          .then(blob => {
            const objUrl = URL.createObjectURL(blob);
            img.src = objUrl;
          })
          .catch((e: Error & { status?: number }) => {
            pendingLoads.delete(img);
            recordFailure(url, e?.status ?? null);
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

  /**
   * Prefetch the full-sky ALLSKY_ORDER backdrop once per base (and per offline
   * band/mjd). Pins the keys so they survive LRU eviction, giving the ancestor
   * preview a guaranteed coarse image everywhere. A missing backdrop tile is
   * silently skipped — it must NEVER trip the auto-fallback (it's just a backdrop).
   */
  function prefetchAllsky() {
    const baseUrl = resolvedBaseUrl;
    if (!baseUrl) return;
    // Offline tiles synthesize locally with no network, so there is no black flash
    // to hide; prefetching a full-sky order-1 set for offline is pure cost (48
    // synths per band/epoch change, which would jank blinking) with no benefit —
    // and order-1 offline tiles show no sources anyway. Backdrop is network-only.
    if (isOfflineUrl(baseUrl)) { allskySig = ''; pinnedTiles.clear(); return; }
    const sig = `${baseUrl}|${layerSignature}`;
    if (sig === allskySig) return;
    allskySig = sig;
    pinnedTiles.clear(); // previous base pins are no longer protected

    const isRub = isRubinUrl(baseUrl);
    const useA = !!rspToken && isRub;
    const auth = useA ? getAuthHeader() : {};
    const fmt = resolveFormat();
    const npix = nside2npix(order2nside(ALLSKY_ORDER));

    for (let pix = 0; pix < npix; pix++) {
      const key = tileKey(ALLSKY_ORDER, pix);
      pinnedTiles.add(key);
      if (tileCache.has(key)) continue;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { tileCache.set(key, img); contentVersion++; scheduleRender(); };
      img.onerror = () => { /* backdrop tile missing → skip silently, no fallback */ };

      if (useA) {
        fetch(buildUrl(ALLSKY_ORDER, pix, fmt, baseUrl), { headers: auth })
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('allsky'))))
          .then((b) => { img.src = URL.createObjectURL(b); })
          .catch(() => { /* skip */ });
      } else {
        img.src = buildUrl(ALLSKY_ORDER, pix, fmt, baseUrl);
      }
    }
  }

  // Prefetch the allsky backdrop whenever the base (or offline band/epoch) changes.
  $effect(() => {
    void resolvedBaseUrl;
    void layerSignature;
    prefetchAllsky();
  });

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
      // Alert hit-testing: report the nearest visible alert under the cursor (within
      // a ~12px tolerance) so the parent can show an inspector tooltip.
      if (onAlertHover && showAlerts && alerts && alertIndex && Number.isFinite(cRa) && Number.isFinite(cDec)) {
        const tolDeg = Math.max(1 / 3600, (12 * fov) / canvasWidth);
        let hit = nearestAlert(alertIndex, alerts, cRa, cDec, tolDeg, alertTypeMask);
        if (hit && alertTimeWindow && (hit.timeMjd < alertTimeWindow.min || hit.timeMjd > alertTimeWindow.max)) {
          hit = null; // hidden by the time window
        }
        onAlertHover(hit);
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
    onAlertHover?.(null);
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
    // Use the same edge-clamped screen positions the handles are DRAWN at, so an
    // off-canvas endpoint's clamped handle is still grabbable (drag pulls it back).
    const a = xsEndpointScreen(xsP0);
    const b = xsEndpointScreen(xsP1);
    const d0 = Math.hypot(px - a.x, py - a.y);
    const d1 = Math.hypot(px - b.x, py - b.y);
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

  // A pointer-up within this many px of the pointer-down is a CLICK (identify),
  // not a pan. A larger movement recenters as before.
  const CLICK_MOVE_PX = 4;
  let pendingIdentifyTimer: ReturnType<typeof setTimeout> | null = null;

  function onPointerUp(e: PointerEvent) {
    if (!isDragging) return;
    isDragging = false;

    // Finalize a PAN: recenter on current view position.
    const wasPan = panOffsetX !== 0 || panOffsetY !== 0;
    if (wasPan) {
      const [newRa, newDec] = canvasToSky(currentView(), canvasWidth / 2, canvasHeight / 2);
      ra = newRa;
      dec = newDec;
      panOffsetX = 0;
      panOffsetY = 0;
    }

    loadTiles();
    emitState();

    // A CLICK (negligible movement, no pan) → identify the object here. Deferred
    // briefly so a double-click (navigate) can cancel it (see onDblClick).
    const moved = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
    if (!wasPan && moved < CLICK_MOVE_PX && !crossSectionMode && onIdentify) {
      const rect = canvasEl.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (pendingIdentifyTimer) clearTimeout(pendingIdentifyTimer);
      pendingIdentifyTimer = setTimeout(() => {
        pendingIdentifyTimer = null;
        doIdentify(px, py);
      }, 220);
    }
  }

  /** Identify the object at a canvas pixel and emit it to the parent's info panel. */
  function doIdentify(px: number, py: number) {
    const [r, d] = canvasToSky(currentView(), px, py);
    if (!Number.isFinite(r) || !Number.isFinite(d)) return;
    // Match radius scales with the zoomed field so a click "hits" what's visibly
    // under it, floored at 1′ and capped at 1° (the catalog is bright objects only).
    const matchRadius = Math.max(1 / 60, Math.min(fov * 0.25, 1));
    const res = identifyAt(r, d, matchRadius);
    onIdentify?.({ ...res, ra: r, dec: d, constellation: constellationFor(r, d).name });
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
    // A double-click NAVIGATES; cancel the pending single-click identify.
    if (pendingIdentifyTimer) { clearTimeout(pendingIdentifyTimer); pendingIdentifyTimer = null; }
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
    // Shift = coarse step (half the FOV), otherwise a quarter.
    const panStep = e.shiftKey ? fov / 2 : fov / 4;
    switch (e.key) {
      case '+':
      case '=':
      case 'PageUp':
        e.preventDefault();
        zoomIn();
        break;
      case '-':
      case 'PageDown':
        e.preventDefault();
        zoomOut();
        break;
      case 'Home':
        e.preventDefault();
        resetView();
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

  /**
   * Clear the auto→DSS fallback latch and re-attempt the nominal base survey.
   * The latch (autoFellBack) only resets on a base/token change, so once Auto
   * degraded to DSS (e.g. the initial view sat off every DP1 field) panning to a
   * covered field would keep showing DSS. Callers invoke this on an explicit
   * "go to" (search / DP1-field jump) so navigating onto Rubin coverage retries
   * Rubin instead of staying stuck on the fallback.
   */
  export function retryBase() {
    if (!autoFellBack) return;
    autoFellBack = false;
    autoFallbackReason = '';
    clearError();
    for (const key of tileCache.keys()) {
      if (!key.startsWith('overlay-')) tileCache.delete(key);
    }
    scheduleRender();
    loadTiles();
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
    void alertTimeWindow;
    void crossSectionMode;
    void xsP0;
    void xsP1;
    scheduleRender();
  });

  // (Re)seed a fresh horizontal cross-section across the CURRENT view every time
  // the tool is enabled. Endpoints are anchored in RA/Dec and reproject with the
  // sky, so after a zoom-in a previously-placed line can sit entirely off-canvas
  // with its handles ungrabbable; and toggling the tool off/on used to restore
  // that same stale off-screen line ("sticky"). Reseeding on each enable spans
  // the current FOV, so there is always an on-screen, grabbable line to adjust.
  let xsWasActive = false;
  $effect(() => {
    const active = crossSectionMode;
    if (active && !xsWasActive) {
      const half = fov / 4;
      const cosd = Math.max(0.02, Math.cos(dec * DEG2RAD));
      xsP0 = { ra: ra - half / cosd, dec };
      xsP1 = { ra: ra + half / cosd, dec };
    }
    xsWasActive = active;
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
    void offlineBand; // offline epoch/band change repaints tiles → re-sample
    void offlineMjd;
    sampleCurrentProfile();
  });

  // Re-sample the 3D surface region on the same triggers.
  $effect(() => {
    void surfaceMode;
    void ra;
    void dec;
    void fov;
    void zoomLevel;
    void contentVersion;
    void canvasWidth;
    void canvasHeight;
    void offlineBand;
    void offlineMjd;
    sampleSurfaceGrid();
  });

  // Reset the auto-fallback latch whenever the user changes the base selection or
  // the token — a fresh choice deserves a fresh Rubin attempt.
  let lastBaseMode = baseMode;
  let lastToken = rspToken;
  let lastRubinDataset = rubinDataset;
  $effect(() => {
    const m = baseMode;
    const t = rspToken;
    const ds = rubinDataset;
    if (m !== lastBaseMode || t !== lastToken || ds !== lastRubinDataset) {
      lastBaseMode = m;
      lastToken = t;
      lastRubinDataset = ds;
      autoFellBack = false;
      autoFallbackReason = '';
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

  // Offline band/epoch change: re-synthesize tiles for the new (band, mjd). We do
  // NOT clear the cache — offline keys are namespaced by band+mjd (see tileKey),
  // so previously-visited epochs stay cached and blinking back to them is instant.
  // Guarded so it never fires for network layers or on the initial mount.
  let lastOfflineSig = '';
  $effect(() => {
    const sig = layerSignature;
    if (!offlineActive) { lastOfflineSig = ''; return; }
    if (lastOfflineSig === '') { lastOfflineSig = sig; return; } // first offline frame handled by base-url effect
    if (sig === lastOfflineSig) return;
    lastOfflineSig = sig;
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

    // Offline synthetic dataset has no server; render locally up to a modest order.
    if (isOfflineUrl(baseUrl)) {
      surveyMaxOrder = 6;
      surveyFormat = '';
      scheduleRender();
      loadTiles();
      return;
    }

    // Rubin DP1 HiPS: every dataset is PNG at hips_order 11 (verified from the
    // public https://data.lsst.cloud/api/hips/v2/dp1/list). Its /properties is
    // auth-gated and a cross-origin authed fetch triggers a CORS preflight that
    // fails — which used to drop us to the jpg/order-3 defaults, so every DP1 tile
    // 404'd (requested .jpg at order ≤3). Seed the correct values directly instead
    // of depending on that fetch; the tiles themselves carry the Bearer token via
    // the fetch→blob path in loadTiles.
    if (isRubinUrl(baseUrl)) {
      surveyFormat = 'png';
      surveyMaxOrder = 11;
      scheduleRender();
      loadTiles();
      return;
    }

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
      // Resize the post-processing offscreen ONLY when the size actually changed:
      // assigning canvas.width/height clears the bitmap to black even when the
      // value is unchanged, and since the post-processing composite is memoized on
      // `ppLastKey`, a cleared-but-not-invalidated offscreen would be re-composited
      // black on the next render that doesn't otherwise change (e.g. returning to a
      // cached tile set). So guard the assignment AND invalidate the memo with it.
      if (offscreenCanvas && (offscreenCanvas.width !== w || offscreenCanvas.height !== h)) {
        offscreenCanvas.width = w;
        offscreenCanvas.height = h;
        ppLastKey = '';
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
      Rubin imagery unavailable — showing public DSS2 preview.{#if autoFallbackReason} Rubin {autoFallbackReason}.{/if} Pick a Base layer to override.
    </div>
  {/if}

  {#if baseMode === 'offline'}
    <div class="synthetic-banner" role="status">
      SYNTHETIC OFFLINE DATA — generated locally, not a real survey
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

  .synthetic-banner {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(60, 40, 10, 0.92);
    border: 1px solid #b83;
    border-radius: 6px;
    padding: 5px 14px;
    color: #fd9;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
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
