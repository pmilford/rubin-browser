<script lang="ts">
  import type { ScalingFunction, ColorMapName, InterpolationMethod, Epoch } from '../types/image.js';
  import type { FilterBand } from '../constants.js';
  import type { SurveyInfo } from '../constants.js';
  import FilterSelector from './FilterSelector.svelte';
  import SurveySelector from './SurveySelector.svelte';
  import BlinkController from './BlinkController.svelte';
  import TimeSlider from './TimeSlider.svelte';
  import Histogram from './Histogram.svelte';
  import PixelReadout from './PixelReadout.svelte';

  let {
    open = false,
    scaling = 'linear' as ScalingFunction,
    colorMap = 'grayscale' as ColorMapName,
    interpolation = 'bilinear' as InterpolationMethod,
    invert = false,
    epochs = [] as Epoch[],
    currentEpochIndex = 0,
    isPlaying = false,
    activeFilter = null as FilterBand | null,
    compositeMode = false,
    compositeChannels = { r: null, g: null, b: null } as { r: FilterBand | null; g: FilterBand | null; b: FilterBand | null },
    surveyOverlays = [] as { survey: SurveyInfo; opacity: number }[],
    blinkTargets = [] as { id: string; label: string }[],
    blinkIndex = 0,
    blinkPlaying = false,
    blinkRate = 1.0,
    onScalingChange,
    onColorMapChange,
    onInterpolationChange,
    onInvertChange,
    onEpochChange,
    onPlayStateChange,
    onFilterChange,
    onCompositeChange,
    onOverlayAdd,
    onOverlayRemove,
    onOpacityChange,
    onBlinkTargetChange,
    onBlinkPlayStateChange,
    onBlinkRateChange,
    onClose,
  }: {
    open?: boolean;
    scaling?: ScalingFunction;
    colorMap?: ColorMapName;
    interpolation?: InterpolationMethod;
    invert?: boolean;
    epochs?: Epoch[];
    currentEpochIndex?: number;
    isPlaying?: boolean;
    activeFilter?: FilterBand | null;
    compositeMode?: boolean;
    compositeChannels?: { r: FilterBand | null; g: FilterBand | null; b: FilterBand | null };
    surveyOverlays?: { survey: SurveyInfo; opacity: number }[];
    blinkTargets?: { id: string; label: string }[];
    blinkIndex?: number;
    blinkPlaying?: boolean;
    blinkRate?: number;
    onScalingChange?: (s: ScalingFunction) => void;
    onColorMapChange?: (c: ColorMapName) => void;
    onInterpolationChange?: (i: InterpolationMethod) => void;
    onInvertChange?: (v: boolean) => void;
    onEpochChange?: (index: number, epoch: Epoch) => void;
    onPlayStateChange?: (playing: boolean) => void;
    onFilterChange?: (filter: FilterBand | null) => void;
    onCompositeChange?: (channels: { r: FilterBand | null; g: FilterBand | null; b: FilterBand | null }) => void;
    onOverlayAdd?: (survey: SurveyInfo) => void;
    onOverlayRemove?: (surveyId: string) => void;
    onOpacityChange?: (surveyId: string, opacity: number) => void;
    onBlinkTargetChange?: (index: number) => void;
    onBlinkPlayStateChange?: (playing: boolean) => void;
    onBlinkRateChange?: (rate: number) => void;
    onClose?: () => void;
  } = $props();

  const scalingOptions: ScalingFunction[] = ['linear', 'log', 'sqrt', 'asinh', 'sinh', 'mtf', 'histogram', 'zscale', 'percentile'];
  const colorMapOptions: ColorMapName[] = ['grayscale', 'viridis', 'plasma', 'inferno', 'hot', 'cool', 'red', 'green', 'blue'];
  const interpolationOptions: InterpolationMethod[] = ['nearest', 'bilinear', 'bicubic', 'lanczos'];

  let activeSection = $state<string | null>('display');

  function toggleSection(id: string) {
    activeSection = activeSection === id ? null : id;
  }
</script>

{#if open}
  <div class="side-panel-overlay" onclick={() => onClose?.()} role="presentation"></div>
  <aside class="side-panel" role="complementary" aria-label="Controls panel">
    <div class="panel-header">
      <h3>Controls</h3>
      <button class="close-button" onclick={() => onClose?.()} aria-label="Close panel" title="Close panel (Escape)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="panel-body">
      <!-- Display settings section -->
      <section class="panel-section">
        <button
          class="section-toggle"
          onclick={() => toggleSection('display')}
          aria-expanded={activeSection === 'display'}
        >
          <span class="toggle-arrow" class:open={activeSection === 'display'}>▶</span>
          Display Settings
        </button>
        {#if activeSection === 'display'}
          <div class="section-content">
            <div class="control-row">
              <label for="scaling-select">Scaling</label>
              <select
                id="scaling-select"
                value={scaling}
                onchange={(e) => onScalingChange?.(e.currentTarget.value as ScalingFunction)}
              >
                {#each scalingOptions as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            </div>
            <div class="control-row">
              <label for="colormap-select">Color Map</label>
              <select
                id="colormap-select"
                value={colorMap}
                onchange={(e) => onColorMapChange?.(e.currentTarget.value as ColorMapName)}
              >
                {#each colorMapOptions as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            </div>
            <div class="control-row">
              <label for="interp-select">Interpolation</label>
              <select
                id="interp-select"
                value={interpolation}
                onchange={(e) => onInterpolationChange?.(e.currentTarget.value as InterpolationMethod)}
              >
                {#each interpolationOptions as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            </div>
            <div class="control-row">
              <label for="invert-toggle">Invert</label>
              <input
                id="invert-toggle"
                type="checkbox"
                checked={invert}
                onchange={(e) => onInvertChange?.(e.currentTarget.checked)}
              />
            </div>
          </div>
        {/if}
      </section>

      <!-- Filter section -->
      <section class="panel-section">
        <button
          class="section-toggle"
          onclick={() => toggleSection('filter')}
          aria-expanded={activeSection === 'filter'}
        >
          <span class="toggle-arrow" class:open={activeSection === 'filter'}>▶</span>
          Filters
        </button>
        {#if activeSection === 'filter'}
          <div class="section-content">
            <FilterSelector
              bind:activeFilter={activeFilter}
              {compositeMode}
              {compositeChannels}
              {onFilterChange}
              {onCompositeChange}
            />
          </div>
        {/if}
      </section>

      <!-- Survey overlays section -->
      <section class="panel-section">
        <SurveySelector
          overlays={surveyOverlays}
          {onOverlayAdd}
          {onOverlayRemove}
          {onOpacityChange}
        />
      </section>

      <!-- Time series section -->
      {#if epochs.length > 0}
        <section class="panel-section">
          <button
            class="section-toggle"
            onclick={() => toggleSection('time')}
            aria-expanded={activeSection === 'time'}
          >
            <span class="toggle-arrow" class:open={activeSection === 'time'}>▶</span>
            Time Series
          </button>
          {#if activeSection === 'time'}
            <div class="section-content">
              <TimeSlider
                {epochs}
                currentIndex={currentEpochIndex}
                playing={isPlaying}
                interval={1000}
                {onEpochChange}
                {onPlayStateChange}
              />
            </div>
          {/if}
        </section>
      {/if}

      <!-- Blink section -->
      {#if blinkTargets.length > 0}
        <section class="panel-section">
          <button
            class="section-toggle"
            onclick={() => toggleSection('blink')}
            aria-expanded={activeSection === 'blink'}
          >
            <span class="toggle-arrow" class:open={activeSection === 'blink'}>▶</span>
            Blink
          </button>
          {#if activeSection === 'blink'}
            <div class="section-content">
              <BlinkController
                targets={blinkTargets}
                currentIndex={blinkIndex}
                playing={blinkPlaying}
                rate={blinkRate}
                onTargetChange={onBlinkTargetChange}
                onPlayStateChange={onBlinkPlayStateChange}
                onRateChange={onBlinkRateChange}
              />
            </div>
          {/if}
        </section>
      {/if}

      <!-- Pixel readout -->
      <section class="panel-section">
        <button
          class="section-toggle"
          onclick={() => toggleSection('pixel')}
          aria-expanded={activeSection === 'pixel'}
        >
          <span class="toggle-arrow" class:open={activeSection === 'pixel'}>▶</span>
          Pixel Readout
        </button>
        {#if activeSection === 'pixel'}
          <div class="section-content">
            <PixelReadout ra={0} dec={0} pixelValue={0} pixelX={0} pixelY={0} visible={true} />
          </div>
        {/if}
      </section>
    </div>
  </aside>
{/if}

<style>
  .side-panel-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 90;
  }

  .side-panel {
    position: fixed;
    top: 0;
    left: 0;
    width: 300px;
    max-width: 90vw;
    height: 100vh;
    background: #1a1a2e;
    border-right: 1px solid #333;
    display: flex;
    flex-direction: column;
    z-index: 100;
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(0);
    }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #333;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #e0e0e0;
  }

  .close-button {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    border-radius: 4px;
  }

  .close-button:hover {
    color: #fff;
    background: #333;
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .panel-section {
    border-bottom: 1px solid #2a2a3e;
  }

  .section-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    color: #ccc;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }

  .section-toggle:hover {
    background: #2a2a3e;
    color: #fff;
  }

  .toggle-arrow {
    font-size: 10px;
    transition: transform 0.15s ease;
    color: #666;
  }

  .toggle-arrow.open {
    transform: rotate(90deg);
  }

  .section-content {
    padding: 4px 16px 12px;
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .control-row label {
    font-size: 12px;
    font-weight: 500;
    color: #aaa;
    min-width: 80px;
  }

  .control-row select {
    flex: 1;
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
  }

  .control-row select:hover {
    border-color: #6a6aff;
  }
</style>
