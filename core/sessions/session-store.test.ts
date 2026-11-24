import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import {
  ABSOLUTE_EXPIRY_MS,
  IDLE_EXPIRY_MS,
  SessionStore,
  TOUCH_INTERVAL_MS,
  hashSessionToken,
} from './session-store.ts';

const user = '111111111111111111';
const other = '222222222222222222';
const HOUR = 3_600_000;

let db: DatabaseSync;
let clock: number;
let store: SessionStore;

function count(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM panel_sessions').get() as { n: number }).n;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  clock = Date.UTC(2026, 0, 1);
  store = new SessionStore(db, () => clock);
});

describe('SessionStore', () => {
  it('exports the expiry constants', () => {
    expect(IDLE_EXPIRY_MS).toBe(43_200_000);
    expect(ABSOLUTE_EXPIRY_MS).toBe(604_800_000);
    expect(TOUCH_INTERVAL_MS).toBe(60_000);
  });

  it('creates a 43-character base64url token and stores only its hash', () => {
    const { token, record } = store.create(user);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record.idHash).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    const rows = db.prepare('SELECT * FROM panel_sessions').all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(record.userId).toBe(user);
    expect(record.createdAt).toBe(clock);
    expect(record.expiresAt).toBe(clock + ABSOLUTE_EXPIRY_MS);
  });

  it('creates different tokens', () => {
    expect(store.create(user).token).not.toBe(store.create(user).token);
  });

  it('returns null for an unknown token', () => {
    expect(store.resolve('nope')).toBeNull();
  });

  it('resolves just before the idle limit and rejects just after', () => {
    const { token } = store.create(user);
    clock += IDLE_EXPIRY_MS - 1;
    expect(store.resolve(token)).not.toBeNull();

    const second = store.create(user);
    clock += IDLE_EXPIRY_MS + 1;
    expect(store.resolve(second.token)).toBeNull();
  });

  it('enforces the absolute limit even with constant use', () => {
    const { token } = store.create(user);
    const start = clock;
    for (let t = HOUR; t <= ABSOLUTE_EXPIRY_MS; t += HOUR) {
      clock = start + t;
      expect(store.resolve(token)).not.toBeNull();
    }
    clock = start + ABSOLUTE_EXPIRY_MS + 1;
    expect(store.resolve(token)).toBeNull();
  });

  it('does not rewrite last_seen_at before the touch interval', () => {
    const { token, record } = store.create(user);
    clock += TOUCH_INTERVAL_MS - 1;
    expect(store.resolve(token)?.lastSeenAt).toBe(record.createdAt);
    clock += 1;
    expect(store.resolve(token)?.lastSeenAt).toBe(clock);
    const row = db.prepare('SELECT last_seen_at FROM panel_sessions').get() as {
      last_seen_at: string;
    };
    expect(row.last_seen_at).toBe(new Date(clock).toISOString());
  });

  it('deletes by token and by hash', () => {
    const a = store.create(user);
    const b = store.create(user);
    store.delete(a.token);
    expect(store.resolve(a.token)).toBeNull();
    store.deleteByHash(b.record.idHash);
    expect(store.resolve(b.token)).toBeNull();
    expect(count()).toBe(0);
  });

  it('purges only expired sessions', () => {
    const old = store.create(user);
    clock += IDLE_EXPIRY_MS + 1;
    const fresh = store.create(user);
    expect(store.purgeExpired()).toBe(1);
    expect(count()).toBe(1);
    expect(store.resolve(old.token)).toBeNull();
    expect(store.resolve(fresh.token)).not.toBeNull();
  });

  it('purges sessions past the absolute limit', () => {
    const { token } = store.create(user);
    const start = clock;
    for (let t = HOUR; t <= ABSOLUTE_EXPIRY_MS; t += HOUR) {
      clock = start + t;
      store.resolve(token);
    }
    clock = start + ABSOLUTE_EXPIRY_MS + 1;
    expect(store.purgeExpired()).toBe(1);
  });

  it('deletes every session of a user', () => {
    store.create(user);
    store.create(user);
    const kept = store.create(other);
    expect(store.deleteForUser(user)).toBe(2);
    expect(count()).toBe(1);
    expect(store.resolve(kept.token)).not.toBeNull();
  });
});
