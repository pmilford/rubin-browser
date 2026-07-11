/**
 * Pure performance-metrics collector for the HiPS viewer's tile-fetch and render
 * paths. No DOM, no timers of its own — the component feeds it real events
 * (fetch start/end/cancel/error, cache hits, render durations) and reads a
 * {@link PerfSnapshot} for the HUD.
 *
 * Why a pure module: the actual pixels the viewer paints are only observable in
 * Playwright (the jsdom canvas is mocked), but the ARITHMETIC of hit-rate,
 * rolling min/max/avg, and FPS derivation is deterministic and adversarially
 * unit-testable here — a stub returning constants cannot satisfy the sequence
 * assertions.
 */

/** Min/max/avg over the last N samples of a rolling window. */
export interface WindowStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

/** Immutable view of the collector's state for the HUD. */
export interface PerfSnapshot {
  /** Tiles asked for = cache hits + network fetches started. */
  tilesRequested: number;
  /** Tiles that required a network fetch (cache misses). */
  fetchedFromNetwork: number;
  /** Tiles served from the in-memory cache (no network). */
  servedFromCache: number;
  /** Fetches currently outstanding (started, not yet ended/cancelled/errored). */
  inFlight: number;
  /** Tile fetches that ended in an error. */
  errors: number;
  /** servedFromCache / (servedFromCache + fetchedFromNetwork); 0 when neither. */
  cacheHitRate: number;
  /** Rolling per-tile network load time (ms). */
  tileLoadMs: WindowStats;
  /** Rolling full-frame render time (ms). */
  renderMs: WindowStats;
  /** Frames/second derived from the average render time (0 when unknown). */
  fps: number;
  /** The most recent render duration (ms), 0 before any render. */
  lastRenderMs: number;
}

const EMPTY_STATS: WindowStats = { min: 0, max: 0, avg: 0, count: 0 };

/** Compute min/max/avg over a sample array (empty → all zero). */
function stats(samples: readonly number[]): WindowStats {
  const count = samples.length;
  if (count === 0) return { ...EMPTY_STATS };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const s of samples) {
    if (s < min) min = s;
    if (s > max) max = s;
    sum += s;
  }
  return { min, max, avg: sum / count, count };
}

/** A fixed-capacity ring of recent samples (drops the oldest past capacity). */
class RollingWindow {
  private readonly samples: number[] = [];
  constructor(private readonly capacity: number) {}
  push(v: number): void {
    this.samples.push(v);
    if (this.samples.length > this.capacity) this.samples.shift();
  }
  stats(): WindowStats {
    return stats(this.samples);
  }
  clear(): void {
    this.samples.length = 0;
  }
}

/** Default clock — high-resolution where available, wall-clock otherwise. */
function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * A live, pure metrics collector. `now` is injectable so load-time derivation is
 * deterministic under test; `windowSize` bounds the rolling min/max/avg.
 */
export class PerfMetrics {
  private tilesRequested = 0;
  private fetchedFromNetwork = 0;
  private servedFromCache = 0;
  private inFlight = 0;
  private errors = 0;
  private lastRenderMs = 0;
  private readonly tileLoad: RollingWindow;
  private readonly render: RollingWindow;
  private readonly now: () => number;

  constructor(windowSize = 60, now: () => number = defaultNow) {
    // A window of at least 1 keeps min/max/avg meaningful.
    const cap = Math.max(1, Math.floor(windowSize));
    this.tileLoad = new RollingWindow(cap);
    this.render = new RollingWindow(cap);
    this.now = now;
  }

  /** A tile was served from cache (no network). Counts as a request + a hit. */
  recordCacheHit(): void {
    this.tilesRequested++;
    this.servedFromCache++;
  }

  /**
   * A network fetch for a tile has started. Counts as a request; increments the
   * in-flight gauge. Returns an opaque start token to pass to {@link recordFetchEnd}.
   */
  recordFetchStart(): number {
    this.tilesRequested++;
    this.inFlight++;
    return this.now();
  }

  /** A network fetch succeeded — record its load time and clear it from in-flight. */
  recordFetchEnd(startToken: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.fetchedFromNetwork++;
    this.tileLoad.push(Math.max(0, this.now() - startToken));
  }

  /**
   * An in-flight fetch was cancelled (superseded view). Clears it from in-flight
   * WITHOUT counting it as a network fetch or an error — a cancel is neither a
   * completed load nor a failure.
   */
  recordFetchCancel(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  /** A tile fetch failed. Clears it from in-flight and counts an error. */
  recordError(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.errors++;
  }

  /** Record a full-frame render duration (ms). */
  recordRender(ms: number): void {
    const v = Math.max(0, ms);
    this.lastRenderMs = v;
    this.render.push(v);
  }

  /** Snapshot the current state for display. */
  snapshot(): PerfSnapshot {
    const denom = this.servedFromCache + this.fetchedFromNetwork;
    const cacheHitRate = denom === 0 ? 0 : this.servedFromCache / denom;
    const renderMs = this.render.stats();
    const fps = renderMs.avg > 0 ? 1000 / renderMs.avg : 0;
    return {
      tilesRequested: this.tilesRequested,
      fetchedFromNetwork: this.fetchedFromNetwork,
      servedFromCache: this.servedFromCache,
      inFlight: this.inFlight,
      errors: this.errors,
      cacheHitRate,
      tileLoadMs: this.tileLoad.stats(),
      renderMs,
      fps,
      lastRenderMs: this.lastRenderMs,
    };
  }

  /** Reset all counters and windows (e.g. when switching surveys). */
  reset(): void {
    this.tilesRequested = 0;
    this.fetchedFromNetwork = 0;
    this.servedFromCache = 0;
    this.inFlight = 0;
    this.errors = 0;
    this.lastRenderMs = 0;
    this.tileLoad.clear();
    this.render.clear();
  }
}
