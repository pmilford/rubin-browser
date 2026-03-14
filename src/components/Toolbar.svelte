<script lang="ts">
  import type { ScalingFunction, ColorMapName, InterpolationMethod } from '../types/image.js';

  let {
    scaling = 'linear' as ScalingFunction,
    colorMap = 'grayscale' as ColorMapName,
    interpolation = 'bilinear' as InterpolationMethod,
    onScalingChange,
    onColorMapChange,
    onInterpolationChange,
    onZoomIn,
    onZoomOut,
    onResetView,
    onSearch,
    onHelpClick,
  }: {
    scaling?: ScalingFunction;
    colorMap?: ColorMapName;
    interpolation?: InterpolationMethod;
    onScalingChange?: (s: ScalingFunction) => void;
    onColorMapChange?: (c: ColorMapName) => void;
    onInterpolationChange?: (i: InterpolationMethod) => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onResetView?: () => void;
    onSearch?: (ra: number, dec: number) => void;
    onHelpClick?: () => void;
  } = $props();

  const scalingOptions: ScalingFunction[] = ['linear', 'log', 'sqrt', 'asinh', 'histogram', 'zscale', 'percentile'];
  const colorMapOptions: ColorMapName[] = ['grayscale', 'viridis', 'plasma', 'inferno', 'hot', 'cool'];
  const interpolationOptions: InterpolationMethod[] = ['nearest', 'bilinear', 'bicubic', 'lanczos'];

  let searchQuery = $state('');
  let searchError = $state('');

  function handleSearch() {
    searchError = '';
    const query = searchQuery.trim();
    if (!query) return;

    // Try to parse "RA, Dec" format (e.g., "62.0, -37.0" or "62.0 -37.0")
    const parts = query.split(/[,\s]+/).map(s => parseFloat(s));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const ra = parts[0];
      const dec = parts[1];
      if (ra < 0 || ra > 360) {
        searchError = 'RA must be 0-360';
        return;
      }
      if (dec < -90 || dec > 90) {
        searchError = 'Dec must be -90 to 90';
        return;
      }
      onSearch?.(ra, dec);
      return;
    }

    // Try to parse sexagesimal format (e.g., "04h08m00s -37d00m00s")
    const raMatch = query.match(/(\d+)h\s*(\d+)?m?\s*([\d.]+)?s?/i);
    const decMatch = query.match(/([+-]?\d+)d?\s*(\d+)?m?\s*([\d.]+)?s?/i);
    if (raMatch && decMatch) {
      const raH = parseFloat(raMatch[1] || '0');
      const raM = parseFloat(raMatch[2] || '0');
      const raS = parseFloat(raMatch[3] || '0');
      const ra = (raH + raM / 60 + raS / 3600) * 15;

      const decSign = decMatch[1].startsWith('-') ? -1 : 1;
      const decD = Math.abs(parseFloat(decMatch[1] || '0'));
      const decM = parseFloat(decMatch[2] || '0');
      const decS = parseFloat(decMatch[3] || '0');
      const dec = decSign * (decD + decM / 60 + decS / 3600);

      onSearch?.(ra, dec);
      return;
    }

    searchError = 'Enter RA,Dec (e.g. 62.0,-37.0) or sexagesimal (e.g. 4h8m0s -37d0m0s)';
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }
</script>

<div class="toolbar" role="toolbar" aria-label="Image controls">
  <!-- Search bar -->
  <div class="search-group">
    <input
      type="text"
      class="search-input"
      placeholder="RA, Dec (e.g. 62.0, -37.0)"
      bind:value={searchQuery}
      onkeydown={handleSearchKeydown}
      title="Enter coordinates as 'RA, Dec' in degrees or sexagesimal"
      aria-label="Search coordinates"
    />
    <button class="search-button" onclick={handleSearch} title="Go to coordinates" aria-label="Go">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    </button>
    {#if searchError}
      <span class="search-error">{searchError}</span>
    {/if}
  </div>

  <div class="separator"></div>

  <!-- Zoom controls -->
  <div class="control-group">
    <button class="icon-button" onclick={() => onZoomIn?.()} title="Zoom in" aria-label="Zoom in">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="11" y1="8" x2="11" y2="14"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
    </button>
    <button class="icon-button" onclick={() => onZoomOut?.()} title="Zoom out" aria-label="Zoom out">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
    </button>
    <button class="icon-button" onclick={() => onResetView?.()} title="Reset view" aria-label="Reset view">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
      </svg>
    </button>
  </div>

  <div class="separator"></div>

  <!-- Image controls -->
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
    gap: 10px;
    padding: 6px 12px;
    background: #1a1a2e;
    border-bottom: 1px solid #333;
    color: #e0e0e0;
    font-size: 13px;
    flex-wrap: wrap;
  }

  .search-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .search-input {
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    width: 220px;
  }

  .search-input::placeholder {
    color: #666;
  }

  .search-input:focus {
    outline: none;
    border-color: #6a6aff;
  }

  .search-button {
    background: #2a2a3e;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .search-button:hover {
    background: #3a3a5e;
    color: #fff;
    border-color: #6a6aff;
  }

  .search-error {
    color: #f66;
    font-size: 11px;
    max-width: 200px;
  }

  .separator {
    width: 1px;
    height: 24px;
    background: #444;
    margin: 0 4px;
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .icon-button {
    background: #2a2a3e;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
  }

  .icon-button:hover {
    background: #3a3a5e;
    color: #fff;
    border-color: #6a6aff;
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
