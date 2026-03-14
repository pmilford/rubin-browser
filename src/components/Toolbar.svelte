<script lang="ts">
  import type { ScalingFunction, ColorMapName, InterpolationMethod } from '../types/image.js';

  let {
    scaling = 'linear' as ScalingFunction,
    colorMap = 'grayscale' as ColorMapName,
    interpolation = 'bilinear' as InterpolationMethod,
    onScalingChange,
    onColorMapChange,
    onInterpolationChange,
    onHelpClick,
  }: {
    scaling?: ScalingFunction;
    colorMap?: ColorMapName;
    interpolation?: InterpolationMethod;
    onScalingChange?: (s: ScalingFunction) => void;
    onColorMapChange?: (c: ColorMapName) => void;
    onInterpolationChange?: (i: InterpolationMethod) => void;
    onHelpClick?: () => void;
  } = $props();

  const scalingOptions: ScalingFunction[] = ['linear', 'log', 'sqrt', 'asinh', 'histogram', 'zscale', 'percentile'];
  const colorMapOptions: ColorMapName[] = ['grayscale', 'viridis', 'plasma', 'inferno', 'hot', 'cool'];
  const interpolationOptions: InterpolationMethod[] = ['nearest', 'bilinear', 'bicubic', 'lanczos'];
</script>

<div class="toolbar" role="toolbar" aria-label="Image controls">
  <div class="control-group">
    <label for="scaling-select" title="Image intensity scaling method">Scale</label>
    <select
      id="scaling-select"
      value={scaling}
      onchange={(e) => onScalingChange?.(e.currentTarget.value as ScalingFunction)}
    >
      {#each scalingOptions as opt}
        <option value={opt}>{opt}</option>
      {/each}
    </select>
  </div>

  <div class="control-group">
    <label for="colormap-select" title="Color map for pixel display">Color</label>
    <select
      id="colormap-select"
      value={colorMap}
      onchange={(e) => onColorMapChange?.(e.currentTarget.value as ColorMapName)}
    >
      {#each colorMapOptions as opt}
        <option value={opt}>{opt}</option>
      {/each}
    </select>
  </div>

  <div class="control-group">
    <label for="interp-select" title="Pixel interpolation method for zoom">Interp</label>
    <select
      id="interp-select"
      value={interpolation}
      onchange={(e) => onInterpolationChange?.(e.currentTarget.value as InterpolationMethod)}
    >
      {#each interpolationOptions as opt}
        <option value={opt}>{opt}</option>
      {/each}
    </select>
  </div>

  <button
    class="help-button"
    onclick={() => onHelpClick?.()}
    title="Show keyboard shortcuts and help"
    aria-label="Help"
  >
    ?
  </button>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    background: #1a1a2e;
    border-bottom: 1px solid #333;
    color: #e0e0e0;
    font-size: 13px;
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  label {
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #aaa;
    cursor: help;
  }

  select {
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    cursor: pointer;
  }

  select:hover {
    border-color: #6a6aff;
  }

  .help-button {
    margin-left: auto;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid #555;
    background: #2a2a3e;
    color: #aaa;
    font-weight: bold;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .help-button:hover {
    background: #3a3a5e;
    color: #fff;
    border-color: #6a6aff;
  }
</style>
