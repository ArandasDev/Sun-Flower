import { describe, expect, it } from 'vitest';

import { mergeSettings } from './merge-settings.ts';

describe('mergeSettings', () => {
  it('keeps the sibling keys at every depth', () => {
    const stored = { spam: { flood: { limit: 7, seconds: 5 }, escalation: { steps: [1] } }, a: 1 };
    expect(mergeSettings(stored, { spam: { flood: { limit: 9 } } })).toEqual({
      spam: { flood: { limit: 9, seconds: 5 }, escalation: { steps: [1] } },
      a: 1,
    });
  });

  it('replaces a list instead of concatenating it', () => {
    expect(mergeSettings({ ids: ['1', '2'] }, { ids: ['3'] })).toEqual({ ids: ['3'] });
  });

  it('replaces the stored value with null and with primitives', () => {
    expect(mergeSettings({ a: { b: 1 }, c: 1 }, { a: null, c: 'x' })).toEqual({ a: null, c: 'x' });
  });

  it('replaces a stored non-object with a partial object', () => {
    expect(mergeSettings({ a: 1 }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
  });

  it('ignores __proto__, constructor and prototype', () => {
    const partial = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":1,"ok":1}',
    ) as Record<string, unknown>;
    const result = mergeSettings({}, partial);
    expect(result).toEqual({ ok: 1 });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not mutate its inputs', () => {
    const stored = { a: { b: 1 } };
    const partial = { a: { c: 2 } };
    const result = mergeSettings(stored, partial) as { a: Record<string, number> };
    expect(stored).toEqual({ a: { b: 1 } });
    expect(partial).toEqual({ a: { c: 2 } });
    expect(result.a).not.toBe(stored.a);
  });
});
