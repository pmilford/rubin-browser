<script lang="ts">
  /**
   * Linked colour–magnitude (HR) diagram for the loaded Gaia sources.
   *
   * x = BP−RP colour (blue/hot LEFT, red/cool RIGHT); y = G magnitude with the
   * axis INVERTED (brighter = up), using absolute M_G where parallax > 0 and
   * apparent G otherwise (disclosed in a note). Every point is REAL data straight
   * from the fetched {@link GaiaCatalog} via {@link cmdPoints} — an all-NaN catalog
   * renders an honest empty state, never fabricated points.
   *
   * Rendered as SVG (not canvas) on purpose: each source is an inspectable,
   * clickable <circle> so selection is testable with jsdom (the canvas 2D context
   * is mocked in tests). Clicking a point fires `onSelect(index)` — the SAME
   * selection state that highlights the sky marker + table row — and the currently
   * selected source's point is highlighted, so sky↔CMD selection is bidirectional.
   */
  import type { GaiaCatalog } from '../api/gaia.js';
  import { cmdPoints, bpRpToRgb, type CmdPoint } from '../utils/gaiaViz.js';

  let {
    catalog = null,
    selectedIndex = -1,
    onSelect,
    onClose,
  }: {
    catalog: GaiaCatalog | null;
    /** Index (into the GaiaCatalog) of the selected source, or -1. */
    selectedIndex?: number;
    /** Fired with the source index when a point is clicked (links to the marker). */
    onSelect?: (index: number) => void;
    onClose?: () => void;
  } = $props();

  const W = 300;
  const H = 240;
  const PAD_L = 34;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 26;

  const points = $derived(catalog ? cmdPoints(catalog) : []);
  // True only when every plotted magnitude is absolute (parallax > 0 for all);
  // when some fall back to apparent G we disclose the mix in the note.
  const anyApparent = $derived(points.some((p) => !p.absolute));
  const anyAbsolute = $derived(points.some((p) => p.absolute));

  interface Domain {
    cMin: number;
    cMax: number;
    mMin: number;
    mMax: number;
  }
  /** Data ranges (with a small margin) so points fill the plot area. */
  const domain = $derived.by<Domain>(() => {
    if (points.length === 0) return { cMin: 0, cMax: 1, mMin: 0, mMax: 1 };
    let cMin = Infinity, cMax = -Infinity, mMin = Infinity, mMax = -Infinity;
    for (const p of points) {
      if (p.colour < cMin) cMin = p.colour;
      if (p.colour > cMax) cMax = p.colour;
      if (p.mag < mMin) mMin = p.mag;
      if (p.mag > mMax) mMax = p.mag;
    }
    // Avoid a zero-width range for a single point / identical values.
    if (cMax - cMin < 1e-6) { cMin -= 0.5; cMax += 0.5; }
    if (mMax - mMin < 1e-6) { mMin -= 0.5; mMax += 0.5; }
    const cPad = (cMax - cMin) * 0.08;
    const mPad = (mMax - mMin) * 0.08;
    return { cMin: cMin - cPad, cMax: cMax + cPad, mMin: mMin - mPad, mMax: mMax + mPad };
  });

  /** BP−RP → x pixel (blue/hot at LEFT). */
  function xOf(colour: number): number {
    const { cMin, cMax } = domain;
    return PAD_L + ((colour - cMin) / (cMax - cMin)) * (W - PAD_L - PAD_R);
  }
  /** G magnitude → y pixel, INVERTED (bright / small magnitude at the TOP). */
  function yOf(mag: number): number {
    const { mMin, mMax } = domain;
    return PAD_T + ((mag - mMin) / (mMax - mMin)) * (H - PAD_T - PAD_B);
  }

  function fillOf(p: CmdPoint): string {
    const [r, g, b] = bpRpToRgb(p.colour);
    return `rgb(${r},${g},${b})`;
  }
</script>

<div class="cmd" aria-label="Colour-magnitude diagram">
  <div class="cmd-header">
    <span class="cmd-title">Colour–magnitude diagram{#if points.length > 0} · {points.length}{/if}</span>
    <button class="cmd-close" aria-label="Close colour-magnitude diagram" onclick={() => onClose?.()}>×</button>
  </div>

  {#if points.length > 0}
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Gaia HR diagram scatter">
      <!-- Axes -->
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} class="axis" />
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} class="axis" />
      <!-- Points: one per finite source. -->
      {#each points as p (p.index)}
        <circle
          cx={xOf(p.colour)}
          cy={yOf(p.mag)}
          r={p.index === selectedIndex ? 5 : 3}
          fill={fillOf(p)}
          class:selected={p.index === selectedIndex}
          data-index={p.index}
          aria-label={`Source ${p.index}: BP-RP ${p.colour.toFixed(2)}, ${p.absolute ? 'M_G' : 'G'} ${p.mag.toFixed(2)}`}
          role="button"
          tabindex="0"
          onclick={() => onSelect?.(p.index)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p.index); } }}
        />
      {/each}
      <!-- Axis labels -->
      <text x={(W + PAD_L) / 2} y={H - 6} class="axis-label" text-anchor="middle">BP−RP (blue → red)</text>
      <text x={10} y={(H - PAD_B + PAD_T) / 2} class="axis-label" text-anchor="middle"
            transform={`rotate(-90 10 ${(H - PAD_B + PAD_T) / 2})`}>
        {anyAbsolute && !anyApparent ? 'M_G (abs)' : 'G (mag)'} ↑bright
      </text>
    </svg>
    {#if anyApparent}
      <div class="cmd-note" aria-label="Colour-magnitude note">
        {anyAbsolute
          ? 'M_G (absolute) where parallax > 0; apparent G otherwise.'
          : 'Apparent G shown — no source has a usable (positive) parallax.'}
      </div>
    {:else}
      <div class="cmd-note">Absolute magnitude M_G from Gaia parallax.</div>
    {/if}
  {:else}
    <div class="cmd-empty" aria-label="Colour-magnitude empty state">
      {catalog && catalog.count > 0
        ? 'No source here has both a BP−RP colour and a magnitude to plot.'
        : 'No Gaia sources loaded.'}
    </div>
  {/if}
</div>

<style>
  .cmd {
    background: rgba(10, 14, 22, 0.97);
    border: 1px solid rgba(90, 220, 255, 0.5);
    border-radius: 8px;
    padding: 8px 10px;
    color: #d6e6f0;
    font-size: 10px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 320px;
  }
  .cmd-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .cmd-title { color: #5ce0ff; font-weight: 700; font-size: 11px; }
  .cmd-close { background: none; border: none; color: #aaa; font-size: 18px; line-height: 1; cursor: pointer; }
  .cmd-close:hover { color: #fff; }
  svg { display: block; background: #06090f; border-radius: 4px; }
  .axis { stroke: rgba(140, 170, 200, 0.5); stroke-width: 1; }
  .axis-label { fill: #8ab; font-size: 9px; }
  circle { cursor: pointer; stroke: rgba(0, 0, 0, 0.5); stroke-width: 0.5; }
  circle:hover { stroke: #fff; stroke-width: 1; }
  circle.selected { stroke: #ff3; stroke-width: 2; }
  .cmd-note { color: #789; padding: 3px 2px 0; }
  .cmd-empty { color: #bbb; padding: 8px 2px; }
</style>
