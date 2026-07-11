import { describe, it, expect } from 'vitest';
import { PerfMetrics } from '../../src/utils/perfMetrics.js';

/**
 * Adversarial: every assertion pins an OUTCOME derived from a KNOWN sequence, so
 * a stub `snapshot()` that returns constants (or reflects inputs blindly) fails.
 */
describe('PerfMetrics', () => {
  /** A metrics instance driven by an injected, controllable clock. */
  function withClock() {
    let t = 1000;
    const now = () => t;
    const m = new PerfMetrics(4, now); // small window to test bounding
    return { m, tick: (dt: number) => { t += dt; } };
  }

  describe('cache hit-rate', () => {
    it('is hits / (hits + misses)', () => {
      const { m } = withClock();
      m.recordCacheHit();
      m.recordCacheHit();
      m.recordCacheHit(); // 3 hits
      const s = m.recordFetchStart();
      m.recordFetchEnd(s); // 1 network fetch (miss)
      const snap = m.snapshot();
      expect(snap.servedFromCache).toBe(3);
      expect(snap.fetchedFromNetwork).toBe(1);
      expect(snap.cacheHitRate).toBeCloseTo(3 / 4, 10); // 0.75, not a constant
    });

    it('guards 0/0 → 0 (no divide-by-zero, no NaN)', () => {
      const { m } = withClock();
      const snap = m.snapshot();
      expect(snap.cacheHitRate).toBe(0);
      expect(Number.isNaN(snap.cacheHitRate)).toBe(false);
    });

    it('rises as a re-requested tile is served from cache', () => {
      const { m } = withClock();
      const s = m.recordFetchStart();
      m.recordFetchEnd(s); // first visit: 1 miss → rate 0
      expect(m.snapshot().cacheHitRate).toBe(0);
      m.recordCacheHit(); // revisit: 1 hit → rate 0.5
      expect(m.snapshot().cacheHitRate).toBeCloseTo(0.5, 10);
    });
  });

  describe('counters increment exactly', () => {
    it('tilesRequested = cache hits + fetch starts', () => {
      const { m } = withClock();
      m.recordCacheHit();
      const s1 = m.recordFetchStart();
      m.recordFetchStart(); // s2
      m.recordFetchEnd(s1);
      m.recordError(); // s2 failed
      const snap = m.snapshot();
      expect(snap.tilesRequested).toBe(3);
      expect(snap.fetchedFromNetwork).toBe(1);
      expect(snap.servedFromCache).toBe(1);
      expect(snap.errors).toBe(1);
    });

    it('inFlight tracks start/end/cancel/error and never goes negative', () => {
      const { m } = withClock();
      const a = m.recordFetchStart();
      m.recordFetchStart(); // b
      m.recordFetchStart(); // c
      expect(m.snapshot().inFlight).toBe(3);
      m.recordFetchEnd(a);
      m.recordFetchCancel(); // b superseded
      m.recordError(); // c failed
      expect(m.snapshot().inFlight).toBe(0);
      // Over-settling must not push it negative (cancel doesn't touch error count).
      m.recordFetchCancel();
      m.recordFetchCancel();
      expect(m.snapshot().inFlight).toBe(0);
      // A cancel is neither a network fetch nor an error.
      expect(m.snapshot().fetchedFromNetwork).toBe(1);
      expect(m.snapshot().errors).toBe(1);
    });
  });

  describe('rolling tile-load window', () => {
    it('computes min/max/avg over the recorded load times', () => {
      const { m, tick } = withClock();
      // load times 10, 30, 20 ms
      let s = m.recordFetchStart(); tick(10); m.recordFetchEnd(s);
      s = m.recordFetchStart(); tick(30); m.recordFetchEnd(s);
      s = m.recordFetchStart(); tick(20); m.recordFetchEnd(s);
      const w = m.snapshot().tileLoadMs;
      expect(w.count).toBe(3);
      expect(w.min).toBe(10);
      expect(w.max).toBe(30);
      expect(w.avg).toBeCloseTo(20, 10);
    });

    it('is BOUNDED to the window — an old sample drops out of min/max', () => {
      const { m, tick } = withClock(); // window size 4
      const push = (dt: number) => { const s = m.recordFetchStart(); tick(dt); m.recordFetchEnd(s); };
      push(100); // this large sample must fall off after 4 more
      push(10); push(20); push(30); push(40);
      const w = m.snapshot().tileLoadMs;
      expect(w.count).toBe(4); // capped
      expect(w.max).toBe(40); // the 100ms sample has dropped out of the window
      expect(w.min).toBe(10);
    });
  });

  describe('render window + FPS', () => {
    it('derives FPS from the average render time', () => {
      const { m } = withClock();
      m.recordRender(20);
      m.recordRender(20); // avg 20ms → 50 fps
      const snap = m.snapshot();
      expect(snap.renderMs.avg).toBeCloseTo(20, 10);
      expect(snap.lastRenderMs).toBe(20);
      expect(snap.fps).toBeCloseTo(50, 6);
    });

    it('FPS is 0 before any render (no divide-by-zero)', () => {
      const { m } = withClock();
      expect(m.snapshot().fps).toBe(0);
      expect(m.snapshot().renderMs.count).toBe(0);
    });

    it('FPS changes when render time changes (not a constant)', () => {
      const { m } = withClock();
      m.recordRender(10); // 100 fps
      expect(m.snapshot().fps).toBeCloseTo(100, 6);
      m.recordRender(30); // avg (10+30)/2=20 → 50 fps
      expect(m.snapshot().fps).toBeCloseTo(50, 6);
    });
  });

  it('reset() zeroes everything', () => {
    const { m } = withClock();
    m.recordCacheHit();
    const s = m.recordFetchStart(); m.recordFetchEnd(s);
    m.recordRender(12);
    m.reset();
    const snap = m.snapshot();
    expect(snap.tilesRequested).toBe(0);
    expect(snap.servedFromCache).toBe(0);
    expect(snap.fetchedFromNetwork).toBe(0);
    expect(snap.errors).toBe(0);
    expect(snap.inFlight).toBe(0);
    expect(snap.cacheHitRate).toBe(0);
    expect(snap.fps).toBe(0);
    expect(snap.tileLoadMs.count).toBe(0);
    expect(snap.renderMs.count).toBe(0);
  });
});
