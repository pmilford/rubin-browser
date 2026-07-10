<script lang="ts">
  import { profilePath, type LineProfile, type ProfileChannel } from '../utils/crossSection.js';

  let {
    profile = null as LineProfile | null,
    onClose,
  }: {
    profile?: LineProfile | null;
    onClose?: () => void;
  } = $props();

  let logScale = $state(false);

  // Which channels to trace. Luminance (grayscale) on by default; R/G/B off. For a
  // colour-composite base (DSS/Rubin gri) these are the composite's channels; true
  // per-FILTER-layer traces need per-layer buffers (a follow-up).
  const CHANNELS: { key: ProfileChannel; label: string; color: string }[] = [
    { key: 'lum', label: 'Lum', color: '#9cc7ff' },
    { key: 'r', label: 'R', color: '#ff6b6b' },
    { key: 'g', label: 'G', color: '#5fd35f' },
    { key: 'b', label: 'B', color: '#5fa8ff' },
  ];
  let enabled = $state<Record<ProfileChannel, boolean>>({ lum: true, r: false, g: false, b: false });
  function toggleChannel(k: ProfileChannel) {
    // Keep at least one channel visible.
    const next = { ...enabled, [k]: !enabled[k] };
    if (CHANNELS.some((c) => next[c.key])) enabled = next;
  }

  const W = 280;
  const H = 120;

  // Fraction of samples that have data (the rest are gaps / no-data).
  const coverage = $derived.by(() => {
    if (!profile || profile.lum.length === 0) return 0;
    const n = profile.gap.filter((g) => !g).length;
    return n / profile.lum.length;
  });
  const hasData = $derived(coverage > 0);

  // One SVG path per enabled channel (drawn back-to-front: colours under lum).
  const tracePaths = $derived.by(() =>
    !profile || !hasData
      ? []
      : CHANNELS.filter((c) => enabled[c.key]).map((c) => ({
          color: c.color,
          key: c.key,
          d: profilePath(profile, W, H, logScale, 1e-3, c.key),
        }))
  );
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
    <div class="channels" role="group" aria-label="Cross-section channels">
      {#each CHANNELS as c (c.key)}
        <button
          class="chan-btn"
          class:on={enabled[c.key]}
          style={`--chan: ${c.color}`}
          aria-pressed={enabled[c.key]}
          aria-label={`Toggle ${c.label} channel`}
          onclick={() => toggleChannel(c.key)}
        >{c.label}</button>
      {/each}
    </div>
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
      {#each tracePaths as tp (tp.key)}
        <path d={tp.d} fill="none" stroke={tp.color} stroke-width="1.3" data-channel={tp.key} />
      {/each}
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
  .channels {
    display: inline-flex;
    gap: 2px;
  }
  .chan-btn {
    background: #1a1c30;
    border: 1px solid #334;
    border-radius: 3px;
    color: #667;
    cursor: pointer;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 5px;
    font-family: inherit;
    min-width: 20px;
  }
  .chan-btn.on {
    color: var(--chan);
    border-color: var(--chan);
    background: #15182c;
    box-shadow: inset 0 -2px 0 var(--chan);
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
