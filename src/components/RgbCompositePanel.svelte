<script lang="ts">
  /**
   * RGB band-mixing composite panel (feature 120). Given three aligned per-band
   * FITS cutouts (fetched at the SAME position/size by `TileViewer`), it composites
   * them into a colour image with the Lupton asinh recipe (`luptonRgb`), exposing
   * band→channel mapping selectors (default i→R, r→G, g→B — longer wavelength to
   * red) and Q / stretch sliders.
   *
   * Presentational: it OWNS the mapping + Q/stretch UI state but takes the fetched
   * images as a prop. All the colour maths is the pure, tested `luptonRgb`
   * (src/utils/luptonRgb.ts). If the three chosen bands' cutouts differ in
   * dimensions they CANNOT be combined — the panel says so honestly (via the error
   * `luptonRgb` throws) instead of padding/cropping or showing a wrong image.
   */
  import type { FitsImage } from '../utils/fits.js';
  import { luptonRgb } from '../utils/luptonRgb.js';

  let {
    images,
    ra,
    dec,
    onClose,
  }: {
    /** Fetched per-band cutouts, keyed by LSST band (e.g. { i, r, g }). */
    images: Record<string, FitsImage>;
    ra: number;
    dec: number;
    onClose?: () => void;
  } = $props();

  const availableBands = $derived(Object.keys(images));

  /** Pick a sensible default band for a channel, falling back to what's present. */
  function defaultBand(preferred: string, index: number): string {
    const bands = Object.keys(images);
    if (bands.includes(preferred)) return preferred;
    return bands[Math.min(index, bands.length - 1)] ?? bands[0] ?? '';
  }

  // Default mapping: i→R, r→G, g→B (longer wavelength → red). Falls back to the
  // available bands in order when i/r/g aren't all present.
  let rBand = $state(defaultBand('i', 0));
  let gBand = $state(defaultBand('r', 1));
  let bBand = $state(defaultBand('g', 2));

  // Lupton parameters (astropy defaults: Q=8, stretch=5).
  let q = $state(8);
  let stretch = $state(5);

  let canvasEl: HTMLCanvasElement | undefined = $state();

  // Composite the three selected bands. Returns either the RGBA + dims, or an
  // honest error string (e.g. the bands differ in size) — never a wrong image.
  const composite = $derived.by(():
    | { rgba: Uint8ClampedArray; width: number; height: number; error: null }
    | { rgba: null; width: 0; height: 0; error: string } => {
    const rImg = images[rBand];
    const gImg = images[gBand];
    const bImg = images[bBand];
    if (!rImg || !gImg || !bImg) {
      return { rgba: null, width: 0, height: 0, error: 'A selected band has no cutout.' };
    }
    if (
      rImg.width !== gImg.width || rImg.width !== bImg.width ||
      rImg.height !== gImg.height || rImg.height !== bImg.height
    ) {
      return {
        rgba: null, width: 0, height: 0,
        error:
          `The three bands' cutouts differ in size ` +
          `(R ${rImg.width}×${rImg.height}, G ${gImg.width}×${gImg.height}, B ${bImg.width}×${bImg.height}) ` +
          'and cannot be combined.',
      };
    }
    try {
      const rgba = luptonRgb(rImg.data, gImg.data, bImg.data, rImg.width, rImg.height, {
        Q: q,
        stretch,
      });
      return { rgba, width: rImg.width, height: rImg.height, error: null };
    } catch (e) {
      return { rgba: null, width: 0, height: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });

  $effect(() => {
    const ctx = canvasEl?.getContext('2d');
    if (!ctx || !composite.rgba) return;
    const img = new ImageData(composite.rgba, composite.width, composite.height);
    ctx.putImageData(img, 0, 0);
  });
</script>

<div class="rgb-panel" aria-label="RGB composite">
  <div class="rgb-header">
    <span class="rgb-title">RGB composite · Lupton asinh</span>
    <button class="rgb-close" aria-label="Close RGB composite" onclick={() => onClose?.()}>×</button>
  </div>

  <div class="rgb-pos" aria-label="RGB composite centre">
    centre RA {ra.toFixed(5)}°, Dec {dec >= 0 ? '+' : ''}{dec.toFixed(5)}°
  </div>

  {#if composite.error}
    <div class="rgb-error" aria-label="RGB composite error">{composite.error}</div>
  {:else}
    <canvas
      bind:this={canvasEl}
      width={composite.width}
      height={composite.height}
      class="rgb-canvas"
      aria-label="RGB composite image"
    ></canvas>
  {/if}

  <div class="rgb-mapping" aria-label="Band to channel mapping">
    <label class="ch-r">R
      <select aria-label="R channel band" bind:value={rBand}>
        {#each availableBands as bnd (bnd)}<option value={bnd}>{bnd}</option>{/each}
      </select>
    </label>
    <label class="ch-g">G
      <select aria-label="G channel band" bind:value={gBand}>
        {#each availableBands as bnd (bnd)}<option value={bnd}>{bnd}</option>{/each}
      </select>
    </label>
    <label class="ch-b">B
      <select aria-label="B channel band" bind:value={bBand}>
        {#each availableBands as bnd (bnd)}<option value={bnd}>{bnd}</option>{/each}
      </select>
    </label>
  </div>

  <div class="rgb-sliders">
    <label>Q {q.toFixed(1)}
      <input type="range" min="0.5" max="30" step="0.5" bind:value={q} aria-label="Q parameter" />
    </label>
    <label>stretch {stretch.toFixed(1)}
      <input type="range" min="0.5" max="50" step="0.5" bind:value={stretch} aria-label="Stretch parameter" />
    </label>
  </div>

  <div class="rgb-note" aria-label="RGB composite note">
    i→R r→G g→B by default · longer wavelength → red · Lupton (2004) asinh
  </div>
</div>

<style>
  .rgb-panel {
    background: rgba(12, 14, 22, 0.97);
    border: 1px solid rgba(120, 200, 255, 0.5);
    border-radius: 8px;
    padding: 8px 10px;
    color: #d8e2f0;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 300px;
  }
  .rgb-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .rgb-title { color: #9cf; font-weight: 700; }
  .rgb-close { background: none; border: none; color: #aaa; font-size: 18px; line-height: 1; cursor: pointer; }
  .rgb-close:hover { color: #fff; }
  .rgb-pos { color: #89a; margin-bottom: 6px; }
  .rgb-canvas {
    width: 280px;
    height: 280px;
    image-rendering: pixelated;
    border: 1px solid #234;
    background: #000;
    display: block;
  }
  .rgb-error { color: #f99; white-space: pre-wrap; line-height: 1.4; padding: 8px 0; }
  .rgb-mapping { display: flex; gap: 10px; margin-top: 8px; }
  .rgb-mapping label { display: inline-flex; align-items: center; gap: 4px; }
  .ch-r { color: #f88; }
  .ch-g { color: #8f8; }
  .ch-b { color: #88f; }
  .rgb-mapping select { background: #1a1a2e; color: #cef; border: 1px solid #345; border-radius: 4px; font: inherit; font-size: 10px; }
  .rgb-sliders { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; color: #9ab; }
  .rgb-sliders label { display: flex; align-items: center; gap: 6px; }
  .rgb-sliders input { flex: 1; accent-color: #6cf; }
  .rgb-note { color: #778; font-size: 9px; margin-top: 8px; }
</style>
