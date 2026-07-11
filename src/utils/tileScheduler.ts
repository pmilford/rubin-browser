/**
 * Pure in-flight tracker for tile loads: DEDUP (never start a second load for a
 * key already loading) and CANCELLATION (abort in-flight loads for tiles that a
 * newer view has superseded). Kept separate from ImageViewer so the "dedup once"
 * and "never cancel a still-visible tile" invariants are unit-testable without a
 * DOM or a network.
 *
 * The tracker holds only the abort side of each load; the component supplies a
 * `start()` that kicks off the real Image/fetch and returns a {@link TileLoadHandle}.
 */

/** The cancellable side of an in-flight load. */
export interface TileLoadHandle {
  /** Abort the load (AbortController for fetch; detach handlers + clear src for <img>). */
  abort: () => void;
  /**
   * Whether {@link TileScheduler.supersede} may cancel this load. Pinned/backdrop
   * loads set this false so a view change never cancels the full-sky preview.
   * Defaults to true.
   */
  cancellable?: boolean;
}

export class TileScheduler {
  private readonly inflight = new Map<string, TileLoadHandle>();

  /** Whether a load for `key` is currently in flight. */
  isInFlight(key: string): boolean {
    return this.inflight.has(key);
  }

  /** Number of loads currently in flight. */
  inFlightCount(): number {
    return this.inflight.size;
  }

  /**
   * Start a load for `key` unless one is already in flight (DEDUP). Returns true
   * when a NEW load was started, false when the request was deduped (the caller
   * must NOT kick off its own load).
   *
   * A placeholder slot is reserved BEFORE calling `start()` so that a load which
   * settles synchronously inside `start()` (e.g. an offline data-URL failure that
   * calls {@link settle} immediately) cannot leak a stale in-flight entry: if the
   * slot was removed during `start()`, the real handle is not resurrected.
   */
  request(key: string, start: () => TileLoadHandle): boolean {
    if (this.inflight.has(key)) return false;
    const placeholder: TileLoadHandle = { abort: () => {}, cancellable: true };
    this.inflight.set(key, placeholder);
    const handle = start();
    // Only install the real handle if start() didn't already settle this key.
    if (this.inflight.get(key) === placeholder) this.inflight.set(key, handle);
    return true;
  }

  /** Mark a load done (loaded / errored / aborted) so the key can load again later. */
  settle(key: string): void {
    this.inflight.delete(key);
  }

  /**
   * Cancel every cancellable in-flight load whose key is NOT in `keep` (the tiles
   * still needed by the current view). Aborts and removes them so they can be
   * re-fetched when they reappear. Non-cancellable loads and kept keys are left
   * untouched. Returns the aborted keys.
   */
  supersede(keep: ReadonlySet<string>): string[] {
    const aborted: string[] = [];
    for (const [key, handle] of this.inflight) {
      if (handle.cancellable === false) continue;
      if (keep.has(key)) continue;
      handle.abort();
      this.inflight.delete(key);
      aborted.push(key);
    }
    return aborted;
  }

  /** Abort and forget every in-flight load (e.g. on unmount). */
  clear(): void {
    for (const [, handle] of this.inflight) handle.abort();
    this.inflight.clear();
  }
}
