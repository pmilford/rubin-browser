<script lang="ts">
  import ImageViewer from '../components/ImageViewer.svelte';
  import CompactToolbar from '../components/CompactToolbar.svelte';
  import SidePanel from '../components/SidePanel.svelte';
  import ColorBar from '../components/ColorBar.svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import HelpModal from '../components/HelpModal.svelte';
  import ObjectBrowser from '../components/ObjectBrowser.svelte';
  import type { ScalingFunction, ColorMapName, InterpolationMethod, ViewerState, Epoch } from '../types/image.js';
  import { mjdToIso } from '../types/image.js';
  import { DEFAULT_MOCK_EPOCHS, type SurveyInfo } from '../constants.js';
  import type { FilterBand } from '../constants.js';
  import { getToken } from '../api/auth.js';
  import { lookupObject, type AstroObject } from '../data/objects.js';

  let scaling: ScalingFunction = $state('linear');
  let colorMap: ColorMapName = $state('grayscale');
  let interpolation: InterpolationMethod = $state('bilinear');
  let helpOpen = $state(false);

  // UI state
  let panelOpen = $state(false);
  let isFullscreen = $state(false);
  let uiVisible = $state(true);

  let currentRa = $state(62.0);
  let currentDec = $state(-37.0);
  let zoomLevel = $state(3);
  let statusMessage = $state('Ready');

  // Filter state
  let activeFilter: FilterBand | null = $state(null);
  let compositeMode = $state(false);
  let compositeChannels: { r: FilterBand | null; g: FilterBand | null; b: FilterBand | null } = $state({ r: null, g: null, b: null });

  // Survey overlay state
  interface OverlayEntry {
    survey: SurveyInfo;
    opacity: number;
  }
  let surveyOverlays: OverlayEntry[] = $state([]);

  // Time series state
  const mockEpochs: Epoch[] = DEFAULT_MOCK_EPOCHS.map(e => ({
    mjd: e.mjd,
    isoDate: mjdToIso(e.mjd),
    filter: e.filter,
  }));
  let currentEpochIndex = $state(0);

  // Blink state
  let blinkPlaying = $state(false);
  let blinkRate = $state(1.0);
  const blinkTargets = $derived(mockEpochs.map((e, i) => ({
    id: `epoch-${i}`,
    label: `Epoch ${i + 1} (${e.filter ?? '?'})`
  })));
  let blinkIndex = $state(0);
  let isPlaying = $state(false);

  let imageViewerRef: ImageViewer | undefined = $state();
  let rspToken = $state(getToken() || '');

  function handleViewerStateChange(state: ViewerState) {
    currentRa = state.centerRa;
    currentDec = state.centerDec;
    zoomLevel = state.zoomLevel;
  }

  function handleSearch(ra: number, dec: number) {
    currentRa = ra;
    currentDec = dec;
    imageViewerRef?.panToAndReload(ra, dec);
    statusMessage = `Go to RA=${ra.toFixed(2)}°, Dec=${dec.toFixed(2)}°`;
  }

  function handleEpochChange(index: number, epoch: Epoch) {
    currentEpochIndex = index;
    statusMessage = `Epoch ${index + 1}: MJD ${epoch.mjd.toFixed(2)} (${epoch.filter ?? '—'})`;
  }

  function handleFilterChange(filter: FilterBand | null) {
    activeFilter = filter;
    statusMessage = filter ? `Filter: ${filter}` : 'Filter: none';
  }

  function handleCompositeChange(channels: { r: FilterBand | null; g: FilterBand | null; b: FilterBand | null }) {
    compositeChannels = channels;
    const parts = [];
    if (channels.r) parts.push(`R:${channels.r}`);
    if (channels.g) parts.push(`G:${channels.g}`);
    if (channels.b) parts.push(`B:${channels.b}`);
    statusMessage = parts.length > 0 ? `Composite: ${parts.join(' ')}` : 'Composite: cleared';
  }

  function handleOverlayAdd(survey: SurveyInfo) {
    surveyOverlays = [...surveyOverlays, { survey, opacity: 80 }];
    imageViewerRef?.addOverlay(survey.id, survey.hipsUrl, 80);
    statusMessage = `Added overlay: ${survey.name}`;
  }

  function handleOverlayRemove(surveyId: string) {
    const entry = surveyOverlays.find(o => o.survey.id === surveyId);
    surveyOverlays = surveyOverlays.filter(o => o.survey.id !== surveyId);
    imageViewerRef?.removeOverlay(surveyId);
    statusMessage = `Removed overlay: ${entry?.survey.name ?? surveyId}`;
  }

  function handleOpacityChange(surveyId: string, opacity: number) {
    surveyOverlays = surveyOverlays.map(o =>
      o.survey.id === surveyId ? { ...o, opacity } : o
    );
    imageViewerRef?.setOverlayOpacity(surveyId, opacity);
    const entry = surveyOverlays.find(o => o.survey.id === surveyId);
    statusMessage = `${entry?.survey.name ?? surveyId} opacity: ${opacity}%`;
  }

  function handleBlinkTargetChange(index: number) {
    blinkIndex = index;
    currentEpochIndex = index;
    const epoch = mockEpochs[index];
    if (epoch) {
      statusMessage = `Blink: Epoch ${index + 1} (${epoch.filter ?? '—'})`;
    }
  }

  function togglePanel() {
    panelOpen = !panelOpen;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      isFullscreen = true;
    } else {
      document.exitFullscreen?.();
      isFullscreen = false;
    }
  }

  function handleFullscreenChange() {
    isFullscreen = !!document.fullscreenElement;
  }

  /** Handle object selection from ObjectBrowser */
  function handleObjectSelect(obj: AstroObject) {
    currentRa = obj.ra;
    currentDec = obj.dec;
    imageViewerRef?.panToAndReload(obj.ra, obj.dec);
    statusMessage = `Go to ${obj.name}: RA=${obj.ra.toFixed(2)}°, Dec=${obj.dec.toFixed(2)}°`;
  }

  /** Handle named object search from toolbar */
  export function handleNameSearch(name: string): boolean {
    const obj = lookupObject(name);
    if (obj) {
      handleObjectSelect(obj);
      return true;
    }
    return false;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Escape toggles UI visibility / closes panel
    if (e.key === 'Escape') {
      if (panelOpen) {
        panelOpen = false;
      } else {
        uiVisible = !uiVisible;
      }
      return;
    }
    // H toggles help
    if (e.key === 'h' || e.key === 'H') {
      if (!e.ctrlKey && !e.metaKey) {
        helpOpen = !helpOpen;
        return;
      }
    }
    // F toggles fullscreen
    if (e.key === 'f' || e.key === 'F') {
      if (!e.ctrlKey && !e.metaKey) {
        toggleFullscreen();
        return;
      }
    }
    // +/- for zoom
    if (e.key === '+' || e.key === '=') {
      imageViewerRef?.zoomIn();
    }
    if (e.key === '-' || e.key === '_') {
      imageViewerRef?.zoomOut();
    }
    if (e.key === '0') {
      imageViewerRef?.resetView();
    }
  }
</script>

<svelte:window
  onkeydown={handleKeydown}
  onfullscreenchange={handleFullscreenChange}
/>

<div class="tile-viewer" class:ui-hidden={!uiVisible}>
  {#if uiVisible}
    <CompactToolbar
      panelOpen={panelOpen}
      {isFullscreen}
      onZoomIn={() => imageViewerRef?.zoomIn()}
      onZoomOut={() => imageViewerRef?.zoomOut()}
      onResetView={() => imageViewerRef?.resetView()}
      onSearch={handleSearch}
      onTogglePanel={togglePanel}
      onToggleFullscreen={toggleFullscreen}
      onToggleHelp={() => { helpOpen = !helpOpen; }}
    />
  {/if}

  <SidePanel
    open={panelOpen}
    {scaling}
    {colorMap}
    {interpolation}
    epochs={mockEpochs}
    {currentEpochIndex}
    {isPlaying}
    {activeFilter}
    {compositeMode}
    {compositeChannels}
    {surveyOverlays}
    {blinkTargets}
    {blinkIndex}
    {blinkPlaying}
    {blinkRate}
    onScalingChange={(s) => { scaling = s; statusMessage = `Scaling: ${s}`; }}
    onColorMapChange={(c) => { colorMap = c; statusMessage = `Color map: ${c}`; }}
    onInterpolationChange={(i) => { interpolation = i; statusMessage = `Interpolation: ${i}`; }}
    onEpochChange={handleEpochChange}
    onPlayStateChange={(p) => { isPlaying = p; }}
    onFilterChange={handleFilterChange}
    onCompositeChange={handleCompositeChange}
    onOverlayAdd={handleOverlayAdd}
    onOverlayRemove={handleOverlayRemove}
    onOpacityChange={handleOpacityChange}
    onBlinkTargetChange={handleBlinkTargetChange}
    onBlinkPlayStateChange={(p) => { blinkPlaying = p; }}
    onBlinkRateChange={(r) => { blinkRate = r; }}
    onClose={() => { panelOpen = false; }}
  />

  <div class="viewer-area">
    <ImageViewer
      bind:this={imageViewerRef}
      {rspToken}
      {scaling}
      {colorMap}
      {interpolation}
      initialRa={62.0}
      initialDec={-37.0}
      initialZoom={3}
      onViewerStateChange={handleViewerStateChange}
    />
    <div class="object-browser-overlay">
      <ObjectBrowser onObjectSelect={handleObjectSelect} />
    </div>
  </div>

  {#if uiVisible}
    <ColorBar {colorMap} minValue={0} maxValue={1} />
    <StatusBar ra={currentRa} dec={currentDec} {zoomLevel} message={statusMessage} />
  {/if}

  <HelpModal open={helpOpen} onClose={() => { helpOpen = false; }} />
</div>

<style>
  .tile-viewer {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #111;
  }

  .viewer-area {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .object-browser-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 15;
    max-height: 50%;
    overflow-y: auto;
  }

  .ui-hidden .viewer-area {
    height: 100vh;
  }
</style>
