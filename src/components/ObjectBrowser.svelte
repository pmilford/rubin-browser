<script lang="ts">
  import {
    ALL_OBJECTS,
    OBJECT_CATEGORIES,
    OBJECT_TYPES,
    OBJECT_TYPE_LABELS,
    searchObjects,
    type AstroObject,
    type ObjectCategory,
    type ObjectType,
  } from '../data/objects.js';

  let {
    onObjectSelect,
  }: {
    onObjectSelect?: (object: AstroObject) => void;
  } = $props();

  // Max rows rendered at once — 3000 objects can't all be DOM buttons. The list
  // is sorted brightest-first and capped; the true filtered total is always shown
  // ("showing X of Y") so nothing is hidden silently.
  const RENDER_CAP = 200;

  let expanded = $state(false);
  let searchQuery = $state('');
  let selectedCategory = $state<ObjectCategory | 'All'>('All');
  let selectedType = $state<ObjectType | 'All'>('All');
  // Magnitude upper bound (fainter = larger). Default admits everything.
  const MAG_MIN = -2;
  const MAG_MAX = 16;
  let magLimit = $state(MAG_MAX);

  // Static counts for the filter dropdowns.
  const categoryCounts = OBJECT_CATEGORIES.map((c) => ({
    c,
    n: ALL_OBJECTS.filter((o) => o.category === c).length,
  }));
  const typeCounts = OBJECT_TYPES.map((t) => ({
    t,
    n: ALL_OBJECTS.filter((o) => o.type === t).length,
  })).filter((x) => x.n > 0);

  // Full filtered + sorted set (brightest first). This is the TRUE total.
  const filteredAll = $derived.by(() => {
    let objects = searchQuery.trim() ? searchObjects(searchQuery) : ALL_OBJECTS;
    if (selectedCategory !== 'All') objects = objects.filter((o) => o.category === selectedCategory);
    if (selectedType !== 'All') objects = objects.filter((o) => o.type === selectedType);
    objects = objects.filter((o) => o.magnitude <= magLimit);
    return [...objects].sort((a, b) => a.magnitude - b.magnitude);
  });

  // Only the first RENDER_CAP are turned into DOM rows.
  const visibleObjects = $derived(filteredAll.slice(0, RENDER_CAP));
  const totalCount = $derived(filteredAll.length);
  const isCapped = $derived(totalCount > RENDER_CAP);

  function toggleExpanded() {
    expanded = !expanded;
  }

  function selectObject(obj: AstroObject) {
    onObjectSelect?.(obj);
  }

  function formatMagnitude(mag: number): string {
    return `m${mag.toFixed(1)}`;
  }
</script>

<div class="object-browser" role="region" aria-label="Object browser">
  <button
    class="toggle-btn"
    onclick={toggleExpanded}
    aria-expanded={expanded}
    aria-label="Toggle object browser"
    title="Toggle object browser panel"
  >
    <span class="toggle-icon">{expanded ? '▼' : '▶'}</span>
    <span class="toggle-label">Object Browser</span>
    <span class="object-count">({totalCount.toLocaleString()})</span>
  </button>

  {#if expanded}
    <div class="browser-content">
      <div class="browser-controls">
        <input
          type="text"
          class="search-input"
          placeholder="Search objects..."
          bind:value={searchQuery}
          aria-label="Search objects"
        />
        <select class="filter-select" bind:value={selectedCategory} aria-label="Filter by catalog">
          <option value="All">All catalogs</option>
          {#each categoryCounts as { c, n } (c)}
            <option value={c}>{c} ({n.toLocaleString()})</option>
          {/each}
        </select>
        <select class="filter-select" bind:value={selectedType} aria-label="Filter by type">
          <option value="All">All types</option>
          {#each typeCounts as { t, n } (t)}
            <option value={t}>{OBJECT_TYPE_LABELS[t]} ({n.toLocaleString()})</option>
          {/each}
        </select>
      </div>

      <div class="mag-control">
        <label for="mag-limit">Brighter than</label>
        <input
          id="mag-limit"
          type="range"
          min={MAG_MIN}
          max={MAG_MAX}
          step="0.5"
          bind:value={magLimit}
          aria-label="Magnitude limit"
        />
        <span class="mag-value">{magLimit >= MAG_MAX ? 'any' : `m ≤ ${magLimit.toFixed(1)}`}</span>
      </div>

      <div class="list-status" aria-live="polite">
        {#if isCapped}
          Showing brightest {RENDER_CAP.toLocaleString()} of {totalCount.toLocaleString()}
        {:else}
          {totalCount.toLocaleString()} object{totalCount === 1 ? '' : 's'}
        {/if}
      </div>

      <div class="object-list" role="listbox" aria-label="Astronomical objects">
        {#if totalCount === 0}
          <div class="no-results">No objects match your filters.</div>
        {:else}
          {#each visibleObjects as obj (obj.id)}
            <button
              class="object-item"
              onclick={() => selectObject(obj)}
              title={obj.description || obj.name}
              role="option"
              aria-selected="false"
            >
              <span class="object-name">{obj.name}</span>
              <span class="object-type">{OBJECT_TYPE_LABELS[obj.type]}</span>
              <span class="object-coords">{obj.ra.toFixed(1)}°, {obj.dec.toFixed(1)}°</span>
              <span class="object-mag">{formatMagnitude(obj.magnitude)}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .object-browser {
    background: #1a1a2e;
    border-bottom: 1px solid #333;
    color: #e0e0e0;
    font-size: 12px;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: #e0e0e0;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
  }

  .toggle-btn:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .toggle-icon {
    font-size: 10px;
    color: #888;
  }

  .toggle-label {
    font-weight: 600;
  }

  .object-count {
    color: #8cf;
    font-size: 11px;
  }

  .browser-content {
    padding: 4px 12px 8px;
  }

  .browser-controls {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }

  .search-input {
    flex: 1;
    min-width: 90px;
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
  }

  .search-input:focus {
    outline: none;
    border-color: #6a6aff;
  }

  .search-input::placeholder {
    color: #666;
  }

  .filter-select {
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 11px;
    cursor: pointer;
  }

  .filter-select:focus {
    outline: none;
    border-color: #6a6aff;
  }

  .mag-control {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 11px;
    color: #aab;
  }

  .mag-control input[type='range'] {
    flex: 1;
    accent-color: #6a6aff;
  }

  .mag-value {
    color: #fc8;
    font-family: 'Courier New', monospace;
    min-width: 54px;
    text-align: right;
  }

  .list-status {
    font-size: 10px;
    color: #889;
    padding: 2px 2px 4px;
  }

  .object-list {
    max-height: 250px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .no-results {
    padding: 12px;
    text-align: center;
    color: #888;
    font-style: italic;
  }

  .object-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 6px;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: #ddd;
    cursor: pointer;
    text-align: left;
    font-size: 11px;
  }

  .object-item:hover {
    background: rgba(106, 106, 255, 0.15);
  }

  .object-item:focus {
    outline: none;
    background: rgba(106, 106, 255, 0.2);
  }

  .object-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .object-type {
    color: #9b9;
    font-size: 10px;
    white-space: nowrap;
  }

  .object-coords {
    color: #8cf;
    font-family: 'Courier New', monospace;
    font-size: 10px;
    white-space: nowrap;
  }

  .object-mag {
    color: #fc8;
    font-family: 'Courier New', monospace;
    font-size: 10px;
    min-width: 40px;
    text-align: right;
  }
</style>
