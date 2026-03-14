<script lang="ts">
  import A from 'aladin-lite';
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

  // Resolve which HiPS endpoint to use
  const resolvedBaseUrl = $derived(
    hipsBaseUrl || (rspToken ? RUBIN_HIPS : PUBLIC_HIPS)
  );

  let containerEl: HTMLDivElement;
  let aladinViewer: any = null;
  let currentRa = $state(initialRa);
  let currentDec = $state(initialDec);
  let zoomLevel = $state(initialZoom);
  let hasError = $state(false);
  let errorMessage = $state('');
  let errorDismissTimer: ReturnType<typeof setTimeout> | null = null;

  // Overlay tracking for survey overlays
  interface OverlayEntry {
    id: string;
    hipsUrl: string;
    opacity: number;
    survey: any;
  }
  let overlays: Map<string, OverlayEntry> = new Map();

  /** Show error overlay with auto-dismiss */
  function showError(msg: string): void {
    hasError = true;
    errorMessage = msg;
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
    if (!onViewerStateChange) return;
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
    if (!aladinViewer) return;
    aladinViewer.increaseZoom();
  }

  /** Zoom out by a factor of 1.5x */
  export function zoomOut() {
    if (!aladinViewer) return;
    aladinViewer.decreaseZoom();
  }

  /** Reset to initial view */
  export function resetView() {
    if (!aladinViewer) return;
    aladinViewer.gotoRaDec(initialRa, initialDec);
    aladinViewer.setZoom(initialZoom);
  }

  /** Pan to specific RA/Dec coordinates */
  export function panTo(ra: number, dec: number) {
    if (!aladinViewer) return;
    aladinViewer.gotoRaDec(ra, dec);
  }

  /** Pan to coordinates and force tile reload for new region */
  export function panToAndReload(ra: number, dec: number) {
    if (!aladinViewer) return;
    aladinViewer.gotoRaDec(ra, dec);
    // Aladin auto-loads tiles for the new region
  }

  /** Set zoom level */
  export function setZoom(level: number) {
    if (!aladinViewer) return;
    aladinViewer.setZoom(level);
  }

  /** Add a survey overlay */
  export function addOverlay(surveyId: string, hipsUrl: string, opacity: number = 80) {
    if (!aladinViewer) return;
    if (overlays.has(surveyId)) return;

    const survey = aladinViewer.newImageSurvey(hipsUrl);
    aladinViewer.addImageSurvey(survey);

    const entry: OverlayEntry = {
      id: surveyId,
      hipsUrl,
      opacity,
      survey,
    };
    overlays.set(surveyId, entry);
  }

  /** Remove a survey overlay */
  export function removeOverlay(surveyId: string) {
    if (!aladinViewer) return;
    const entry = overlays.get(surveyId);
    if (entry) {
      aladinViewer.removeImageSurvey(entry.survey);
    }
    overlays.delete(surveyId);
  }

  /** Change overlay opacity */
  export function setOverlayOpacity(surveyId: string, opacity: number) {
    const entry = overlays.get(surveyId);
    if (entry?.survey) {
      entry.survey.setOpacity(opacity / 100);
      entry.opacity = opacity;
    }
  }

  // Initialize Aladin when container is ready
  $effect(() => {
    if (!containerEl) return;

    let destroyed = false;

    (async () => {
      try {
        await A.init();

        if (destroyed) return;

        const viewer = A.aladin(containerEl, {
          target: `${initialRa} ${initialDec}`,
          zoom: initialZoom,
          survey: resolvedBaseUrl,
          cooFrame: 'J2000',
          showFullscreenControl: false,
          showZoomControl: false,
          showLayersControl: false,
          showGotoControl: false,
          showSimbadPointerControl: false,
          showCooGrid: false,
        });

        aladinViewer = viewer;
        clearError();

        // Listen for position changes
        const onPosChanged = (pos: { ra: number; dec: number }) => {
          currentRa = Math.round(pos.ra * 100) / 100;
          currentDec = Math.round(pos.dec * 100) / 100;
          emitState();
        };
        viewer.on('positionChanged', onPosChanged as (...args: unknown[]) => void);

        // Listen for zoom changes
        const onZoomChanged = (zoom: number) => {
          zoomLevel = zoom;
          emitState();
        };
        viewer.on('zoomChanged', onZoomChanged as (...args: unknown[]) => void);

      } catch (err) {
        showError(err instanceof Error ? err.message : 'Failed to initialize viewer');
      }
    })();

    return () => {
      destroyed = true;
      if (errorDismissTimer) {
        clearTimeout(errorDismissTimer);
        errorDismissTimer = null;
      }
      if (aladinViewer) {
        aladinViewer.destroy();
        aladinViewer = null;
      }
    };
  });
</script>

<div class="image-viewer" bind:this={containerEl}>
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
