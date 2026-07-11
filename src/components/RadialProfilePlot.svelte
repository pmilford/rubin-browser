<script lang="ts">
  /**
   * Presentational SVG radial-profile / curve-of-growth plot (feature 122).
   *
   * Plots the two curves produced by `radialProfile` (src/utils/photometry.ts):
   * the mean flux per annular bin (the radial profile) and the cumulative
   * encircled flux (the curve-of-growth), each normalised to its own maximum so
   * both are visible on one 0–1 axis. PURE presentation — it takes the already-
   * computed profile as a prop and draws SVG polylines; no maths, no canvas, so it
   * is unit-testable by counting the points it renders.
   */
  import type { RadialProfileResult } from '../utils/photometry.js';

  let {
    profile,
    onClose,
  }: {
    profile: RadialProfileResult | null;
    onClose?: () => void;
  } = $props();

  const VIEW_W = 240;
  const VIEW_H = 120;
  const PAD = 4;

  /** Max finite value of an array, or 0 if none finite. */
  function finiteMax(values: number[]): number {
    let m = 0;
    for (const v of values) if (Number.isFinite(v) && v > m) m = v;
    return m;
  }

  // Build normalised polyline point strings (x = radius, y = value / max),
  // skipping NaN bins so a gap doesn't draw a spurious line to zero.
  const geometry = $derived.by(() => {
    if (!profile || profile.radius.length === 0) return null;
    const rMax = profile.radius[profile.radius.length - 1] || 1;
    const meanMax = finiteMax(profile.meanFlux) || 1;
    const encMax = finiteMax(profile.encircledFlux) || 1;
    const x = (r: number) => PAD + (r / rMax) * (VIEW_W - 2 * PAD);
    const y = (frac: number) => VIEW_H - PAD - frac * (VIEW_H - 2 * PAD);

    const meanPts: string[] = [];
    const encPts: string[] = [];
    for (let k = 0; k < profile.radius.length; k++) {
      const px = x(profile.radius[k]!);
      if (Number.isFinite(profile.meanFlux[k]!)) {
        meanPts.push(`${px.toFixed(1)},${y(profile.meanFlux[k]! / meanMax).toFixed(1)}`);
      }
      encPts.push(`${px.toFixed(1)},${y(profile.encircledFlux[k]! / encMax).toFixed(1)}`);
    }
    return { meanLine: meanPts.join(' '), encLine: encPts.join(' '), meanCount: meanPts.length };
  });
</script>

<div class="rp-plot" aria-label="Radial profile">
  <div class="rp-header">
    <span class="rp-title">Radial profile · curve of growth</span>
    {#if onClose}<button class="rp-close" aria-label="Close radial profile" onclick={() => onClose?.()}>×</button>{/if}
  </div>
  {#if geometry}
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} class="rp-svg" role="img" aria-label="Radial profile plot" preserveAspectRatio="none">
      <!-- Curve-of-growth (encircled flux, cumulative) -->
      <polyline class="rp-enc" aria-label="Curve of growth line" points={geometry.encLine} fill="none" />
      <!-- Radial profile (mean flux per annulus) -->
      <polyline class="rp-mean" aria-label="Radial profile line" points={geometry.meanLine} fill="none" />
    </svg>
    <div class="rp-legend" aria-label="Radial profile legend">
      <span class="rp-key rp-key-enc">encircled flux (growth)</span>
      <span class="rp-key rp-key-mean">mean flux vs radius</span>
    </div>
  {:else}
    <div class="rp-empty" aria-label="Radial profile empty">Click a point on the cutout to measure a radial profile.</div>
  {/if}
</div>

<style>
  .rp-plot { color: #cde; font-size: 10px; }
  .rp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }
  .rp-title { color: #9cf; font-weight: 700; }
  .rp-close { background: none; border: none; color: #aaa; font-size: 15px; line-height: 1; cursor: pointer; }
  .rp-close:hover { color: #fff; }
  .rp-svg { width: 100%; height: 90px; background: #0a0c14; border: 1px solid #234; display: block; }
  .rp-enc { stroke: #6cf; stroke-width: 1.5; }
  .rp-mean { stroke: #fc8; stroke-width: 1.5; }
  .rp-legend { display: flex; gap: 10px; margin-top: 3px; }
  .rp-key-enc { color: #6cf; }
  .rp-key-mean { color: #fc8; }
  .rp-empty { color: #778; padding: 6px 0; }
</style>
