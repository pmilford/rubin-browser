<script lang="ts">
  import type { PerfSnapshot } from '../utils/perfMetrics.js';

  let { snapshot }: { snapshot: PerfSnapshot } = $props();

  // Derived display strings. Kept trivial so the HUD reflects the REAL snapshot
  // fed from ImageViewer's fetch/render path, never a placeholder.
  const fps = $derived(snapshot.fps.toFixed(0));
  const lastRender = $derived(snapshot.lastRenderMs.toFixed(1));
  const avgTileLoad = $derived(snapshot.tileLoadMs.count > 0 ? snapshot.tileLoadMs.avg.toFixed(0) : '—');
  const hitPct = $derived((snapshot.cacheHitRate * 100).toFixed(0));
</script>

<div class="perf-hud" aria-label="Performance HUD">
  <div class="perf-title">⏱ Performance</div>
  <div class="perf-row">
    <span class="perf-key">FPS</span>
    <span class="perf-val" aria-label="FPS">{fps}</span>
    <span class="perf-key">render</span>
    <span class="perf-val" aria-label="Last render ms">{lastRender} ms</span>
  </div>
  <div class="perf-row">
    <span class="perf-key">tiles</span>
    <span class="perf-val" aria-label="Tiles loaded">{snapshot.tilesRequested}</span>
    <span class="perf-key">hit-rate</span>
    <span class="perf-val" aria-label="Cache hit rate">{hitPct}%</span>
  </div>
  <div class="perf-row">
    <span class="perf-key">in-flight</span>
    <span class="perf-val" aria-label="In-flight fetches">{snapshot.inFlight}</span>
    <span class="perf-key">avg load</span>
    <span class="perf-val" aria-label="Avg tile load ms">{avgTileLoad}{avgTileLoad === '—' ? '' : ' ms'}</span>
  </div>
  <div class="perf-row">
    <span class="perf-key">network</span>
    <span class="perf-val" aria-label="Tiles fetched from network">{snapshot.fetchedFromNetwork}</span>
    <span class="perf-key">errors</span>
    <span class="perf-val" class:err={snapshot.errors > 0} aria-label="Error count">{snapshot.errors}</span>
  </div>
</div>

<style>
  .perf-hud {
    position: absolute;
    top: 90px;
    left: 8px;
    z-index: 9;
    background: rgba(6, 10, 20, 0.9);
    border: 1px solid rgba(120, 200, 255, 0.4);
    border-radius: 6px;
    padding: 6px 10px;
    color: #cfe;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    line-height: 1.5;
    pointer-events: none;
    min-width: 180px;
  }
  .perf-title {
    color: #9cf;
    font-weight: 700;
    margin-bottom: 2px;
  }
  .perf-row {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    gap: 4px 8px;
    align-items: baseline;
  }
  .perf-key {
    color: #789;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 9px;
  }
  .perf-val {
    color: #dff;
    text-align: right;
  }
  .perf-val.err {
    color: #f88;
  }
</style>
