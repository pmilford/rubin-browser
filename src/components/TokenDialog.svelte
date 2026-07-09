<script lang="ts">
  import {
    setToken,
    clearToken,
    getToken,
    isAuthenticated,
    validateToken,
  } from '../api/auth.js';

  let {
    open = false,
    onClose,
    onTokenChange,
  }: {
    open?: boolean;
    onClose: () => void;
    onTokenChange: (token: string | null) => void;
  } = $props();

  let tokenInput = $state('');
  let inputEl: HTMLInputElement | undefined = $state();

  // Auth status snapshot — refreshed explicitly (on open and after mutations)
  // rather than re-derived, so isAuthenticated() side effects stay controlled.
  let authed = $state(false);
  let expiryLabel: string | null = $state(null);

  // Validation state
  let validating = $state(false);
  let validationResult: 'ok' | 'failed' | null = $state(null);
  let validationError = $state('');

  function refreshStatus() {
    authed = isAuthenticated();
    if (authed) {
      const token = getToken();
      const exp = token ? parseExpiry(token) : null;
      expiryLabel = exp ? new Date(exp).toLocaleString() : null;
    } else {
      expiryLabel = null;
    }
  }

  function parseExpiry(token: string): number | null {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  // Focus the input when the dialog opens, and reset transient state.
  $effect(() => {
    if (open) {
      tokenInput = '';
      validationResult = null;
      validationError = '';
      validating = false;
      refreshStatus();
      // Focus after the DOM updates.
      queueMicrotask(() => inputEl?.focus());
    }
  });

  function handleSave() {
    const token = tokenInput.trim();
    if (!token) return;
    setToken(token);
    refreshStatus();
    onTokenChange(token);
    onClose();
  }

  function handleClear() {
    clearToken();
    tokenInput = '';
    validationResult = null;
    validationError = '';
    refreshStatus();
    onTokenChange(null);
  }

  async function handleValidate() {
    const token = tokenInput.trim();
    if (!token) return;
    validating = true;
    validationResult = null;
    validationError = '';
    try {
      const ok = await validateToken(token);
      validationResult = ok ? 'ok' : 'failed';
    } catch (err) {
      validationResult = 'failed';
      validationError = err instanceof Error ? err.message : String(err);
    } finally {
      validating = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="RSP Authentication Token"
    onkeydown={handleKeydown}
  >
    <div class="modal-content">
      <div class="modal-header">
        <h2>Rubin Science Platform Token</h2>
        <button class="close-button" onclick={() => onClose()} aria-label="Close token dialog">×</button>
      </div>

      <div class="status-row" data-authenticated={authed}>
        {#if authed}
          <span class="status-badge status-ok">Authenticated</span>
          {#if expiryLabel}
            <span class="status-detail">Token expires {expiryLabel}</span>
          {/if}
        {:else}
          <span class="status-badge status-off">Not authenticated</span>
          <span class="status-detail">using public preview imagery (DSS)</span>
        {/if}
      </div>

      <label class="field-label" for="rsp-token-input">Paste your RSP token</label>
      <input
        id="rsp-token-input"
        class="token-input"
        type="password"
        bind:this={inputEl}
        bind:value={tokenInput}
        placeholder="gt-xxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxx"
        autocomplete="off"
        spellcheck="false"
        aria-label="RSP token"
      />

      {#if validating}
        <p class="validate-msg validate-pending" role="status">Validating…</p>
      {:else if validationResult === 'ok'}
        <p class="validate-msg validate-ok" role="status">Token is valid.</p>
      {:else if validationResult === 'failed'}
        <p class="validate-msg validate-fail" role="alert">
          Token validation failed{validationError ? ` (${validationError})` : ''}.
        </p>
      {/if}

      <div class="button-row">
        <button class="btn btn-primary" onclick={handleSave} disabled={!tokenInput.trim()}>
          Save
        </button>
        <button class="btn" onclick={handleValidate} disabled={!tokenInput.trim() || validating}>
          Validate
        </button>
        <button class="btn btn-danger" onclick={handleClear}>
          Clear / Log out
        </button>
        <button class="btn" onclick={() => onClose()}>Cancel</button>
      </div>

      <p class="help-line">
        Get a token from data.lsst.cloud → your username menu → Security Tokens →
        Create Token (scopes: read:image, read:tap).
      </p>
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
    max-width: 480px;
    width: 90%;
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

  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 16px;
    padding: 8px 10px;
    background: #12121f;
    border: 1px solid #2a2a3e;
    border-radius: 6px;
    font-size: 13px;
  }

  .status-badge {
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
  }

  .status-ok {
    background: #16351f;
    color: #6ee08c;
  }

  .status-off {
    background: #35251a;
    color: #e0a86e;
  }

  .status-detail {
    color: #999;
  }

  .field-label {
    display: block;
    font-size: 12px;
    color: #8cf;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }

  .token-input {
    width: 100%;
    box-sizing: border-box;
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 13px;
    font-family: monospace;
  }

  .token-input::placeholder {
    color: #666;
  }

  .token-input:focus {
    outline: none;
    border-color: #6a6aff;
  }

  .validate-msg {
    font-size: 12px;
    margin: 8px 0 0;
  }

  .validate-pending {
    color: #8cf;
  }

  .validate-ok {
    color: #6ee08c;
  }

  .validate-fail {
    color: #f66;
  }

  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }

  .btn {
    background: #2a2a3e;
    color: #ccc;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: #3a3a5e;
    color: #fff;
    border-color: #6a6aff;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #3a3a6e;
    color: #fff;
    border-color: #6a6aff;
  }

  .btn-danger {
    color: #f88;
  }

  .btn-danger:hover:not(:disabled) {
    background: #3e2020;
    color: #fff;
    border-color: #a44;
  }

  .help-line {
    margin: 16px 0 0;
    font-size: 11px;
    color: #888;
    line-height: 1.5;
  }
</style>
