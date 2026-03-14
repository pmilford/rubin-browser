<script lang="ts">
  import type { ColorMapName } from '../types/image.js';
  import { generateColorBar } from '../utils/colormap.js';

  let {
    colorMap = 'grayscale' as ColorMapName,
    minValue = 0,
    maxValue = 1,
  }: {
    colorMap?: ColorMapName;
    minValue?: number;
    maxValue?: number;
  } = $props();

  let canvasEl: HTMLCanvasElement;

  const COLOR_BAR_HEIGHT = 16;
  const COLOR_BAR_WIDTH = 256;

  $effect(() => {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const rgbaData = generateColorBar(colorMap);
    const imageData = new ImageData(
      new Uint8ClampedArray(rgbaData),
      COLOR_BAR_WIDTH,
      1
    );

    // Draw scaled to canvas
    canvasEl.width = COLOR_BAR_WIDTH;
    canvasEl.height = COLOR_BAR_HEIGHT;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = COLOR_BAR_WIDTH;
    tempCanvas.height = 1;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tempCanvas, 0, 0, COLOR_BAR_WIDTH, COLOR_BAR_HEIGHT);
  });
</script>

<div class="color-bar">
  <canvas bind:this={canvasEl} aria-label="Color map legend"></canvas>
  <div class="labels">
    <span>{minValue.toFixed(2)}</span>
    <span class="map-name">{colorMap}</span>
    <span>{maxValue.toFixed(2)}</span>
  </div>
</div>

<style>
  .color-bar {
    padding: 4px 12px;
    background: #1a1a2e;
    border-top: 1px solid #333;
  }

  canvas {
    width: 100%;
    height: 16px;
    border-radius: 2px;
    display: block;
  }

  .labels {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #888;
    margin-top: 2px;
  }

  .map-name {
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #aaa;
  }
</style>
