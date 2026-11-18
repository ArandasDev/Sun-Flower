import { describe, expect, it } from 'vitest';

import { ActivityLog, fingerprintOf } from '../spam/activity.ts';
import type { ActivityEntry } from '../spam/activity.ts';

function entry(id: number, atMs: number, overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    messageId: `m${String(id)}`,
    channelId: '222222222222222222',
    atMs,
    fingerprint: null,
    ...overrides,
  };
}

describe('fingerprintOf', () => {
  it('ignores case, accents, extra whitespace and zero-width characters', () => {
    const base = fingerprintOf('Olá   Mundo, tudo bem?');
    expect(base).not.toBeNull();
    expect(fingerprintOf('ola mundo, tudo BEM?')).toBe(base);
    expect(fingerprintOf('Ol\u200Bá Mundo, tudo bem?')).toBe(base);
  });

  it('returns null for short normalized text', () => {
    expect(fingerprintOf('kkkkkkk')).toBeNull();
    expect(fingerprintOf('  a\u200B b  ')).toBeNull();
  });

  it('returns a 64-char hex digest that does not contain the text', () => {
    const result = fingerprintOf('mensagem repetida de teste');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
    expect(result).not.toContain('mensagem');
  });
});

describe('ActivityLog', () => {
  it('keeps the 200 newest entries per author', () => {
    const log = new ActivityLog();
    for (let i = 0; i < 201; i += 1) log.record('a', entry(i, i));
    const entries = log.since('a', 0);
    expect(entries).toHaveLength(200);
    expect(entries[0]?.messageId).toBe('m1');
    expect(entries[199]?.messageId).toBe('m200');
  });

  it('evicts the least recently recorded author beyond 2000', () => {
    const log = new ActivityLog();
    for (let i = 0; i < 2000; i += 1) log.record(`u${String(i)}`, entry(i, i));
    log.record('u0', entry(5000, 5000));
    log.record('new', entry(5001, 5001));
    expect(log.authorCount).toBe(2000);
    expect(log.since('u1', 0)).toEqual([]);
    expect(log.since('u0', 0)).toHaveLength(2);
    expect(log.since('new', 0)).toHaveLength(1);
  });

  it('filters by time, returns a copy and handles unknown authors', () => {
    const log = new ActivityLog();
    log.record('a', entry(1, 100));
    log.record('a', entry(2, 200));
    const result = log.since('a', 150);
    expect(result.map((e) => e.messageId)).toEqual(['m2']);
    expect(log.since('a', 100)).toHaveLength(2);
    expect(log.since('nobody', 0)).toEqual([]);
    (log.since('a', 0) as ActivityEntry[]).pop();
    expect(log.since('a', 0)).toHaveLength(2);
  });

  it('forgets entries and removes empty authors', () => {
    const log = new ActivityLog();
    log.record('a', entry(1, 100));
    log.record('a', entry(2, 200));
    log.forget('a', ['m1', 'unknown']);
    expect(log.since('a', 0).map((e) => e.messageId)).toEqual(['m2']);
    log.forget('a', ['m2']);
    expect(log.authorCount).toBe(0);
    log.forget('nobody', ['m1']);
  });

  it('prunes old entries and empty authors', () => {
    const log = new ActivityLog();
    log.record('old', entry(1, 100));
    log.record('mixed', entry(2, 100));
    log.record('mixed', entry(3, 900));
    log.prune(1000, 500);
    expect(log.since('old', 0)).toEqual([]);
    expect(log.since('mixed', 0).map((e) => e.messageId)).toEqual(['m3']);
    expect(log.authorCount).toBe(1);
  });
});
