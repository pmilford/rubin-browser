/**
 * The memoization key for the viewer's post-processed offscreen composite.
 *
 * `ImageViewer.renderWithPostProcessing()` caches an expensive
 * draw→getImageData→applyPostProcessing pass and only rebuilds it when this key
 * changes (a pan only moves the composite, so panOffset is deliberately NOT in
 * the key). Extracted here as a PURE function precisely so the key's dependency
 * set is unit-testable: a control that affects the rendered pixels but is missing
 * from the key produces a *silently stale* canvas — the "opacity slider does
 * nothing until you pan" class of bug. The invariant test asserts that toggling
 * EVERY field changes the key, so an omitted input fails a fast, deterministic
 * unit test instead of only surfacing live in the browser.
 *
 * If you add a new input that changes the post-processed pixels (a new overlay
 * property, a new stretch control, a new layer axis), add it here AND to
 * `POST_PROCESS_KEY_FIELDS` so the invariant test covers it.
 */
export interface PostProcessKeyState {
  ra: number;
  dec: number;
  fov: number;
  zoomLevel: number;
  width: number;
  height: number;
  scaling: string;
  colorMap: string;
  invert: boolean;
  blackPoint: number;
  whitePoint: number;
  contrast: number;
  bias: number;
  /** Offline band/epoch axis signature (empty for network bases). */
  layerSignature: string;
  /** Overlay stack signature: ids + opacities (see ImageViewer.overlaysSignature). */
  overlaysSignature: string;
  /** Bumped on every new tile load so streamed-in content invalidates the memo. */
  contentVersion: number;
}

/** Field names that participate in the key — the invariant test iterates these. */
export const POST_PROCESS_KEY_FIELDS: (keyof PostProcessKeyState)[] = [
  'ra', 'dec', 'fov', 'zoomLevel', 'width', 'height', 'scaling', 'colorMap',
  'invert', 'blackPoint', 'whitePoint', 'contrast', 'bias', 'layerSignature',
  'overlaysSignature', 'contentVersion',
];

/** Build the post-processing memo key. Every field must affect the output. */
export function postProcessMemoKey(s: PostProcessKeyState): string {
  return (
    `${s.ra}|${s.dec}|${s.fov}|${s.zoomLevel}|${s.width}x${s.height}|` +
    `${s.scaling}|${s.colorMap}|${s.invert}|${s.blackPoint}|${s.whitePoint}|` +
    `${s.contrast}|${s.bias}|${s.layerSignature}|${s.overlaysSignature}|${s.contentVersion}`
  );
}
