# Testing Rules

## Before Every Commit

Run `npm test` — all tests must pass. No exceptions.

## Coverage Requirements

- 100% line coverage for all files in `src/`
- Exemption: `src/types/` (type-only files don't need tests)
- If coverage drops, add tests before committing

## Test Structure

```
tests/
├── unit/           # Fast, isolated, mocked dependencies
├── regression/     # Real data fixtures, verify parsing/rendering
├── ui/             # Playwright browser tests
└── fixtures/       # Sample VOTable JSON, FITS headers, etc.
```

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
