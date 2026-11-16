import { describe, expect, it } from 'vitest';
import { TimeoutError, withTimeout } from './timeout.ts';

describe('withTimeout', () => {
  it('resolves when work finishes in time', async () => {
    await expect(withTimeout(() => Promise.resolve(7), 50, 'job')).resolves.toBe(7);
  });

  it('rejects with TimeoutError naming the label and duration', async () => {
    const error: unknown = await withTimeout(() => new Promise(() => {}), 10, 'job').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toHaveProperty('name', 'TimeoutError');
    expect((error as Error).message).toContain('job');
    expect((error as Error).message).toContain('10');
  });
});
