/**
 * Small LRU helpers for the tile cache (a `Map` used as an insertion-ordered
 * recency list). Kept pure and separate from ImageViewer so the "never evict a
 * currently-visible tile" invariant is unit-testable.
 *
 * Recency is by DRAW, not load: {@link touchLru} is called when a tile is
 * actually painted, moving it to the most-recently-used end; {@link evictLru}
 * then drops from the least-recently-used front — but never a key in the
 * `protect` set (the current frame's visible + ancestor tiles), so a tile the
 * next paint needs can never be evicted out from under it.
 */

/** Move `key` to most-recently-used (end) of an LRU Map. No-op if absent. */
export function touchLru<K, V>(map: Map<K, V>, key: K): void {
  const v = map.get(key);
  if (v !== undefined) {
    map.delete(key);
    map.set(key, v);
  }
}

/**
 * Evict least-recently-used entries until `map.size <= cap`, skipping any key in
 * `protect`. Returns the evicted keys. If everything over the cap is protected,
 * the map is left above the cap (correctness beats the bound — we never drop a
 * visible tile). `cap` should therefore exceed the largest possible visible set.
 *
 * `onEvict(key, value)` is invoked for each dropped entry BEFORE it is any use to
 * the caller (the value is already removed from the map) — the ImageViewer uses it
 * to `close()` an evicted `ImageBitmap` and free its decoder memory. It is only
 * ever called for a non-protected key, so it can never fire for a visible tile.
 */
export function evictLru<K, V>(
  map: Map<K, V>,
  cap: number,
  protect: ReadonlySet<K>,
  onEvict?: (key: K, value: V) => void
): K[] {
  const evicted: K[] = [];
  if (cap < 0 || map.size <= cap) return evicted;
  for (const k of map.keys()) {
    if (map.size <= cap) break;
    if (protect.has(k)) continue;
    const v = map.get(k) as V;
    map.delete(k);
    evicted.push(k);
    onEvict?.(k, v);
  }
  return evicted;
}
