import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestModuleStorage } from '../../../tests/helpers/module-storage.ts';
import { DomainStore } from '../domains.ts';
import { OFFICIAL_DOMAINS } from '../detection/lookalike.ts';

const MODULE_DIR = fileURLToPath(new URL('..', import.meta.url));
const NOW = '2026-01-01T00:00:00.000Z';

describe('DomainStore', () => {
  let ctx: ReturnType<typeof createTestModuleStorage>;
  let store: DomainStore;

  beforeEach(() => {
    ctx = createTestModuleStorage(MODULE_DIR);
    store = new DomainStore(ctx.storage);
  });
  afterEach(() => {
    ctx.close();
  });

  it('seeds the official domains once', () => {
    store.seedOfficial(NOW);
    store.seedOfficial(NOW);
    expect(store.list('allow', 1000)).toHaveLength(new Set(OFFICIAL_DOMAINS).size);
    expect(store.isAllowed(OFFICIAL_DOMAINS[0]!)).toBe(true);
  });

  it('keeps a seeded domain blocked after seeding again', () => {
    store.seedOfficial(NOW);
    const official = OFFICIAL_DOMAINS[0]!;
    store.set(official, 'block', '111111111111111111', NOW);
    store.seedOfficial(NOW);
    expect(store.isBlocked(official)).toBe(true);
    expect(store.isAllowed(official)).toBe(false);
  });

  it('moves a domain between lists', () => {
    store.set('golpe.com', 'block', null, NOW);
    store.set('golpe.com', 'allow', '222222222222222222', NOW);
    expect(store.isBlocked('golpe.com')).toBe(false);
    expect(store.isAllowed('golpe.com')).toBe(true);
    expect(store.list('block', 10)).toEqual([]);
  });

  it('matches parent domains', () => {
    store.set('golpe.com', 'block', null, NOW);
    store.set('bom.org', 'allow', null, NOW);
    expect(store.isBlocked('a.golpe.com')).toBe(true);
    expect(store.isAllowed('x.y.bom.org')).toBe(true);
    expect(store.isBlocked('outro.com')).toBe(false);
  });

  it('matches an IPv4 address exactly', () => {
    store.set('203.0.113.7', 'block', null, NOW);
    expect(store.isBlocked('203.0.113.7')).toBe(true);
    expect(store.isBlocked('113.7')).toBe(false);
  });

  it('removes a domain', () => {
    store.set('golpe.com', 'block', null, NOW);
    expect(store.remove('golpe.com')).toBe(true);
    expect(store.remove('golpe.com')).toBe(false);
    expect(store.isBlocked('golpe.com')).toBe(false);
  });

  it('lists in ascending order and respects the limit', () => {
    for (const d of ['c.com', 'a.com', 'b.com']) store.set(d, 'block', null, NOW);
    expect(store.list('block', 2)).toEqual(['a.com', 'b.com']);
  });
});
