<script lang="ts">
  import { LSST_FILTERS, FILTER_BANDS, type FilterBand } from '../constants.js';

  interface CompositeChannels {
    r: FilterBand | null;
    g: FilterBand | null;
    b: FilterBand | null;
  }

  let {
    activeFilter = $bindable<FilterBand | null>(null),
    compositeMode = false,
    compositeChannels = { r: null, g: null, b: null } as CompositeChannels,
    onFilterChange,
    onCompositeChange,
  }: {
    activeFilter?: FilterBand | null;
    compositeMode?: boolean;
    compositeChannels?: CompositeChannels;
    onFilterChange?: (filter: FilterBand | null) => void;
    onCompositeChange?: (channels: CompositeChannels) => void;
  } = $props();

  let selectedCompositeChannel: 'r' | 'g' | 'b' | null = $state(null);

  function selectFilter(band: FilterBand) {
    if (compositeMode && selectedCompositeChannel) {
      // Assign filter to the selected composite channel
      const updated = { ...compositeChannels, [selectedCompositeChannel]: band };
      compositeChannels = updated;
      onCompositeChange?.(updated);
      selectedCompositeChannel = null;
    } else if (!compositeMode) {
      activeFilter = activeFilter === band ? null : band;
      onFilterChange?.(activeFilter);
    }
  }

  function toggleCompositeMode() {
    compositeMode = !compositeMode;
    if (!compositeMode) {
      selectedCompositeChannel = null;
    }
  }

  function selectCompositeChannel(channel: 'r' | 'g' | 'b') {
    selectedCompositeChannel = selectedCompositeChannel === channel ? null : channel;
  }

  function clearComposite() {
    compositeChannels = { r: null, g: null, b: null };
    onCompositeChange?.(compositeChannels);
  }

  const compositeAssigned = $derived(
    compositeChannels.r !== null || compositeChannels.g !== null || compositeChannels.b !== null
  );
</script>

<div class="filter-selector" role="group" aria-label="Filter selection">
  <div class="mode-toggle">
    <button
      class="mode-btn"
      class:active={!compositeMode}
      onclick={() => { if (compositeMode) toggleCompositeMode(); }}
      title="Single filter mode"
      aria-label="Single filter mode"
      aria-pressed={!compositeMode}
    >
      Single
    </button>
    <button
      class="mode-btn"
      class:active={compositeMode}
      onclick={() => { if (!compositeMode) toggleCompositeMode(); }}
      title="RGB composite mode"
      aria-label="RGB composite mode"
      aria-pressed={compositeMode}
    >
      RGB
    </button>
  </div>

  {#if compositeMode}
    <div class="composite-channels" role="group" aria-label="RGB channel assignment">
      {#each ['r', 'g', 'b'] as channel}
        {@const ch = channel as 'r' | 'g' | 'b'}
        <button
          class="channel-btn channel-{ch}"
          class:selected={selectedCompositeChannel === ch}
          class:assigned={compositeChannels[ch] !== null}
          onclick={() => selectCompositeChannel(ch)}
          title="Select {ch.toUpperCase()} channel (click filter to assign)"
          aria-label="{ch.toUpperCase()} channel"
          aria-pressed={selectedCompositeChannel === ch}
        >
          {ch.toUpperCase()}: {compositeChannels[ch] ?? '—'}
        </button>
      {/each}
      {#if compositeAssigned}
        <button
          class="clear-btn"
          onclick={clearComposite}
          title="Clear all channel assignments"
          aria-label="Clear composite"
        >
          ✕
        </button>
      {/if}
    </div>
  {/if}

  <div class="filter-buttons" role="group" aria-label="Filter bands">
    {#each LSST_FILTERS as filter}
      {@const isActive = compositeMode
        ? selectedCompositeChannel !== null
        : activeFilter === filter.name}
      <button
        class="filter-btn"
        class:active={isActive}
        style="--filter-color: {filter.color}"
        onclick={() => selectFilter(filter.name as FilterBand)}
        title="{filter.description}"
        aria-label="{filter.name} filter"
        aria-pressed={isActive}
      >
        <span class="filter-letter" style="color: {filter.color}">{filter.name}</span>
        <span class="filter-wavelength">{filter.wavelength} nm</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .filter-selector {
    padding: 6px 12px;
    background: #1a1a2e;
    border-bottom: 1px solid #333;
    color: #e0e0e0;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .mode-toggle {
    display: flex;
    border: 1px solid #444;
    border-radius: 4px;
    overflow: hidden;
  }

  .mode-btn {
    background: #2a2a3e;
    color: #aaa;
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .mode-btn:first-child {
    border-right: 1px solid #444;
  }

  .mode-btn.active {
    background: #3a3a6e;
    color: #fff;
  }

  .mode-btn:hover:not(.active) {
    background: #333;
    color: #ddd;
  }

  .composite-channels {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .channel-btn {
    background: #2a2a3e;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 3px 8px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    min-width: 60px;
    text-align: center;
  }

  .channel-btn.channel-r {
    color: #f66;
    border-color: #644;
  }

  .channel-btn.channel-g {
    color: #6f6;
    border-color: #464;
  }

  .channel-btn.channel-b {
    color: #66f;
    border-color: #446;
  }

  .channel-btn.selected {
    box-shadow: 0 0 6px currentColor;
    border-color: currentColor;
  }

  .channel-btn.assigned {
    background: #2a2a4e;
  }

  .channel-btn:hover {
    opacity: 0.85;
  }

  .clear-btn {
    background: #3a2020;
    color: #f88;
    border: 1px solid #644;
    border-radius: 4px;
    padding: 3px 6px;
    cursor: pointer;
    font-size: 11px;
  }

  .clear-btn:hover {
    background: #4a2020;
  }

  .filter-buttons {
    display: flex;
    gap: 4px;
  }

  .filter-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    background: #2a2a3e;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    min-width: 44px;
    transition: border-color 0.15s, background 0.15s;
  }

  .filter-btn:hover {
    background: #333;
    border-color: var(--filter-color, #666);
  }

  .filter-btn.active {
    background: #2a2a5e;
    border-color: var(--filter-color, #6a6aff);
    box-shadow: 0 0 6px var(--filter-color, #6a6aff);
  }

  .filter-letter {
    font-size: 16px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .filter-wavelength {
    font-size: 9px;
    color: #888;
    white-space: nowrap;
  }
</style>
