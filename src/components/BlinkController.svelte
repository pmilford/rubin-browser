<script lang="ts">
  interface BlinkTarget {
    id: string;
    label: string;
  }

  let {
    targets = [] as BlinkTarget[],
    currentIndex = 0,
    playing = false,
    rate = 1.0,
    onTargetChange,
    onPlayStateChange,
    onRateChange,
  }: {
    targets?: BlinkTarget[];
    currentIndex?: number;
    playing?: boolean;
    rate?: number;
    onTargetChange?: (index: number, target: BlinkTarget) => void;
    onPlayStateChange?: (playing: boolean) => void;
    onRateChange?: (rate: number) => void;
  } = $props();

  let timerId: ReturnType<typeof setInterval> | undefined = $state(undefined);
  // Mutable ref for setInterval closure
  let blinkIndex = { value: currentIndex };

  const hasTargets = $derived(targets.length > 0);
  const canStepBack = $derived(currentIndex > 0);
  const canStepForward = $derived(currentIndex < targets.length - 1);
  const currentTarget = $derived(targets[currentIndex] ?? null);

  function setIndex(idx: number) {
    if (idx < 0 || idx >= targets.length) return;
    const target = targets[idx];
    if (!target) return;
    currentIndex = idx;
    blinkIndex.value = idx;
    onTargetChange?.(idx, target);
  }

  function stepForward() {
    if (canStepForward) setIndex(currentIndex + 1);
  }

  function stepBack() {
    if (canStepBack) setIndex(currentIndex - 1);
  }

  function togglePlay() {
    if (playing) {
      stopBlink();
    } else {
      startBlink();
    }
  }

  function startBlink() {
    if (targets.length === 0) return;
    playing = true;
    blinkIndex.value = currentIndex;
    onPlayStateChange?.(true);
    timerId = setInterval(() => {
      // Cycle: advance to next, wrap around
      const next = (blinkIndex.value + 1) % targets.length;
      setIndex(next);
    }, rate * 1000);
  }

  function stopBlink() {
    playing = false;
    onPlayStateChange?.(false);
    if (timerId !== undefined) {
      clearInterval(timerId);
      timerId = undefined;
    }
  }

  function handleRateInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const newRate = parseFloat(target.value);
    if (newRate >= 0.2 && newRate <= 5) {
      rate = newRate;
      onRateChange?.(newRate);
      if (playing) {
        stopBlink();
        startBlink();
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      togglePlay();
    }
  }

  $effect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      if (timerId !== undefined) {
        clearInterval(timerId);
      }
    };
  });
</script>

<div class="blink-controller" role="region" aria-label="Blink controls">
  <div class="controls">
    <button
      class="step-btn"
      onclick={stepBack}
      disabled={!canStepBack}
      title="Previous target"
      aria-label="Blink step back"
    >
      ◀
    </button>

    <button
      class="play-btn"
      onclick={togglePlay}
      disabled={!hasTargets}
      title={playing ? 'Stop blink (B)' : 'Start blink (B)'}
      aria-label={playing ? 'Stop blink' : 'Start blink'}
    >
      {playing ? '⏹' : '▶'}
    </button>

    <button
      class="step-btn"
      onclick={stepForward}
      disabled={!canStepForward}
      title="Next target"
      aria-label="Blink step forward"
    >
      ▶
    </button>

    <div class="rate-control">
      <label for="blink-rate" title="Blink rate in seconds">Rate</label>
      <input
        id="blink-rate"
        type="range"
        min="0.2"
        max="5"
        step="0.1"
        value={rate}
        oninput={handleRateInput}
        title="Blink interval: {rate.toFixed(1)}s"
        aria-label="Blink rate"
      />
      <span class="rate-value">{rate.toFixed(1)}s</span>
    </div>

    <div class="info">
      {#if hasTargets}
        <span class="target-counter" title="Current target / total">
          {currentIndex + 1} / {targets.length}
        </span>
        {#if currentTarget}
          <span class="target-label" title="Current target">{currentTarget.label}</span>
        {/if}
      {:else}
        <span class="no-targets">No targets</span>
      {/if}
    </div>
  </div>

  {#if hasTargets}
    <div class="target-list" role="list" aria-label="Blink targets">
      {#each targets as target, i}
        <button
          class="target-item"
          class:active={i === currentIndex}
          onclick={() => setIndex(i)}
          role="listitem"
          aria-label="Target: {target.label}"
          aria-current={i === currentIndex ? 'true' : undefined}
        >
          {target.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .blink-controller {
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
    font-size: 12px;
    min-width: 28px;
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

  .rate-control {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .rate-control label {
    color: #aaa;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .rate-control input[type="range"] {
    width: 80px;
    accent-color: #6a6aff;
    cursor: pointer;
  }

  .rate-value {
    color: #8cf;
    font-family: 'Courier New', monospace;
    min-width: 30px;
  }

  .info {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-left: auto;
    font-family: 'Courier New', monospace;
  }

  .target-counter {
    color: #8cf;
  }

  .target-label {
    color: #fc8;
    font-weight: 600;
  }

  .no-targets {
    color: #666;
    font-style: italic;
  }

  .target-list {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    flex-wrap: wrap;
  }

  .target-item {
    background: #2a2a3e;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }

  .target-item:hover {
    background: #333;
    color: #ddd;
  }

  .target-item.active {
    background: #3a3a6e;
    color: #fff;
    border-color: #6a6aff;
  }
</style>
