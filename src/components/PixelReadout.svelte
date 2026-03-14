<script lang="ts">
  let {
    ra = 0,
    dec = 0,
    pixelValue = null as number | null,
    pixelX = null as number | null,
    pixelY = null as number | null,
    visible = false,
  }: {
    ra?: number;
    dec?: number;
    pixelValue?: number | null;
    pixelX?: number | null;
    pixelY?: number | null;
    visible?: boolean;
  } = $props();

  const raFormatted = $derived(formatRa(ra));
  const decFormatted = $derived(formatDec(dec));
  const valueFormatted = $derived(
    pixelValue !== null && pixelValue !== undefined
      ? pixelValue.toFixed(4)
      : '—'
  );

  function formatRa(raDeg: number): string {
    const totalHours = raDeg / 15;
    const h = Math.floor(totalHours);
    const totalMin = (totalHours - h) * 60;
    const m = Math.floor(totalMin);
    const s = ((totalMin - m) * 60).toFixed(2);
    return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}m${s.padStart(5, '0')}s`;
  }

  function formatDec(decDeg: number): string {
    const sign = decDeg >= 0 ? '+' : '-';
    const abs = Math.abs(decDeg);
    const d = Math.floor(abs);
    const totalMin = (abs - d) * 60;
    const m = Math.floor(totalMin);
    const s = ((totalMin - m) * 60).toFixed(1);
    return `${sign}${String(d).padStart(2, '0')}d${String(m).padStart(2, '0')}m${s.padStart(4, '0')}s`;
  }
</script>

{#if visible}
  <div class="pixel-readout" role="status" aria-label="Pixel readout">
    <div class="readout-row">
      <span class="label">RA</span>
      <span class="value ra">{raFormatted}</span>
      <span class="value ra-deg">{ra.toFixed(4)}°</span>
    </div>
    <div class="readout-row">
      <span class="label">Dec</span>
      <span class="value dec">{decFormatted}</span>
      <span class="value dec-deg">{dec.toFixed(4)}°</span>
    </div>
    {#if pixelX !== null && pixelY !== null}
      <div class="readout-row">
        <span class="label">X,Y</span>
        <span class="value">{pixelX}, {pixelY}</span>
      </div>
    {/if}
    <div class="readout-row">
      <span class="label">Value</span>
      <span class="value pixel-value">{valueFormatted}</span>
    </div>
  </div>
{/if}

<style>
  .pixel-readout {
    position: absolute;
    bottom: 12px;
    left: 12px;
    background: rgba(20, 20, 35, 0.9);
    border: 1px solid #444;
    border-radius: 4px;
    padding: 6px 10px;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    color: #e0e0e0;
    pointer-events: none;
    z-index: 5;
    min-width: 200px;
  }

  .readout-row {
    display: flex;
    align-items: center;
    gap: 8px;
    line-height: 1.6;
  }

  .label {
    color: #888;
    font-weight: 600;
    min-width: 32px;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  .value {
    color: #ddd;
  }

  .ra {
    color: #8cf;
  }

  .dec {
    color: #8fc;
  }

  .ra-deg,
  .dec-deg {
    color: #666;
    font-size: 11px;
  }

  .pixel-value {
    color: #fc8;
  }
</style>
