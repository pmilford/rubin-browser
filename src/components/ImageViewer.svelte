<script lang="ts">
  import { getAuthHeader } from '../api/auth.js';
  import { toRequestUrl } from '../api/rspProxy.js';
  import { parseHipsProperties, radecToThetaPhi, thetaPhiToRadec, getTileCenter } from '../api/hips.js';
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
  import { postProcessMemoKey } from '../utils/renderKey.js';
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
  import { dp1CoverageCircles, coverageCirclePoints } from '../data/footprint.js';
  import type { CatalogSet } from '../data/catalog.js';
  import { pmVectorEndpoint } from '../utils/gaiaViz.js';
  import { touchLru, evictLru } from '../utils/tileCache.js';
  import {
    tileReady,
    tileWidth,
    tileHeight,
    isBitmap,
    closeTile,
    type DecodedTile,
  } from '../utils/decodedTile.js';
  import { PerfMetrics, type PerfSnapshot } from '../utils/perfMetrics.js';
  import { TileScheduler, type TileLoadHandle } from '../utils/tileScheduler.js';
  import type { Band } from '../data/syntheticSky.js';
  import { constellationFor } from '../utils/constellation.js';
  import {
    cardinalDirection,
    formatSeparation,
    angularSeparation,
    positionAngle,
  } from '../utils/skyGeom.js';
  import {
    graticuleLines,
    compassRose,
    scaleBar,
    formatGridLabel,
    type CoordSystem,
  } from '../utils/graticule.js';
  import { nearestObject, identifyAt, type IdentifyInfo } from '../data/objects.js';
  import type { Ds9Region } from '../utils/ds9Regions.js';
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
    gridSystem = 'equatorial' as CoordSystem,
    showCoverage = false,
    showMagnifier = false,
    catalog = null,
    selectedCatalogIndex = -1,
    showPmVectors = false,
    lensCatalog = null,
    selectedLensIndex = -1,
    rubinCatalog = null,
    selectedRubinIndex = -1,
    rulerMode = false,
    onRulerChange,
    regions = [] as Ds9Region[],
    showRegions = true,
    regionMode = false,
    regionShape = 'circle' as 'circle' | 'polygon',
    onRegionsChange,
    offlineBand = 'r' as Band,
    offlineMjd = OFFLINE_MJD,
    onViewerStateChange,
    onBaseResolved,
    onProfileChange,
    onSurfaceChange,
    onIdentify,
    onSkyContext,
    onAlertHover,
    onPerfSnapshot,
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
    /** When true, draw the curved coordinate graticule + compass + scale bar. */
    showGraticule?: boolean;
    /** Coordinate system the graticule follows: equatorial | galactic | ecliptic. */
    gridSystem?: CoordSystem;
    /** When true, shade the Rubin DP1 field footprints (where data actually exists). */
    showCoverage?: boolean;
    /** When true, show a magnifier loupe of the pixels under the cursor. */
    showMagnifier?: boolean;
    /** Catalog overlay (e.g. Gaia cone-search) to draw as markers; null = none. */
    catalog?: CatalogSet | null;
    /** Index of the selected catalog source (highlighted marker), or -1. */
    selectedCatalogIndex?: number;
    /** When true, draw proper-motion arrows from each catalog marker that has a
     *  finite (pmRA*, pmDec) in `catalog.pmRaMasYr`/`pmDecMasYr`. */
    showPmVectors?: boolean;
    /** Gravitational-lens overlay (feature 130) — an INDEPENDENT labelled layer,
     *  drawn on top of (and never replacing) the `catalog` layer; null = none. */
    lensCatalog?: CatalogSet | null;
    /** Index of the selected lens (highlighted marker), or -1. */
    selectedLensIndex?: number;
    /** Rubin DP1 `dp1.Object` cone-search overlay (feature 128) — the token-gated
     *  sibling of the Gaia `catalog` layer, an INDEPENDENT layer drawn as square
     *  markers so it reads differently from Gaia (round) and lenses (diamond). */
    rubinCatalog?: CatalogSet | null;
    /** Index of the selected Rubin Object (highlighted marker), or -1. */
    selectedRubinIndex?: number;
    /** When true, dragging measures a great-circle distance instead of panning. */
    rulerMode?: boolean;
    /** Fired with the current ruler measurement (or null when cleared). */
    onRulerChange?: (m: { separationDeg: number; paDeg: number; text: string } | null) => void;
    /** DS9 regions to draw (feature 121). Sky regions in ICRS degrees; reprojected
     *  every frame via skyToCanvas so they track pan/zoom (not screen-pinned). */
    regions?: Ds9Region[];
    /** When true (and `regions` non-empty), draw the committed region layer. */
    showRegions?: boolean;
    /** When true, the region overlay steals the pointer: drawing a region instead
     *  of panning the sky (mirrors the ruler / cross-section tools). */
    regionMode?: boolean;
    /** Which shape the user is drawing: 'circle' (drag) or 'polygon' (click verts). */
    regionShape?: 'circle' | 'polygon';
    /** Fired with the updated region list whenever the user commits a new region. */
    onRegionsChange?: (regions: Ds9Region[]) => void;
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
    /** Fired on right-click (context menu) with the sky RA/Dec under the cursor. */
    onSkyContext?: (ra: number, dec: number) => void;
    /** Fired on hover over the alert overlay with the nearest alert (or null). */
    onAlertHover?: (hit: AlertHit | null) => void;
    /** Fired (throttled) with a live performance snapshot for the Perf HUD. */
    onPerfSnapshot?: (snapshot: PerfSnapshot) => void;
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
  // Distance-ruler tool: two sky endpoints, reprojected each render; the readout
  // is the great-circle separation (skyGeom), not a flat pixel distance.
  let rulerCanvasEl: HTMLCanvasElement | undefined;
  let rulerCtx: CanvasRenderingContext2D | null = null;
  let rulerP0 = $state<{ ra: number; dec: number } | null>(null);
  let rulerP1 = $state<{ ra: number; dec: number } | null>(null);
  let rulerDragHandle: 0 | 1 | null = null;
  // DS9 region-drawing overlay (feature 121): interactive only in region mode.
  // A committed region's geometry is stored in RA/Dec degrees and reprojected each
  // render. Drafts (in-progress) live here as sky points until committed upward.
  let regionCanvasEl: HTMLCanvasElement | undefined;
  let regionCtx: CanvasRenderingContext2D | null = null;
  // Circle draft: centre + the point the drag is currently at (radius = sep).
  let regionCircleCenter = $state<{ ra: number; dec: number } | null>(null);
  let regionCircleEdge = $state<{ ra: number; dec: number } | null>(null);
  let regionDrawingCircle = false;
  // Polygon draft: committed vertices + a live cursor point for the rubber band.
  let regionPolyVerts = $state<{ ra: number; dec: number }[]>([]);
  let regionPolyCursor = $state<{ ra: number; dec: number } | null>(null);
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

  // Tile cache: tileKey(order,pixelIndex) -> a decoded tile (off-thread
  // ImageBitmap on the fast path, HTMLImageElement on the <img> fallback path).
  const tileCache = new Map<string, DecodedTile>();

  // Whether the runtime can decode tiles OFF the main thread (createImageBitmap).
  // false in jsdom (unit tests) and ancient browsers → every path degrades to the
  // main-thread <img> decode, so nothing regresses where it is unavailable.
  const canBitmap = typeof createImageBitmap === 'function';

  // Test seam (Playwright only): tallies how tiles were decoded so a browser test
  // can PROVE the off-thread createImageBitmap path is actually taken (bitmap > 0)
  // and not silently falling back to main-thread <img> decode. Never read in prod.
  const decodeCounts = ((globalThis as unknown as { __tileDecodeCounts?: { bitmap: number; img: number } })
    .__tileDecodeCounts ??= { bitmap: 0, img: 0 });

  // --- Performance instrumentation + fetch scheduling ---
  // `perf` is a pure collector fed by the REAL fetch/cache/render events below;
  // its snapshot drives the (default-off) Perf HUD in TileViewer. `tileScheduler`
  // provides in-flight DEDUP (never fetch the same tile twice concurrently) and
  // CANCELLATION (abort loads for tiles a newer view superseded).
  const perf = new PerfMetrics();
  const tileScheduler = new TileScheduler();

  // Throttled perf reporting: push at most ~10 Hz, plus a trailing flush so the
  // final idle snapshot (in-flight back to 0) always reaches the HUD.
  let lastPerfReport = 0;
  let perfReportTimer: ReturnType<typeof setTimeout> | null = null;
  function reportPerf(force = false): void {
    if (!onPerfSnapshot) return;
    const now = performance.now();
    if (!force && now - lastPerfReport < 100) {
      if (!perfReportTimer) {
        perfReportTimer = setTimeout(() => {
          perfReportTimer = null;
          reportPerf(true);
        }, 120);
      }
      return;
    }
    lastPerfReport = now;
    onPerfSnapshot(perf.snapshot());
  }

  /**
   * Abort every in-flight tile load AND reconcile the perf in-flight gauge for the
   * aborted ones. tileScheduler.clear() only detaches the loads; without counting a
   * cancel per aborted load, perf.inFlight would leak (stay > 0) — which happens
   * when the mount $effect re-runs (its cleanup aborts loads that a later re-run
   * re-requests). Used wherever loads are torn down without a full perf.reset().
   */
  function abortInFlightLoads(): void {
    const n = tileScheduler.inFlightCount();
    tileScheduler.clear();
    for (let i = 0; i < n; i++) perf.recordFetchCancel();
  }

  // HiPS Allsky backdrop: the survey's single Norder3/Allsky.<ext> preview, sliced
  // into its 768 order-3 tiles and kept HERE (NOT in tileCache) so a backdrop tile
  // can never collide with — and block the load of — the sharp same-order tile.
  // drawAllTiles Pass 0 paints these UNDER every sharp pass. IVOA HiPS Allsky
  // packing: n_tiles_in_row = int(sqrt(nTiles)); tile ipix at (row,col) =
  // divmod(ipix, n_tiles_in_row); tile_width = allskyWidth / n_tiles_in_row.
  const ALLSKY_TILE_ORDER = 3; // 12 * (2^3)^2 = 768 tiles
  const ALLSKY_TILES_PER_ROW = Math.floor(Math.sqrt(nside2npix(order2nside(ALLSKY_TILE_ORDER)))); // 27
  const allskyBackdrop = new Map<number, DecodedTile>();

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

  /**
   * Signature of the overlay stack (ids + opacities), for the post-processing
   * memo key. Without this, the offscreen composite in renderWithPostProcessing
   * is cached across an overlay add/remove or an opacity change while the view is
   * unchanged, so the slider/toggle appears dead until the next pan busts the key
   * on ra/dec. `overlays` is a plain Map (not $state), so this is computed at
   * render time from the live entries rather than via a $derived.
   */
  function overlaysSignature(): string {
    let sig = '';
    for (const [, o] of overlays) sig += `${o.id}:${o.opacity};`;
    return sig;
  }

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
    const renderStart = performance.now();

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
    renderCoverage();
    renderCatalog();
    renderLensCatalog();
    renderRubinCatalog();
    renderAlerts();
    renderCrossSection();
    renderRuler();
    renderRegionOverlay();

    // Time the full frame → FPS + last-render for the HUD, then push a snapshot.
    perf.recordRender(performance.now() - renderStart);
    reportPerf();
  }

  /**
   * Draw the catalog overlay (e.g. a Gaia cone-search) as markers on the main
   * canvas: a small ring per source at its projected position, with the selected
   * source highlighted. Sources off-canvas or on the far hemisphere are skipped.
   * Bounded by the cone's row cap, so a per-frame projection sweep is cheap.
   */
  // Pixels drawn per mas/yr of proper motion. Real stellar PM is a few to tens of
  // mas/yr, so this makes the arrows visibly scale with PM at any zoom (a fast
  // mover gets a long arrow) without swamping the 12′ overlay cone. Screen-space
  // (fixed length regardless of zoom) so arrows never vanish when zoomed out.
  const PM_ARROW_PX_PER_MASYR = 6;

  function renderCatalog() {
    if (!ctx || !catalog || catalog.count === 0) return;
    const view = currentView();
    const colorRgb = catalog.colorRgb;
    const pmRa = catalog.pmRaMasYr;
    const pmDec = catalog.pmDecMasYr;
    ctx.save();
    ctx.lineWidth = 1.2;
    for (let i = 0; i < catalog.count; i++) {
      const [x, y] = skyToCanvas(view, catalog.ra[i]!, catalog.dec[i]!);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < -8 || y < -8 || x > canvasWidth + 8 || y > canvasHeight + 8) continue;

      // Per-source colour from BP−RP (hot=blue → cool=red; NaN=grey) when the
      // catalog provides it; otherwise the legacy cyan marker.
      const fill = colorRgb
        ? `rgb(${colorRgb[i * 3]},${colorRgb[i * 3 + 1]},${colorRgb[i * 3 + 2]})`
        : 'rgba(90,220,255,0.85)';

      // Proper-motion arrow (optional) along (pmRA*, pmDec) — drawn UNDER the
      // marker so the coloured disc stays readable. Skipped for a NaN PM.
      if (showPmVectors && pmRa && pmDec) {
        const end = pmVectorEndpoint(x, y, pmRa[i]!, pmDec[i]!, PM_ARROW_PX_PER_MASYR);
        if (end && (Math.abs(end.x - x) > 0.5 || Math.abs(end.y - y) > 0.5)) {
          ctx.strokeStyle = 'rgba(255,255,255,0.92)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          // Small arrowhead at the tip.
          const ang = Math.atan2(end.y - y, end.x - x);
          const h = 4;
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - h * Math.cos(ang - 0.5), end.y - h * Math.sin(ang - 0.5));
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - h * Math.cos(ang + 0.5), end.y - h * Math.sin(ang + 0.5));
          ctx.stroke();
        }
      }

      if (i === selectedCatalogIndex) {
        // Filled coloured core + a bright yellow selection ring + crosshair.
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff3';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 12, y); ctx.lineTo(x - 5, y);
        ctx.moveTo(x + 5, y); ctx.lineTo(x + 12, y);
        ctx.stroke();
      } else {
        // Filled coloured disc (so a pixel sample at the marker reads its colour)
        // with a thin dark edge for contrast over bright imagery.
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Draw the gravitational-lens overlay (feature 130) as LABELLED markers on the
   * main canvas: a gold diamond per lens with its name beside it, the selected
   * lens highlighted with a ring + crosshair. This is a separate layer from
   * {@link renderCatalog} (which is cyan, unlabelled) so a lens overlay and a
   * Gaia overlay can be shown at the same time without either wiping the other.
   * Lenses off-canvas or on the far hemisphere (non-finite projection) are skipped.
   */
  function renderLensCatalog() {
    if (!ctx || !lensCatalog || lensCatalog.count === 0) return;
    const view = currentView();
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < lensCatalog.count; i++) {
      const [x, y] = skyToCanvas(view, lensCatalog.ra[i]!, lensCatalog.dec[i]!);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < -8 || y < -8 || x > canvasWidth + 8 || y > canvasHeight + 8) continue;

      const selected = i === selectedLensIndex;
      const r = selected ? 8 : 5;
      // Diamond marker (rotated square) so lenses read differently from the round
      // Gaia markers even for a colour-blind viewer.
      ctx.strokeStyle = selected ? '#fff27a' : 'rgba(255,190,60,0.9)';
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.stroke();
      if (selected) {
        ctx.beginPath();
        ctx.moveTo(x - r - 5, y); ctx.lineTo(x - r - 1, y);
        ctx.moveTo(x + r + 1, y); ctx.lineTo(x + r + 5, y);
        ctx.stroke();
      }

      // Name label, with a dark backing stroke so it stays legible over imagery.
      const label = lensCatalog.label[i] ?? '';
      const lx = x + r + 4;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, lx, y);
      ctx.fillStyle = selected ? '#fff6b0' : 'rgba(255,214,140,0.95)';
      ctx.fillText(label, lx, y);
      ctx.lineWidth = 1.4;
    }
    ctx.restore();
  }

  /**
   * Draw the Rubin DP1 `dp1.Object` cone-search overlay (feature 128) as SQUARE
   * magenta markers — a distinct shape from the round Gaia markers
   * ({@link renderCatalog}) and the gold lens diamonds ({@link renderLensCatalog}),
   * so the token-gated Rubin Object layer, the public Gaia layer, and the lens
   * layer can all be shown at once without any one being mistaken for another. The
   * selected object gets a bright yellow ring + crosshair. Objects off-canvas or on
   * the far hemisphere (non-finite projection) are skipped.
   */
  function renderRubinCatalog() {
    if (!ctx || !rubinCatalog || rubinCatalog.count === 0) return;
    const view = currentView();
    ctx.save();
    ctx.lineWidth = 1.2;
    for (let i = 0; i < rubinCatalog.count; i++) {
      const [x, y] = skyToCanvas(view, rubinCatalog.ra[i]!, rubinCatalog.dec[i]!);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < -8 || y < -8 || x > canvasWidth + 8 || y > canvasHeight + 8) continue;

      const selected = i === selectedRubinIndex;
      const s = selected ? 5 : 3.5; // half-side of the square marker
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 2.4;
      ctx.strokeRect(x - s, y - s, s * 2, s * 2);
      ctx.fillStyle = selected ? '#ffdcff' : 'rgba(230,90,230,0.9)';
      ctx.fillRect(x - s, y - s, s * 2, s * 2);

      if (selected) {
        ctx.strokeStyle = '#ff3';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, s + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - s - 8, y); ctx.lineTo(x - s - 2, y);
        ctx.moveTo(x + s + 2, y); ctx.lineTo(x + s + 8, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Shade the Rubin DP1 field footprints (see src/data/footprint.ts) on the main
   * canvas so it is obvious WHERE Rubin data exists — DP1 is only ~7 small fields,
   * and a view off every field legitimately shows public DSS or black. Each field
   * is a small great-circle disc: its boundary points are projected through the
   * same gnomonic skyToCanvas() the tiles use, so the outline tracks pan/zoom.
   * Fields on the far hemisphere (can't project) are skipped.
   */
  function renderCoverage() {
    if (!ctx || !showCoverage) return;
    const view = currentView();
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const circle of dp1CoverageCircles()) {
      // Skip fields more than 90° from the view centre — the tangent-plane
      // projection can't represent the far hemisphere and would draw garbage.
      if (angularSeparation(view.ra, view.dec, circle.ra, circle.dec) > 90) continue;

      const pts = coverageCirclePoints(circle, 72);
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        const [x, y] = skyToCanvas(view, p.ra, p.dec);
        if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,255,180,0.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,255,180,0.75)';
      ctx.stroke();

      const [cx, cy] = skyToCanvas(view, circle.ra, circle.dec);
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        ctx.fillStyle = 'rgba(190,255,215,0.92)';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(circle.name, cx, cy);
        ctx.textAlign = 'left';
      }
    }
    ctx.restore();
  }

  /**
   * Draw the distance ruler on its interactive overlay: a line pinned to the sky
   * (pan-translated) between two endpoints, grabbable handles, and a midpoint
   * label showing the GREAT-CIRCLE separation + position angle (via skyGeom — not
   * a flat pixel distance, which is wrong away from the equator).
   */
  function renderRuler() {
    if (!rulerCtx || !rulerCanvasEl) return;
    rulerCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    if (!rulerMode || !rulerP0 || !rulerP1) return;
    const view = currentView();
    const [x0, y0] = skyToCanvas(view, rulerP0.ra, rulerP0.dec);
    const [x1, y1] = skyToCanvas(view, rulerP1.ra, rulerP1.dec);
    if ([x0, y0, x1, y1].some((n) => Number.isNaN(n))) return;

    rulerCtx.save();
    rulerCtx.translate(panOffsetX, panOffsetY);
    rulerCtx.strokeStyle = 'rgba(255,210,120,0.95)';
    rulerCtx.lineWidth = 1.5;
    rulerCtx.setLineDash([6, 3]);
    rulerCtx.beginPath();
    rulerCtx.moveTo(x0, y0);
    rulerCtx.lineTo(x1, y1);
    rulerCtx.stroke();
    rulerCtx.setLineDash([]);
    for (const [x, y] of [[x0, y0], [x1, y1]] as const) {
      rulerCtx.beginPath();
      rulerCtx.arc(x, y, 5, 0, Math.PI * 2);
      rulerCtx.fillStyle = 'rgba(30,25,10,0.9)';
      rulerCtx.fill();
      rulerCtx.strokeStyle = '#fc6';
      rulerCtx.lineWidth = 2;
      rulerCtx.stroke();
    }
    rulerCtx.restore();

    // Midpoint label (screen-anchored so it stays legible), great-circle readout.
    const sep = angularSeparation(rulerP0.ra, rulerP0.dec, rulerP1.ra, rulerP1.dec);
    const pa = positionAngle(rulerP0.ra, rulerP0.dec, rulerP1.ra, rulerP1.dec);
    const text = `${formatSeparation(sep)} · PA ${pa.toFixed(0)}° (${cardinalDirection(pa)})`;
    const mx = (x0 + x1) / 2 + panOffsetX;
    const my = (y0 + y1) / 2 + panOffsetY;
    rulerCtx.font = '11px monospace';
    const tw = rulerCtx.measureText(text).width;
    rulerCtx.fillStyle = 'rgba(10,12,24,0.8)';
    rulerCtx.fillRect(mx + 8, my - 20, tw + 8, 16);
    rulerCtx.fillStyle = '#fd8';
    rulerCtx.fillText(text, mx + 12, my - 8);
  }

  // --- DS9 regions (feature 121) --------------------------------------------

  /** Approximate on-screen radius (px) of a degree-radius sky circle centred at
   *  (ra,dec): project the centre and a point `rDeg` away in Dec (clamped near the
   *  pole) and take the pixel distance. Exact for small regions; a slight
   *  approximation for large ones, which DS9 regions rarely are. */
  function skyRadiusToPixels(view: ViewParams, cRa: number, cDec: number, rDeg: number): number {
    const [cx, cy] = skyToCanvas(view, cRa, cDec);
    if (!Number.isFinite(cx)) return NaN;
    const edgeDec = cDec + rDeg <= 89.9 ? cDec + rDeg : cDec - rDeg;
    const [ex, ey] = skyToCanvas(view, cRa, edgeDec);
    if (!Number.isFinite(ex)) return NaN;
    return Math.hypot(ex - cx, ey - cy);
  }

  /** Draw one region's outline in the current (already pan-translated) context. */
  function drawRegionShape(
    context: CanvasRenderingContext2D,
    view: ViewParams,
    region: Ds9Region,
    pxPerDeg: number
  ) {
    if (region.shape === 'circle') {
      const [cx, cy] = skyToCanvas(view, region.x, region.y);
      if (!Number.isFinite(cx)) return;
      const rPx = skyRadiusToPixels(view, region.x, region.y, region.r);
      if (!Number.isFinite(rPx) || rPx <= 0) return;
      context.beginPath();
      context.arc(cx, cy, rPx, 0, Math.PI * 2);
      context.stroke();
    } else if (region.shape === 'ellipse' || region.shape === 'box') {
      const [cx, cy] = skyToCanvas(view, region.x, region.y);
      if (!Number.isFinite(cx)) return;
      const angle = (-region.angle * Math.PI) / 180; // screen +y is down → negate
      context.save();
      context.translate(cx, cy);
      context.rotate(angle);
      context.beginPath();
      if (region.shape === 'ellipse') {
        context.ellipse(0, 0, region.a * pxPerDeg, region.b * pxPerDeg, 0, 0, Math.PI * 2);
      } else {
        const w = region.w * pxPerDeg;
        const h = region.h * pxPerDeg;
        context.rect(-w / 2, -h / 2, w, h);
      }
      context.stroke();
      context.restore();
    } else if (region.shape === 'polygon') {
      context.beginPath();
      let started = false;
      for (const p of region.points) {
        const [x, y] = skyToCanvas(view, p.x, p.y);
        if (!Number.isFinite(x)) { started = false; continue; } // off-hemisphere vertex
        if (!started) { context.moveTo(x, y); started = true; } else { context.lineTo(x, y); }
      }
      context.closePath();
      context.stroke();
    }
  }

  /**
   * Draw the DS9 region layer on the region overlay canvas: the COMMITTED regions
   * (always, when `showRegions` — the overlay is visible even with the tool off,
   * like the alert canvas) plus the in-progress DRAFT (only in region mode). The
   * overlay canvas holds only vector strokes (never cross-origin tiles), so it is
   * not CORS-tainted and its geometry is reprojected via skyToCanvas every frame,
   * tracking pan/zoom instead of being screen-pinned. `exportPng` composites this
   * canvas too, so regions appear in a saved screenshot. Regions on the far
   * hemisphere (non-finite projection) are skipped.
   */
  function renderRegionOverlay() {
    if (!regionCtx || !regionCanvasEl) return;
    regionCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    const view = currentView();
    const pxPerDeg = canvasWidth / Math.max(1e-6, fov);
    regionCtx.save();
    regionCtx.translate(panOffsetX, panOffsetY);

    // Committed regions (solid) — visible whether or not the tool is active.
    if (showRegions && regions && regions.length > 0) {
      regionCtx.setLineDash([]);
      regionCtx.strokeStyle = 'rgba(120,255,120,0.95)';
      regionCtx.lineWidth = 1.5;
      for (const region of regions) {
        if (region.frame !== 'icrs') continue; // image-frame regions need WCS we lack
        drawRegionShape(regionCtx, view, region, pxPerDeg);
      }
    }

    if (!regionMode) { regionCtx.restore(); return; }
    regionCtx.strokeStyle = 'rgba(120,255,160,0.95)';
    regionCtx.setLineDash([5, 3]);
    regionCtx.lineWidth = 1.5;

    if (regionCircleCenter && regionCircleEdge) {
      const [cx, cy] = skyToCanvas(view, regionCircleCenter.ra, regionCircleCenter.dec);
      const rDeg = angularSeparation(
        regionCircleCenter.ra, regionCircleCenter.dec,
        regionCircleEdge.ra, regionCircleEdge.dec
      );
      const rPx = skyRadiusToPixels(view, regionCircleCenter.ra, regionCircleCenter.dec, rDeg);
      if (Number.isFinite(cx) && Number.isFinite(rPx) && rPx > 0) {
        regionCtx.beginPath();
        regionCtx.arc(cx, cy, rPx, 0, Math.PI * 2);
        regionCtx.stroke();
      }
    }

    if (regionPolyVerts.length > 0) {
      regionCtx.beginPath();
      let started = false;
      const chain = regionPolyCursor ? [...regionPolyVerts, regionPolyCursor] : regionPolyVerts;
      for (const v of chain) {
        const [x, y] = skyToCanvas(view, v.ra, v.dec);
        if (!Number.isFinite(x)) { started = false; continue; }
        if (!started) { regionCtx.moveTo(x, y); started = true; } else { regionCtx.lineTo(x, y); }
      }
      regionCtx.stroke();
      // Vertex handles (solid), first vertex highlighted (click it to close).
      regionCtx.setLineDash([]);
      for (let i = 0; i < regionPolyVerts.length; i++) {
        const [x, y] = skyToCanvas(view, regionPolyVerts[i]!.ra, regionPolyVerts[i]!.dec);
        if (!Number.isFinite(x)) continue;
        regionCtx.beginPath();
        regionCtx.arc(x, y, i === 0 ? 6 : 4, 0, Math.PI * 2);
        regionCtx.fillStyle = i === 0 ? 'rgba(255,240,120,0.9)' : 'rgba(30,60,30,0.9)';
        regionCtx.fill();
        regionCtx.strokeStyle = 'rgba(120,255,160,0.95)';
        regionCtx.lineWidth = 2;
        regionCtx.stroke();
      }
    }
    regionCtx.restore();
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
    const lines = graticuleLines(view, { system: gridSystem });
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
      ctx.fillText(formatGridLabel(line.kind, line.value, gridSystem), p.x + 3, p.y - 3);
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

  // Repaint when the graticule (or its coordinate system), coverage overlay, or
  // ruler is toggled/changed.
  $effect(() => {
    void showGraticule;
    void gridSystem;
    void showCoverage;
    void rulerMode;
    void catalog;
    void selectedCatalogIndex;
    void showPmVectors;
    void lensCatalog;
    void selectedLensIndex;
    void rubinCatalog;
    void selectedRubinIndex;
    void regions;
    void showRegions;
    void regionMode;
    void regionShape;
    scheduleRender();
  });

  // Clear any in-progress draft when the tool is switched off or the shape
  // changes, so a half-drawn polygon can't leak into the other mode.
  let lastRegionMode = regionMode;
  let lastRegionShape = regionShape;
  $effect(() => {
    if (regionMode !== lastRegionMode || regionShape !== lastRegionShape) {
      lastRegionMode = regionMode;
      lastRegionShape = regionShape;
      cancelRegionDraft();
    }
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

    const key = postProcessMemoKey({
      ra, dec, fov, zoomLevel,
      width: canvasWidth, height: canvasHeight,
      scaling, colorMap, invert, blackPoint, whitePoint, contrast, bias,
      layerSignature, overlaysSignature: overlaysSignature(), contentVersion,
    });
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

    const isLoaded = (key: string): boolean => tileReady(tileCache.get(key));

    // Pass 0 — HiPS Allsky backdrop (coarse full-sky preview) UNDER everything.
    // For each visible tile, draw the order-3 backdrop tile that covers it (its
    // order-3 ancestor when target order ≥ 3; at wider zoom, every present backdrop
    // tile that projects on-screen — drawTile culls the rest). The sharp passes
    // below overwrite it wherever real tiles have loaded, so this only shows through
    // gaps / not-yet-loaded regions — no black flash when jumping to a new area.
    if (allskyBackdrop.size > 0) {
      const backdropPix = new Set<number>();
      if (order >= ALLSKY_TILE_ORDER) {
        for (const t of visibleTiles) {
          backdropPix.add(Math.floor(t.pixelIndex / Math.pow(4, t.order - ALLSKY_TILE_ORDER)));
        }
      } else {
        for (const p of allskyBackdrop.keys()) backdropPix.add(p);
      }
      for (const bpix of backdropPix) {
        const bimg = allskyBackdrop.get(bpix);
        if (tileReady(bimg)) {
          drawTile(context, bimg, { order: ALLSKY_TILE_ORDER, pixelIndex: bpix }, view);
        }
      }
    }

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

    // Pass 1.5 — residual FINER cached tiles. A SPARSE survey (Rubin DP1 has tiles
    // only in a few fields and no low-order/all-sky tiles) 404s the target tiles
    // when you zoom OUT below its available orders, and Pass 1 finds no ancestor
    // either — so a field you had zoomed into would vanish (black on explicit
    // Rubin). Here we draw any cached tile FINER than the target order whose
    // target-order ancestor is a visible-but-unloaded tile, keeping that field
    // embedded when you zoom back out. Skipped for offline (tiles synthesize on
    // demand, never 404) and inert for dense surveys like DSS (their target tiles
    // load, so the ancestor-is-loaded guard skips this pass).
    const drawnFiner = new Set<string>();
    if (!offlineActive) {
      const visiblePix = new Set(visibleTiles.map((t) => t.pixelIndex));
      const finer: { order: number; pix: number }[] = [];
      for (const key of tileCache.keys()) {
        const m = /^(\d+)-(\d+)$/.exec(key); // base tiles only (skip overlay/offline keys)
        if (!m) continue;
        const o = Number(m[1]);
        if (o <= order) continue; // only tiles finer than the current target order
        const pix = Number(m[2]);
        // Integer divide (not >>, which overflows 32-bit at high orders) to the
        // target-order ancestor pixel.
        const ancestorPix = Math.floor(pix / Math.pow(4, o - order));
        if (!visiblePix.has(ancestorPix)) continue; // not under the current view
        if (isLoaded(tileKey(order, ancestorPix))) continue; // the sharp tile will cover it
        if (!isLoaded(key)) continue;
        finer.push({ order: o, pix });
      }
      // Coarser first so finer tiles paint on top.
      finer.sort((a, b) => a.order - b.order);
      for (const t of finer) {
        const k = tileKey(t.order, t.pix);
        touchLru(tileCache, k);
        drawnFiner.add(k);
        drawTile(context, tileCache.get(k)!, { order: t.order, pixelIndex: t.pix }, view);
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
    for (const f of drawnFiner) drawn.add(f); // keep residual finer tiles (zoom-out)
    for (const p of pinnedTiles) drawn.add(p); // never evict the allsky backdrop
    // Free the decoder memory of any evicted ImageBitmap (close() it). Protected
    // by `drawn`, so this never closes a tile visible in this frame.
    evictLru(tileCache, MAX_TILE_CACHE, drawn, (_k, v) => closeTile(v));
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
    img: DecodedTile,
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

    const w = tileWidth(img, TILE_SIZE);
    const h = tileHeight(img, TILE_SIZE);

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
    img: DecodedTile,
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

  // Cap concurrent authenticated tile fetches. The <img> path is throttled by the
  // browser (~6 per host), but the authenticated Rubin fetch() path is NOT — so a
  // high-order view (hundreds–thousands of tiles) fired all at once, plus every
  // superseded pan/zoom view piling on with no cancellation, exhausts the browser
  // (net::ERR_INSUFFICIENT_RESOURCES) and starves the tiles that would succeed.
  // This bounds in-flight fetches and lets loadTiles drop superseded queued work.
  const MAX_CONCURRENT_FETCHES = 6;
  let activeFetches = 0;
  let fetchQueue: Array<() => void> = [];
  function runQueuedFetch(task: () => Promise<void>): void {
    const start = () => {
      activeFetches++;
      void task().finally(() => {
        activeFetches--;
        const next = fetchQueue.shift();
        if (next) next();
      });
    };
    if (activeFetches < MAX_CONCURRENT_FETCHES) start();
    else fetchQueue.push(start);
  }

  function loadTiles() {
    if (!canvasEl) return;
    const order = zoomToOrder(zoomLevel);
    const fmt = resolveFormat();
    const visibleTiles = getVisibleTiles(ra, dec, fov, order);

    // Load CENTRE-OUT: fetch the tiles nearest the view centre first so a field
    // fills from the middle (and looks centred immediately) instead of the
    // enumeration order (~top-left first), which on a sparse, slow-streaming Rubin
    // field looked off-centre / empty while loading. getTileCenter is memoised.
    visibleTiles.sort((a, b) => {
      const ca = getTileCenter(a.pixelIndex, a.order);
      const cb = getTileCenter(b.pixelIndex, b.order);
      return angularSeparation(ra, dec, ca.ra, ca.dec) - angularSeparation(ra, dec, cb.ra, cb.dec);
    });

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

    // CANCELLATION: this batch is the new set of needed tiles. Abort any in-flight
    // load whose tile is no longer visible so a stale decode can't paint over the
    // new view and the browser isn't starved by superseded work. A cancelled tile
    // is removed from the in-flight set → it re-fetches if it reappears (no gap).
    const visibleKeys = new Set(visibleTiles.map((t) => tileKey(t.order, t.pixelIndex)));
    const cancelledKeys = tileScheduler.supersede(visibleKeys);
    for (let i = 0; i < cancelledKeys.length; i++) perf.recordFetchCancel();
    if (cancelledKeys.length > 0) reportPerf();

    for (const tile of visibleTiles) {
      const cacheKey = tileKey(tile.order, tile.pixelIndex);
      // Already decoded → a cache hit (no network). Counted for the HUD hit-rate.
      if (tileCache.has(cacheKey)) {
        perf.recordCacheHit();
        continue;
      }
      // In-flight DEDUP: a load for this tile is already running — attach to it
      // (it will populate the cache + repaint on resolve) instead of a 2nd request.
      if (tileScheduler.isInFlight(cacheKey)) continue;

      loadAttempts++;
      const url = buildUrl(tile.order, tile.pixelIndex, fmt, batchBaseUrl);

      tileScheduler.request(cacheKey, (): TileLoadHandle => {
        const startToken = perf.recordFetchStart();
        let aborted = false;
        // Set only when we (also) create an <img> — the off-thread ImageBitmap path
        // needs no element and no handler detaching, only the `aborted` flag + the
        // AbortController below.
        let imgEl: HTMLImageElement | null = null;
        let controller: AbortController | null = null;

        // A tile finished decoding (off-thread ImageBitmap OR the <img> fallback).
        // If it was superseded while decoding, DROP it — never cache/draw a stale
        // decode — and free the orphan bitmap so it can't leak.
        const onDecoded = (decoded: DecodedTile): void => {
          if (aborted) { closeTile(decoded); return; }
          if (imgEl) pendingLoads.delete(imgEl);
          loadSuccesses++;
          if (isBitmap(decoded)) decodeCounts.bitmap++; else decodeCounts.img++;
          tileCache.set(cacheKey, decoded);
          contentVersion++;
          perf.recordFetchEnd(startToken);
          tileScheduler.settle(cacheKey);
          clearError();
          scheduleRender();
          reportPerf();
        };

        // A real (non-abort) load/decode failure. `status` is the HTTP status when
        // known (fetch path) or null (<img> path / no status).
        const onLoadError = (status: number | null): void => {
          if (aborted) return;
          if (imgEl) pendingLoads.delete(imgEl);
          perf.recordError();
          tileScheduler.settle(cacheKey);
          recordFailure(url, status);
          reportPerf();
        };

        // Detach handlers + drop the src (and abort any fetch) so a cancelled load
        // can neither paint nor fire a spurious onerror (which would be miscounted
        // as a failure and could wrongly trip the auto-fallback). supersede() calls
        // this; it counts the cancel itself, so we touch no perf metrics here.
        const abort = (): void => {
          aborted = true;
          if (controller) controller.abort();
          if (imgEl) {
            imgEl.onload = null;
            imgEl.onerror = null;
            imgEl.src = '';
            pendingLoads.delete(imgEl);
          }
        };

        // Legacy / fallback MAIN-THREAD decode via an <img> (createImageBitmap
        // unavailable, a decode throw, or a CORS-opaque fetch). `crossOrigin` keeps
        // the resulting canvas readable (untainted) so getImageData still works.
        const loadViaImg = (src: string): void => {
          if (aborted) return;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          imgEl = img;
          pendingLoads.add(img);
          img.onload = () => onDecoded(img);
          img.onerror = () => onLoadError(null);
          img.src = src;
        };

        // Decode an already-fetched (CORS, hence readable → untainted) blob OFF the
        // main thread. On a createImageBitmap throw, fall back to an <img> over an
        // object URL of the SAME blob so nothing regresses.
        const decodeBlob = (blob: Blob): Promise<void> => {
          if (aborted) return Promise.resolve();
          if (canBitmap) {
            return createImageBitmap(blob).then(
              (bmp) => onDecoded(bmp),
              () => loadViaImg(URL.createObjectURL(blob))
            );
          }
          loadViaImg(URL.createObjectURL(blob));
          return Promise.resolve();
        };

        if (offline) {
          // Synthesize the tile locally from the bundled synthetic sky — no network.
          // Decode the raw RGBA straight to an ImageBitmap (off-thread), skipping the
          // costly main-thread toDataURL PNG encode + <img> re-decode entirely.
          try {
            const rgba = offlineTileRGBA(tile.order, tile.pixelIndex, offlineBand, offlineMjd);
            const imageData = new ImageData(rgba, OFFLINE_TILE_SIZE, OFFLINE_TILE_SIZE);
            const offlineViaImg = (): void => {
              const oc = document.createElement('canvas');
              oc.width = OFFLINE_TILE_SIZE;
              oc.height = OFFLINE_TILE_SIZE;
              const octx = oc.getContext('2d');
              if (octx) { octx.putImageData(imageData, 0, 0); loadViaImg(oc.toDataURL()); }
              else onLoadError(null);
            };
            if (canBitmap) {
              createImageBitmap(imageData).then((bmp) => onDecoded(bmp), offlineViaImg);
            } else {
              offlineViaImg();
            }
          } catch {
            onLoadError(null);
          }
        } else if (useAuth) {
          // Authenticated Rubin tiles. toRequestUrl → same-origin dev proxy so the
          // credentialed cross-origin request isn't CORS-blocked; recordFailure keeps
          // the ORIGINAL url so the error reports the real RSP host, not the proxy.
          // Throttled via the fetch queue so a high-order view doesn't fire thousands
          // of concurrent requests and exhaust the browser (ERR_INSUFFICIENT_RESOURCES).
          // AbortController lets supersede() cancel a superseded fetch.
          controller = new AbortController();
          runQueuedFetch(() => {
            // If this tile was superseded while queued (still-in-flight but not yet
            // started), drain the queue slot as a no-op — never open a request, and
            // never strand the tile: supersede() already settled + counted the
            // cancel, and a still-VISIBLE queued tile is left un-aborted so it runs.
            if (aborted) return Promise.resolve();
            return fetch(toRequestUrl(url), { headers: auth, signal: controller!.signal })
              .then(resp => {
                if (!resp.ok) {
                  const e = new Error(`HTTP ${resp.status}`) as Error & { status?: number };
                  e.status = resp.status;
                  throw e;
                }
                return resp.blob();
              })
              // Free the network-concurrency slot as soon as the BYTES arrive; the
              // off-thread createImageBitmap decode then runs OFF the fetch queue.
              // Holding a slot through decode would serialise decoding into the
              // 6-wide network cap and slow the whole batch's drain (and make a
              // superseded/offline switch race with still-draining fetches). Decode
              // errors are handled inside decodeBlob (bitmap-throw → <img> fallback).
              .then((blob) => { void decodeBlob(blob); })
              .catch((e: Error & { status?: number }) => {
                // An abort is NOT a tile failure — it must never count as an error
                // or trip the auto-fallback. Metrics for the cancel were recorded
                // by supersede(); just stop here.
                if (aborted || e?.name === 'AbortError') return;
                onLoadError(e?.status ?? null);
              });
          });
        } else if (canBitmap) {
          // Public (e.g. CDS/DSS) tiles: fetch (CORS) → blob → off-thread
          // createImageBitmap. The public HiPS hosts send Access-Control-Allow-Origin
          // (the same reason the <img crossOrigin> path yields a readable canvas), so
          // the CORS fetch succeeds and the blob is readable → the canvas is NOT
          // tainted. On a CORS-opaque / network failure the fetch rejects (no HTTP
          // status) and we fall back to the <img crossOrigin> path so nothing
          // regresses.
          //
          // NOT routed through runQueuedFetch (unlike the single-origin auth proxy
          // path): the fetch is issued IMMEDIATELY, exactly as the old `img.src`
          // did, so the browser's own per-host connection cap (~6) throttles it —
          // deferring the fetch() call behind an app queue would initiate requests
          // LATER than the <img> path and change batch/drain timing.
          controller = new AbortController();
          fetch(toRequestUrl(url), { signal: controller.signal })
            .then(resp => {
              if (!resp.ok) {
                const e = new Error(`HTTP ${resp.status}`) as Error & { status?: number };
                e.status = resp.status;
                throw e;
              }
              return resp.blob();
            })
            // Off-thread createImageBitmap decode (errors handled inside decodeBlob:
            // bitmap-throw → <img> fallback → onLoadError).
            .then((blob) => { void decodeBlob(blob); })
            .catch((e: Error & { status?: number }) => {
              if (aborted || e?.name === 'AbortError') return;
              // No HTTP status ⇒ a network/CORS error, not a real 4xx/5xx: retry
              // once via the browser's own <img crossOrigin> loader before counting
              // a failure (some hosts serve <img> but reject a raw CORS fetch).
              if (e?.status == null) { loadViaImg(toRequestUrl(url)); return; }
              onLoadError(e.status);
            });
        } else {
          // No createImageBitmap (jsdom / old browsers): the original main-thread
          // <img> decode. Also the path taken in unit tests (so no real fetch fires).
          loadViaImg(toRequestUrl(url));
        }

        return { abort, cancellable: true };
      });
    }

    reportPerf();

    // Also load overlay tiles for current view
    if (overlays.size > 0) {
      loadOverlayTiles();
    }
  }

  /**
   * Prefetch the coarse full-sky backdrop once per base (and per offline band/mjd),
   * so the ancestor/backdrop preview always has an image — no black flash when
   * jumping to an unvisited region. PRIMARY path: fetch the survey's SINGLE HiPS
   * `Norder3/Allsky.<ext>` preview (one request + one quota unit) and slice it into
   * its 768 order-3 tiles. FALLBACK (Allsky 404 / taint / too small): the previous
   * behaviour — enumerate the 48 order-1 tiles. Either way, a failure NEVER trips
   * the auto-fallback (it's just a backdrop).
   */
  function prefetchAllsky() {
    const baseUrl = resolvedBaseUrl;
    if (!baseUrl) return;
    // Offline tiles synthesize locally with no network, so there is no black flash
    // to hide; a full-sky backdrop for offline is pure cost with no benefit.
    if (isOfflineUrl(baseUrl)) { allskySig = ''; pinnedTiles.clear(); allskyBackdrop.clear(); return; }
    const sig = `${baseUrl}|${layerSignature}`;
    if (sig === allskySig) return;
    allskySig = sig;
    pinnedTiles.clear();      // previous base's order-1 fallback pins
    allskyBackdrop.clear();   // previous base's sliced Allsky tiles

    const isRub = isRubinUrl(baseUrl);
    const useA = !!rspToken && isRub;
    const auth = useA ? getAuthHeader() : {};
    const fmt = resolveFormat();
    const cleanBase = baseUrl.replace(/\/properties$/, '').replace(/\/$/, '');
    const allskyUrl = `${cleanBase}/Norder${ALLSKY_TILE_ORDER}/Allsky.${fmt}`;

    const onFail = () => { if (sig === allskySig) prefetchAllskyLowOrder(baseUrl, sig, useA, auth, fmt); };
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (sig === allskySig) sliceAllsky(img, sig, onFail); };
    img.onerror = onFail;

    if (useA) {
      runQueuedFetch(() =>
        fetch(toRequestUrl(allskyUrl), { headers: auth })
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('allsky'))))
          .then((b) => { img.src = URL.createObjectURL(b); })
          .catch(onFail)
      );
    } else {
      img.src = toRequestUrl(allskyUrl);
    }
  }

  /**
   * Slice a loaded HiPS Allsky preview into its 768 order-3 tiles → allskyBackdrop.
   * Chunked across timers so 768 encodes don't block the main thread; guarded by
   * `sig` so a base change mid-slice aborts. Empty (transparent/black) tiles — the
   * norm for a sparse survey like DP1 — are skipped to save memory. On taint or a
   * degenerate (too-small) image, falls back to the order-1 enumeration.
   */
  function sliceAllsky(allskyImg: HTMLImageElement, sig: string, onFail: () => void) {
    const w = allskyImg.naturalWidth;
    const tw = Math.floor(w / ALLSKY_TILES_PER_ROW);
    if (tw <= 0) { onFail(); return; } // image too small to be a real Allsky mosaic
    const npix = nside2npix(order2nside(ALLSKY_TILE_ORDER)); // 768
    const scratch = document.createElement('canvas');
    scratch.width = tw;
    scratch.height = tw;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!sctx) { onFail(); return; }

    const CHUNK = 96;
    let pix = 0;
    const sliceChunk = () => {
      if (sig !== allskySig) return; // base changed → abort remaining slices
      const end = Math.min(pix + CHUNK, npix);
      for (; pix < end; pix++) {
        const col = pix % ALLSKY_TILES_PER_ROW;
        const row = Math.floor(pix / ALLSKY_TILES_PER_ROW);
        sctx.clearRect(0, 0, tw, tw);
        sctx.drawImage(allskyImg, col * tw, row * tw, tw, tw, 0, 0, tw, tw);
        let hasContent = false;
        try {
          const d = sctx.getImageData(0, 0, tw, tw).data;
          for (let i = 0; i < d.length; i += 16) {
            if (d[i + 3]! > 10 && d[i]! + d[i + 1]! + d[i + 2]! > 6) { hasContent = true; break; }
          }
          if (!hasContent) continue; // empty backdrop tile — don't cache it
          const dataUrl = scratch.toDataURL();
          const timg = new Image();
          const p = pix;
          timg.onload = () => {
            if (sig !== allskySig) return;
            allskyBackdrop.set(p, timg);
            contentVersion++;
            scheduleRender();
          };
          timg.src = dataUrl;
        } catch {
          // Cross-origin taint (no CORS) → readback/encode blocked. Fall back to
          // the order-1 enumeration, which draws fine without any pixel readback.
          onFail();
          return;
        }
      }
      if (pix < npix) setTimeout(sliceChunk, 0);
    };
    sliceChunk();
  }

  /**
   * FALLBACK backdrop: enumerate the 48 order-1 tiles into the tile cache, pinned
   * against LRU eviction. Used only when the single Allsky preview is unavailable.
   * A missing tile is skipped silently — it must NEVER trip the auto-fallback.
   */
  function prefetchAllskyLowOrder(
    baseUrl: string,
    sig: string,
    useA: boolean,
    auth: Record<string, string>,
    fmt: string
  ) {
    if (sig !== allskySig) return;
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
        runQueuedFetch(() =>
          fetch(toRequestUrl(buildUrl(ALLSKY_ORDER, pix, fmt, baseUrl)), { headers: auth })
            .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('allsky'))))
            .then((b) => { img.src = URL.createObjectURL(b); })
            .catch(() => { /* skip */ })
        );
      } else {
        img.src = toRequestUrl(buildUrl(ALLSKY_ORDER, pix, fmt, baseUrl));
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
    magnifierVisible = false;
    onAlertHover?.(null);
  }

  // --- Magnifier loupe ---
  let magnifierCanvasEl: HTMLCanvasElement | undefined = $state();
  let magnifierCtx: CanvasRenderingContext2D | null = null;
  let magnifierVisible = $state(false);
  const MAGNIFIER_SIZE = 132; // loupe canvas px (square)
  const MAGNIFIER_ZOOM = 5; // magnification factor

  // Grab the loupe 2D context once its canvas mounts (only when showMagnifier).
  $effect(() => {
    if (magnifierCanvasEl && !magnifierCtx) {
      magnifierCtx = magnifierCanvasEl.getContext('2d');
    }
  });

  /**
   * Paint the magnifier loupe: copy a small region of the MAIN canvas centred on
   * the cursor, upscaled (nearest-neighbour) into the loupe, with a crosshair.
   * drawImage of a cross-origin-tainted canvas still DISPLAYS (only readback
   * throws), so the loupe works even when a survey taints the tile canvas.
   */
  function updateMagnifier(px: number, py: number) {
    if (!magnifierCtx || !canvasEl) return;
    const src = MAGNIFIER_SIZE / MAGNIFIER_ZOOM;
    magnifierCtx.imageSmoothingEnabled = false;
    magnifierCtx.fillStyle = '#000';
    magnifierCtx.fillRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
    try {
      magnifierCtx.drawImage(
        canvasEl, px - src / 2, py - src / 2, src, src, 0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE
      );
    } catch {
      /* tainted-canvas readback can't happen here (drawImage only), but guard anyway */
    }
    const c = MAGNIFIER_SIZE / 2;
    magnifierCtx.strokeStyle = 'rgba(255,90,90,0.9)';
    magnifierCtx.lineWidth = 1;
    magnifierCtx.beginPath();
    magnifierCtx.moveTo(c, c - 8); magnifierCtx.lineTo(c, c + 8);
    magnifierCtx.moveTo(c - 8, c); magnifierCtx.lineTo(c + 8, c);
    magnifierCtx.stroke();
  }

  function onPointerMove(e: PointerEvent) {
    updateCursorReadout(e);

    if (showMagnifier && magnifierCtx) {
      const rect = canvasEl.getBoundingClientRect();
      updateMagnifier(e.clientX - rect.left, e.clientY - rect.top);
      magnifierVisible = true;
    }

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

  /** Which ruler endpoint (0/1) is within grab range of a screen point, else null. */
  function rulerHandleAt(px: number, py: number): 0 | 1 | null {
    if (!rulerP0 || !rulerP1) return null;
    const view = currentView();
    const ends = [rulerP0, rulerP1] as const;
    for (let i = 0; i < 2; i++) {
      const [x, y] = skyToCanvas(view, ends[i]!.ra, ends[i]!.dec);
      if (Math.hypot(px - (x + panOffsetX), py - (y + panOffsetY)) <= 10) return i as 0 | 1;
    }
    return null;
  }

  function onRulerPointerDown(e: PointerEvent) {
    if (!rulerMode || !rulerCanvasEl || e.button !== 0) return;
    e.stopPropagation();
    const rect = rulerCanvasEl.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const handle = rulerHandleAt(px, py);
    if (handle === null) {
      const [r, d] = canvasToSky(currentView(), px, py);
      if (!Number.isFinite(r) || !Number.isFinite(d)) return;
      rulerP0 = { ra: r, dec: d };
      rulerP1 = { ra: r, dec: d };
      rulerDragHandle = 1;
    } else {
      rulerDragHandle = handle;
    }
    rulerCanvasEl.setPointerCapture(e.pointerId);
    scheduleRender();
  }

  function onRulerPointerMove(e: PointerEvent) {
    if (rulerDragHandle === null || !rulerCanvasEl) return;
    const rect = rulerCanvasEl.getBoundingClientRect();
    const [r, d] = canvasToSky(currentView(), e.clientX - rect.left, e.clientY - rect.top);
    if (!Number.isFinite(r) || !Number.isFinite(d)) return;
    if (rulerDragHandle === 0) rulerP0 = { ra: r, dec: d };
    else rulerP1 = { ra: r, dec: d };
    scheduleRender();
  }

  function onRulerPointerUp(e: PointerEvent) {
    if (rulerDragHandle === null) return;
    rulerDragHandle = null;
    rulerCanvasEl?.releasePointerCapture?.(e.pointerId);
  }

  // --- DS9 region drawing pointer handlers (own the drag; never pan) ---------

  const REGION_CLOSE_PX = 12; // click within this of vertex 0 closes the polygon
  const REGION_MIN_RADIUS_DEG = 1e-6; // reject a degenerate zero-radius circle

  /** Screen point under a region-overlay pointer event, and its sky coords. */
  function regionEventSky(e: PointerEvent): { px: number; py: number; ra: number; dec: number } | null {
    if (!regionCanvasEl) return null;
    const rect = regionCanvasEl.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const [ra, dec] = canvasToSky(currentView(), px, py);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
    return { px, py, ra, dec };
  }

  function commitRegion(region: Ds9Region) {
    onRegionsChange?.([...(regions ?? []), region]);
  }

  function onRegionPointerDown(e: PointerEvent) {
    if (!regionMode || !regionCanvasEl || e.button !== 0) return;
    e.stopPropagation();
    const hit = regionEventSky(e);
    if (!hit) return;

    if (regionShape === 'circle') {
      // Drag from centre outward; radius = great-circle sep at pointer-up.
      regionCircleCenter = { ra: hit.ra, dec: hit.dec };
      regionCircleEdge = { ra: hit.ra, dec: hit.dec };
      regionDrawingCircle = true;
      regionCanvasEl.setPointerCapture(e.pointerId);
    } else {
      // Polygon: each click adds a vertex; clicking near the first closes it.
      if (regionPolyVerts.length >= 3) {
        const view = currentView();
        const [fx, fy] = skyToCanvas(view, regionPolyVerts[0]!.ra, regionPolyVerts[0]!.dec);
        if (
          Number.isFinite(fx) &&
          Math.hypot(hit.px - (fx + panOffsetX), hit.py - (fy + panOffsetY)) <= REGION_CLOSE_PX
        ) {
          commitRegion({
            shape: 'polygon',
            frame: 'icrs',
            points: regionPolyVerts.map((v) => ({ x: v.ra, y: v.dec })),
          });
          regionPolyVerts = [];
          regionPolyCursor = null;
          scheduleRender();
          return;
        }
      }
      regionPolyVerts = [...regionPolyVerts, { ra: hit.ra, dec: hit.dec }];
      regionPolyCursor = { ra: hit.ra, dec: hit.dec };
    }
    scheduleRender();
  }

  function onRegionPointerMove(e: PointerEvent) {
    if (!regionMode) return;
    const hit = regionEventSky(e);
    if (!hit) return;
    if (regionDrawingCircle) {
      regionCircleEdge = { ra: hit.ra, dec: hit.dec };
      scheduleRender();
    } else if (regionShape === 'polygon' && regionPolyVerts.length > 0) {
      regionPolyCursor = { ra: hit.ra, dec: hit.dec };
      scheduleRender();
    }
  }

  function onRegionPointerUp(e: PointerEvent) {
    if (!regionDrawingCircle) return;
    regionDrawingCircle = false;
    regionCanvasEl?.releasePointerCapture?.(e.pointerId);
    if (regionCircleCenter && regionCircleEdge) {
      const r = angularSeparation(
        regionCircleCenter.ra, regionCircleCenter.dec,
        regionCircleEdge.ra, regionCircleEdge.dec
      );
      if (r >= REGION_MIN_RADIUS_DEG) {
        commitRegion({ shape: 'circle', frame: 'icrs', x: regionCircleCenter.ra, y: regionCircleCenter.dec, r });
      }
    }
    regionCircleCenter = null;
    regionCircleEdge = null;
    scheduleRender();
  }

  /** Cancel an in-progress polygon (Escape) so a stray click chain can be undone. */
  function cancelRegionDraft() {
    regionPolyVerts = [];
    regionPolyCursor = null;
    regionCircleCenter = null;
    regionCircleEdge = null;
    regionDrawingCircle = false;
    scheduleRender();
  }

  // Report the current ruler measurement (great-circle separation + PA) to the parent.
  $effect(() => {
    if (!rulerMode || !rulerP0 || !rulerP1) {
      onRulerChange?.(null);
      return;
    }
    const sep = angularSeparation(rulerP0.ra, rulerP0.dec, rulerP1.ra, rulerP1.dec);
    const pa = positionAngle(rulerP0.ra, rulerP0.dec, rulerP1.ra, rulerP1.dec);
    onRulerChange?.({
      separationDeg: sep,
      paDeg: pa,
      text: `${formatSeparation(sep)} · PA ${pa.toFixed(0)}° (${cardinalDirection(pa)})`,
    });
  });

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

  /** Right-click: report the sky RA/Dec under the cursor (for a "what's here?"
   *  SIMBAD lookup). Only intercept the browser context menu when a handler is
   *  wired, so the default menu still works otherwise. */
  function onContextMenu(e: MouseEvent) {
    if (!onSkyContext) return;
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const [r, d] = canvasToSky(currentView(), e.clientX - rect.left, e.clientY - rect.top);
    onSkyContext(r, d);
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
      case 'Escape':
        // Cancel an in-progress region draft (half-drawn polygon / circle).
        if (regionMode && (regionPolyVerts.length > 0 || regionDrawingCircle)) {
          e.preventDefault();
          cancelRegionDraft();
        }
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
    // Abort in-flight loads so a stale (old-base) tile can't resolve into the
    // freshly cleared cache under the same key. reset() clears the (now-aborted)
    // in-flight count and starts per-survey perf counters fresh.
    tileScheduler.clear();
    perf.reset();
    for (const key of tileCache.keys()) {
      if (!key.startsWith('overlay-')) { closeTile(tileCache.get(key)); tileCache.delete(key); }
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

  /**
   * Export the current view as a PNG download, compositing every stacked canvas
   * in the container in z-order (base+overlays+graticule on the main canvas, then
   * the alert / cross-section / ruler overlay canvases on top). Same-origin tiles
   * (dev proxy / public CDS with CORS / offline) keep the canvas untainted so
   * toBlob succeeds; a taint (cross-origin tile without CORS) is surfaced as a
   * visible error rather than a silent failure.
   */
  export function exportPng(filename = 'rubin-view.png') {
    if (!canvasEl) return;
    const w = canvasEl.width;
    const h = canvasEl.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    if (!octx) return;
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, w, h);
    const canvases = containerEl?.querySelectorAll('canvas') ?? [];
    canvases.forEach((c) => {
      const cc = c as HTMLCanvasElement;
      if (cc.width > 0 && cc.height > 0) octx.drawImage(cc, 0, 0, w, h);
    });
    try {
      out.toBlob((blob) => {
        if (!blob) { showError('Screenshot failed: could not encode the image.'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    } catch {
      // A tainted canvas (cross-origin tile without CORS) throws on toBlob.
      showError('Screenshot blocked: cross-origin tiles tainted the canvas.');
    }
  }

  export function addOverlay(id: string, hipsUrl: string, opacity: number = 80) {
    if (overlays.has(id)) return;
    overlays.set(id, { id, baseUrl: hipsUrl, opacity });
    loadOverlayTiles();
    // Paint immediately: any already-cached overlay tiles (e.g. re-adding, or
    // tiles shared with a prior view) would otherwise not show until a network
    // onload or a pan, since loadOverlayTiles only scheduleRenders on load.
    scheduleRender();
  }

  export function removeOverlay(id: string) {
    overlays.delete(id);
    // Remove overlay tiles from cache
    const prefix = `overlay-${id}-`;
    for (const key of tileCache.keys()) {
      if (key.startsWith(prefix)) { closeTile(tileCache.get(key)); tileCache.delete(key); }
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

        // Use authenticated fetch for Rubin overlays (throttled via the queue).
        if (useAuth && overlay.baseUrl.includes('data.lsst.cloud')) {
          runQueuedFetch(() =>
            fetch(toRequestUrl(url), { headers: auth })
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
              })
          );
        } else {
          img.src = toRequestUrl(url);
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
    if (rulerCanvasEl) rulerCtx = rulerCanvasEl.getContext('2d');
    if (regionCanvasEl) regionCtx = regionCanvasEl.getContext('2d');
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
      if (perfReportTimer) {
        clearTimeout(perfReportTimer);
        perfReportTimer = null;
      }
      // Abort any in-flight tile loads (also detaches their img handlers) and
      // reconcile the perf in-flight gauge — this cleanup also fires when the
      // effect merely RE-RUNS, so a bare clear() would leak in-flight counts.
      abortInFlightLoads();
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
    // Abort in-flight loads for the old base before clearing its cache, so a stale
    // tile can't resolve into the new base's cache under the same key. reset()
    // clears the (now-aborted) in-flight count + starts per-survey counters fresh.
    tileScheduler.clear();
    perf.reset();
    for (const key of tileCache.keys()) {
      if (!key.startsWith('overlay-')) { closeTile(tileCache.get(key)); tileCache.delete(key); }
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
      if (rulerCanvasEl) {
        rulerCanvasEl.width = w;
        rulerCanvasEl.height = h;
        rulerCanvasEl.style.width = w + 'px';
        rulerCanvasEl.style.height = h + 'px';
      }
      if (regionCanvasEl) {
        regionCanvasEl.width = w;
        regionCanvasEl.height = h;
        regionCanvasEl.style.width = w + 'px';
        regionCanvasEl.style.height = h + 'px';
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
    oncontextmenu={onContextMenu}
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

  <!-- Distance-ruler overlay: interactive ONLY in mode, steals the drag so
       measuring never pans the sky. -->
  <canvas
    bind:this={rulerCanvasEl}
    class="ruler-canvas"
    class:active={rulerMode}
    aria-hidden="true"
    onpointerdown={onRulerPointerDown}
    onpointermove={onRulerPointerMove}
    onpointerup={onRulerPointerUp}
    onpointercancel={onRulerPointerUp}
  ></canvas>

  <!-- DS9 region-drawing overlay: interactive ONLY in region mode, steals the
       drag/clicks so drawing a region never pans the sky. -->
  <canvas
    bind:this={regionCanvasEl}
    class="region-canvas"
    class:active={regionMode}
    aria-label="Region drawing overlay"
    onpointerdown={onRegionPointerDown}
    onpointermove={onRegionPointerMove}
    onpointerup={onRegionPointerUp}
    onpointercancel={onRegionPointerUp}
  ></canvas>

  <!-- Magnifier loupe: a zoomed copy of the pixels under the cursor. Only mounted
       when enabled; non-interactive so it never steals pointer events. -->
  {#if showMagnifier}
    <canvas
      bind:this={magnifierCanvasEl}
      width={MAGNIFIER_SIZE}
      height={MAGNIFIER_SIZE}
      class="magnifier-canvas"
      class:visible={magnifierVisible}
      aria-label="Magnifier loupe"
    ></canvas>
  {/if}

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

  .ruler-canvas {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 7;
  }

  .ruler-canvas.active {
    pointer-events: auto;
    cursor: crosshair;
  }

  .region-canvas {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 7;
  }

  .region-canvas.active {
    pointer-events: auto;
    cursor: crosshair;
  }

  .hips-canvas:active {
    cursor: grabbing;
  }

  .magnifier-canvas {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 132px;
    height: 132px;
    border: 2px solid rgba(120, 200, 255, 0.7);
    border-radius: 50%;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
    pointer-events: none;
    z-index: 9;
    opacity: 0;
    transition: opacity 0.12s;
    background: #000;
  }
  .magnifier-canvas.visible {
    opacity: 1;
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
