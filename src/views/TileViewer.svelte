<script lang="ts">
  import ImageViewer from '../components/ImageViewer.svelte';
  import Toolbar from '../components/Toolbar.svelte';
  import ColorBar from '../components/ColorBar.svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import HelpModal from '../components/HelpModal.svelte';
  import TimeSlider from '../components/TimeSlider.svelte';
  import FilterSelector from '../components/FilterSelector.svelte';
  import type { ScalingFunction, ColorMapName, InterpolationMethod, ViewerState, Epoch } from '../types/image.js';
  import { mjdToIso } from '../types/image.js';
  import { DEFAULT_MOCK_EPOCHS } from '../constants.js';
  import type { FilterBand } from '../constants.js';

  let scaling: ScalingFunction = $state('linear');
  let colorMap: ColorMapName = $state('grayscale');
  let interpolation: InterpolationMethod = $state('bilinear');
  let helpOpen = $state(false);

  let currentRa = $state(62.0);
  let currentDec = $state(-37.0);
  let zoomLevel = $state(3);
  let statusMessage = $state('Ready');

  // Filter state
  let activeFilter: FilterBand | null = $state(null);
  let compositeMode = $state(false);
  let compositeChannels: { r: FilterBand | null; g: FilterBand | null; b: FilterBand | null } = $state({ r: null, g: null, b: null });

  // Time series state
  const mockEpochs: Epoch[] = DEFAULT_MOCK_EPOCHS.map(e => ({
    mjd: e.mjd,
    isoDate: mjdToIso(e.mjd),
    filter: e.filter,
  }));
  let currentEpochIndex = $state(0);
  let isPlaying = $state(false);

  let imageViewerRef: ImageViewer | undefined = $state();

  function handleViewerStateChange(state: ViewerState) {
    currentRa = state.centerRa;
    currentDec = state.centerDec;
    zoomLevel = state.zoomLevel;
  }

  function handleSearch(ra: number, dec: number) {
    currentRa = ra;
    currentDec = dec;
    imageViewerRef?.panTo(ra, dec);
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'h' || e.key === 'H') {
      helpOpen = !helpOpen;
    }
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

<svelte:window onkeydown={handleKeydown} />

<div class="tile-viewer">
  <Toolbar
    {scaling}
    {colorMap}
    {interpolation}
    onScalingChange={(s) => { scaling = s; statusMessage = `Scaling: ${s}`; }}
    onColorMapChange={(c) => { colorMap = c; statusMessage = `Color map: ${c}`; }}
    onInterpolationChange={(i) => { interpolation = i; statusMessage = `Interpolation: ${i}`; }}
    onZoomIn={() => imageViewerRef?.zoomIn()}
    onZoomOut={() => imageViewerRef?.zoomOut()}
    onResetView={() => imageViewerRef?.resetView()}
    onSearch={handleSearch}
    onHelpClick={() => { helpOpen = true; }}
  />

  <TimeSlider
    epochs={mockEpochs}
    currentIndex={currentEpochIndex}
    playing={isPlaying}
    interval={1000}
    onEpochChange={handleEpochChange}
    onPlayStateChange={(p) => { isPlaying = p; }}
  />

  <FilterSelector
    bind:activeFilter={activeFilter}
    {compositeMode}
    {compositeChannels}
    onFilterChange={handleFilterChange}
    onCompositeChange={handleCompositeChange}
  />

  <div class="viewer-area">
    <ImageViewer
      bind:this={imageViewerRef}
      initialRa={62.0}
      initialDec={-37.0}
      initialZoom={3}
      onViewerStateChange={handleViewerStateChange}
    />
  </div>

  <ColorBar {colorMap} minValue={0} maxValue={1} />
  <StatusBar ra={currentRa} dec={currentDec} {zoomLevel} message={statusMessage} />
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
</style>
