---
name: tdd-workflow
description: TDD workflow for Rubin Browser — write tests first, implement, verify coverage. Use when creating new features or fixing bugs.
auto: true
---

# TDD Workflow

Guide for test-driven development in the Rubin Browser project.

## Steps

### 1. Write a Failing Test

Create a test file in `tests/unit/` that describes the desired behavior:

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../../src/module.js';

describe('myFunction', () => {
  it('should do the expected thing', () => {
    expect(myFunction(input)).toEqual(expected);
  });
});
```

### 2. Run the Test (Confirm It Fails)

```bash
npm test -- tests/unit/my-test.test.ts
```

Verify it fails for the right reason.

### 3. Implement the Minimum

Write the simplest code in `src/` that makes the test pass. Don't over-engineer.

### 4. Run Tests Again

```bash
npm test
```

All tests should pass.

### 5. Check Coverage

```bash
npm run test:coverage
```

If the new file isn't fully covered, add more test cases.

### 6. Refactor

Clean up the implementation while keeping tests green.

### 7. Commit

```bash
git add -A
git commit -m "feat: description of what was added"
```

## Test Patterns

### Mocking Fetch

```typescript
import { vi } from 'vitest';

globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ data: 'mock' }),
});
```

### Testing Errors

```typescript
it('throws on invalid input', () => {
  expect(() => parseCoordinates('garbage')).toThrow('Invalid coordinates');
});
```

### Testing Async

```typescript
it('fetches data', async () => {
  const result = await fetchData('query');
  expect(result).toBeDefined();
});
```

## Coverage Targets

- `src/api/` — 100%
- `src/utils/` — 100%
- `src/components/` — 90% minimum
- `src/types/` — no coverage needed
