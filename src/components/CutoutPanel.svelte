<script lang="ts">
  /**
   * FITS cutout display panel (feature 109). Renders a parsed FITS cutout
   * (`readFits` → linear-float pixels) to a canvas via the pure `renderCutout`
   * pipeline, with DS9-style stretch + colour-map controls, an invert toggle,
   * and a live cursor readout of the FITS pixel, its physical value + unit, and
   * — when the header carries a usable TAN WCS — the calibrated RA/Dec.
   *
   * Presentational: it OWNS its scale/colormap/invert UI state but takes the
   * image + metadata as props and reports close via a callback. All the image
   * maths is the pure, tested `renderCutout` (src/utils/cutoutRender.ts) and
   * `parseWcs`/`pixelToWorld` (src/utils/wcs.ts).
   */
  import type { FitsImage } from '../utils/fits.js';
  import { renderCutout } from '../utils/cutoutRender.js';
  import { parseWcs, pixelToWorld } from '../utils/wcs.js';
  import { getColorMapNames } from '../utils/colormap.js';
  import type { ScalingFunction, ColorMapName } from '../types/image.js';

  let {
    image,
    ra,
    dec,
    band,
    datasetId,
    onClose,
  }: {
    image: FitsImage;
    ra: number;
    dec: number;
    band: string;
    datasetId: string;
    onClose?: () => void;
  } = $props();

  // Stretch functions offered for a cutout (the nonlinear DS9 family that makes
  // sense on linear-float pixels). A subset of the full ScalingFunction union.
  const SCALES: ScalingFunction[] = ['linear', 'log', 'sqrt', 'asinh'];
  const COLORMAPS: ColorMapName[] = getColorMapNames();

  let scale = $state<ScalingFunction>('asinh');
  let colormap = $state<ColorMapName>('grayscale');
  let invert = $state(false);

  // Parse the WCS ONCE from the header (null when the cutout has no usable TAN
  // WCS — the readout then omits RA/Dec rather than inventing coordinates).
  const wcs = $derived(parseWcs(image.header));

  // Pure render → RGBA. Recomputes whenever a control changes.
  const rendered = $derived(renderCutout(image, { scale, colormap, invert }));

  let canvasEl: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    const ctx = canvasEl?.getContext('2d');
    if (!ctx) return;
    const img = new ImageData(rendered.rgba, rendered.width, rendered.height);
    ctx.putImageData(img, 0, 0);
  });

  // Cursor readout state (null until the pointer is over the image).
  let readout = $state<{
    col: number;
    row: number;
    value: number;
    ra: number | null;
    dec: number | null;
  } | null>(null);

  function handleMouseMove(e: MouseEvent) {
    const canvas = canvasEl;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Map CSS pixel → data pixel (the canvas is displayed scaled up).
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * image.width);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * image.height);
    if (col < 0 || col >= image.width || row < 0 || row >= image.height) {
      readout = null;
      return;
    }
    const value = image.data[row * image.width + col] ?? NaN;
    // FITS pixel is 1-based (col+1, row+1); pass that to the WCS.
    const world = wcs ? pixelToWorld(wcs, col + 1, row + 1) : null;
    readout = { col, row, value, ra: world?.ra ?? null, dec: world?.dec ?? null };
  }

  function handleMouseLeave() {
    readout = null;
  }

  /** Short dataset id for the header (full id shown in the title attribute). */
  const shortId = $derived(
    datasetId.length > 22 ? `${datasetId.slice(0, 10)}…${datasetId.slice(-8)}` : datasetId
  );

  function fmtValue(v: number): string {
    if (!Number.isFinite(v)) return 'BLANK';
    const abs = Math.abs(v);
    if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(3);
    return v.toFixed(3);
  }
</script>

<div class="cutout-panel" aria-label="FITS cutout">
  <div class="cp-header">
    <span class="cp-title">FITS cutout</span>
    <button class="cp-close" aria-label="Close cutout" onclick={() => onClose?.()}>×</button>
  </div>

  <div class="cp-meta" aria-label="Cutout metadata">
    {#if image.header.object}<span class="cp-object">{image.header.object}</span>{/if}
    <span>{image.width}×{image.height} px</span>
    <span>band {band}</span>
    <span class="cp-dataset" title={datasetId}>{shortId}</span>
  </div>
  <div class="cp-pos" aria-label="Cutout centre">
    centre RA {ra.toFixed(5)}°, Dec {dec >= 0 ? '+' : ''}{dec.toFixed(5)}°
  </div>

  <canvas
    bind:this={canvasEl}
    width={image.width}
    height={image.height}
    class="cp-canvas"
    aria-label="FITS cutout image"
    onmousemove={handleMouseMove}
    onmouseleave={handleMouseLeave}
  ></canvas>

  <div class="cp-readout" aria-label="Cutout readout">
    {#if readout}
      <span>pix ({readout.col + 1}, {readout.row + 1})</span>
      <span>= {fmtValue(readout.value)}{#if image.header.bunit}&nbsp;{image.header.bunit}{/if}</span>
      {#if readout.ra !== null && readout.dec !== null}
        <span class="cp-radec"
          >RA {readout.ra.toFixed(5)}°, Dec {readout.dec >= 0 ? '+' : ''}{readout.dec.toFixed(5)}°</span
        >
      {:else}
        <span class="cp-nowcs">no WCS</span>
      {/if}
    {:else}
      <span class="cp-hint">move over the image to read pixel value{wcs ? ' + RA/Dec' : ''}</span>
    {/if}
  </div>

  <div class="cp-controls">
    <label>Scale
      <select aria-label="Cutout scale" bind:value={scale}>
        {#each SCALES as s (s)}<option value={s}>{s}</option>{/each}
      </select>
    </label>
    <label>Map
      <select aria-label="Cutout colormap" bind:value={colormap}>
        {#each COLORMAPS as c (c)}<option value={c}>{c}</option>{/each}
      </select>
    </label>
    <label class="cp-invert">
      <input type="checkbox" aria-label="Invert cutout" bind:checked={invert} /> invert
    </label>
  </div>

  {#if !Number.isFinite(rendered.min)}
    <div class="cp-note" aria-label="Cutout note">No finite pixels in this cutout (all BLANK).</div>
  {:else}
    <div class="cp-note" aria-label="Cutout note">stretch {fmtValue(rendered.min)}–{fmtValue(rendered.max)}{#if image.header.bunit}&nbsp;{image.header.bunit}{/if} · 0.5–99.5%</div>
  {/if}
</div>

<style>
  .cutout-panel {
    background: rgba(12, 14, 22, 0.97);
    border: 1px solid rgba(120, 200, 255, 0.5);
    border-radius: 8px;
    padding: 8px 10px;
    color: #d8e2f0;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 300px;
  }
  .cp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .cp-title { color: #9cf; font-weight: 700; }
  .cp-close { background: none; border: none; color: #aaa; font-size: 18px; line-height: 1; cursor: pointer; }
  .cp-close:hover { color: #fff; }
  .cp-meta { display: flex; flex-wrap: wrap; gap: 8px; color: #9ab; margin-bottom: 3px; }
  .cp-object { color: #cef; font-weight: 700; }
  .cp-dataset { color: #789; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-pos { color: #89a; margin-bottom: 6px; }
  .cp-canvas {
    width: 280px;
    height: 280px;
    image-rendering: pixelated;
    border: 1px solid #234;
    background: #000;
    display: block;
  }
  .cp-readout { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; min-height: 15px; color: #bdf; }
  .cp-radec { color: #cef; }
  .cp-nowcs, .cp-hint { color: #778; }
  .cp-controls { display: flex; gap: 10px; align-items: center; margin-top: 8px; }
  .cp-controls select { background: #1a1a2e; color: #cef; border: 1px solid #345; border-radius: 4px; font: inherit; font-size: 10px; }
  .cp-invert { display: inline-flex; align-items: center; gap: 4px; }
  .cp-note { color: #778; font-size: 9px; margin-top: 6px; }
</style>
