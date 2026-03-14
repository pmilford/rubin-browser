<script lang="ts">
  import { getAuthHeader } from '../api/auth.js';
  import { radecToTileIndex } from '../api/hips.js';
  import { applyScaling } from '../utils/scaling.js';
  import { applyColorMap } from '../utils/colormap.js';
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
    onViewerStateChange?: (state: ViewerState) => void;
  } = $props();

  const PUBLIC_HIPS = 'https://alasky.cds.unistra.fr/DSS/DSSColor';
  const RUBIN_HIPS = 'https://data.lsst.cloud/api/hips/images/color_gri';
  const DEFAULT_FORMAT = 'jpg';
  const TILE_SIZE = 512;
  const MAX_ZOOM = 18;
  const MIN_ZOOM = 0;

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

  function zoomToFov(zoom: number): number {
    return 180 / Math.pow(2, zoom);
  }

  function zoomToOrder(zoom: number): number {
    const order = Math.floor(zoom / 1.5);
    return Math.max(0, Math.min(13, order));
  }

  /**
   * Gnomonic projection: sky coords (deg) → canvas coords (px).
   * Pure projection without pan offset — offset is applied in render().
   */
  function skyToCanvas(skyRa: number, skyDec: number): [number, number] {
    const cosDec0 = Math.cos((dec * Math.PI) / 180);
    const sinDec0 = Math.sin((dec * Math.PI) / 180);
    const cosDec = Math.cos((skyDec * Math.PI) / 180);
    const sinDec = Math.sin((skyDec * Math.PI) / 180);
    const dRa = ((skyRa - ra) * Math.PI) / 180;
    const cosDRa = Math.cos(dRa);

    const cosC = sinDec0 * sinDec + cosDec0 * cosDec * cosDRa;
    if (cosC <= 0.01) return [NaN, NaN];

    const k = 1 / cosC;
    const u = k * cosDec * Math.sin(dRa);
    const v = k * (cosDec0 * sinDec - sinDec0 * cosDec * cosDRa);
    const scale = canvasWidth / ((fov * Math.PI) / 180);

    return [canvasWidth / 2 + u * scale, canvasHeight / 2 - v * scale];
  }

  /**
   * Canvas coords (px, relative to canvas) → sky coords (deg).
   * Accounts for current pan offset so coordinate readout is correct during drag.
   */
  function canvasToSky(px: number, py: number): [number, number] {
    // Undo pan offset to get logical canvas position
    const logicalX = px - panOffsetX;
    const logicalY = py - panOffsetY;

    const scale = canvasWidth / ((fov * Math.PI) / 180);
    const u = (logicalX - canvasWidth / 2) / scale;
    const v = -(logicalY - canvasHeight / 2) / scale;
    const rho = Math.sqrt(u * u + v * v);
    const c = Math.atan(rho);
    const cosDec0 = Math.cos((dec * Math.PI) / 180);
    const sinDec0 = Math.sin((dec * Math.PI) / 180);
    const cosC = Math.cos(c);
    const sinC = Math.sin(c);

    const newDec = Math.asin(cosC * sinDec0 + (v * sinC * cosDec0) / (rho || 1));
    const newRa = ra + (Math.atan2(u * sinC, rho * cosC * cosDec0 - v * sinC * sinDec0) * 180) / Math.PI;

    return [((newRa % 360) + 360) % 360, (newDec * 180) / Math.PI];
  }

  // --- Tile URL Construction ---

  function buildUrl(order: number, pixelIndex: number, fmt: string, baseUrl: string): string {
    const dir = Math.floor(pixelIndex / 10000) * 10000;
    const cleanBase = baseUrl.replace(/\/properties$/, '').replace(/\/$/, '');
    return `${cleanBase}/Norder${order}/Dir${dir}/Npix${pixelIndex}.${fmt}`;
  }

  function resolveFormat(): string {
    if (tileFormat) return tileFormat;
    return DEFAULT_FORMAT;
  }

  // --- Tile Discovery ---

  interface TileKey {
    order: number;
    pixelIndex: number;
  }

  function getVisibleTiles(centerRa: number, centerDec: number, viewFov: number, order: number): TileKey[] {
    const tiles: TileKey[] = [];
    const tileAngularSize = 180 / Math.pow(2, order);
    const coverageRadius = viewFov / 2 + tileAngularSize;

    const decRange = coverageRadius;
    const cosDec = Math.cos((centerDec * Math.PI) / 180) || 0.01;
    const raRange = coverageRadius / cosDec;

    const decMin = Math.max(-90, centerDec - decRange);
    const decMax = Math.min(90, centerDec + decRange);
    const decSteps = Math.max(1, Math.ceil(decRange / tileAngularSize));
    const raSteps = Math.max(1, Math.ceil(raRange / tileAngularSize));

    const seen = new Set<number>();

    for (let di = -decSteps; di <= decSteps; di++) {
      const tileDec = centerDec + di * tileAngularSize;
      if (tileDec < -90 || tileDec > 90) continue;

      for (let ri = -raSteps; ri <= raSteps; ri++) {
        const tileRa = centerRa + ri * tileAngularSize;
        const normalizedRa = ((tileRa % 360) + 360) % 360;

        const pix = radecToTileIndex(normalizedRa, tileDec, order);
        if (!seen.has(pix)) {
          seen.add(pix);
          tiles.push({ order, pixelIndex: pix });
        }
      }
    }

    return tiles;
  }

  // --- Rendering ---

  /**
   * Main render function.
   * Uses canvas translate for pan offset so old tiles remain visible during drag (Issue #3).
   */
  function render() {
    if (!ctx) return;

    const needsPostProcessing = scaling !== 'linear' || colorMap !== 'grayscale' || invert;

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
        drawTile(context, img, tile.order, tile.pixelIndex);
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
          drawTile(context, img, tile.order, tile.pixelIndex);
          context.globalAlpha = 1.0;
        }
      }
    }
  }

  function drawTile(
    context: CanvasRenderingContext2D,
    img: HTMLImageElement,
    order: number,
    pixelIndex: number
  ) {
    const nside = Math.pow(2, order);
    const totalPixels = 12 * nside * nside;
    if (pixelIndex < 0 || pixelIndex >= totalPixels) return;

    const tileAngularSize = 180 / nside;
    const tileCenter = estimateTileCenter(pixelIndex, order, ra, dec);
    if (!tileCenter) return;

    const [tileRa, tileDec] = tileCenter;

    // Check if tile center is in front of viewer
    const cosDec0 = Math.cos((dec * Math.PI) / 180);
    const sinDec0 = Math.sin((dec * Math.PI) / 180);
    const cosDecT = Math.cos((tileDec * Math.PI) / 180);
    const sinDecT = Math.sin((tileDec * Math.PI) / 180);
    const dRa = ((tileRa - ra) * Math.PI) / 180;
    const cosC = sinDec0 * sinDecT + cosDec0 * cosDecT * Math.cos(dRa);
    if (cosC <= 0.05) return; // Behind viewer

    // Project tile center to screen
    const [cx, cy] = skyToCanvas(tileRa, tileDec);
    if (isNaN(cx) || isNaN(cy)) return;

    // Check if tile is on-screen (with generous margin for pan offset)
    const margin = TILE_SIZE * 2;
    if (cx < -margin || cx > canvasWidth + margin || cy < -margin || cy > canvasHeight + margin) return;

    // Compute screen size of the tile
    const k = 1 / cosC;
    const scale = canvasWidth / ((fov * Math.PI) / 180);
    const screenHalfSize = (k * (tileAngularSize / 2) * Math.PI) / 180 * scale;

    // Compute rotation from projected tile edges
    const halfSize = tileAngularSize / 2;
    const cosDecE = Math.cos((tileDec * Math.PI) / 180) || 0.01;
    const [ex, ey] = skyToCanvas(tileRa + halfSize / cosDecE, tileDec);
    if (isNaN(ex) || isNaN(ey)) return;

    const dx = ex - cx;
    const dy = ey - cy;
    const rotation = Math.atan2(dy, dx);

    // Draw with rotation
    context.save();
    context.translate(cx, cy);
    context.rotate(rotation);
    context.drawImage(
      img,
      -screenHalfSize,
      -screenHalfSize,
      screenHalfSize * 2,
      screenHalfSize * 2
    );
    context.restore();
  }

  /**
   * Estimate tile center RA/Dec from pixel index by searching around the current view center.
   */
  function estimateTileCenter(
    pixelIndex: number,
    order: number,
    viewRa: number,
    viewDec: number
  ): [number, number] | null {
    const tileAngularSize = 180 / Math.pow(2, order);
    const steps = 8;
    const range = tileAngularSize * 3;

    let bestRa = viewRa;
    let bestDec = viewDec;
    let minDist = Infinity;

    for (let di = -steps; di <= steps; di++) {
      for (let ri = -steps; ri <= steps; ri++) {
        const testDec = viewDec + (di / steps) * range;
        if (testDec < -90 || testDec > 90) continue;

        const cosD = Math.cos((testDec * Math.PI) / 180) || 0.01;
        const testRa = viewRa + (ri / steps) * range / cosD;
        const normalizedRa = ((testRa % 360) + 360) % 360;

        const pix = radecToTileIndex(normalizedRa, Math.max(-89.99, Math.min(89.99, testDec)), order);

        if (pix === pixelIndex) {
          const raDiff = Math.min(
            Math.abs(normalizedRa - viewRa),
            360 - Math.abs(normalizedRa - viewRa)
          );
          const dist = Math.sqrt(raDiff * raDiff + (testDec - viewDec) * (testDec - viewDec));
          if (dist < minDist) {
            minDist = dist;
            bestRa = normalizedRa;
            bestDec = testDec;
          }
        }
      }
    }

    if (minDist < Infinity) return [bestRa, bestDec];
    return null;
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

  function onPointerMove(e: PointerEvent) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    // Update canvas offset for smooth panning (Issue #3: old tiles stay visible)
    panOffsetX = dragStartOffsetX + dx;
    panOffsetY = dragStartOffsetY + dy;

    scheduleRender();
    emitState();
  }

  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;

    // Recenter if offset exceeds threshold (Issue #2: continuous panning)
    const thresholdX = canvasWidth * 0.5;
    const thresholdY = canvasHeight * 0.5;

    if (Math.abs(panOffsetX) > thresholdX || Math.abs(panOffsetY) > thresholdY) {
      // Convert current screen center to sky coordinates
      const [newRa, newDec] = canvasToSky(canvasWidth / 2, canvasHeight / 2);
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
    const [centerRa, centerDec] = canvasToSky(canvasWidth / 2, canvasHeight / 2);

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
    const [newRa, newDec] = canvasToSky(px, py);
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
    const [centerRa, centerDec] = canvasToSky(canvasWidth / 2, canvasHeight / 2);

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

    for (const [, overlay] of overlays) {
      const visibleTiles = getVisibleTiles(ra, dec, fov, order);
      for (const tile of visibleTiles) {
        const cacheKey = `overlay-${overlay.id}-${tile.order}-${tile.pixelIndex}`;
        if (tileCache.has(cacheKey)) continue;

        const url = buildUrl(tile.order, tile.pixelIndex, fmt, overlay.baseUrl);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          tileCache.set(cacheKey, img);
          scheduleRender();
        };
        img.src = url;
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
    scheduleRender();
  });

  /**
   * Resize canvas to container. Called on init, resize, and fullscreen change (Issue #8).
   */
  function resizeToContainer() {
    if (!containerEl || !canvasEl) return;
    const w = containerEl.offsetWidth || 800;
    const h = containerEl.offsetHeight || 600;
    if (w > 0 && h > 0) {
      canvasWidth = w;
      canvasHeight = h;
      canvasEl.width = w;
      canvasEl.height = h;
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
    onwheel={onWheel}
    ondblclick={onDblClick}
    onkeydown={onKeyDown}
  ></canvas>

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
    width: 100%;
    height: 100%;
    cursor: grab;
    image-rendering: pixelated;
    outline: none;
  }

  .hips-canvas:active {
    cursor: grabbing;
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
