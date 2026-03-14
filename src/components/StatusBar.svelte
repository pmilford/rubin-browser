<script lang="ts">
  let {
    ra = 0,
    dec = 0,
    zoomLevel = 1,
    pixelValue,
    message = '',
  }: {
    ra?: number;
    dec?: number;
    zoomLevel?: number;
    pixelValue?: number;
    message?: string;
  } = $props();

  let formattedRa = $derived(formatDegrees(ra, 'ra'));
  let formattedDec = $derived(formatDegrees(dec, 'dec'));
  let formattedZoom = $derived(zoomLevel.toFixed(1));

  function formatDegrees(deg: number, axis: 'ra' | 'dec'): string {
    const absDeg = Math.abs(deg);
    const d = Math.floor(absDeg);
    const m = Math.floor((absDeg - d) * 60);
    const s = ((absDeg - d) * 3600 - m * 60).toFixed(1);
    const sign = axis === 'dec' ? (deg >= 0 ? '+' : '-') : '';
    if (axis === 'ra') {
      const h = Math.floor(deg / 15);
      const rm = Math.floor((deg / 15 - h) * 60);
      const rs = ((deg / 15 - h) * 3600 - rm * 60).toFixed(2);
      return `${h}h ${rm}m ${rs}s`;
    }
    return `${sign}${d}° ${m}' ${s}"`;
  }
</script>

<div class="status-bar" role="status" aria-live="polite">
  <span class="coord" title="Right Ascension">RA: {formattedRa}</span>
  <span class="coord" title="Declination">Dec: {formattedDec}</span>
  <span class="zoom" title="Current zoom level">Zoom: {formattedZoom}x</span>
  {#if pixelValue !== undefined}
    <span class="pixel" title="Pixel intensity value">Val: {pixelValue.toExponential(3)}</span>
  {/if}
  {#if message}
    <span class="message">{message}</span>
  {/if}
</div>

<style>
  .status-bar {
    display: flex;
    gap: 16px;
    padding: 4px 12px;
    background: #111;
    color: #ccc;
    font-size: 12px;
    font-family: 'Courier New', monospace;
    border-top: 1px solid #333;
  }

  .coord {
    color: #8cf;
  }

  .zoom {
    color: #8fc;
  }

  .pixel {
    color: #fc8;
  }

  .message {
    margin-left: auto;
    color: #aaa;
    font-style: italic;
  }
</style>
