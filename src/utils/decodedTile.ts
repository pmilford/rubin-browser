/**
 * A decoded HiPS tile is either an {@link HTMLImageElement} (the legacy /
 * fallback main-thread `<img>` decode) or an {@link ImageBitmap} (off-thread
 * `createImageBitmap` decode — TODO 125). Both are valid `drawImage` sources, so
 * the renderer treats them uniformly through the helpers here.
 *
 * Kept pure and separate from ImageViewer so the "is this tile ready to draw",
 * "what are its pixel dimensions", and "free it on eviction" rules are
 * unit-testable without a DOM, a network, or a real canvas — and so the same
 * `naturalWidth` duck-type test works whether or not the runtime even defines the
 * `ImageBitmap` constructor (jsdom does not).
 */

/** A tile decoded and cached for drawing: either an `<img>` or an `ImageBitmap`. */
export type DecodedTile = HTMLImageElement | ImageBitmap;

/**
 * True when the tile is an {@link ImageBitmap} rather than an `HTMLImageElement`.
 * Duck-typed on `naturalWidth` (present on `<img>`, absent on `ImageBitmap`) so it
 * works even where the `ImageBitmap` global is undefined (jsdom) — never
 * `instanceof ImageBitmap`, which would throw / mis-narrow there.
 */
export function isBitmap(tile: DecodedTile): tile is ImageBitmap {
  return !('naturalWidth' in tile);
}

/**
 * Whether a cached tile is fully decoded and safe to draw. An `<img>` must have
 * loaded (`complete` + non-zero `naturalWidth`); an `ImageBitmap` exists only once
 * decoded, but a CLOSED bitmap reports `width === 0` — so `width > 0` correctly
 * rejects both an undecoded `<img>` and a freed bitmap.
 */
export function tileReady(tile: DecodedTile | undefined | null): tile is DecodedTile {
  if (!tile) return false;
  return isBitmap(tile) ? tile.width > 0 : tile.complete && tile.naturalWidth > 0;
}

/** Intrinsic pixel width of a decoded tile (falls back for an unmeasured `<img>`). */
export function tileWidth(tile: DecodedTile, fallback: number): number {
  return isBitmap(tile) ? tile.width : tile.naturalWidth || fallback;
}

/** Intrinsic pixel height of a decoded tile (falls back for an unmeasured `<img>`). */
export function tileHeight(tile: DecodedTile, fallback: number): number {
  return isBitmap(tile) ? tile.height : tile.naturalHeight || fallback;
}

/**
 * Release a tile's GPU/decoder memory if it is an {@link ImageBitmap} (calls
 * `.close()`). A no-op for an `<img>` (nothing to free) and for a bitmap without a
 * `close` method (defensive). Only ever call this on a tile that is NOT still
 * referenced/visible — see the eviction protect-set in ImageViewer.
 */
export function closeTile(tile: DecodedTile | undefined | null): void {
  if (tile && isBitmap(tile) && typeof tile.close === 'function') tile.close();
}
