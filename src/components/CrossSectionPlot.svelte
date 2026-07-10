<script lang="ts">
  import { profilePath, type LineProfile } from '../utils/crossSection.js';

  let {
    profile = null as LineProfile | null,
    onClose,
  }: {
    profile?: LineProfile | null;
    onClose?: () => void;
  } = $props();

  let logScale = $state(false);

  const W = 280;
  const H = 120;

  // Fraction of samples that have data (the rest are gaps / no-data).
  const coverage = $derived.by(() => {
    if (!profile || profile.lum.length === 0) return 0;
    const n = profile.gap.filter((g) => !g).length;
    return n / profile.lum.length;
  });
  const hasData = $derived(coverage > 0);

  const pathD = $derived(profile && hasData ? profilePath(profile, W, H, logScale) : '');
  const maxDist = $derived(
    profile && profile.distanceArcmin.length
      ? profile.distanceArcmin[profile.distanceArcmin.length - 1]!
      : 0
  );
  const peakLum = $derived.by(() => {
    if (!profile) return 0;
    let m = 0;
    for (let i = 0; i < profile.lum.length; i++) if (!profile.gap[i] && profile.lum[i]! > m) m = profile.lum[i]!;
    return m;
  });
</script>

<div class="xsection-plot" role="region" aria-label="Cross-section profile">
  <div class="header">
    <span class="title">Cross-section</span>
    <button
      class="mode-btn"
      aria-pressed={logScale}
      aria-label="Toggle logarithmic intensity axis"
      onclick={() => (logScale = !logScale)}
    >
      {logScale ? 'log' : 'linear'}
    </button>
    {#if onClose}
      <button class="close-btn" aria-label="Close cross-section" onclick={onClose}>×</button>
    {/if}
  </div>

  {#if !hasData}
    <div class="no-data">no data along this line</div>
  {:else}
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} class="plot-svg" aria-label="Intensity vs position">
      <rect x="0" y="0" width={W} height={H} fill="rgba(8,8,20,0.9)" />
      <!-- horizontal gridlines -->
      {#each [0.25, 0.5, 0.75] as g (g)}
        <line x1="0" y1={H * g} x2={W} y2={H * g} stroke="rgba(120,120,200,0.12)" stroke-width="0.5" />
      {/each}
      <path d={pathD} fill="none" stroke="#7cf" stroke-width="1.3" />
    </svg>
    <div class="axes">
      <span class="ax">0′</span>
      <span class="ax-label">
        {logScale ? 'log rel. luminance' : 'rel. luminance'} · peak {peakLum.toFixed(3)}
      </span>
      <span class="ax">{maxDist.toFixed(1)}′</span>
    </div>
  {/if}
  <div class="foot">displayed relative luminance (8-bit), not calibrated flux · {(coverage * 100).toFixed(0)}% covered</div>
</div>

<style>
  .xsection-plot {
    background: #12122a;
    border: 1px solid #345;
    border-radius: 6px;
    padding: 6px 8px;
    color: #ccd;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 296px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .title {
    font-weight: 600;
    color: #9cf;
    flex: 1;
  }
  .mode-btn,
  .close-btn {
    background: #22243a;
    border: 1px solid #445;
    border-radius: 4px;
    color: #ccd;
    cursor: pointer;
    font-size: 10px;
    padding: 2px 6px;
    font-family: inherit;
  }
  .mode-btn[aria-pressed='true'] {
    background: #2a3a5a;
    color: #bdf;
    border-color: #57a;
  }
  .close-btn {
    padding: 2px 7px;
  }
  .plot-svg {
    display: block;
    border-radius: 3px;
  }
  .no-data {
    padding: 24px 8px;
    text-align: center;
    color: #889;
    font-style: italic;
  }
  .axes {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 2px;
    color: #89a;
    font-size: 10px;
  }
  .ax-label {
    color: #9ab;
  }
  .foot {
    margin-top: 3px;
    color: #667;
    font-size: 9px;
  }
</style>
