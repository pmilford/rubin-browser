<script lang="ts">
  interface HistogramBin {
    x0: number;
    x1: number;
    count: number;
  }

  let {
    data = [] as number[],
    bins = 64,
    min = 0,
    max = 1,
    stretchMin = $bindable(0),
    stretchMax = $bindable(1),
    onStretchChange,
  }: {
    data?: number[];
    bins?: number;
    min?: number;
    max?: number;
    stretchMin?: number;
    stretchMax?: number;
    onStretchChange?: (min: number, max: number) => void;
  } = $props();

  const histogramData = $derived(computeHistogram(data, bins, min, max));
  const maxCount = $derived(
    histogramData.length > 0 ? Math.max(...histogramData.map(b => b.count)) : 1
  );

  function computeHistogram(values: number[], numBins: number, vMin: number, vMax: number): HistogramBin[] {
    if (values.length === 0 || vMax <= vMin) return [];

    const binWidth = (vMax - vMin) / numBins;
    const bins_arr: HistogramBin[] = [];

    for (let i = 0; i < numBins; i++) {
      const x0 = vMin + i * binWidth;
      const x1 = x0 + binWidth;
      bins_arr.push({ x0, x1, count: 0 });
    }

    for (const v of values) {
      if (v < vMin || v > vMax) continue;
      const idx = Math.min(Math.floor((v - vMin) / binWidth), numBins - 1);
      const bin = bins_arr[idx];
      if (bin) bin.count++;
    }

    return bins_arr;
  }

  const barWidth = 256;
  const barHeight = 80;

  function handleStretchMinInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const val = parseFloat(target.value);
    stretchMin = Math.min(val, stretchMax);
    onStretchChange?.(stretchMin, stretchMax);
  }

  function handleStretchMaxInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const val = parseFloat(target.value);
    stretchMax = Math.max(val, stretchMin);
    onStretchChange?.(stretchMin, stretchMax);
  }

  const stretchMinPercent = $derived(((stretchMin - min) / (max - min)) * 100);
  const stretchMaxPercent = $derived(((stretchMax - min) / (max - min)) * 100);
</script>

<div class="histogram" role="region" aria-label="Pixel histogram">
  <div class="histogram-title">
    <span>Histogram</span>
    <span class="histogram-range">[{min.toFixed(2)}, {max.toFixed(2)}]</span>
    <span class="histogram-count">{data.length} px</span>
  </div>

  {#if histogramData.length > 0}
    <svg
      width={barWidth}
      height={barHeight}
      viewBox="0 0 {barWidth} {barHeight}"
      aria-label="Histogram chart"
      role="img"
    >
      {#each histogramData as bin, i}
        {@const barH = maxCount > 0 ? (bin.count / maxCount) * (barHeight - 4) : 0}
        {@const x = (i / histogramData.length) * barWidth}
        {@const w = barWidth / histogramData.length}
        {@const inRange = bin.x0 >= stretchMin && bin.x1 <= stretchMax}
        <rect
          x={x + 0.5}
          y={barHeight - barH}
          width={Math.max(0, w - 1)}
          height={barH}
          fill={inRange ? '#6a6aff' : '#444'}
          opacity={inRange ? 0.9 : 0.4}
        />
      {/each}

      <!-- Stretch min line -->
      <line
        x1={stretchMinPercent * barWidth / 100}
        y1={0}
        x2={stretchMinPercent * barWidth / 100}
        y2={barHeight}
        stroke="#f66"
        stroke-width="1.5"
        stroke-dasharray="3,2"
      />

      <!-- Stretch max line -->
      <line
        x1={stretchMaxPercent * barWidth / 100}
        y1={0}
        x2={stretchMaxPercent * barWidth / 100}
        y2={barHeight}
        stroke="#6f6"
        stroke-width="1.5"
        stroke-dasharray="3,2"
      />
    </svg>
  {:else}
    <div class="no-data">No pixel data</div>
  {/if}

  <div class="stretch-controls">
    <div class="stretch-row">
      <label for="stretch-min">Min</label>
      <input
        id="stretch-min"
        type="range"
        min={min}
        max={max}
        step={(max - min) / 256}
        value={stretchMin}
        oninput={handleStretchMinInput}
        aria-label="Stretch minimum"
      />
      <span class="stretch-value">{stretchMin.toFixed(3)}</span>
    </div>
    <div class="stretch-row">
      <label for="stretch-max">Max</label>
      <input
        id="stretch-max"
        type="range"
        min={min}
        max={max}
        step={(max - min) / 256}
        value={stretchMax}
        oninput={handleStretchMaxInput}
        aria-label="Stretch maximum"
      />
      <span class="stretch-value">{stretchMax.toFixed(3)}</span>
    </div>
  </div>
</div>

<style>
  .histogram {
    background: #1a1a2e;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 8px;
    font-size: 11px;
    color: #e0e0e0;
  }

  .histogram-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .histogram-range {
    color: #888;
    font-weight: normal;
    font-family: 'Courier New', monospace;
  }

  .histogram-count {
    color: #8cf;
    font-weight: normal;
    margin-left: auto;
  }

  svg {
    display: block;
    background: #111;
    border: 1px solid #333;
    border-radius: 2px;
    width: 100%;
  }

  .no-data {
    text-align: center;
    color: #666;
    padding: 20px;
    font-style: italic;
  }

  .stretch-controls {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stretch-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .stretch-row label {
    color: #aaa;
    min-width: 28px;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
  }

  .stretch-row input[type="range"] {
    flex: 1;
    accent-color: #6a6aff;
    cursor: pointer;
  }

  .stretch-value {
    color: #8cf;
    font-family: 'Courier New', monospace;
    min-width: 50px;
    text-align: right;
  }
</style>
