<script lang="ts">
  /**
   * Visit-image BLINK panel (feature 136). Plays a real DP1 multi-epoch
   * visit-image time series (from `src/api/visitImageSeries.ts`) as a light-curve
   * movie: it renders the CURRENT epoch's decoded FITS cutout to a canvas and lets
   * the user scrub epochs with a slider or auto-advance with play/pause. The whole
   * point is that the frame CHANGES with time — the displayed MJD + band and the
   * canvas pixels both track the selected epoch.
   *
   * Self-contained + presentational: it OWNS its epoch index / play state but takes
   * the decoded `epochs` (+ loading/error flags) as props and reports close via a
   * callback, so it drops straight into TileViewer behind a toggle. All image maths
   * is the pure, tested `renderCutout` (src/utils/cutoutRender.ts) — no rendering
   * logic is duplicated here.
   */
  import type { EpochImage } from '../api/visitImageSeries.js';
  import { renderCutout } from '../utils/cutoutRender.js';

  let {
    epochs = [],
    loading = false,
    error = null,
    truncated = false,
    totalEpochs = 0,
    failedEpochs = 0,
    rate = 1.0,
    onClose,
  }: {
    /** Decoded blink frames, ascending by MJD (from `fetchVisitImageSeries`). */
    epochs?: EpochImage[];
    /** True while the series is being fetched (distinct from empty). */
    loading?: boolean;
    /** A fetch error message to surface, or null. */
    error?: string | null;
    /** True when more epochs existed than were fetched (from the fetch result). */
    truncated?: boolean;
    /** Total epochs discovered before the display cap (from the fetch result). */
    totalEpochs?: number;
    /** How many capped epochs failed their cutout and were skipped. */
    failedEpochs?: number;
    /** Seconds between auto-advanced frames while playing. */
    rate?: number;
    /** Called when the user closes the panel. */
    onClose?: () => void;
  } = $props();

  let index = $state(0);
  let playing = $state(false);
  let timerId: ReturnType<typeof setInterval> | undefined;

  const hasEpochs = $derived(epochs.length > 0);
  // Clamp so a shrinking `epochs` prop never indexes past the end.
  const safeIndex = $derived(hasEpochs ? Math.min(index, epochs.length - 1) : 0);
  const current = $derived(hasEpochs ? (epochs[safeIndex] ?? null) : null);

  // Pure render of the CURRENT frame → RGBA. Recomputes whenever the epoch
  // changes, so the canvas genuinely tracks the selected time (not a static frame).
  const rendered = $derived(current ? renderCutout(current.image, { scale: 'asinh', colormap: 'grayscale' }) : null);

  let canvasEl: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    const r = rendered;
    const ctx = canvasEl?.getContext('2d');
    if (!ctx || !r) return;
    ctx.putImageData(new ImageData(r.rgba, r.width, r.height), 0, 0);
  });

  function stop() {
    playing = false;
    if (timerId !== undefined) {
      clearInterval(timerId);
      timerId = undefined;
    }
  }

  function start() {
    if (!hasEpochs) return;
    playing = true;
    timerId = setInterval(() => {
      // Advance with wraparound, in terms of the clamped index.
      index = (safeIndex + 1) % epochs.length;
    }, Math.max(0.2, rate) * 1000);
  }

  function togglePlay() {
    if (playing) stop();
    else start();
  }

  function onSlider(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v)) index = v;
  }

  // Clean up the timer on unmount (mirrors BlinkController).
  $effect(() => () => stop());

  /** Format an MJD for the readout. */
  function fmtMjd(mjd: number): string {
    return Number.isFinite(mjd) ? mjd.toFixed(4) : '—';
  }
</script>

<div class="vib-panel" aria-label="Visit image blink">
  <div class="vib-header">
    <span class="vib-title">Visit-image time series</span>
    <button class="vib-close" aria-label="Close visit-image blink" onclick={() => onClose?.()}>×</button>
  </div>

  {#if loading}
    <div class="vib-state vib-loading" aria-label="Visit image blink loading">
      Loading visit-image epochs…
    </div>
  {:else if error}
    <div class="vib-state vib-error" aria-label="Visit image blink error">
      {error}
    </div>
  {:else if !hasEpochs}
    <div class="vib-state vib-empty" aria-label="Visit image blink empty">
      No visit-image epochs cover this position.
    </div>
  {:else}
    <div class="vib-canvas-wrap">
      <canvas
        bind:this={canvasEl}
        width={current?.image.width ?? 1}
        height={current?.image.height ?? 1}
        class="vib-canvas"
        aria-label="Visit image frame"
      ></canvas>
    </div>

    <div class="vib-readout" aria-label="Visit image epoch readout">
      <span class="vib-counter">epoch {safeIndex + 1} / {epochs.length}</span>
      <span class="vib-mjd">MJD {fmtMjd(current?.mjd ?? NaN)}</span>
      <span class="vib-band">band {current?.band ?? '—'}</span>
    </div>

    <div class="vib-controls">
      <button
        class="vib-play"
        aria-label="Play/pause visit-image blink"
        aria-pressed={playing}
        title={playing ? 'Pause blink' : 'Play blink'}
        onclick={togglePlay}
      >{playing ? '⏸' : '▶'}</button>
      <input
        class="vib-slider"
        type="range"
        min="0"
        max={epochs.length - 1}
        step="1"
        value={safeIndex}
        aria-label="Visit image epoch"
        oninput={onSlider}
      />
    </div>

    {#if truncated || failedEpochs > 0}
      <div class="vib-note" aria-label="Visit image blink note">
        {#if truncated}Showing {epochs.length} of {totalEpochs} epochs (capped).{/if}
        {#if failedEpochs > 0} {failedEpochs} epoch{failedEpochs === 1 ? '' : 's'} failed to load.{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .vib-panel {
    background: rgba(12, 14, 22, 0.97);
    border: 1px solid rgba(120, 200, 255, 0.5);
    border-radius: 8px;
    padding: 8px 10px;
    color: #d8e2f0;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 300px;
  }
  .vib-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .vib-title { color: #9cf; font-weight: 700; }
  .vib-close { background: none; border: none; color: #aaa; font-size: 18px; line-height: 1; cursor: pointer; }
  .vib-close:hover { color: #fff; }
  .vib-state { padding: 18px 8px; text-align: center; }
  .vib-loading { color: #9ab; }
  .vib-error { color: #f88; }
  .vib-empty { color: #778; }
  .vib-canvas-wrap { width: 280px; height: 280px; }
  .vib-canvas {
    width: 280px;
    height: 280px;
    image-rendering: pixelated;
    border: 1px solid #234;
    background: #000;
    display: block;
  }
  .vib-readout { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; color: #bdf; }
  .vib-mjd { color: #cef; }
  .vib-band { color: #fc8; }
  .vib-controls { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .vib-play {
    background: #2a2a3e;
    color: #9cf;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  .vib-play:hover { background: #3a3a5e; color: #fff; border-color: #6a6aff; }
  .vib-slider { flex: 1; accent-color: #6cf; cursor: pointer; }
  .vib-note { color: #778; font-size: 9px; margin-top: 6px; }
</style>
