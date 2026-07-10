<script lang="ts">
  /**
   * Light-curve (intensity vs TIME) line graph for the offline synthetic cube.
   * Plots the KNOWN ground-truth intensity at the view-centre sky point across the
   * epoch axis, marking the current epoch — so a transient/supernova under the
   * centre shows its actual rise-and-fade. Offline only (a single Rubin coadd has
   * no time axis; real per-visit series is backlog #4).
   */
  import { mjdToIso } from '../types/image.js';
  import type { LightCurvePoint } from '../data/offlineDataset.js';

  let {
    curve = null as LightCurvePoint[] | null,
    currentIndex = 0,
    band = 'r',
    title = 'Light curve',
    status = null as string | null,
    footNote = 'ground-truth synthetic intensity (counts) at the view centre · not real observations',
    onRefresh,
    onClose,
  }: {
    curve?: LightCurvePoint[] | null;
    currentIndex?: number;
    band?: string;
    title?: string;
    /** Loading / error / info message shown when there is no curve. */
    status?: string | null;
    footNote?: string;
    onRefresh?: () => void;
    onClose?: () => void;
  } = $props();

  const W = 280;
  const H = 110;

  const maxI = $derived(curve && curve.length ? Math.max(1e-6, ...curve.map((p) => p.intensity)) : 1);
  const hasData = $derived(!!curve && curve.length >= 2);

  const xy = (i: number): [number, number] => {
    const n = curve!.length;
    const x = (i / (n - 1)) * (W - 8) + 4;
    const y = H - 4 - (curve![i]!.intensity / maxI) * (H - 12);
    return [x, y];
  };
  const linePath = $derived.by(() => {
    if (!hasData) return '';
    return curve!.map((_p, i) => { const [x, y] = xy(i); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
  });
  const marker = $derived(hasData && currentIndex >= 0 && currentIndex < curve!.length ? xy(currentIndex) : null);
  const mjdRange = $derived(hasData ? [curve![0]!.mjd, curve![curve!.length - 1]!.mjd] as const : [0, 0] as const);
</script>

<div class="lc-plot" role="region" aria-label="Light curve">
  <div class="header">
    <span class="title">{title} · {band}</span>
    {#if onRefresh}
      <button class="close-btn" aria-label="Refresh light curve" title="Fetch at the current centre" onclick={onRefresh}>↻</button>
    {/if}
    {#if onClose}
      <button class="close-btn" aria-label="Close light curve" onclick={onClose}>×</button>
    {/if}
  </div>

  {#if !hasData}
    <div class="no-data" aria-label="Light curve status">{status ?? 'no time axis (offline cube only)'}</div>
  {:else}
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} class="plot-svg" aria-label="Intensity vs time">
      <rect x="0" y="0" width={W} height={H} fill="rgba(8,10,22,0.95)" />
      {#each [0.5] as g (g)}
        <line x1="0" y1={H * g} x2={W} y2={H * g} stroke="rgba(120,140,220,0.12)" stroke-width="0.5" />
      {/each}
      <path d={linePath} fill="none" stroke="#8fd" stroke-width="1.4" />
      {#each curve as _p, i (i)}
        {@const [cx, cy] = xy(i)}
        <circle {cx} {cy} r="1.8" fill="#8fd" />
      {/each}
      {#if marker}
        <line x1={marker[0]} y1="0" x2={marker[0]} y2={H} stroke="#fc6" stroke-width="1" stroke-dasharray="2,2" />
        <circle cx={marker[0]} cy={marker[1]} r="3.2" fill="#fc6" aria-label="Current epoch marker" />
      {/if}
    </svg>
    <div class="axes">
      <span class="ax">MJD {mjdRange[0].toFixed(0)}</span>
      <span class="ax-label">{mjdToIso(mjdRange[0])} → {mjdToIso(mjdRange[1])}</span>
      <span class="ax">MJD {mjdRange[1].toFixed(0)}</span>
    </div>
  {/if}
  <div class="foot">{footNote}</div>
</div>

<style>
  .lc-plot {
    background: #10122a;
    border: 1px solid #345;
    border-radius: 6px;
    padding: 6px 8px;
    color: #ccd;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 296px;
  }
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .title { font-weight: 600; color: #9fd; flex: 1; }
  .close-btn {
    background: #22243a; border: 1px solid #445; border-radius: 4px; color: #ccd;
    cursor: pointer; font-size: 10px; padding: 2px 7px; font-family: inherit;
  }
  .plot-svg { display: block; border-radius: 3px; }
  .no-data { padding: 24px 8px; text-align: center; color: #889; font-style: italic; }
  .axes {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 2px; color: #89a; font-size: 9px;
  }
  .ax-label { color: #9ab; }
  .foot { margin-top: 3px; color: #667; font-size: 9px; }
</style>
