<script lang="ts">
  /**
   * Multi-epoch VARIABILITY display (feature 124 — the display layer over the pure,
   * tested `variability.ts` analysis). For the HEALPix tile at the view centre it
   * stacks EVERY offline epoch's intensity frame, computes a per-pixel temporal
   * variability map, and detects the variable sources — showing WHERE the sky
   * changes over time (as opposed to DiffPanel's two-epoch difference).
   *
   * Meaningful ONLY over the OFFLINE multi-epoch cube (a single Rubin coadd has no
   * time axis), so it is gated to the offline base by the caller. All computation
   * is the pure pipeline: offlineIntensityFrame → variabilityMap →
   * detectVariableSources. Markers are in FRAME space (the raster the frames use),
   * so they are trivially correct.
   */
  import { offlineIntensityFrame, OFFLINE_TILE_SIZE as TS } from '../data/offlineDataset.js';
  import { variabilityMap, detectVariableSources } from '../utils/variability.js';
  import type { Band } from '../data/syntheticSky.js';

  let {
    order,
    pixelIndex,
    band = 'r' as Band,
    epochs,
    onClose,
  }: {
    order: number;
    pixelIndex: number;
    band?: Band;
    epochs: readonly number[];
    onClose?: () => void;
  } = $props();

  // A realistic per-epoch noise gives the detector a background std distribution to
  // threshold against (noise-free frames make every constant pixel exactly 0, so
  // there is no robust noise floor for significance). Matches DiffPanel's choice.
  const NOISE = 1.5;

  const frames = $derived(epochs.map((mjd) => offlineIntensityFrame(order, pixelIndex, band, mjd, NOISE)));
  // Temporal std per pixel: a constant source (even a bright one) sits at the noise
  // floor while a 1–2-epoch transient surfaces as a hot spot.
  const map = $derived(variabilityMap(frames, TS, TS, { metric: 'std' }));
  const sources = $derived(
    detectVariableSources(map, TS, TS, { nSigma: 5, minSeparation: 4, maxDetections: 12 })
  );

  let mapCanvasEl: HTMLCanvasElement | undefined = $state();

  /** A "hot" ramp: black → red → orange → yellow → white for t in [0,1]. */
  function hot(t: number): [number, number, number] {
    const x = Math.max(0, Math.min(1, t));
    const r = Math.max(0, Math.min(1, x * 3));
    const g = Math.max(0, Math.min(1, x * 3 - 1));
    const b = Math.max(0, Math.min(1, x * 3 - 2));
    return [r * 255, g * 255, b * 255];
  }

  function drawMap(canvas: HTMLCanvasElement | undefined, data: Float64Array) {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    let hi = 0;
    for (const v of data) if (Number.isFinite(v) && v > hi) hi = v;
    const span = hi || 1;
    const img = new ImageData(TS, TS);
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      const [r, g, b] = hot(Number.isFinite(v) ? v / span : 0);
      const o = i * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Ring the detected variable sources.
    ctx.strokeStyle = '#6cf';
    ctx.lineWidth = 1.5;
    for (const s of sources) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  $effect(() => {
    drawMap(mapCanvasEl, map);
  });
</script>

<div class="var-panel" aria-label="Variability map">
  <div class="vp-header">
    <span class="vp-title">Temporal variability (offline)</span>
    <button class="vp-close" aria-label="Close variability" onclick={() => onClose?.()}>×</button>
  </div>

  <div class="vp-body">
    <figure>
      <canvas bind:this={mapCanvasEl} width={TS} height={TS} aria-label="Variability map canvas"></canvas>
      <figcaption>per-pixel temporal σ over {epochs.length} epochs</figcaption>
    </figure>

    <div class="vp-sources" aria-label="Variable source list">
      <div aria-label="Variable source count">
        {sources.length} variable source{sources.length === 1 ? '' : 's'}
      </div>
      {#each sources.slice(0, 8) as s, i (i)}
        <div class="vp-src">({s.x}, {s.y}) · σ={s.significance.toFixed(1)} · idx={s.index.toFixed(1)}</div>
      {/each}
      {#if sources.length === 0}
        <div class="vp-none">no variable sources in this tile</div>
      {/if}
    </div>
  </div>
  <div class="vp-note">Synthetic ground truth · brighter = varies more over time</div>
</div>

<style>
  .var-panel {
    background: rgba(12, 14, 22, 0.97);
    border: 1px solid rgba(120, 200, 255, 0.5);
    border-radius: 8px;
    padding: 8px 10px;
    color: #d8e2f0;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 260px;
  }
  .vp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .vp-title { color: #9cf; font-weight: 700; }
  .vp-close { background: none; border: none; color: #aaa; font-size: 18px; line-height: 1; cursor: pointer; }
  .vp-close:hover { color: #fff; }
  .vp-body { display: flex; gap: 8px; }
  .vp-body figure { margin: 0; text-align: center; }
  .vp-body canvas { width: 120px; height: 120px; image-rendering: pixelated; border: 1px solid #234; background: #000; }
  .vp-body figcaption { color: #89a; font-size: 9px; margin-top: 2px; max-width: 120px; }
  .vp-sources { flex: 1; max-height: 120px; overflow-y: auto; }
  .vp-src { color: #bdf; }
  .vp-none { color: #778; }
  .vp-note { color: #778; font-size: 9px; margin-top: 6px; }
</style>
