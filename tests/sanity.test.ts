import { describe, expect, it } from 'vitest';

// Temporary: guarantees the CI runs at least one real test until the Core tests arrive in Phase 1.
describe('test runner', () => {
  it('executes tests', () => {
    expect(1 + 1).toBe(2);
  });
});
