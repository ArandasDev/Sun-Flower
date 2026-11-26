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
/** A person keeps at most this many live sessions; a new one evicts the least recently used. */
export const MAX_SESSIONS_PER_USER = 5;

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
  readonly #listeners = new Set<(idHashes: readonly string[]) => void>();

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
    const evicted = this.#evictForNewSession(userId, now);
    this.#db
      .prepare(
        'INSERT INTO panel_sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(record.idHash, userId, iso(now), iso(now), iso(record.expiresAt));
    if (evicted.length > 0) this.#notify(evicted);
    return { token, record };
  }

  /**
   * Deletes the live sessions of the person that would exceed the limit once a new one exists,
   * least recently used first (ties by creation). Expired sessions do not count; the purge
   * removes them. Returns the deleted hashes, for the caller to announce after the insert.
   */
  #evictForNewSession(userId: string, now: number): string[] {
    const rows = this.#db
      .prepare('SELECT * FROM panel_sessions WHERE user_id = ?')
      .all(userId) as unknown as SessionRow[];
    const live = rows
      .map(toRecord)
      .filter(
        (record) =>
          Number.isFinite(record.expiresAt) &&
          Number.isFinite(record.lastSeenAt) &&
          now <= record.expiresAt &&
          now <= record.lastSeenAt + IDLE_EXPIRY_MS,
      )
      .sort(
        (a, b) =>
          a.lastSeenAt - b.lastSeenAt ||
          a.createdAt - b.createdAt ||
          a.idHash.localeCompare(b.idHash),
      );
    const excess = live.length - (MAX_SESSIONS_PER_USER - 1);
    if (excess <= 0) return [];
    const evicted = live.slice(0, excess).map((record) => record.idHash);
    for (const idHash of evicted) this.deleteByHash(idHash);
    return evicted;
  }

  /** Returns the session if both expirations still hold, refreshing `last_seen_at` at most once a minute. */
  resolve(token: string): SessionRecord | null {
    const record = this.peek(token);
    if (record === null) return null;
    const now = this.#now();
    if (now - record.lastSeenAt < TOUCH_INTERVAL_MS) return record;
    this.#db
      .prepare('UPDATE panel_sessions SET last_seen_at = ? WHERE id_hash = ?')
      .run(iso(now), record.idHash);
    return { ...record, lastSeenAt: now };
  }

  /** Like `resolve`, but read-only: `last_seen_at` is never rewritten. */
  peek(token: string): SessionRecord | null {
    return this.peekByHash(hashSessionToken(token));
  }

  /** The valid session with this hash, read-only. */
  peekByHash(idHash: string): SessionRecord | null {
    const row = this.#db.prepare('SELECT * FROM panel_sessions WHERE id_hash = ?').get(idHash) as
      SessionRow | undefined;
    if (row === undefined) return null;
    const record = toRecord(row);
    const now = this.#now();
    if (!Number.isFinite(record.expiresAt) || !Number.isFinite(record.lastSeenAt)) return null;
    if (now > record.expiresAt || now > record.lastSeenAt + IDLE_EXPIRY_MS) return null;
    return record;
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

  /** Live sessions (same expiry rule as `peek`), newest first. */
  list(): SessionRecord[] {
    const rows = this.#db
      .prepare('SELECT * FROM panel_sessions ORDER BY created_at DESC, id_hash')
      .all() as unknown as SessionRow[];
    const now = this.#now();
    return rows
      .map(toRecord)
      .filter(
        (record) =>
          Number.isFinite(record.expiresAt) &&
          Number.isFinite(record.lastSeenAt) &&
          now <= record.expiresAt &&
          now <= record.lastSeenAt + IDLE_EXPIRY_MS,
      );
  }

  /** An opaque, stable reference for a session; the hash itself never leaves the Core. */
  refOf(idHash: string): string {
    return createHash('sha256').update(`ref:${idHash}`).digest('hex').slice(0, 16);
  }

  /** Deletes the session with this reference. Notifies listeners only if one was deleted. */
  revokeByRef(ref: string): boolean {
    const rows = this.#db.prepare('SELECT id_hash FROM panel_sessions').all() as unknown as {
      id_hash: string;
    }[];
    const match = rows.find((row) => this.refOf(row.id_hash) === ref);
    if (match === undefined) return false;
    this.deleteByHash(match.id_hash);
    this.#notify([match.id_hash]);
    return true;
  }

  /** Deletes every session of the user. Notifies listeners once, only if any was deleted. */
  revokeForUser(userId: string): number {
    const rows = this.#db
      .prepare('SELECT id_hash FROM panel_sessions WHERE user_id = ?')
      .all(userId) as unknown as { id_hash: string }[];
    if (rows.length === 0) return 0;
    const removed = this.deleteForUser(userId);
    this.#notify(rows.map((row) => row.id_hash));
    return removed;
  }

  /** Listens to revocations made by `revokeByRef` and `revokeForUser`. Returns the unsubscribe function. */
  onRevoked(listener: (idHashes: readonly string[]) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(idHashes: readonly string[]): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(idHashes);
      } catch {
        // A faulty listener must not stop the others or undo the revocation.
      }
    }
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
