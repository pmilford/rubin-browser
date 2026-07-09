# Testing Rules

## Before Every Commit

Run `npm test` — all tests must pass. No exceptions.

## Coverage Requirements

Coverage thresholds are enforced by `vitest.config` (recalibrated for
@vitest/coverage-v8 v4: ~statements 80, lines 79, functions 78, branches 71).
`src/types/` is effectively type-only.

- Keep coverage at or above the configured thresholds; ratchet them UP as real
  coverage improves. Do NOT lower them to make a commit pass.
- Coverage is a FLOOR, not the goal. A green unit suite does NOT prove the viewer
  renders — rendering/interaction/geometry changes REQUIRE a Playwright visual
  test and/or a `projection.test.ts` invariant that asserts an OUTCOME (see the
  project CLAUDE.md "four test layers").
- Mocked `fetch` unit tests verify parsing/logic only; they cannot catch
  black-canvas, wrong-URL, backwards-pan, or dead-control failures.

## Test Structure

```
tests/
├── unit/            # Fast, isolated. Pure logic + projection invariants
│                    #   (projection.test.ts runs with NO mocks).
├── ui/              # Playwright browser tests (visual-regression,
│                    #   interaction-outcomes, canvas-rendering, ...).
│   └── __snapshots__/  # Committed screenshot baselines (toHaveScreenshot).
└── setup.ts         # jsdom setup; mocks the canvas 2D context (which is WHY
                     #   unit-layer canvas assertions are meaningless).
```

Note: `npm run test:regression` targets `tests/regression/`, which does not exist
yet — add it (with `tests/fixtures/`) when real-data regression tests are built.

## Unit Test Pattern

```typescript
import { describe, it, expect, vi } from 'vitest';
import { functionUnderTest } from '../../src/module.js';

describe('functionUnderTest', () => {
  it('handles normal case', () => {
    expect(functionUnderTest(input)).toEqual(expected);
  });

  it('handles edge case', () => {
    expect(functionUnderTest(edgeInput)).toEqual(expected);
  });

  it('throws on invalid input', () => {
    expect(() => functionUnderTest(bad)).toThrow('descriptive message');
  });
});
```

## Mocking API Calls

Always mock `fetch` in unit tests:

```typescript
globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve(mockData),
});
```

Never make real API calls in unit tests — that's what regression tests are for.

## Regression Tests

Use fixture data from `tests/fixtures/`. Download real responses from Rubin TAP and commit them. Test that parsing produces correct structured output.
