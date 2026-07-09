<script lang="ts">
  /**
   * DS9-style display transfer controls that operate on the post-stretch value
   * (after the scale function, before the colormap): black/white points, plus
   * contrast (slope about the midpoint) and bias (midpoint position). Identity at
   * defaults (0, 1, 1, 0.5). See the project literature notes for the model.
   */
  let {
    blackPoint = 0,
    whitePoint = 1,
    contrast = 1,
    bias = 0.5,
    onChange,
  }: {
    blackPoint?: number;
    whitePoint?: number;
    contrast?: number;
    bias?: number;
    onChange: (v: { blackPoint: number; whitePoint: number; contrast: number; bias: number }) => void;
  } = $props();

  function emit(patch: Partial<{ blackPoint: number; whitePoint: number; contrast: number; bias: number }>) {
    onChange({ blackPoint, whitePoint, contrast, bias, ...patch });
  }

  function reset() {
    onChange({ blackPoint: 0, whitePoint: 1, contrast: 1, bias: 0.5 });
  }

  const isDefault = $derived(
    blackPoint === 0 && whitePoint === 1 && contrast === 1 && bias === 0.5
  );
</script>

<div class="stretch-controls" aria-label="Stretch controls">
  <div class="ctl">
    <label for="stretch-black">Black point</label>
    <input
      id="stretch-black"
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={blackPoint}
      oninput={(e) => emit({ blackPoint: Math.min(whitePoint - 0.01, +e.currentTarget.value) })}
    />
    <output>{blackPoint.toFixed(2)}</output>
  </div>

  <div class="ctl">
    <label for="stretch-white">White point</label>
    <input
      id="stretch-white"
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={whitePoint}
      oninput={(e) => emit({ whitePoint: Math.max(blackPoint + 0.01, +e.currentTarget.value) })}
    />
    <output>{whitePoint.toFixed(2)}</output>
  </div>

  <div class="ctl">
    <label for="stretch-contrast">Contrast</label>
    <input
      id="stretch-contrast"
      type="range"
      min="0.1"
      max="4"
      step="0.05"
      value={contrast}
      oninput={(e) => emit({ contrast: +e.currentTarget.value })}
    />
    <output>{contrast.toFixed(2)}</output>
  </div>

  <div class="ctl">
    <label for="stretch-bias">Bias</label>
    <input
      id="stretch-bias"
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={bias}
      oninput={(e) => emit({ bias: +e.currentTarget.value })}
    />
    <output>{bias.toFixed(2)}</output>
  </div>

  <button class="reset-btn" onclick={reset} disabled={isDefault}>Reset stretch</button>
</div>

<style>
  .stretch-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ctl {
    display: grid;
    grid-template-columns: 78px 1fr 38px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #ccc;
  }

  .ctl label {
    color: #9aa;
  }

  .ctl input[type='range'] {
    width: 100%;
    accent-color: #6a6aff;
  }

  .ctl output {
    text-align: right;
    font-family: monospace;
    color: #ccf;
    font-size: 11px;
  }

  .reset-btn {
    align-self: flex-start;
    background: #2a2a3e;
    color: #ccc;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .reset-btn:hover:not(:disabled) {
    background: #3a3a5e;
    color: #fff;
    border-color: #6a6aff;
  }

  .reset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
