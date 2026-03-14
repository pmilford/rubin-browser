<script lang="ts">
  import ImageViewer from '../components/ImageViewer.svelte';
  import Toolbar from '../components/Toolbar.svelte';
  import ColorBar from '../components/ColorBar.svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import HelpModal from '../components/HelpModal.svelte';
  import type { ScalingFunction, ColorMapName, InterpolationMethod, ViewerState } from '../types/image.js';

  let scaling: ScalingFunction = $state('linear');
  let colorMap: ColorMapName = $state('grayscale');
  let interpolation: InterpolationMethod = $state('bilinear');
  let helpOpen = $state(false);

  let currentRa = $state(62.0);
  let currentDec = $state(-37.0);
  let zoomLevel = $state(3);
  let statusMessage = $state('Ready');

  function handleViewerStateChange(state: ViewerState) {
    currentRa = state.centerRa;
    currentDec = state.centerDec;
    zoomLevel = state.zoomLevel;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'h' || e.key === 'H') {
      helpOpen = !helpOpen;
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
    onHelpClick={() => { helpOpen = true; }}
  />

  <div class="viewer-area">
    <ImageViewer
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
