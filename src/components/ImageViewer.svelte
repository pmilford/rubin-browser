<script lang="ts">
  import OpenSeadragon from 'openseadragon';
  import type { ViewerState, ScalingFunction, ColorMapName, InterpolationMethod } from '../types/image.js';
  import { applyScaling } from '../utils/scaling.js';
  import { applyColorMap } from '../utils/colormap.js';

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
    onViewerStateChange?: (state: ViewerState) => void;
  } = $props();

  // Default to public DSS2 Color HiPS (no auth needed)
  const PUBLIC_HIPS = 'https://alasky.cds.unistra.fr/DSS/DSSColor';
  const RUBIN_HIPS = 'https://data.lsst.cloud/api/hips/images/color_gri';

  // Resolve which HiPS endpoint and format to use
  const resolvedBaseUrl = $derived(
    hipsBaseUrl || (rspToken ? RUBIN_HIPS : PUBLIC_HIPS)
  );
  const resolvedFormat = $derived(
    tileFormat || (rspToken ? 'png' : 'jpg')
  );

  let containerEl: HTMLDivElement;
  let osdViewer: OpenSeadragon.Viewer | null = null;
  let displayCanvas: HTMLCanvasElement | null = null;
  let currentRa = $state(initialRa);
  let currentDec = $state(initialDec);
  let zoomLevel = $state(initialZoom);
  let hasError = $state(false);
  let errorMessage = $state('');

  // Track tile loading for smart error display
  let tileFailCount = $state(0);
  let tileSuccessCount = $state(0);
  let errorDismissTimer: ReturnType<typeof setTimeout> | null = null;

  // Post-processing state
  let postProcessRaf: number | null = null;
  let needsPostProcess = $state(false);

  // Overlay tracking for survey overlays
  interface OverlayEntry {
    id: string;
    hipsUrl: string;
    opacity: number;
    tiledImage: OpenSeadragon.TiledImage | null;
  }
  let overlays: Map<string, OverlayEntry> = new Map();

  /** Check if post-processing is needed (non-default scaling or colormap) */
  function isPostProcessingNeeded(): boolean {
    return scaling !== 'linear' || colorMap !== 'grayscale';
  }

  /** Apply scaling and colormap to canvas pixel data */
  function postProcessCanvas(): void {
    if (!osdViewer || !displayCanvas) return;

    const canvas = osdViewer.drawer?.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    // Resize display canvas to match
    if (displayCanvas.width !== width || displayCanvas.height !== height) {
      displayCanvas.width = width;
      displayCanvas.height = height;
    }

    const displayCtx = displayCanvas.getContext('2d');
    if (!displayCtx) return;

    // Read pixels from OSD canvas
    const imageData = ctx.getImageData(0, 0, width, height);
    const rgba = imageData.data;

    // Convert RGBA to grayscale intensity (Float64Array)
    const intensity = new Float64Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const offset = i * 4;
      // Standard luminance weights
      intensity[i] = 0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2];
    }

    // Apply scaling
    const scaled = applyScaling(intensity, { method: scaling });
    const scaledData = scaled.data;

    // Apply colormap
    const colored = applyColorMap(scaledData, colorMap);

    // Write to display canvas
    const pixelRgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < colored.length; i++) {
      const v = Math.max(0, Math.min(255, Math.round(colored[i])));
      pixelRgba[i * 4] = v;
      pixelRgba[i * 4 + 1] = v;
      pixelRgba[i * 4 + 2] = v;
      pixelRgba[i * 4 + 3] = 255;
    }
    const displayImageData = new ImageData(pixelRgba, width, height);
    displayCtx.putImageData(displayImageData, 0, 0);
    displayCanvas.style.display = 'block';
  }

  /** Schedule a post-processing pass (debounced via rAF) */
  function schedulePostProcess(): void {
    if (!isPostProcessingNeeded()) {
      // Hide display canvas, show OSD canvas directly
      if (displayCanvas) {
        displayCanvas.style.display = 'none';
      }
      return;
    }
    if (postProcessRaf !== null) return;
    postProcessRaf = requestAnimationFrame(() => {
      postProcessRaf = null;
      postProcessCanvas();
    });
  }

  /** Show error overlay with auto-dismiss */
  function showError(msg: string): void {
    hasError = true;
    errorMessage = msg;
    // Auto-dismiss after 5 seconds
    if (errorDismissTimer) clearTimeout(errorDismissTimer);
    errorDismissTimer = setTimeout(() => {
      hasError = false;
      errorMessage = '';
    }, 5000);
  }

  /** Clear error state */
  function clearError(): void {
    hasError = false;
    errorMessage = '';
    if (errorDismissTimer) {
      clearTimeout(errorDismissTimer);
      errorDismissTimer = null;
    }
  }

  function emitState() {
    if (!onViewerStateChange || !osdViewer) return;
    onViewerStateChange({
      centerRa: currentRa,
      centerDec: currentDec,
      zoomLevel,
      scaling: { method: scaling },
      colorMap: colorMap,
      interpolation: interpolation,
    });
  }

  /** Zoom in by a factor of 1.5x */
  export function zoomIn() {
    if (!osdViewer) return;
    osdViewer.viewport.zoomBy(1.5);
    osdViewer.viewport.applyConstraints();
  }

  /** Zoom out by a factor of 1.5x */
  export function zoomOut() {
    if (!osdViewer) return;
    osdViewer.viewport.zoomBy(1 / 1.5);
    osdViewer.viewport.applyConstraints();
  }

  /** Reset to initial view */
  export function resetView() {
    if (!osdViewer) return;
    osdViewer.viewport.goHome();
  }

  /** Pan to specific RA/Dec coordinates */
  export function panTo(ra: number, dec: number) {
    if (!osdViewer) return;
    // For the OSD tile source (image coordinates 0..1), convert ra/dec
    // Our tile source uses RA as x (0-360 normalized) and Dec as y (-90 to 90 normalized)
    const x = ra / 360;
    const y = (90 - dec) / 180;
    osdViewer.viewport.panTo(new OpenSeadragon.Point(x, y));
    osdViewer.viewport.applyConstraints();
  }

  /** Pan to coordinates and force tile reload for new region */
  export function panToAndReload(ra: number, dec: number) {
    if (!osdViewer) return;

    // Reset tile tracking for new region
    tileFailCount = 0;
    tileSuccessCount = 0;

    // Pan to new position
    const x = ra / 360;
    const y = (90 - dec) / 180;
    osdViewer.viewport.panTo(new OpenSeadragon.Point(x, y));
    osdViewer.viewport.applyConstraints();

    // Force OSD to invalidate and reload visible tiles
    osdViewer.world.getItemCount();
    const itemCount = osdViewer.world.getItemCount();
    for (let i = 0; i < itemCount; i++) {
      const tiledImage = osdViewer.world.getItemAt(i);
      if (tiledImage) {
        tiledImage.reset();
      }
    }
  }

  /** Set zoom level */
  export function setZoom(level: number) {
    if (!osdViewer) return;
    osdViewer.viewport.zoomTo(level);
    osdViewer.viewport.applyConstraints();
  }

  /** Add a survey overlay */
  export function addOverlay(surveyId: string, hipsUrl: string, opacity: number = 80) {
    if (!osdViewer) return;
    if (overlays.has(surveyId)) return;

    const tileSource = {
      height: 256 * Math.pow(2, 10),
      width: 256 * Math.pow(2, 10),
      tileSize: 256,
      getTileUrl: function (level: number, x: number, y: number) {
        const order = Math.max(0, level - 1);
        const nside = Math.pow(2, order);
        const pixelIndex = y * nside + x;
        const dir = Math.floor(pixelIndex / 10000) * 10000;
        return `${hipsUrl}Norder${order}/Dir${dir}/Npix${pixelIndex}.jpg`;
      },
    };

    osdViewer.addTiledImage({
      tileSource: tileSource as unknown as OpenSeadragon.TileSource,
      opacity: opacity / 100,
      compositeOperation: 'source-over',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      success: ((event: any) => {
        const entry: OverlayEntry = {
          id: surveyId,
          hipsUrl,
          opacity,
          tiledImage: event.item,
        };
        overlays.set(surveyId, entry);
      }) as (event: Event) => void,
    });
  }

  /** Remove a survey overlay */
  export function removeOverlay(surveyId: string) {
    if (!osdViewer) return;
    const entry = overlays.get(surveyId);
    if (entry?.tiledImage) {
      osdViewer.world.removeItem(entry.tiledImage);
    }
    overlays.delete(surveyId);
  }

  /** Change overlay opacity */
  export function setOverlayOpacity(surveyId: string, opacity: number) {
    const entry = overlays.get(surveyId);
    if (entry?.tiledImage) {
      entry.tiledImage.setOpacity(opacity / 100);
      entry.opacity = opacity;
    }
  }

  // Watch for scaling/colorMap/interpolation changes and re-process
  $effect(() => {
    // These reactive dependencies trigger re-processing
    void scaling;
    void colorMap;
    void interpolation;
    schedulePostProcess();
  });

  $effect(() => {
    if (!containerEl) return;

    try {
      // Build auth headers if we have an RSP token
      const ajaxHeaders: Record<string, string> = {};
      if (rspToken) {
        ajaxHeaders['Authorization'] = `Bearer ${rspToken}`;
      }

      const viewer = OpenSeadragon({
        element: containerEl,
        showNavigationControl: false,
        showNavigator: true,
        navigatorPosition: 'BOTTOM_RIGHT',
        minZoomLevel: 0.5,
        maxZoomLevel: 40,
        visibilityRatio: 0.5,
        constrainDuringPan: false,
        wrapHorizontal: true,
        tileSources: {
          height: 256 * Math.pow(2, 10),
          width: 256 * Math.pow(2, 10),
          tileSize: 256,
          ajaxHeaders: Object.keys(ajaxHeaders).length > 0 ? ajaxHeaders : undefined,
          getTileUrl: function (level: number, x: number, y: number) {
            const order = Math.max(0, level - 1);
            const nside = Math.pow(2, order);
            const pixelIndex = y * nside + x;
            const dir = Math.floor(pixelIndex / 10000) * 10000;
            return `${resolvedBaseUrl}/Norder${order}/Dir${dir}/Npix${pixelIndex}.${resolvedFormat}`;
          },
        },
      });

      viewer.addHandler('zoom', (event: OpenSeadragon.ZoomEvent) => {
        zoomLevel = event.zoom ?? zoomLevel;
        emitState();
        schedulePostProcess();
      });

      viewer.addHandler('pan', () => {
        const center = viewer.viewport.getCenter();
        if (center) {
          currentRa = Math.round(center.x * 360 * 100) / 100;
          currentDec = Math.round((0.5 - center.y) * 180 * 100) / 100;
          emitState();
        }
      });

      viewer.addHandler('open', () => {
        clearError();
        // Reset tile tracking for new image
        tileFailCount = 0;
        tileSuccessCount = 0;
        // Pan to initial position
        const x = initialRa / 360;
        const y = (90 - initialDec) / 180;
        viewer.viewport.panTo(new OpenSeadragon.Point(x, y));
        viewer.viewport.zoomTo(initialZoom);
        emitState();
        // Schedule post-processing after initial load
        setTimeout(() => schedulePostProcess(), 500);
      });

      viewer.addHandler('open-failed', (event: { message?: string }) => {
        showError(event.message || 'Failed to load image tiles');
      });

      // Track individual tile failures - only show error if many fail
      viewer.addHandler('tile-load-failed', () => {
        tileFailCount++;
        const total = tileFailCount + tileSuccessCount;
        // Only show error if >50% of tiles are failing and we have enough samples
        if (total >= 5 && tileFailCount / total > 0.5) {
          showError('Multiple tiles failed to load. Try a different coordinate or check your connection.');
        }
      });

      // Track successful tile loads - clear error when tiles succeed
      viewer.addHandler('tile-loaded', () => {
        tileSuccessCount++;
        // If tiles are loading successfully, dismiss any error
        if (hasError) {
          clearError();
        }
      });

      // Schedule post-processing when tiles are drawn
      viewer.addHandler('tile-drawn', () => {
        schedulePostProcess();
      });

      osdViewer = viewer;
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to initialize viewer');
    }

    return () => {
      if (postProcessRaf !== null) {
        cancelAnimationFrame(postProcessRaf);
        postProcessRaf = null;
      }
      if (errorDismissTimer) {
        clearTimeout(errorDismissTimer);
        errorDismissTimer = null;
      }
      if (osdViewer) {
        osdViewer.destroy();
        osdViewer = null;
      }
    };
  });
</script>

<div class="image-viewer" bind:this={containerEl}>
  <canvas
    bind:this={displayCanvas}
    class="display-canvas"
    aria-label="Post-processed display"
    style="display: none;"
  ></canvas>
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
    background: #111;
    position: relative;
  }

  .display-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 5;
    pointer-events: none;
    image-rendering: pixelated;
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
