<script lang="ts">
  import type { Epoch } from '../types/image.js';
  import { mjdToIso } from '../types/image.js';

  let {
    epochs = [] as Epoch[],
    currentIndex = 0,
    playing = false,
    interval = 1000,
    onEpochChange,
    onPlayStateChange,
  }: {
    epochs?: Epoch[];
    currentIndex?: number;
    playing?: boolean;
    interval?: number;
    onEpochChange?: (index: number, epoch: Epoch) => void;
    onPlayStateChange?: (playing: boolean) => void;
  } = $props();

  let timerId: ReturnType<typeof setInterval> | undefined = $state(undefined);
  // Mutable ref for use in setInterval closures (Svelte 5 $state not reactive in closures)
  let playbackIndex = { value: currentIndex };

  const currentEpoch = $derived(epochs[currentIndex]);
  const hasEpochs = $derived(epochs.length > 0);
  const canStepBack = $derived(currentIndex > 0);
  const canStepForward = $derived(currentIndex < epochs.length - 1);

  function setIndex(idx: number) {
    if (idx < 0 || idx >= epochs.length) return;
    const epoch = epochs[idx];
    if (!epoch) return;
    currentIndex = idx;
    playbackIndex.value = idx;
    onEpochChange?.(idx, epoch);
  }

  function stepForward() {
    if (canStepForward) setIndex(currentIndex + 1);
  }

  function stepBack() {
    if (canStepBack) setIndex(currentIndex - 1);
  }

  function togglePlay() {
    if (playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function startPlayback() {
    if (epochs.length === 0) return;
    playing = true;
    playbackIndex.value = currentIndex;
    onPlayStateChange?.(true);
    timerId = setInterval(() => {
      if (playbackIndex.value < epochs.length - 1) {
        setIndex(playbackIndex.value + 1);
      } else {
        stopPlayback();
      }
    }, interval);
  }

  function stopPlayback() {
    playing = false;
    onPlayStateChange?.(false);
    if (timerId !== undefined) {
      clearInterval(timerId);
      timerId = undefined;
    }
  }

  function handleSliderInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    setIndex(parseInt(target.value, 10));
  }

  function handleIntervalInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const newInterval = parseInt(target.value, 10);
    if (newInterval >= 100) {
      interval = newInterval;
      if (playing) {
        stopPlayback();
        startPlayback();
      }
    }
  }

  $effect(() => {
    return () => {
      if (timerId !== undefined) {
        clearInterval(timerId);
      }
    };
  });

  const displayMjd = $derived(currentEpoch?.mjd ?? 0);
  const displayDate = $derived(currentEpoch ? mjdToIso(currentEpoch.mjd) : '—');
  const displayFilter = $derived(currentEpoch?.filter ?? '—');
  const sliderMax = $derived(Math.max(0, epochs.length - 1));
</script>

<div class="time-slider" role="region" aria-label="Time series controls">
  <div class="controls">
    <button
      class="step-btn"
      onclick={stepBack}
      disabled={!canStepBack}
      title="Previous epoch"
      aria-label="Previous epoch"
    >
      ⏮
    </button>

    <button
      class="play-btn"
      onclick={togglePlay}
      disabled={!hasEpochs}
      title={playing ? 'Pause' : 'Play'}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {playing ? '⏸' : '▶'}
    </button>

    <button
      class="step-btn"
      onclick={stepForward}
      disabled={!canStepForward}
      title="Next epoch"
      aria-label="Next epoch"
    >
      ⏭
    </button>

    <input
      type="range"
      class="slider"
      min="0"
      max={sliderMax}
      value={currentIndex}
      oninput={handleSliderInput}
      disabled={!hasEpochs}
      title="Epoch index"
      aria-label="Epoch slider"
    />

    <div class="info">
      <span class="epoch-counter" title="Current epoch / total">
        {currentIndex + 1} / {epochs.length}
      </span>
      <span class="mjd" title="Modified Julian Date">
        MJD {displayMjd.toFixed(2)}
      </span>
      <span class="date" title="Observation date">{displayDate}</span>
      <span class="filter" title="Observation filter">{displayFilter}</span>
    </div>

    <div class="interval-control">
      <label for="interval-input" title="Playback interval in milliseconds">Delay</label>
      <input
        id="interval-input"
        type="number"
        class="interval-input"
        value={interval}
        min="100"
        max="5000"
        step="100"
        oninput={handleIntervalInput}
        title="Playback interval (ms)"
        aria-label="Playback interval in milliseconds"
      />
      <span class="unit">ms</span>
    </div>
  </div>
</div>

<style>
  .time-slider {
    padding: 6px 12px;
    background: #1a1a2e;
    border-bottom: 1px solid #333;
    color: #e0e0e0;
    font-size: 12px;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .step-btn,
  .play-btn {
    background: #2a2a3e;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 14px;
    min-width: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .step-btn:hover:not(:disabled),
  .play-btn:hover:not(:disabled) {
    background: #3a3a5e;
    color: #fff;
    border-color: #6a6aff;
  }

  .step-btn:disabled,
  .play-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .slider {
    flex: 1;
    min-width: 100px;
    accent-color: #6a6aff;
    cursor: pointer;
  }

  .slider:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .info {
    display: flex;
    gap: 10px;
    align-items: center;
    font-family: 'Courier New', monospace;
    white-space: nowrap;
  }

  .epoch-counter {
    color: #8cf;
  }

  .mjd {
    color: #8fc;
  }

  .date {
    color: #ccc;
  }

  .filter {
    color: #fc8;
    font-weight: 600;
  }

  .interval-control {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .interval-control label {
    color: #aaa;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .interval-input {
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    width: 60px;
    text-align: right;
  }

  .interval-input:focus {
    outline: none;
    border-color: #6a6aff;
  }

  .unit {
    color: #888;
    font-size: 11px;
  }
</style>
