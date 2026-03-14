<script lang="ts">
  import { lookupObject } from '../data/objects.js';

  let {
    onZoomIn,
    onZoomOut,
    onResetView,
    onSearch,
    onTogglePanel,
    onToggleFullscreen,
    onToggleHelp,
    onToggleInvert,
    panelOpen = false,
    isFullscreen = false,
    invert = false,
  }: {
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onResetView?: () => void;
    onSearch?: (ra: number, dec: number) => void;
    onTogglePanel?: () => void;
    onToggleFullscreen?: () => void;
    onToggleHelp?: () => void;
    onToggleInvert?: () => void;
    panelOpen?: boolean;
    isFullscreen?: boolean;
    invert?: boolean;
  } = $props();

  let searchQuery = $state('');
  let searchError = $state('');

  function handleSearch() {
    searchError = '';
    const query = searchQuery.trim();
    if (!query) return;

    // First, try to resolve as a named object (Messier, NGC, star name)
    const namedObj = lookupObject(query);
    if (namedObj) {
      onSearch?.(namedObj.ra, namedObj.dec);
      return;
    }

    // Try to parse "RA, Dec" format
    const parts = query.split(/[,\s]+/).filter(s => s.length > 0);
    if (parts.length === 2) {
      const ra = Number(parts[0]);
      const dec = Number(parts[1]);
      if (!isNaN(ra) && !isNaN(dec) && isFinite(ra) && isFinite(dec)) {
        if (ra < 0 || ra > 360) {
          searchError = 'RA must be 0-360';
          return;
        }
        if (dec < -90 || dec > 90) {
          searchError = 'Dec must be -90 to 90';
          return;
        }
        onSearch?.(ra, dec);
        return;
      }
    }

    // Try to parse sexagesimal format
    const raMatch = query.match(/(\d+)h\s*(\d+)?m?\s*([\d.]+)?s?/i);
    // Match Dec only after RA — look for signed number with optional d marker
    const restOfQuery = raMatch ? query.slice(raMatch[0].length) : query;
    const decMatch = restOfQuery.match(/([+-]?\d+)d?\s*(\d+)?m?\s*([\d.]+)?s?/i);
    if (raMatch && decMatch) {
      const raH = parseFloat(raMatch[1] || '0');
      const raM = parseFloat(raMatch[2] || '0');
      const raS = parseFloat(raMatch[3] || '0');
      const ra = (raH + raM / 60 + raS / 3600) * 15;

      const decSign = decMatch[1].startsWith('-') ? -1 : 1;
      const decD = Math.abs(parseFloat(decMatch[1] || '0'));
      const decM = parseFloat(decMatch[2] || '0');
      const decS = parseFloat(decMatch[3] || '0');
      const dec = decSign * (decD + decM / 60 + decS / 3600);

      onSearch?.(ra, dec);
      return;
    }

    searchError = 'Enter coords or object name (e.g. M42)';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSearch();
  }
</script>

<div class="compact-toolbar" role="toolbar" aria-label="Compact controls">
  <!-- Menu toggle -->
  <button
    class="icon-button menu-button"
    class:active={panelOpen}
    onclick={() => onTogglePanel?.()}
    title="Toggle controls panel (Escape)"
    aria-label="Toggle controls panel"
    aria-expanded={panelOpen}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  </button>

  <!-- Search -->
  <div class="search-group">
    <input
      type="text"
      class="search-input"
      placeholder="62.0, -37.0 or M42"
      bind:value={searchQuery}
      onkeydown={handleKeydown}
      title="Enter coordinates or object name (e.g. M42, Orion Nebula)"
      aria-label="Search coordinates"
    />
    <button class="icon-button search-button" onclick={handleSearch} title="Go to coordinates" aria-label="Go">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    </button>
    {#if searchError}
      <span class="search-error">{searchError}</span>
    {/if}
  </div>

  <div class="separator"></div>

  <!-- Zoom controls -->
  <button class="icon-button" onclick={() => onZoomIn?.()} title="Zoom in (+)" aria-label="Zoom in">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="11" y1="8" x2="11" y2="14"/>
      <line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  </button>
  <button class="icon-button" onclick={() => onZoomOut?.()} title="Zoom out (-)" aria-label="Zoom out">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  </button>
  <button class="icon-button" onclick={() => onResetView?.()} title="Reset view (0)" aria-label="Reset view">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
    </svg>
  </button>

  <div class="spacer"></div>

  <!-- Invert toggle -->
  <button
    class="icon-button"
    class:active={invert}
    onclick={() => onToggleInvert?.()}
    title="Invert image (I)"
    aria-label="Invert image"
    aria-pressed={invert}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"/>
    </svg>
  </button>

  <!-- Fullscreen toggle -->
  <button class="icon-button" onclick={() => onToggleFullscreen?.()} title="Toggle fullscreen (F)" aria-label="Toggle fullscreen">
    {#if isFullscreen}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
      </svg>
    {:else}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
      </svg>
    {/if}
  </button>

  <!-- Help -->
  <button class="icon-button" onclick={() => onToggleHelp?.()} title="Help (H)" aria-label="Help">
    <span class="help-icon">?</span>
  </button>
</div>

<style>
  .compact-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: #1a1a2e;
    border-bottom: 1px solid #333;
    color: #e0e0e0;
    font-size: 13px;
    z-index: 20;
  }

  .search-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .search-input {
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    width: 180px;
  }

  .search-input::placeholder {
    color: #666;
  }

  .search-input:focus {
    outline: none;
    border-color: #6a6aff;
  }

  .search-error {
    color: #f66;
    font-size: 11px;
    max-width: 180px;
  }

  .separator {
    width: 1px;
    height: 20px;
    background: #444;
    margin: 0 2px;
  }

  .spacer {
    flex: 1;
  }

  .icon-button {
    background: #2a2a3e;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
  }

  .icon-button:hover {
    background: #3a3a5e;
    color: #fff;
    border-color: #6a6aff;
  }

  .menu-button.active {
    background: #3a3a5e;
    color: #6a6aff;
    border-color: #6a6aff;
  }

  .icon-button.active {
    background: #3a3a5e;
    color: #6a6aff;
    border-color: #6a6aff;
  }

  .search-button {
    min-width: 28px;
  }

  .help-icon {
    font-weight: bold;
    font-size: 14px;
    line-height: 1;
  }
</style>
