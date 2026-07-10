<script lang="ts">
  /**
   * 3D "mountain" / surface plot of a sky region's intensity, rendered from a
   * sampled luminance grid via the pure {@link surfaceGeometry}. Height + colour
   * both encode DISPLAYED relative luminance (pre-colormap), not calibrated flux.
   */
  import { surfaceGeometry } from '../utils/surfacePlot.js';

  let {
    grid = null as number[][] | null,
    onClose,
  }: {
    /** rows × cols luminance grid (0..1); null when nothing sampled. */
    grid?: number[][] | null;
    onClose?: () => void;
  } = $props();

  const W = 280;
  const H = 150;
  let zScale = $state(0.5);

  const hasData = $derived(!!grid && grid.length >= 2 && (grid[0]?.length ?? 0) >= 2);
  const geom = $derived(hasData ? surfaceGeometry(grid!, { width: W, height: H, zScale }) : null);

  /** Height 0..1 → a dark-blue→cyan→yellow heat colour (cheap, monotonic). */
  function heat(v: number): string {
    const t = Math.max(0, Math.min(1, v));
    const r = Math.round(255 * Math.min(1, Math.max(0, 1.6 * t - 0.4)));
    const g = Math.round(255 * Math.min(1, Math.max(0, 1.4 * t)));
    const b = Math.round(255 * Math.min(1, Math.max(0, 1 - 1.4 * t) + 0.15));
    return `rgb(${r},${g},${b})`;
  }
  const toPts = (points: [number, number][]) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
</script>

<div class="surface-plot" role="region" aria-label="3D surface plot">
  <div class="header">
    <span class="title">3D surface</span>
    <label class="z" title="Vertical exaggeration">
      z
      <input type="range" min="0.2" max="0.9" step="0.05" bind:value={zScale} aria-label="Vertical exaggeration" />
    </label>
    {#if onClose}
      <button class="close-btn" aria-label="Close 3D surface" onclick={onClose}>×</button>
    {/if}
  </div>

  {#if !hasData || !geom}
    <div class="no-data">no data in this region</div>
  {:else}
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} class="plot-svg" aria-label="Intensity surface">
      <rect x="0" y="0" width={W} height={H} fill="rgba(6,6,16,0.95)" />
      {#each geom.cells as cell, i (i)}
        <polygon
          points={toPts(cell.points)}
          fill={heat(cell.height)}
          stroke="rgba(0,0,0,0.35)"
          stroke-width="0.4"
        />
      {/each}
    </svg>
  {/if}
  <div class="foot">displayed relative luminance as height · not calibrated flux</div>
</div>

<style>
  .surface-plot {
    background: #10112a;
    border: 1px solid #345;
    border-radius: 6px;
    padding: 6px 8px;
    color: #ccd;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 296px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .title {
    font-weight: 600;
    color: #9cf;
    flex: 1;
  }
  .z {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #9ab;
  }
  .z input {
    width: 70px;
    accent-color: #6cf;
  }
  .close-btn {
    background: #22243a;
    border: 1px solid #445;
    border-radius: 4px;
    color: #ccd;
    cursor: pointer;
    font-size: 10px;
    padding: 2px 7px;
    font-family: inherit;
  }
  .plot-svg {
    display: block;
    border-radius: 3px;
  }
  .no-data {
    padding: 30px 8px;
    text-align: center;
    color: #889;
    font-style: italic;
  }
  .foot {
    margin-top: 3px;
    color: #667;
    font-size: 9px;
  }
</style>
