import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** A session is dropped after this long without use. */
export const IDLE_EXPIRY_MS = 43_200_000;
/** A session is dropped this long after creation, however much it is used. */
export const ABSOLUTE_EXPIRY_MS = 604_800_000;
/** `last_seen_at` is rewritten at most this often. */
export const TOUCH_INTERVAL_MS = 60_000;
/** How often startCore purges expired sessions. */
export const PURGE_INTERVAL_MS = 3_600_000;

export interface SessionRecord {
  readonly idHash: string;
  readonly userId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
}

interface SessionRow {
  id_hash: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    idHash: row.id_hash,
    userId: row.user_id,
    createdAt: Date.parse(row.created_at),
    lastSeenAt: Date.parse(row.last_seen_at),
    expiresAt: Date.parse(row.expires_at),
  };
}

/** Panel sessions. Only the sha256 of the token is stored, never the token. */
export class SessionStore {
  readonly #db: DatabaseSync;
  readonly #now: () => number;

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(userId: string): { token: string; record: SessionRecord } {
    const token = randomBytes(32).toString('base64url');
    const now = this.#now();
    const record: SessionRecord = {
      idHash: hashSessionToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + ABSOLUTE_EXPIRY_MS,
    };
    this.#db
      .prepare(
        'INSERT INTO panel_sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(record.idHash, userId, iso(now), iso(now), iso(record.expiresAt));
    return { token, record };
  }

  /** Returns the session if both expirations still hold, refreshing `last_seen_at` at most once a minute. */
  resolve(token: string): SessionRecord | null {
    const idHash = hashSessionToken(token);
    const row = this.#db.prepare('SELECT * FROM panel_sessions WHERE id_hash = ?').get(idHash) as
      SessionRow | undefined;
    if (row === undefined) return null;
    const record = toRecord(row);
    const now = this.#now();
    if (!Number.isFinite(record.expiresAt) || !Number.isFinite(record.lastSeenAt)) return null;
    if (now > record.expiresAt || now > record.lastSeenAt + IDLE_EXPIRY_MS) return null;
    if (now - record.lastSeenAt < TOUCH_INTERVAL_MS) return record;
    this.#db
      .prepare('UPDATE panel_sessions SET last_seen_at = ? WHERE id_hash = ?')
      .run(iso(now), idHash);
    return { ...record, lastSeenAt: now };
  }

  delete(token: string): void {
    this.deleteByHash(hashSessionToken(token));
  }

  deleteByHash(idHash: string): void {
    this.#db.prepare('DELETE FROM panel_sessions WHERE id_hash = ?').run(idHash);
  }

  deleteForUser(userId: string): number {
    return Number(
      this.#db.prepare('DELETE FROM panel_sessions WHERE user_id = ?').run(userId).changes,
    );
  }

  purgeExpired(): number {
    const now = this.#now();
    let removed = Number(
      this.#db
        .prepare('DELETE FROM panel_sessions WHERE expires_at < ? OR last_seen_at < ?')
        .run(iso(now), iso(now - IDLE_EXPIRY_MS)).changes,
    );
    const rows = this.#db.prepare('SELECT * FROM panel_sessions').all() as unknown as SessionRow[];
    for (const row of rows) {
      const record = toRecord(row);
      if (!Number.isFinite(record.expiresAt) || !Number.isFinite(record.lastSeenAt)) {
        this.deleteByHash(row.id_hash);
        removed += 1;
      }
    }
    return removed;
  }
}
