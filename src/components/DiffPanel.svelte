<script lang="ts">
  /**
   * Offline image-differencing panel (feature 108). Differences two epochs of the
   * bundled synthetic cube — which carries KNOWN ground-truth transients — and
   * shows epoch A, epoch B, and the (diverging-coloured) difference, plus the list
   * of detected transients marked on the diff. All computation is the pure,
   * tested pipeline: offlineIntensityFrame → differenceImages → detectTransients
   * (src/utils/imageDiff.ts). Markers are in FRAME space (the same raster the
   * frames use), so they are trivially correct; a sky-space overlay is a follow-up.
   */
  import {
    offlineIntensityFrame,
    OFFLINE_TILE_SIZE as TS,
  } from '../data/offlineDataset.js';
  import { differenceImages, detectTransients } from '../utils/imageDiff.js';
  import type { Band } from '../data/syntheticSky.js';

  let {
    order,
    pixelIndex,
    band = 'r' as Band,
    epochs,
    aIndex,
    bIndex,
    onAChange,
    onBChange,
    onClose,
  }: {
    order: number;
    pixelIndex: number;
    band?: Band;
    epochs: readonly number[];
    aIndex: number;
    bIndex: number;
    onAChange?: (i: number) => void;
    onBChange?: (i: number) => void;
    onClose?: () => void;
  } = $props();

  // Difference NOISY frames: with noise-free frames the static sky cancels
  // exactly, so the difference has zero spread (MAD std = 0) and detectTransients
  // correctly finds nothing — there'd be no noise floor to threshold against. A
  // realistic per-epoch noise gives the detector a floor the transient exceeds.
  const DIFF_NOISE = 1.5;
  const frameA = $derived(offlineIntensityFrame(order, pixelIndex, band, epochs[aIndex] ?? 0, DIFF_NOISE));
  const frameB = $derived(offlineIntensityFrame(order, pixelIndex, band, epochs[bIndex] ?? 0, DIFF_NOISE));
  // Offset-only (k=1): the synthetic epochs share the same photometric zero point
  // (no gain/zeropoint change), and a field whose only bright source IS the
  // transient has no static sources to anchor a slope fit — 'linear' would fit a
  // wild slope off the transient itself. 'median' removes the background diff and
  // leaves the transient as a clean excursion.
  const diff = $derived(differenceImages(frameA, frameB, TS, TS, { method: 'median' }));
  const transients = $derived(
    detectTransients(diff.diff, TS, TS, { nSigma: 5, maxDetections: 20, minArea: 1 })
  );

  let aCanvasEl: HTMLCanvasElement | undefined = $state();
  let bCanvasEl: HTMLCanvasElement | undefined = $state();
  let diffCanvasEl: HTMLCanvasElement | undefined = $state();

  /** Draw a linear-intensity frame as grayscale (min–max normalised). */
  function drawGray(canvas: HTMLCanvasElement | undefined, data: Float64Array) {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    let lo = Infinity, hi = -Infinity;
    for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    const img = new ImageData(TS, TS);
    for (let i = 0; i < data.length; i++) {
      const g = Math.max(0, Math.min(255, ((data[i]! - lo) / span) * 255));
      const o = i * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Draw the difference with a diverging map: red = appeared/brighter, blue =
   *  faded, black = no change (symmetric about 0). */
  function drawDiff(canvas: HTMLCanvasElement | undefined, data: Float64Array) {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    let m = 0;
    for (const v of data) { const a = Math.abs(v); if (Number.isFinite(a) && a > m) m = a; }
    m = m || 1;
    const img = new ImageData(TS, TS);
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      const t = Math.max(-1, Math.min(1, (Number.isFinite(v) ? v : 0) / m));
      const o = i * 4;
      if (t >= 0) { img.data[o] = 255 * t; img.data[o + 1] = 0; img.data[o + 2] = 0; }
      else { img.data[o] = 0; img.data[o + 1] = 0; img.data[o + 2] = 255 * -t; }
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Mark detected transients.
    ctx.strokeStyle = '#6f6';
    ctx.lineWidth = 1.5;
    for (const tr of transients) {
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  $effect(() => { drawGray(aCanvasEl, frameA); });
  $effect(() => { drawGray(bCanvasEl, frameB); });
  $effect(() => { drawDiff(diffCanvasEl, diff.diff); });
</script>

<div class="diff-panel" aria-label="Image differencing">
  <div class="dp-header">
    <span class="dp-title">Image differencing (offline)</span>
    <button class="dp-close" aria-label="Close differencing" onclick={() => onClose?.()}>×</button>
  </div>

  <div class="dp-epochs">
    <label>A
      <select aria-label="Epoch A" value={aIndex} onchange={(e) => onAChange?.(+e.currentTarget.value)}>
        {#each epochs as mjd, i (i)}<option value={i}>{i + 1}: MJD {mjd.toFixed(0)}</option>{/each}
      </select>
    </label>
    <label>B
      <select aria-label="Epoch B" value={bIndex} onchange={(e) => onBChange?.(+e.currentTarget.value)}>
        {#each epochs as mjd, i (i)}<option value={i}>{i + 1}: MJD {mjd.toFixed(0)}</option>{/each}
      </select>
    </label>
  </div>

  <div class="dp-canvases">
    <figure><canvas bind:this={aCanvasEl} width={TS} height={TS} aria-label="Epoch A frame"></canvas><figcaption>A</figcaption></figure>
    <figure><canvas bind:this={bCanvasEl} width={TS} height={TS} aria-label="Epoch B frame"></canvas><figcaption>B</figcaption></figure>
    <figure><canvas bind:this={diffCanvasEl} width={TS} height={TS} aria-label="Difference frame"></canvas><figcaption>B − A</figcaption></figure>
  </div>

  <div class="dp-transients" aria-label="Transient list">
    <div aria-label="Transient count">{transients.length} transient{transients.length === 1 ? '' : 's'} detected</div>
    {#each transients.slice(0, 6) as t, i (i)}
      <div class="dp-tr">
        ({t.x.toFixed(0)}, {t.y.toFixed(0)}) · σ={Math.abs(t.significance).toFixed(1)} · {t.peak >= 0 ? 'appeared/brighter' : 'faded'}
      </div>
    {/each}
  </div>
  <div class="dp-note">Synthetic ground truth · red = appeared, blue = faded</div>
</div>

<style>
  .diff-panel {
    background: rgba(12, 14, 22, 0.97);
    border: 1px solid rgba(120, 200, 255, 0.5);
    border-radius: 8px;
    padding: 8px 10px;
    color: #d8e2f0;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 300px;
  }
  .dp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .dp-title { color: #9cf; font-weight: 700; }
  .dp-close { background: none; border: none; color: #aaa; font-size: 18px; line-height: 1; cursor: pointer; }
  .dp-close:hover { color: #fff; }
  .dp-epochs { display: flex; gap: 12px; margin-bottom: 6px; }
  .dp-epochs select { background: #1a1a2e; color: #cef; border: 1px solid #345; border-radius: 4px; font: inherit; font-size: 10px; }
  .dp-canvases { display: flex; gap: 6px; justify-content: space-between; }
  .dp-canvases figure { margin: 0; text-align: center; }
  .dp-canvases canvas { width: 88px; height: 88px; image-rendering: pixelated; border: 1px solid #234; background: #000; }
  .dp-canvases figcaption { color: #89a; font-size: 9px; }
  .dp-transients { margin-top: 8px; max-height: 96px; overflow-y: auto; }
  .dp-tr { color: #bdf; }
  .dp-note { color: #778; font-size: 9px; margin-top: 6px; }
</style>
