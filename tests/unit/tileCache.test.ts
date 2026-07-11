import { describe, it, expect } from 'vitest';
import { touchLru, evictLru } from '../../src/utils/tileCache.js';

describe('touchLru', () => {
  it('moves a key to the most-recently-used (end) position', () => {
    const m = new Map<string, number>([['a', 1], ['b', 2], ['c', 3]]);
    touchLru(m, 'a');
    expect([...m.keys()]).toEqual(['b', 'c', 'a']);
  });
  it('is a no-op for an absent key', () => {
    const m = new Map<string, number>([['a', 1]]);
    touchLru(m, 'z');
    expect([...m.keys()]).toEqual(['a']);
  });
});

describe('evictLru', () => {
  it('drops least-recently-used entries down to the cap', () => {
    const m = new Map<number, number>();
    for (let i = 0; i < 10; i++) m.set(i, i);
    const evicted = evictLru(m, 6, new Set());
    expect(m.size).toBe(6);
    expect(evicted).toEqual([0, 1, 2, 3]); // oldest four
    expect([...m.keys()]).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('NEVER evicts a protected (currently-visible) key — even the oldest', () => {
    // The classic trap: a tile that has been on screen across many frames is the
    // OLDEST by insertion. A pure insertion-order evictor would drop it (and then
    // the very next paint has a hole). With it protected, eviction must skip it.
    const m = new Map<number, number>();
    for (let i = 0; i < 10; i++) m.set(i, i);
    const protectedVisible = new Set([0, 1]); // oldest two are still on screen
    const evicted = evictLru(m, 6, protectedVisible);
    expect(m.has(0)).toBe(true);
    expect(m.has(1)).toBe(true);
    expect(m.size).toBe(6);
    // It evicted the oldest UNPROTECTED keys instead.
    expect(evicted).toEqual([2, 3, 4, 5]);
    // A broken evictor that ignored `protect` would have dropped 0/1 and failed.
  });

  it('leaves the map above cap rather than evicting a protected tile (correctness > bound)', () => {
    const m = new Map<number, number>();
    for (let i = 0; i < 5; i++) m.set(i, i);
    const protectAll = new Set([0, 1, 2, 3, 4]);
    const evicted = evictLru(m, 2, protectAll);
    expect(evicted).toEqual([]);
    expect(m.size).toBe(5); // never drop a visible tile, even over the cap
  });

  it('no-ops when already at or below the cap', () => {
    const m = new Map<number, number>([[1, 1], [2, 2]]);
    expect(evictLru(m, 5, new Set())).toEqual([]);
    expect(m.size).toBe(2);
  });

  it('invokes onEvict(key,value) for each dropped entry, never for a protected one', () => {
    // The ImageBitmap-freeing hook: onEvict must fire once per EVICTED entry with
    // its value (so the caller can close() the bitmap) and never for a still-visible
    // (protected) tile — closing a visible tile would blank it.
    const m = new Map<number, string>();
    for (let i = 0; i < 6; i++) m.set(i, `v${i}`);
    const protectedVisible = new Set([1]); // oldest-but-visible, must survive
    const seen: Array<[number, string]> = [];
    const evicted = evictLru(m, 3, protectedVisible, (k, v) => seen.push([k, v]));
    // Drops the oldest UNPROTECTED keys (0,2,3) — skips protected 1.
    expect(evicted).toEqual([0, 2, 3]);
    expect(seen).toEqual([[0, 'v0'], [2, 'v2'], [3, 'v3']]);
    expect(m.has(1)).toBe(true); // protected, and onEvict never saw it
    expect(seen.some(([k]) => k === 1)).toBe(false);
  });
});
