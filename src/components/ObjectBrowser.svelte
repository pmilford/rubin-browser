<script lang="ts">
  import { ALL_OBJECTS, OBJECT_CATEGORIES, searchObjects, getObjectsByCategory, type AstroObject, type ObjectCategory } from '../data/objects.js';

  let {
    onObjectSelect,
  }: {
    onObjectSelect?: (object: AstroObject) => void;
  } = $props();

  let expanded = $state(false);
  let searchQuery = $state('');
  let selectedCategory = $state<ObjectCategory | 'All'>('All');

  const filteredObjects = $derived.by(() => {
    let objects = ALL_OBJECTS;
    if (selectedCategory !== 'All') {
      objects = getObjectsByCategory(selectedCategory);
    }
    if (searchQuery.trim()) {
      return searchObjects(searchQuery).filter(obj =>
        selectedCategory === 'All' || obj.category === selectedCategory
      );
    }
    return objects;
  });

  const groupedObjects = $derived.by(() => {
    const groups: Record<string, AstroObject[]> = {};
    for (const obj of filteredObjects) {
      if (!groups[obj.category]) {
        groups[obj.category] = [];
      }
      groups[obj.category]!.push(obj);
    }
    return groups;
  });

  function toggleExpanded() {
    expanded = !expanded;
  }

  function selectObject(obj: AstroObject) {
    onObjectSelect?.(obj);
  }

  function formatMagnitude(mag?: number): string {
    if (mag === undefined) return '';
    return mag >= 0 ? `m${mag.toFixed(1)}` : `m${mag.toFixed(1)}`;
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
    <span class="object-count">({filteredObjects.length})</span>
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
        <select
          class="category-select"
          bind:value={selectedCategory}
          aria-label="Filter by category"
        >
          <option value="All">All ({ALL_OBJECTS.length})</option>
          {#each OBJECT_CATEGORIES as category}
            {@const count = getObjectsByCategory(category).length}
            <option value={category}>{category} ({count})</option>
          {/each}
        </select>
      </div>

      <div class="object-list" role="listbox" aria-label="Astronomical objects">
        {#if filteredObjects.length === 0}
          <div class="no-results">No objects match your search.</div>
        {:else if selectedCategory === 'All'}
          {#each Object.entries(groupedObjects) as [category, objects]}
            <div class="category-group">
              <div class="category-header">{category}</div>
              {#each objects as obj}
                <button
                  class="object-item"
                  onclick={() => selectObject(obj)}
                  title={obj.description || obj.name}
                  role="option"
                >
                  <span class="object-name">{obj.name}</span>
                  <span class="object-coords">{obj.ra.toFixed(1)}°, {obj.dec.toFixed(1)}°</span>
                  {#if obj.magnitude !== undefined}
                    <span class="object-mag">{formatMagnitude(obj.magnitude)}</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/each}
        {:else}
          {#each filteredObjects as obj}
            <button
              class="object-item"
              onclick={() => selectObject(obj)}
              title={obj.description || obj.name}
              role="option"
            >
              <span class="object-name">{obj.name}</span>
              <span class="object-coords">{obj.ra.toFixed(1)}°, {obj.dec.toFixed(1)}°</span>
              {#if obj.magnitude !== undefined}
                <span class="object-mag">{formatMagnitude(obj.magnitude)}</span>
              {/if}
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

  .category-select {
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 11px;
    cursor: pointer;
  }

  .category-select:focus {
    outline: none;
    border-color: #6a6aff;
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

  .category-group {
    margin-bottom: 4px;
  }

  .category-header {
    font-weight: 600;
    color: #6a6aff;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 4px 4px 2px;
    border-bottom: 1px solid #333;
    margin-bottom: 2px;
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
    min-width: 32px;
    text-align: right;
  }
</style>
