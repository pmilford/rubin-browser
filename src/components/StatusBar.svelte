<script lang="ts">
  let {
    ra = 0,
    dec = 0,
    zoomLevel = 1,
    pixelValue,
    message = '',
    onCopy,
  }: {
    ra?: number;
    dec?: number;
    zoomLevel?: number;
    pixelValue?: number;
    message?: string;
    /** Called with the copied text (for tests + host hooks); optional. */
    onCopy?: (text: string) => void;
  } = $props();

  // Sexagesimal (h:m:s / d:m:s) by default — the astronomy convention and what
  // the existing tests pin; a toggle switches to plain decimal degrees, which is
  // what most tools want pasted. Click a coordinate to copy it in the shown form.
  let decimalMode = $state(false);
  let copied = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  let raText = $derived(decimalMode ? `${ra.toFixed(5)}°` : formatDegrees(ra, 'ra'));
  let decText = $derived(decimalMode ? `${dec >= 0 ? '+' : ''}${dec.toFixed(5)}°` : formatDegrees(dec, 'dec'));
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

  function copy(label: string, text: string) {
    onCopy?.(text);
    // navigator.clipboard is absent in jsdom / insecure contexts — guard it.
    try {
      void navigator?.clipboard?.writeText?.(text);
    } catch {
      /* copying is best-effort; the readout still shows the value */
    }
    copied = label;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied = null; }, 1200);
  }

  const pairText = $derived(`${ra.toFixed(6)}, ${dec.toFixed(6)}`);
</script>

<div class="status-bar" role="status" aria-live="polite">
  <button
    class="coord"
    title="Click to copy Right Ascension ({raText})"
    aria-label="Copy right ascension"
    onclick={() => copy('ra', raText)}
  >RA: {raText}</button>
  <button
    class="coord"
    title="Click to copy Declination ({decText})"
    aria-label="Copy declination"
    onclick={() => copy('dec', decText)}
  >Dec: {decText}</button>
  <button
    class="fmt-toggle"
    title="Toggle sexagesimal / decimal degrees"
    aria-label="Toggle coordinate format"
    aria-pressed={decimalMode}
    onclick={() => { decimalMode = !decimalMode; }}
  >{decimalMode ? '°' : 'h:m:s'}</button>
  <button
    class="copy-pair"
    title="Copy RA, Dec (decimal degrees)"
    aria-label="Copy coordinates as decimal degrees"
    onclick={() => copy('pair', pairText)}
  >⧉</button>
  {#if copied}
    <span class="copied" aria-live="assertive">copied</span>
  {/if}
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
    align-items: center;
    gap: 12px;
    padding: 4px 12px;
    background: #111;
    color: #ccc;
    font-size: 12px;
    font-family: 'Courier New', monospace;
    border-top: 1px solid #333;
  }

  .coord {
    color: #8cf;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
  .coord:hover {
    color: #bdf;
    text-decoration: underline;
  }

  .fmt-toggle,
  .copy-pair {
    background: rgba(120, 200, 255, 0.12);
    border: 1px solid rgba(120, 200, 255, 0.3);
    border-radius: 4px;
    color: #9cf;
    font: inherit;
    font-size: 11px;
    padding: 0 5px;
    cursor: pointer;
  }
  .fmt-toggle:hover,
  .copy-pair:hover {
    background: rgba(120, 200, 255, 0.25);
  }

  .copied {
    color: #6e6;
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
