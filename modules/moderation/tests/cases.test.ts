import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestModuleStorage } from '../../../tests/helpers/module-storage.ts';
import { CaseStore } from '../cases.ts';
import type { NewCase } from '../cases.ts';

const MODULE_DIR = fileURLToPath(new URL('..', import.meta.url));

function newCase(overrides: Partial<NewCase> = {}): NewCase {
  return {
    kind: 'automatic',
    level: 'confirmed',
    action: 'delete_timeout',
    targetUserId: '111111111111111111',
    actorUserId: null,
    channelId: '222222222222222222',
    messageId: '333333333333333333',
    domains: ['golpe.com'],
    signals: [{ name: 'blocked', points: 100 }],
    score: 100,
    reason: 'phishing',
    outcome: { delete: 'ok' },
    status: 'actioned',
    timeoutUntil: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CaseStore', () => {
  let ctx: ReturnType<typeof createTestModuleStorage>;
  let store: CaseStore;

  beforeEach(() => {
    ctx = createTestModuleStorage(MODULE_DIR);
    store = new CaseStore(ctx.storage);
  });
  afterEach(() => {
    ctx.close();
  });

  it('creates cases with increasing ids and deserializes JSON columns', () => {
    const a = store.create(newCase());
    const b = store.create(newCase());
    expect(b).toBeGreaterThan(a);
    expect(store.get(a)).toMatchObject({
      id: a,
      domains: ['golpe.com'],
      signals: [{ name: 'blocked', points: 100 }],
      outcome: { delete: 'ok' },
      level: 'confirmed',
      revertedBy: null,
      revertedAt: null,
    });
    expect(store.get(9999)).toBeUndefined();
  });

  it('finds the latest case of a message', () => {
    store.create(newCase());
    const last = store.create(newCase());
    store.create(newCase({ messageId: '000000000000000000' }));
    expect(store.findLatestByMessage('333333333333333333')?.id).toBe(last);
    expect(store.findLatestByMessage('999999999999999999')).toBeUndefined();
  });

  it('lists recent cases newest first, optionally by user', () => {
    const a = store.create(newCase());
    const b = store.create(newCase({ targetUserId: '222222222222222222' }));
    const c = store.create(newCase());
    expect(store.listRecent(10).map((r) => r.id)).toEqual([c, b, a]);
    expect(store.listRecent(10, '111111111111111111').map((r) => r.id)).toEqual([c, a]);
    expect(store.listRecent(1)).toHaveLength(1);
  });

  it('reverts only from open or actioned', () => {
    const open = store.create(newCase({ status: 'open' }));
    const actioned = store.create(newCase());
    const dismissed = store.create(newCase({ status: 'dismissed' }));
    expect(store.setStatus(open, 'reverted', 'x', 'T')).toBe(true);
    expect(store.setStatus(actioned, 'reverted', 'x', 'T')).toBe(true);
    expect(store.setStatus(actioned, 'reverted', 'x', 'T')).toBe(false);
    expect(store.setStatus(dismissed, 'reverted', 'x', 'T')).toBe(false);
    expect(store.get(open)).toMatchObject({ status: 'reverted', revertedBy: 'x', revertedAt: 'T' });
  });

  it('dismisses only from open', () => {
    const open = store.create(newCase({ status: 'open' }));
    const actioned = store.create(newCase());
    expect(store.setStatus(actioned, 'dismissed', 'x', 'T')).toBe(false);
    expect(store.setStatus(open, 'dismissed', 'x', 'T')).toBe(true);
    expect(store.setStatus(open, 'dismissed', 'x', 'T')).toBe(false);
    expect(store.setStatus(999, 'dismissed', 'x', 'T')).toBe(false);
  });

  it('has no column that stores message content', () => {
    const columns = ctx.storage
      .all<{ name: string }>("SELECT name FROM pragma_table_info('moderation_cases')")
      .map((c) => c.name);
    expect(columns.filter((n) => /content|text|body/.test(n))).toEqual([]);
  });
});

describe('CaseStore spam rules', () => {
  let ctx: ReturnType<typeof createTestModuleStorage>;
  let store: CaseStore;

  beforeEach(() => {
    ctx = createTestModuleStorage(MODULE_DIR);
    store = new CaseStore(ctx.storage);
  });
  afterEach(() => {
    ctx.close();
  });

  const spamCase = (overrides: Partial<NewCase> = {}): NewCase =>
    newCase({ rules: [{ rule: 'flood', count: 9, seconds: 5 }], ...overrides });
  const user = '111111111111111111';
  const since = '2026-01-01T00:00:00.000Z';

  it('stores and reads back rules, defaulting to an empty list', () => {
    const withRules = store.create(
      spamCase({
        rules: [
          { rule: 'mentions', count: 7 },
          { rule: 'repeat', count: 4, seconds: 60 },
        ],
      }),
    );
    const without = store.create(newCase());
    expect(store.get(withRules)?.rules).toEqual([
      { rule: 'mentions', count: 7 },
      { rule: 'repeat', count: 4, seconds: 60 },
    ]);
    expect(store.get(without)?.rules).toEqual([]);
  });

  it('counts only actioned automatic spam cases since the given instant', () => {
    store.create(spamCase());
    store.create(spamCase({ createdAt: '2026-01-02T00:00:00.000Z' }));
    store.create(newCase()); // phishing: rules empty
    store.create(spamCase({ status: 'open' }));
    store.create(spamCase({ status: 'reverted' }));
    store.create(spamCase({ status: 'dismissed' }));
    store.create(spamCase({ createdAt: '2025-12-31T23:59:59.999Z' }));
    store.create(spamCase({ kind: 'manual' }));
    store.create(spamCase({ targetUserId: '999999999999999999' }));
    expect(store.countActionedSpamSince(user, since)).toBe(2);
  });
});
