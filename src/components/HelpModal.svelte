<script lang="ts">
  let {
    open = false,
    onClose,
  }: {
    open?: boolean;
    onClose?: () => void;
  } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose?.();
  }

  interface HelpEntry {
    label: string;
    description: string;
  }

  const shortcuts: HelpEntry[] = [
    { label: 'Mouse drag', description: 'Pan the view' },
    { label: 'Scroll wheel', description: 'Zoom in/out' },
    { label: 'Double-click', description: 'Zoom in to point' },
    { label: '+/-', description: 'Zoom in/out' },
    { label: '0', description: 'Reset zoom' },
    { label: 'H', description: 'Toggle this help' },
  ];

  const scalingHelp: HelpEntry[] = [
    { label: 'Linear', description: 'Simple min-max normalization. Best for high-contrast data.' },
    { label: 'Log', description: 'Logarithmic stretch. Reveals faint structure near bright sources.' },
    { label: 'Square Root', description: 'Moderate stretch between linear and log.' },
    { label: 'Asinh', description: 'Inverse hyperbolic sine. Handles wide dynamic range well.' },
    { label: 'Histogram', description: 'Equalizes pixel distribution. Maximizes visible detail.' },
    { label: 'ZScale', description: 'IRAF-style auto-scaling. Standard in astronomy.' },
    { label: 'Percentile', description: 'Clips to percentile range. Good for removing outliers.' },
  ];
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Help" onkeydown={handleKeydown}>
    <div class="modal-content">
      <div class="modal-header">
        <h2>Rubin Image Viewer Help</h2>
        <button class="close-button" onclick={() => onClose?.()} aria-label="Close help">×</button>
      </div>

      <section>
        <h3>Keyboard Shortcuts</h3>
        <dl>
          {#each shortcuts as entry}
            <div class="help-row">
              <dt>{entry.label}</dt>
              <dd>{entry.description}</dd>
            </div>
          {/each}
        </dl>
      </section>

      <section>
        <h3>Scaling Methods</h3>
        <dl>
          {#each scalingHelp as entry}
            <div class="help-row">
              <dt>{entry.label}</dt>
              <dd>{entry.description}</dd>
            </div>
          {/each}
        </dl>
      </section>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: #1a1a2e;
    border: 1px solid #444;
    border-radius: 8px;
    max-width: 520px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    padding: 24px;
    color: #e0e0e0;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
    color: #fff;
  }

  h3 {
    font-size: 14px;
    color: #8cf;
    margin: 16px 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .close-button {
    background: none;
    border: none;
    color: #aaa;
    font-size: 24px;
    cursor: pointer;
    padding: 0 4px;
  }

  .close-button:hover {
    color: #fff;
  }

  dl {
    margin: 0;
  }

  .help-row {
    display: flex;
    gap: 12px;
    padding: 4px 0;
    border-bottom: 1px solid #2a2a3e;
  }

  dt {
    min-width: 120px;
    font-weight: 600;
    color: #ccc;
    font-family: monospace;
  }

  dd {
    margin: 0;
    color: #999;
  }
</style>
