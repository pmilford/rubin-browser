<script lang="ts">
  import type { SimbadObject } from '../api/simbad.js';

  let {
    ra,
    dec,
    results = null,
    status = null,
    onClose,
    onSelect,
  }: {
    ra: number;
    dec: number;
    /** Matched objects (nearest first), or null before a lookup resolves. */
    results?: SimbadObject[] | null;
    /** Loading / error / empty message shown when there are no results. */
    status?: string | null;
    onClose?: () => void;
    /** Fired when a result is clicked (e.g. to recentre the view). */
    onSelect?: (o: SimbadObject) => void;
  } = $props();
</script>

<div class="simbad-panel" aria-label="SIMBAD results">
  <div class="sp-header">
    <span class="sp-title" aria-label="SIMBAD query position">
      SIMBAD · {ra.toFixed(4)}, {dec >= 0 ? '+' : ''}{dec.toFixed(4)}
    </span>
    <button class="sp-close" aria-label="Close SIMBAD" onclick={() => onClose?.()}>×</button>
  </div>

  {#if results && results.length > 0}
    <ul class="sp-list" aria-label="SIMBAD matches">
      {#each results as o (o.mainId)}
        <li>
          <button class="sp-row" onclick={() => onSelect?.(o)} title="Recentre on this object">
            <span class="sp-name">{o.mainId}</span>
            <span class="sp-type">{o.objectType || '—'}</span>
            {#if o.separationArcsec != null}
              <span class="sp-sep">{o.separationArcsec.toFixed(1)}″</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="sp-status" aria-label="SIMBAD status">
      {status ?? 'No catalogued SIMBAD object here.'}
    </div>
  {/if}
  <div class="sp-note">Public SIMBAD (CDS) · right-click the sky to query</div>
</div>

<style>
  .simbad-panel {
    background: rgba(14, 12, 24, 0.96);
    border: 1px solid rgba(150, 130, 255, 0.5);
    border-radius: 8px;
    padding: 8px 10px;
    color: #dcd8f0;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    min-width: 220px;
    max-width: 320px;
  }
  .sp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .sp-title {
    color: #b9a8ff;
    font-weight: 700;
  }
  .sp-close {
    background: none;
    border: none;
    color: #aaa;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 0 2px;
  }
  .sp-close:hover {
    color: #fff;
  }
  .sp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 220px;
    overflow-y: auto;
  }
  .sp-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid rgba(150, 130, 255, 0.12);
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 3px 2px;
    cursor: pointer;
  }
  .sp-row:hover {
    background: rgba(150, 130, 255, 0.12);
  }
  .sp-name {
    color: #cfe;
    font-weight: 600;
  }
  .sp-type {
    color: #a99;
    margin-left: auto;
  }
  .sp-sep {
    color: #789;
  }
  .sp-status {
    color: #bbb;
    padding: 4px 2px;
  }
  .sp-note {
    color: #776;
    font-size: 9px;
    margin-top: 6px;
  }
</style>
