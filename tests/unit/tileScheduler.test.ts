import { describe, it, expect, vi } from 'vitest';
import { TileScheduler } from '../../src/utils/tileScheduler.js';

describe('TileScheduler', () => {
  describe('in-flight dedup', () => {
    it('starts the loader ONCE for two requests of the same key before it resolves', () => {
      const s = new TileScheduler();
      const start = vi.fn(() => ({ abort: vi.fn() }));

      const first = s.request('3-42', start);
      const second = s.request('3-42', start); // same key, still in flight

      expect(first).toBe(true); // a new load started
      expect(second).toBe(false); // deduped — caller must not start its own
      expect(start).toHaveBeenCalledTimes(1); // the underlying load ran once
      expect(s.inFlightCount()).toBe(1);
    });

    it('allows a re-fetch AFTER the first load settles (not permanently blocked)', () => {
      const s = new TileScheduler();
      const start = vi.fn(() => ({ abort: vi.fn() }));
      s.request('3-42', start);
      s.settle('3-42'); // load finished
      const again = s.request('3-42', start); // reappears later
      expect(again).toBe(true);
      expect(start).toHaveBeenCalledTimes(2);
    });

    it('does not leak a key when start() settles synchronously', () => {
      const s = new TileScheduler();
      // A loader that settles immediately (e.g. an offline synth failure).
      const start = vi.fn(() => {
        s.settle('3-7');
        return { abort: vi.fn() };
      });
      s.request('3-7', start);
      // The slot must NOT be resurrected by the post-start install.
      expect(s.isInFlight('3-7')).toBe(false);
      // And the key is immediately requestable again — no permanent block.
      expect(s.request('3-7', () => ({ abort: vi.fn() }))).toBe(true);
    });
  });

  describe('cancellation (supersede)', () => {
    it('aborts in-flight keys NOT kept, and NEVER a still-visible (kept) one', () => {
      const s = new TileScheduler();
      const abortA = vi.fn();
      const abortB = vi.fn();
      const abortC = vi.fn();
      s.request('A', () => ({ abort: abortA }));
      s.request('B', () => ({ abort: abortB }));
      s.request('C', () => ({ abort: abortC }));

      // The new view still needs A; B and C scrolled off.
      const aborted = s.supersede(new Set(['A']));

      expect(abortA).not.toHaveBeenCalled(); // still visible → kept
      expect(abortB).toHaveBeenCalledTimes(1);
      expect(abortC).toHaveBeenCalledTimes(1);
      expect(aborted.sort()).toEqual(['B', 'C']);
      // Cancelled tiles left the in-flight set → they can re-fetch when they reappear.
      expect(s.isInFlight('B')).toBe(false);
      expect(s.isInFlight('C')).toBe(false);
      expect(s.isInFlight('A')).toBe(true);
    });

    it('never cancels a non-cancellable (pinned backdrop) load', () => {
      const s = new TileScheduler();
      const abortPinned = vi.fn();
      const abortNormal = vi.fn();
      s.request('allsky', () => ({ abort: abortPinned, cancellable: false }));
      s.request('view', () => ({ abort: abortNormal }));

      // Supersede with an empty keep-set: everything cancellable should go.
      const aborted = s.supersede(new Set());
      expect(abortPinned).not.toHaveBeenCalled(); // pinned survives
      expect(abortNormal).toHaveBeenCalledTimes(1);
      expect(aborted).toEqual(['view']);
      expect(s.isInFlight('allsky')).toBe(true);
    });

    it('a re-requested cancelled key starts a fresh load', () => {
      const s = new TileScheduler();
      s.request('X', () => ({ abort: vi.fn() }));
      s.supersede(new Set()); // X cancelled
      const restart = vi.fn(() => ({ abort: vi.fn() }));
      expect(s.request('X', restart)).toBe(true); // re-fetchable
      expect(restart).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear()', () => {
    it('aborts and forgets every in-flight load', () => {
      const s = new TileScheduler();
      const a = vi.fn();
      const b = vi.fn();
      s.request('A', () => ({ abort: a }));
      s.request('B', () => ({ abort: b, cancellable: false }));
      s.clear();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1); // clear aborts even pinned loads
      expect(s.inFlightCount()).toBe(0);
    });
  });
});
