<script lang="ts">
  import type { CatalogSet } from '../data/catalog.js';

  let {
    catalog,
    selectedIndex = -1,
    title = 'Catalog',
    status = null,
    onSelect,
    onClose,
  }: {
    catalog: CatalogSet | null;
    selectedIndex?: number;
    title?: string;
    /** Loading / error / empty message shown when there are no rows. */
    status?: string | null;
    /** Fired when a row is clicked (index into the catalog) — links to the marker. */
    onSelect?: (index: number) => void;
    onClose?: () => void;
  } = $props();

  const MAX_ROWS = 200;
  // Columns come from the first record's keys (single source of truth = catalog.ts).
  const columns = $derived(catalog && catalog.count > 0 ? Object.keys(catalog.records[0] ?? {}) : []);
  const rowCount = $derived(catalog ? Math.min(catalog.count, MAX_ROWS) : 0);
</script>

<div class="cat-table" aria-label="Catalog table">
  <div class="ct-header">
    <span class="ct-title">{title}{#if catalog && catalog.count > 0} · {catalog.count.toLocaleString()}{/if}</span>
    <button class="ct-close" aria-label="Close catalog" onclick={() => onClose?.()}>×</button>
  </div>

  {#if catalog && catalog.count > 0}
    <div class="ct-scroll">
      <table>
        <thead>
          <tr>{#each columns as c (c)}<th>{c}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each Array(rowCount) as _unused, i (i)}
            <tr
              class:selected={i === selectedIndex}
              aria-label={`Catalog row ${i}`}
              aria-selected={i === selectedIndex}
              onclick={() => onSelect?.(i)}
            >
              {#each columns as c (c)}<td>{catalog.records[i]?.[c] ?? '—'}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if catalog.count > MAX_ROWS}
        <div class="ct-more">Showing first {MAX_ROWS} of {catalog.count.toLocaleString()}.</div>
      {/if}
    </div>
  {:else}
    <div class="ct-status" aria-label="Catalog status">{status ?? 'No catalog sources here.'}</div>
  {/if}
</div>

<style>
  .cat-table {
    background: rgba(10, 14, 22, 0.97);
    border: 1px solid rgba(90, 220, 255, 0.5);
    border-radius: 8px;
    padding: 8px 10px;
    color: #d6e6f0;
    font-size: 10px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 340px;
  }
  .ct-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .ct-title { color: #5ce0ff; font-weight: 700; font-size: 11px; }
  .ct-close { background: none; border: none; color: #aaa; font-size: 18px; line-height: 1; cursor: pointer; }
  .ct-close:hover { color: #fff; }
  .ct-scroll { max-height: 260px; overflow: auto; }
  table { border-collapse: collapse; width: 100%; }
  th { position: sticky; top: 0; background: #10161f; color: #8ab; text-align: left; padding: 2px 5px; font-weight: 600; white-space: nowrap; }
  td { padding: 2px 5px; white-space: nowrap; color: #bdf; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: rgba(90, 220, 255, 0.12); }
  tbody tr.selected { background: rgba(255, 255, 90, 0.18); }
  tbody tr.selected td { color: #ffd; }
  .ct-status { color: #bbb; padding: 4px 2px; }
  .ct-more { color: #789; padding: 3px 2px; }
</style>
