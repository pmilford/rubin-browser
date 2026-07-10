import { describe, it, expect } from 'vitest';
import {
  postProcessMemoKey,
  POST_PROCESS_KEY_FIELDS,
  type PostProcessKeyState,
} from '../../src/utils/renderKey.js';

const BASE: PostProcessKeyState = {
  ra: 62,
  dec: -37,
  fov: 10,
  zoomLevel: 3,
  width: 800,
  height: 600,
  scaling: 'linear',
  colorMap: 'grayscale',
  invert: false,
  blackPoint: 0,
  whitePoint: 1,
  contrast: 1,
  bias: 0.5,
  layerSignature: '',
  overlaysSignature: '',
  contentVersion: 0,
};

/** A distinct value for each field, so mutating it must change the key. */
const MUTATION: PostProcessKeyState = {
  ra: 63,
  dec: -38,
  fov: 20,
  zoomLevel: 4,
  width: 801,
  height: 601,
  scaling: 'log',
  colorMap: 'viridis',
  invert: true,
  blackPoint: 0.1,
  whitePoint: 0.9,
  contrast: 1.5,
  bias: 0.6,
  layerSignature: 'off|r|60000',
  overlaysSignature: 'gaia-dr3:80;',
  contentVersion: 1,
};

describe('postProcessMemoKey', () => {
  it('is deterministic for identical state', () => {
    expect(postProcessMemoKey(BASE)).toBe(postProcessMemoKey({ ...BASE }));
  });

  // The load-bearing invariant: EVERY field must affect the key. This is exactly
  // the test that would have caught the "overlay opacity does nothing until you
  // pan" bug — overlaysSignature was omitted from the key, so mutating it left
  // the key (and the cached composite) unchanged.
  it.each(POST_PROCESS_KEY_FIELDS)('changes when %s changes', (field) => {
    const mutated = { ...BASE, [field]: MUTATION[field] } as PostProcessKeyState;
    expect(mutated[field]).not.toEqual(BASE[field]); // guard: the mutation is real
    expect(postProcessMemoKey(mutated)).not.toBe(postProcessMemoKey(BASE));
  });

  it('specifically depends on the overlay signature (opacity + set)', () => {
    const a = postProcessMemoKey({ ...BASE, overlaysSignature: 'gaia-dr3:80;' });
    const b = postProcessMemoKey({ ...BASE, overlaysSignature: 'gaia-dr3:20;' }); // opacity change
    const c = postProcessMemoKey({ ...BASE, overlaysSignature: '' }); // overlay removed
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});
