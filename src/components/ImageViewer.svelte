<script lang="ts">
  import OpenSeadragon from 'openseadragon';
  import type { ViewerState } from '../types/image.js';

  let {
    hipsBaseUrl = 'https://data.lsst.cloud/api/hips/images/color_gri',
    initialRa = 62.0,
    initialDec = -37.0,
    initialZoom = 3,
    onViewerStateChange,
  }: {
    hipsBaseUrl?: string;
    initialRa?: number;
    initialDec?: number;
    initialZoom?: number;
    onViewerStateChange?: (state: ViewerState) => void;
  } = $props();

  let containerEl: HTMLDivElement;
  let osdViewer: OpenSeadragon.Viewer | null = null;
  let currentRa = $state(initialRa);
  let currentDec = $state(initialDec);
  let zoomLevel = $state(initialZoom);
  let hasError = $state(false);
  let errorMessage = $state('');

  function emitState() {
    if (!onViewerStateChange || !osdViewer) return;
    onViewerStateChange({
      centerRa: currentRa,
      centerDec: currentDec,
      zoomLevel,
      scaling: { method: 'linear' },
      colorMap: 'grayscale',
      interpolation: 'bilinear',
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

  /** Set zoom level */
  export function setZoom(level: number) {
    if (!osdViewer) return;
    osdViewer.viewport.zoomTo(level);
    osdViewer.viewport.applyConstraints();
  }

  $effect(() => {
    if (!containerEl) return;

    try {
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
          getTileUrl: function (level: number, x: number, y: number) {
            const order = Math.max(0, level - 1);
            const nside = Math.pow(2, order);
            const pixelIndex = y * nside + x;
            const dir = Math.floor(pixelIndex / 10000) * 10000;
            return `${hipsBaseUrl}/Norder${order}/Dir${dir}/Npix${pixelIndex}.png`;
          },
        },
      });

      viewer.addHandler('zoom', (event: OpenSeadragon.ZoomEvent) => {
        zoomLevel = event.zoom ?? zoomLevel;
        emitState();
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
        hasError = false;
        errorMessage = '';
        // Pan to initial position
        const x = initialRa / 360;
        const y = (90 - initialDec) / 180;
        viewer.viewport.panTo(new OpenSeadragon.Point(x, y));
        viewer.viewport.zoomTo(initialZoom);
        emitState();
      });

      viewer.addHandler('open-failed', (event: { message?: string }) => {
        hasError = true;
        errorMessage = event.message || 'Failed to load image tiles';
      });

      viewer.addHandler('tile-load-failed', (event: { message?: string }) => {
        hasError = true;
        errorMessage = event.message || 'Failed to load tiles';
      });

      osdViewer = viewer;
    } catch (err) {
      hasError = true;
      errorMessage = err instanceof Error ? err.message : 'Failed to initialize viewer';
    }

    return () => {
      if (osdViewer) {
        osdViewer.destroy();
        osdViewer = null;
      }
    };
  });
</script>

<div class="image-viewer" bind:this={containerEl}>
  {#if hasError}
    <div class="error-overlay">
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
