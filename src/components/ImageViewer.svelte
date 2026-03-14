<script lang="ts">
  import OpenSeadragon from 'openseadragon';
  // Import types
  import type { ColorMapName, ScalingFunction, InterpolationMethod, ViewerState } from '../types/image.js';

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
  let viewer: OpenSeadragon.Viewer | null = $state(null);
  let currentRa = $state(initialRa);
  let currentDec = $state(initialDec);
  let zoomLevel = $state(initialZoom);

  $effect(() => {
    if (!containerEl) return;

    const osd = OpenSeadragon({
      element: containerEl,
      prefixUrl: '',
      showNavigationControl: true,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      minZoomLevel: 1,
      maxZoomLevel: 20,
      visibilityRatio: 1.0,
      constrainDuringPan: true,
      tileSources: {
        height: 256 * Math.pow(2, 10),
        width: 256 * Math.pow(2, 10),
        tileSize: 256,
        getTileUrl: (level: number, x: number, y: number) => {
          const order = Math.max(0, level);
          const pixelIndex = y * Math.pow(2, order) + x;
          const dir = Math.floor(pixelIndex / 10000) * 10000;
          return `${hipsBaseUrl}/Norder${order}/Dir${dir}/Npix${pixelIndex}.png`;
        },
      },
    });

    osd.addHandler('zoom', (event: OpenSeadragon.ZoomEvent) => {
      zoomLevel = event.zoom ?? zoomLevel;
    });

    osd.addHandler('pan', () => {
      const center = osd.viewport.getCenter();
      if (center) {
        currentRa = center.x;
        currentDec = center.y;
      }
    });

    viewer = osd;

    return () => {
      osd.destroy();
      viewer = null;
    };
  });
</script>

<div class="image-viewer" bind:this={containerEl}></div>

<style>
  .image-viewer {
    width: 100%;
    height: 100%;
    min-height: 400px;
    background: #111;
    position: relative;
  }
</style>
