<script lang="ts">
  /**
   * Multi-epoch + multi-wavelength browser for the OFFLINE synthetic base layer.
   * Time (MJD) and band (g/r/i/z/y) are independent axes; changing either drives
   * ImageViewer to re-synthesize tiles for that (band, mjd). Blink plays through
   * the epoch axis. Only shown while the offline base layer is active — it drives
   * SYNTHETIC data and is labelled as such.
   */
  import { mjdToIso } from '../types/image.js';
  import type { Band } from '../data/syntheticSky.js';

  let {
    epochs,
    bands,
    epochIndex = 0,
    band = 'r' as Band,
    playing = false,
    rate = 1.0,
    onEpochChange,
    onBandChange,
    onPlayStateChange,
    onFindTransient,
  }: {
    /** Epoch time axis (MJD), ascending. */
    epochs: readonly number[];
    /** Available bands (wavelength axis). */
    bands: readonly Band[];
    epochIndex?: number;
    band?: Band;
    playing?: boolean;
    /** Blink interval in seconds. */
    rate?: number;
    onEpochChange?: (index: number) => void;
    onBandChange?: (band: Band) => void;
    onPlayStateChange?: (playing: boolean) => void;
    /** Jump the view to the brightest demo transient and its peak epoch. */
    onFindTransient?: () => void;
  } = $props();

  let timerId: ReturnType<typeof setInterval> | undefined = $state(undefined);
  // Mutable ref so the setInterval closure reads the live index (Svelte 5 $state
  // is not reactive inside plain closures).
  const idxRef = { value: epochIndex };

  const nEpochs = $derived(epochs.length);
  const currentMjd = $derived(epochs[epochIndex] ?? epochs[0] ?? 0);
  const currentDate = $derived(mjdToIso(currentMjd));
  const canBack = $derived(epochIndex > 0);
  const canForward = $derived(epochIndex < nEpochs - 1);

  function setIndex(idx: number) {
    if (idx < 0 || idx >= nEpochs) return;
    epochIndex = idx;
    idxRef.value = idx;
    onEpochChange?.(idx);
  }

  function stepBack() {
    if (canBack) setIndex(epochIndex - 1);
  }
  function stepForward() {
    if (canForward) setIndex(epochIndex + 1);
  }

  function selectBand(b: Band) {
    if (b === band) return;
    band = b;
    onBandChange?.(b);
  }

  function startBlink() {
    if (nEpochs < 2) return;
    playing = true;
    idxRef.value = epochIndex;
    onPlayStateChange?.(true);
    timerId = setInterval(() => {
      // Wrap around the epoch axis so the transient loops.
      setIndex((idxRef.value + 1) % nEpochs);
    }, Math.max(100, rate * 1000));
  }

  function stopBlink() {
    playing = false;
    onPlayStateChange?.(false);
    if (timerId !== undefined) {
      clearInterval(timerId);
      timerId = undefined;
    }
  }

  function togglePlay() {
    if (playing) stopBlink();
    else startBlink();
  }

  function handleSlider(e: Event) {
    const t = e.currentTarget as HTMLInputElement;
    setIndex(parseInt(t.value, 10));
  }

  // Keep the setInterval closure's ref in sync with the prop so an external epoch
  // change (e.g. "Find a transient") is honoured by the next blink tick.
  $effect(() => {
    idxRef.value = epochIndex;
  });

  $effect(() => {
    return () => {
      if (timerId !== undefined) clearInterval(timerId);
    };
  });
</script>

<div class="offline-controls" role="region" aria-label="Offline synthetic epoch and band controls">
  <span class="section-label" title="These controls browse the bundled synthetic data cube">
    Synthetic cube
  </span>

  <div class="band-group" role="group" aria-label="Band">
    {#each bands as b (b)}
      <button
        class="band-btn"
        class:active={b === band}
        onclick={() => selectBand(b)}
        aria-pressed={b === band}
        aria-label={`Band ${b}`}
        title={`Wavelength band ${b}`}
      >{b}</button>
    {/each}
  </div>

  <div class="epoch-group">
    <button class="step" onclick={stepBack} disabled={!canBack} aria-label="Previous epoch" title="Previous epoch">⏮</button>
    <button class="play" onclick={togglePlay} disabled={nEpochs < 2} aria-label={playing ? 'Stop blink' : 'Play blink'} title={playing ? 'Stop blink' : 'Blink through epochs'}>{playing ? '⏸' : '▶'}</button>
    <button class="step" onclick={stepForward} disabled={!canForward} aria-label="Next epoch" title="Next epoch">⏭</button>
    <input
      type="range"
      class="epoch-slider"
      min="0"
      max={Math.max(0, nEpochs - 1)}
      value={epochIndex}
      oninput={handleSlider}
      aria-label="Epoch"
      title="Epoch (time)"
    />
    <span class="readout" aria-label="Current epoch">
      <span class="counter">{epochIndex + 1}/{nEpochs}</span>
      <span class="mjd">MJD {currentMjd.toFixed(0)}</span>
      <span class="date">{currentDate}</span>
    </span>
  </div>

  {#if onFindTransient}
    <button
      class="find-transient"
      onclick={() => onFindTransient?.()}
      aria-label="Find a transient"
      title="Jump to the brightest synthetic transient at its peak epoch — then blink to watch it fade"
    >◎ Find a transient</button>
  {/if}
</div>

<style>
  .offline-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    background: rgba(30, 20, 40, 0.88);
    border: 1px solid rgba(200, 140, 255, 0.35);
    border-radius: 6px;
    padding: 4px 10px;
    color: #dcd;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .section-label {
    color: #caa6e0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .band-group {
    display: inline-flex;
    gap: 2px;
  }

  .band-btn {
    background: #241a30;
    color: #b9a;
    border: 1px solid #443055;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 700;
    text-transform: lowercase;
  }

  .band-btn:hover {
    background: #322044;
    color: #edf;
  }

  .band-btn.active {
    background: #4a2f66;
    color: #fff;
    border-color: rgba(200, 140, 255, 0.8);
    box-shadow: 0 0 6px rgba(200, 140, 255, 0.5);
  }

  .epoch-group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .step,
  .play {
    background: #241a30;
    color: #b9a;
    border: 1px solid #443055;
    border-radius: 4px;
    padding: 2px 6px;
    cursor: pointer;
    font-size: 12px;
    min-width: 26px;
  }

  .step:hover:not(:disabled),
  .play:hover:not(:disabled) {
    background: #322044;
    color: #edf;
  }

  .step:disabled,
  .play:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .epoch-slider {
    width: 120px;
    accent-color: #c68cff;
    cursor: pointer;
  }

  .readout {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    white-space: nowrap;
  }

  .counter {
    color: #c9f;
  }
  .mjd {
    color: #9fc;
  }
  .date {
    color: #bbb;
  }

  .find-transient {
    background: #2a1f3a;
    color: #e8c8ff;
    border: 1px solid rgba(200, 140, 255, 0.5);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    white-space: nowrap;
  }

  .find-transient:hover {
    background: #3a2b52;
    color: #fff;
  }
</style>
