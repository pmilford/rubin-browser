<script lang="ts">
  let {
    ra = 0,
    dec = 0,
    scale = 1.0,
    fovDeg = 1.0,
    showGrid = true,
    showNE = true,
    showScale = true,
  }: {
    ra?: number;
    dec?: number;
    scale?: number;
    fovDeg?: number;
    showGrid?: boolean;
    showNE?: boolean;
    showScale?: boolean;
  } = $props();

  // Compute grid line spacing based on FOV
  const gridSpacing = $derived(computeGridSpacing(fovDeg));

  function computeGridSpacing(fov: number): number {
    if (fov > 40) return 10;
    if (fov > 20) return 5;
    if (fov > 10) return 2;
    if (fov > 5) return 1;
    if (fov > 2) return 0.5;
    if (fov > 1) return 0.2;
    if (fov > 0.5) return 0.1;
    if (fov > 0.2) return 0.05;
    return 0.02;
  }

  // Generate grid lines within the FOV
  const raLines = $derived(generateGridLines(ra, fovDeg, gridSpacing));
  const decLines = $derived(generateGridLines(dec, fovDeg, gridSpacing));

  function generateGridLines(center: number, fov: number, spacing: number): number[] {
    const half = fov / 2;
    const start = Math.ceil((center - half) / spacing) * spacing;
    const lines: number[] = [];
    for (let v = start; v <= center + half; v += spacing) {
      lines.push(Math.round(v * 1000) / 1000);
    }
    return lines;
  }

  function formatCoord(value: number, isRA: boolean): string {
    if (isRA) {
      const hours = value / 15;
      const h = Math.floor(hours);
      const m = Math.floor((hours - h) * 60);
      return `${h}h${String(m).padStart(2, '0')}m`;
    }
    const sign = value >= 0 ? '+' : '';
    const d = Math.floor(Math.abs(value));
    const m = Math.floor((Math.abs(value) - d) * 60);
    return `${sign}${value < 0 ? '-' : ''}${d}°${String(m).padStart(2, '0')}'`;
  }

  // Scale bar: show appropriate length based on FOV
  const scaleBarArcmin = $derived(computeScaleBar(fovDeg));

  function computeScaleBar(fov: number): number {
    const fovArcmin = fov * 60;
    const targetPixels = 80; // approximate pixel width for scale bar
    const arcminPerPixel = fovArcmin / 400; // assume ~400px display
    const barArcmin = targetPixels * arcminPerPixel;
    // Round to nice number
    if (barArcmin >= 60) return Math.round(barArcmin / 30) * 30;
    if (barArcmin >= 10) return Math.round(barArcmin / 5) * 5;
    if (barArcmin >= 1) return Math.round(barArcmin);
    return Math.round(barArcmin * 10) / 10;
  }

  function formatScaleBar(arcmin: number): string {
    if (arcmin >= 60) return `${(arcmin / 60).toFixed(1)}°`;
    return `${arcmin.toFixed(arcmin < 1 ? 1 : 0)}'`;
  }
</script>

<div class="wcs-overlay" role="img" aria-label="WCS overlay">
  {#if showGrid}
    <div class="grid-section">
      <div class="grid-info" title="Coordinate grid">
        <span class="grid-label">Grid</span>
        <span class="grid-spacing">{gridSpacing}° spacing</span>
        <span class="grid-count">{raLines.length} RA × {decLines.length} Dec</span>
      </div>
      <div class="grid-coords">
        <div class="ra-lines">
          <span class="coord-type">RA:</span>
          {#each raLines.slice(0, 5) as line}
            <span class="coord-line">{formatCoord(line, true)}</span>
          {/each}
          {#if raLines.length > 5}
            <span class="coord-ellipsis">+{raLines.length - 5} more</span>
          {/if}
        </div>
        <div class="dec-lines">
          <span class="coord-type">Dec:</span>
          {#each decLines.slice(0, 5) as line}
            <span class="coord-line">{formatCoord(line, false)}</span>
          {/each}
          {#if decLines.length > 5}
            <span class="coord-ellipsis">+{decLines.length - 5} more</span>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if showNE}
    <div class="ne-indicator" title="North/East orientation">
      <div class="ne-arrow ne-n">
        <span class="ne-label">N</span>
        <span class="ne-sym">↑</span>
      </div>
      <div class="ne-arrow ne-e">
        <span class="ne-label">E</span>
        <span class="ne-sym">←</span>
      </div>
    </div>
  {/if}

  {#if showScale}
    <div class="scale-bar" title="Angular scale">
      <div class="bar">
        <div class="bar-line"></div>
        <div class="bar-ticks">
          <span class="tick">|</span>
          <span class="tick">|</span>
        </div>
      </div>
      <span class="bar-label">{formatScaleBar(scaleBarArcmin)}</span>
    </div>
  {/if}
</div>

<style>
  .wcs-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 4;
  }

  .grid-section {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(20, 20, 35, 0.85);
    border: 1px solid #444;
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 10px;
    color: #aaa;
  }

  .grid-info {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 4px;
  }

  .grid-label {
    font-weight: 600;
    text-transform: uppercase;
    color: #ddd;
    letter-spacing: 0.5px;
  }

  .grid-spacing {
    color: #8cf;
    font-family: 'Courier New', monospace;
  }

  .grid-count {
    color: #888;
  }

  .grid-coords {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ra-lines,
  .dec-lines {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }

  .coord-type {
    color: #888;
    font-weight: 600;
    min-width: 24px;
  }

  .coord-line {
    color: #bbb;
    font-family: 'Courier New', monospace;
    background: #222;
    padding: 1px 4px;
    border-radius: 2px;
  }

  .coord-ellipsis {
    color: #666;
    font-style: italic;
  }

  .ne-indicator {
    position: absolute;
    top: 50%;
    left: 12px;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ne-arrow {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }

  .ne-label {
    font-size: 10px;
    font-weight: 700;
    color: #aaa;
  }

  .ne-sym {
    font-size: 16px;
    color: #8cf;
  }

  .ne-n .ne-sym {
    color: #f88;
  }

  .ne-e .ne-sym {
    color: #8cf;
  }

  .scale-bar {
    position: absolute;
    bottom: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .bar {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 80px;
  }

  .bar-line {
    height: 2px;
    background: #ccc;
    border-radius: 1px;
  }

  .bar-ticks {
    display: flex;
    justify-content: space-between;
    color: #ccc;
    font-size: 10px;
    line-height: 1;
    margin-top: -2px;
  }

  .tick {
    font-size: 8px;
  }

  .bar-label {
    font-size: 10px;
    color: #aaa;
    font-family: 'Courier New', monospace;
  }
</style>
