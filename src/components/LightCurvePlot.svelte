<script lang="ts">
  /**
   * Light-curve (intensity/flux vs TIME) plot with a TIME-PROPORTIONAL x-axis, so
   * real observing gaps are visible; multi-band overlay (each filter a coloured
   * series with a toggleable legend); tick-labelled axes; an expandable window; and
   * a hover read-out of the exact MJD / date / value under the cursor. Sources:
   *   - offline synthetic cube (single band + a current-epoch blink marker),
   *   - Rubin DP1 forced photometry (all bands overlaid),
   *   - Gaia DR2 epoch photometry (g/bp/rp overlaid).
   *
   * Back-compat: a single `curve` (+ `currentIndex`) still renders as one series —
   * the offline call site and the presentational unit test use that path.
   */
  import { mjdToIso } from '../types/image.js';
  import type { LightCurvePoint } from '../data/offlineDataset.js';
  import {
    cleanPoints,
    seriesDomain,
    niceTicks,
    gapSegments,
    normalizeIntensities,
    bandColor,
    formatValue,
    uniqueSorted,
    buildCompressedSegments,
    compressedCoord,
    isInCollapsedGap,
    foldPhase,
    type LcSeries,
    type LcSeriesPoint,
  } from '../utils/lightCurvePlot.js';

  let {
    series = [] as LcSeries[],
    curve = null as LightCurvePoint[] | null,
    currentIndex = -1,
    currentMjd = null as number | null,
    band = 'r',
    yLabel = 'intensity',
    title = 'Light curve',
    status = null as string | null,
    footNote = 'ground-truth synthetic intensity (counts) at the view centre · not real observations',
    onRefresh,
    onClose,
  }: {
    /** One entry per band (overlaid). Preferred over `curve` for multi-band data. */
    series?: LcSeries[];
    /** Back-compat single series (wrapped into `series` when `series` is empty). */
    curve?: LightCurvePoint[] | null;
    /** Back-compat epoch-blink marker index into `curve` (offline). */
    currentIndex?: number;
    /** Marker time (MJD) — takes precedence over `currentIndex` when set. */
    currentMjd?: number | null;
    /** Band label for the single-series (`curve`) path. */
    band?: string;
    yLabel?: string;
    title?: string;
    /** Loading / error / info message shown when there is no curve. */
    status?: string | null;
    footNote?: string;
    onRefresh?: () => void;
    onClose?: () => void;
  } = $props();

  // --- window size (expandable) -------------------------------------------------
  let expanded = $state(false);
  const W = $derived(expanded ? 620 : 300);
  const H = $derived(expanded ? 340 : 150);
  const M = { l: 48, r: 12, t: 10, b: 30 };
  const plotW = $derived(W - M.l - M.r);
  const plotH = $derived(H - M.t - M.b);

  // --- normalise + legend state -------------------------------------------------
  let normalized = $state(false);
  let hidden = $state<string[]>([]);
  // Compress large observing gaps to a short break (so dense clusters aren't
  // squashed by a season-long void). Opt-in; the default axis stays true-to-time.
  let compress = $state(false);
  // Phase-fold onto a single cycle at a user-entered period (days) — reveals the
  // shape of a periodic variable. Opt-in; the default axis stays time (MJD).
  let folded = $state(false);
  let periodDays = $state(1);

  // --- assemble series (series prop wins; else wrap the back-compat curve) -------
  const allSeries = $derived.by((): { band: string; color: string; points: LcSeriesPoint[] }[] => {
    const raw: LcSeries[] = series && series.length ? series : curve && curve.length ? [{ band, points: curve }] : [];
    return raw
      .map((s, i) => ({ band: s.band, color: s.color ?? bandColor(s.band, i), points: cleanPoints(s.points) }))
      .filter((s) => s.points.length > 0);
  });
  const hasAny = $derived(allSeries.length > 0);
  const visibleSeries = $derived(allSeries.filter((s) => !hidden.includes(s.band)));
  const multi = $derived(allSeries.length > 1);

  // Fold is only meaningful (and only offered) with a valid positive period.
  const foldActive = $derived(folded && Number.isFinite(periodDays) && periodDays > 0);

  /**
   * One plotted point: `x` is the axis coordinate (MJD in time mode, PHASE 0–1 in
   * fold mode), `y` the mapped value (normalised or raw), `v` the true value, `err`
   * the 1σ uncertainty in the SAME units as `v` (only when normalise is off — a
   * whisker in normalised space would need per-band rescaling and isn't drawn).
   */
  interface PlotPoint {
    mjd: number;
    y: number;
    v: number;
    mag?: number;
    err?: number;
  }
  const plotSeries = $derived.by((): { band: string; color: string; points: PlotPoint[] }[] =>
    visibleSeries.map((s) => {
      const norm = normalized ? normalizeIntensities(s.points) : null;
      let pts: PlotPoint[] = s.points.map((p, i) => ({
        mjd: p.mjd,
        y: norm ? norm[i]! : p.intensity,
        v: p.intensity,
        mag: p.mag,
        // Only carry a whisker in RAW space (normalise would distort per-band σ).
        ...(!normalized && typeof p.err === 'number' && Number.isFinite(p.err) && p.err > 0 ? { err: p.err } : {}),
      }));
      if (foldActive) {
        pts = pts
          .map((p) => ({ ...p, mjd: foldPhase(p.mjd, periodDays) }))
          .filter((p) => Number.isFinite(p.mjd))
          .sort((a, b) => a.mjd - b.mjd);
      }
      return { band: s.band, color: s.color, points: pts };
    })
  );

  // Domain over the *plotted* y (so it recomputes when a band is toggled or on normalise).
  const domain = $derived(seriesDomain(plotSeries.map((s) => ({ band: s.band, points: s.points.map((p) => ({ mjd: p.mjd, intensity: p.y })) }))));
  const hasData = $derived(!!domain);

  // --- compressed time axis (opt-in) --------------------------------------------
  // Union of every visible epoch, and the piecewise-linear compressed axis over it.
  const unionMjds = $derived(uniqueSorted(plotSeries.flatMap((s) => s.points.map((p) => p.mjd))));
  const compAxis = $derived(buildCompressedSegments(unionMjds));
  // A compressed view only matters when there IS a collapsed gap to remove.
  // Folding replaces the time axis entirely, so gap-compression is mutually exclusive.
  const hasGap = $derived(compAxis.segments.some((s) => s.gap));
  const compressing = $derived(!foldActive && compress && hasGap && compAxis.totalC > 0);

  // --- scales -------------------------------------------------------------------
  const xOf = (mjd: number): number => {
    if (!domain) return M.l;
    // Fold mode: `mjd` already carries a PHASE in [0,1) — map it across the full width.
    if (foldActive) return M.l + Math.max(0, Math.min(1, mjd)) * plotW;
    if (compressing) return M.l + (compressedCoord(mjd, compAxis.segments, compAxis.totalC) / compAxis.totalC) * plotW;
    if (domain.mjdMax === domain.mjdMin) return M.l + plotW / 2;
    return M.l + ((mjd - domain.mjdMin) / (domain.mjdMax - domain.mjdMin)) * plotW;
  };
  const yOf = (v: number): number => {
    if (!domain) return M.t;
    if (domain.vMax === domain.vMin) return M.t + plotH / 2;
    return M.t + plotH - ((v - domain.vMin) / (domain.vMax - domain.vMin)) * plotH;
  };

  // In compressed mode hide any tick that lands inside a collapsed void (its x would
  // misleadingly sit in the short break). The break glyphs mark those spans instead.
  const xTicks = $derived.by(() => {
    if (!domain) return [];
    // Fold mode: fixed phase gridlines across a single 0–1 cycle.
    if (foldActive) return [0, 0.25, 0.5, 0.75, 1];
    const ticks = niceTicks(domain.mjdMin, domain.mjdMax, expanded ? 7 : 4);
    return compressing ? ticks.filter((t) => !isInCollapsedGap(t, compAxis.segments)) : ticks;
  });
  /** X tick label: integer MJD in time mode, 2-dp phase in fold mode. */
  const xTickLabel = (t: number): string => (foldActive ? t.toFixed(2) : String(Math.round(t)));
  const yTicks = $derived(domain ? niceTicks(domain.vMin, domain.vMax, expanded ? 6 : 4) : []);

  // Screen x of each collapsed gap's break glyph (midpoint of the short break span).
  const breakXs = $derived(
    compressing
      ? compAxis.segments.filter((s) => s.gap).map((s) => M.l + (((s.c0 + s.c1) / 2) / compAxis.totalC) * plotW)
      : []
  );

  // Per-series gap-aware line segments (dashed + dimmed across large temporal gaps).
  const segmentsFor = (pts: PlotPoint[]): { x1: number; y1: number; x2: number; y2: number; gap: boolean }[] => {
    const gaps = gapSegments(pts.map((p) => ({ mjd: p.mjd, intensity: p.y })));
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      segs.push({ x1: xOf(pts[i - 1]!.mjd), y1: yOf(pts[i - 1]!.y), x2: xOf(pts[i]!.mjd), y2: yOf(pts[i]!.y), gap: gaps[i - 1]! });
    }
    return segs;
  };

  // Current-epoch marker (offline blink): explicit currentMjd, else curve[currentIndex].
  const markerMjd = $derived.by((): number | null => {
    if (currentMjd != null && Number.isFinite(currentMjd)) return currentMjd;
    if (curve && currentIndex >= 0 && currentIndex < curve.length) return curve[currentIndex]!.mjd;
    return null;
  });
  const markerInRange = $derived(
    !foldActive &&
      markerMjd != null && domain != null && markerMjd >= domain.mjdMin && markerMjd <= domain.mjdMax
  );

  // Soft "scales differ" hint: overlaid, un-normalised, and one band's peak dwarfs another's.
  const scalesDiffer = $derived.by(() => {
    if (!multi || normalized || visibleSeries.length < 2) return false;
    const peaks = visibleSeries.map((s) => Math.max(...s.points.map((p) => Math.abs(p.intensity)))).filter((v) => v > 0);
    if (peaks.length < 2) return false;
    return Math.max(...peaks) / Math.min(...peaks) > 20;
  });

  // --- hover read-out -----------------------------------------------------------
  let hover = $state<{ band: string; mjd: number; v: number; mag?: number; err?: number; color: string } | null>(null);

  function toggleBand(b: string): void {
    hidden = hidden.includes(b) ? hidden.filter((x) => x !== b) : [...hidden, b];
  }
</script>

<div class="lc-plot" role="region" aria-label="Light curve" style={`width:${W + 16}px`}>
  <div class="header">
    <span class="title">{title}</span>
    {#if !multi}
      <span class="band-tag">{band === 'all' ? 'luminance' : band}</span>
    {/if}
    {#if multi}
      <button
        class="ctl"
        class:on={normalized}
        aria-label="Normalise bands"
        aria-pressed={normalized}
        title="Rescale each band to 0–1 so filters with different flux levels are shape-comparable"
        onclick={() => (normalized = !normalized)}>norm</button
      >
    {/if}
    {#if hasGap && !folded}
      <button
        class="ctl"
        class:on={compress}
        aria-label="Compress time gaps"
        aria-pressed={compress}
        title="Collapse long observing gaps to a short break so the dense data isn't squashed"
        onclick={() => (compress = !compress)}>⇥gap</button
      >
    {/if}
    {#if hasAny}
      <button
        class="ctl"
        class:on={folded}
        aria-label="Phase fold"
        aria-pressed={folded}
        title="Fold the light curve onto a single cycle at the entered period (days)"
        onclick={() => (folded = !folded)}>⟳fold</button
      >
      {#if folded}
        <input
          class="period-input"
          type="number"
          min="0.0001"
          step="0.1"
          bind:value={periodDays}
          aria-label="Fold period (days)"
          title="Period in days"
        />
      {/if}
    {/if}
    <button
      class="ctl"
      aria-label={expanded ? 'Collapse light curve' : 'Expand light curve'}
      aria-pressed={expanded}
      title={expanded ? 'Shrink the plot' : 'Enlarge the plot'}
      onclick={() => (expanded = !expanded)}>{expanded ? '⤡' : '⤢'}</button
    >
    {#if onRefresh}
      <button class="ctl" aria-label="Refresh light curve" title="Fetch at the current centre" onclick={onRefresh}>↻</button>
    {/if}
    {#if onClose}
      <button class="ctl" aria-label="Close light curve" onclick={onClose}>×</button>
    {/if}
  </div>

  {#if !hasAny}
    <div class="no-data" aria-label="Light curve status">{status ?? 'no time axis (offline cube only)'}</div>
  {:else if !hasData}
    <div class="no-data" aria-label="Light curve status">all bands hidden — re-enable one in the legend</div>
  {:else}
    <div class="plot-row">
      <span class="y-axis-label" aria-label="Y axis">{normalized ? 'normalised 0–1' : yLabel}</span>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        class="plot-svg"
        aria-label="Intensity vs time"
        onmouseleave={() => (hover = null)}
      >
        <rect x="0" y="0" width={W} height={H} fill="rgba(8,10,22,0.95)" />
        <!-- y grid + ticks -->
        {#each yTicks as t (t)}
          {@const gy = yOf(t)}
          <line x1={M.l} y1={gy} x2={W - M.r} y2={gy} stroke="rgba(120,140,220,0.14)" stroke-width="0.5" />
          <text class="tick" x={M.l - 4} y={gy + 3} text-anchor="end">{formatValue(t)}</text>
        {/each}
        <!-- x grid + ticks -->
        {#each xTicks as t (t)}
          {@const gx = xOf(t)}
          <line x1={gx} y1={M.t} x2={gx} y2={H - M.b} stroke="rgba(120,140,220,0.10)" stroke-width="0.5" />
          <text class="tick" x={gx} y={H - M.b + 12} text-anchor="middle">{xTickLabel(t)}</text>
        {/each}
        <!-- axes frame -->
        <line x1={M.l} y1={M.t} x2={M.l} y2={H - M.b} stroke="rgba(150,170,230,0.5)" stroke-width="0.8" />
        <line x1={M.l} y1={H - M.b} x2={W - M.r} y2={H - M.b} stroke="rgba(150,170,230,0.5)" stroke-width="0.8" />

        <!-- break glyphs marking each collapsed time gap (compressed axis) -->
        {#each breakXs as bx, bi (bi)}
          <g class="axis-break" aria-label="Time gap break">
            <line x1={bx} y1={M.t} x2={bx} y2={H - M.b} stroke="rgba(255,180,90,0.35)" stroke-width="1" stroke-dasharray="1,3" />
            <path d={`M${bx - 3},${H - M.b + 1} l4,-5 M${bx - 1},${H - M.b + 1} l4,-5`} stroke="#fb5" stroke-width="1" fill="none" />
          </g>
        {/each}

        <!-- current-epoch (offline blink) marker -->
        {#if markerInRange && markerMjd != null}
          <line
            x1={xOf(markerMjd)}
            y1={M.t}
            x2={xOf(markerMjd)}
            y2={H - M.b}
            stroke="#fc6"
            stroke-width="1"
            stroke-dasharray="2,2"
            aria-label="Current epoch marker"
          />
        {/if}

        <!-- series (one <g data-band> each; per-segment lines allow gap dashing).
             Fold mode draws POINTS + error bars only — a connecting line would
             cross the 0↔1 phase seam and mislead. -->
        {#each plotSeries as s (s.band)}
          <g class="series" data-band={s.band}>
            {#if !foldActive}
              {#each segmentsFor(s.points) as seg, si (si)}
                <line
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke={s.color}
                  stroke-width={expanded ? 1.6 : 1.3}
                  stroke-dasharray={seg.gap ? '3,3' : undefined}
                  opacity={seg.gap ? 0.4 : 1}
                />
              {/each}
            {/if}
            <!-- 1σ error-bar whiskers (only where a finite positive err is present) -->
            {#each s.points as p, ei (ei)}
              {#if p.err != null && p.err > 0}
                {@const ex = xOf(p.mjd)}
                {@const yhi = yOf(p.v + p.err)}
                {@const ylo = yOf(p.v - p.err)}
                <g class="errbar" aria-label={`${s.band} error bar`}>
                  <line x1={ex} y1={yhi} x2={ex} y2={ylo} stroke={s.color} stroke-width="1" opacity="0.6" />
                  <line x1={ex - 2} y1={yhi} x2={ex + 2} y2={yhi} stroke={s.color} stroke-width="1" opacity="0.6" />
                  <line x1={ex - 2} y1={ylo} x2={ex + 2} y2={ylo} stroke={s.color} stroke-width="1" opacity="0.6" />
                </g>
              {/if}
            {/each}
            {#each s.points as p, pi (pi)}
              <circle
                cx={xOf(p.mjd)}
                cy={yOf(p.y)}
                r={expanded ? 2.6 : 1.9}
                fill={s.color}
                stroke="transparent"
                stroke-width="6"
                role="img"
                aria-label={`${s.band} ${foldActive ? 'phase' : 'MJD'} ${p.mjd.toFixed(3)} value ${formatValue(p.v)}`}
                onmouseenter={() => (hover = { band: s.band, mjd: p.mjd, v: p.v, mag: p.mag, err: p.err, color: s.color })}
              />
            {/each}
          </g>
        {/each}
      </svg>
    </div>

    <div class="x-axis-label" aria-label="X axis">
      {foldActive ? `Phase (fold @ ${periodDays} d)` : 'Time (MJD)'}
    </div>

    {#if multi}
      <div class="legend" aria-label="Band legend">
        {#each allSeries as s (s.band)}
          <button
            class="chip"
            class:off={hidden.includes(s.band)}
            aria-label={`Toggle band ${s.band}`}
            aria-pressed={!hidden.includes(s.band)}
            onclick={() => toggleBand(s.band)}
          >
            <span class="swatch" style={`background:${s.color}`}></span>{s.band === 'all' ? 'lum' : s.band}
          </button>
        {/each}
      </div>
    {/if}

    {#if scalesDiffer}
      <div class="hint" aria-label="Scale hint">bands differ in scale — try “norm” or hover for true values</div>
    {/if}

    <div class="readout" aria-label="Light curve readout">
      {#if hover}
        <span class="ro-band" style={`color:${hover.color}`}>{hover.band === 'all' ? 'lum' : hover.band}</span>
        {#if foldActive}phase {hover.mjd.toFixed(3)}{:else}MJD {hover.mjd.toFixed(3)} · {mjdToIso(hover.mjd)}{/if} · {formatValue(hover.v)}{#if hover.err != null && hover.err > 0}
          ± {formatValue(hover.err)}{/if}{#if hover.mag != null}
          · {hover.mag.toFixed(2)} mag{/if}
      {:else}
        hover a point for its MJD, date &amp; value
      {/if}
    </div>
  {/if}
  <div class="foot">{footNote}</div>
</div>

<style>
  .lc-plot {
    background: #10122a;
    border: 1px solid #345;
    border-radius: 6px;
    padding: 6px 8px;
    color: #ccd;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .title { font-weight: 600; color: #9fd; flex: 1; }
  .ctl {
    background: #22243a; border: 1px solid #445; border-radius: 4px; color: #ccd;
    cursor: pointer; font-size: 10px; padding: 2px 7px; font-family: inherit;
  }
  .ctl.on { background: #2b6; color: #041; border-color: #3c7; }
  .period-input {
    width: 56px; background: #1a1c33; border: 1px solid #445; border-radius: 4px;
    color: #cde; font: inherit; font-size: 10px; padding: 1px 4px;
  }
  .band-tag { color: #9fd; font-weight: 600; }
  .plot-row { display: flex; align-items: stretch; gap: 3px; }
  .y-axis-label {
    writing-mode: vertical-rl; transform: rotate(180deg);
    font-size: 8px; color: #89a; text-align: center; align-self: center;
  }
  .x-axis-label { text-align: center; font-size: 9px; color: #89a; margin-top: 1px; }
  .plot-svg { display: block; border-radius: 3px; }
  .tick { fill: #89a; font-size: 8px; font-family: inherit; }
  .no-data { padding: 24px 8px; text-align: center; color: #889; font-style: italic; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: #1a1c33; border: 1px solid #445; border-radius: 10px; color: #cde;
    font-size: 9px; padding: 1px 7px 1px 5px; cursor: pointer; font-family: inherit;
  }
  .chip.off { opacity: 0.4; text-decoration: line-through; }
  .swatch { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .hint { margin-top: 3px; color: #db8; font-size: 9px; }
  .readout { margin-top: 3px; color: #9ab; font-size: 9px; min-height: 12px; }
  .ro-band { font-weight: 700; margin-right: 3px; }
  .foot { margin-top: 3px; color: #667; font-size: 9px; }
</style>
