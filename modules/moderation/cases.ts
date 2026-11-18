import type { ModuleStorage, SqlValue } from '../../shared/contracts/storage.ts';
import type { Signal } from './detection/score.ts';

export type CaseAction = 'none' | 'delete_timeout' | 'warn' | 'timeout' | 'kick' | 'ban';
export type CaseStatus = 'open' | 'actioned' | 'reverted' | 'dismissed';

/** No message content is stored: only identifiers, domains, signals and outcomes. */
export interface NewCase {
  kind: 'automatic' | 'manual';
  level: 'confirmed' | 'suspicious' | null;
  action: CaseAction;
  targetUserId: string;
  actorUserId: string | null;
  channelId: string | null;
  messageId: string | null;
  domains: string[];
  signals: Signal[];
  score: number;
  reason: string;
  outcome: Record<string, string>;
  status: CaseStatus;
  timeoutUntil: string | null;
  createdAt: string;
}

export interface CaseRecord extends NewCase {
  id: number;
  revertedBy: string | null;
  revertedAt: string | null;
}

interface CaseRow {
  id: number;
  kind: NewCase['kind'];
  level: NewCase['level'];
  action: CaseAction;
  target_user_id: string;
  actor_user_id: string | null;
  channel_id: string | null;
  message_id: string | null;
  domains: string;
  signals: string;
  score: number;
  reason: string;
  outcome: string;
  status: CaseStatus;
  timeout_until: string | null;
  created_at: string;
  reverted_by: string | null;
  reverted_at: string | null;
}

function toRecord(row: CaseRow): CaseRecord {
  return {
    id: row.id,
    kind: row.kind,
    level: row.level,
    action: row.action,
    targetUserId: row.target_user_id,
    actorUserId: row.actor_user_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    domains: JSON.parse(row.domains) as string[],
    signals: JSON.parse(row.signals) as Signal[],
    score: row.score,
    reason: row.reason,
    outcome: JSON.parse(row.outcome) as Record<string, string>,
    status: row.status,
    timeoutUntil: row.timeout_until,
    createdAt: row.created_at,
    revertedBy: row.reverted_by,
    revertedAt: row.reverted_at,
  };
}

const ALLOWED_FROM: Record<'reverted' | 'dismissed', readonly CaseStatus[]> = {
  reverted: ['open', 'actioned'],
  dismissed: ['open'],
};

/** Moderation cases, persisted in `moderation_cases`. */
export class CaseStore {
  private readonly storage: ModuleStorage;

  constructor(storage: ModuleStorage) {
    this.storage = storage;
  }

  create(c: NewCase): number {
    const result = this.storage.run(
      `INSERT INTO moderation_cases
         (kind, level, action, target_user_id, actor_user_id, channel_id, message_id,
          domains, signals, score, reason, outcome, status, timeout_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        c.kind,
        c.level,
        c.action,
        c.targetUserId,
        c.actorUserId,
        c.channelId,
        c.messageId,
        JSON.stringify(c.domains),
        JSON.stringify(c.signals),
        c.score,
        c.reason,
        JSON.stringify(c.outcome),
        c.status,
        c.timeoutUntil,
        c.createdAt,
      ],
    );
    return Number(result.lastInsertRowid);
  }

  get(id: number): CaseRecord | undefined {
    const row = this.storage.get<CaseRow>('SELECT * FROM moderation_cases WHERE id = ?', [id]);
    return row === undefined ? undefined : toRecord(row);
  }

  findLatestByMessage(messageId: string): CaseRecord | undefined {
    const row = this.storage.get<CaseRow>(
      'SELECT * FROM moderation_cases WHERE message_id = ? ORDER BY id DESC LIMIT 1',
      [messageId],
    );
    return row === undefined ? undefined : toRecord(row);
  }

  listRecent(limit: number, targetUserId?: string): CaseRecord[] {
    const params: SqlValue[] = [];
    let where = '';
    if (targetUserId !== undefined) {
      where = 'WHERE target_user_id = ?';
      params.push(targetUserId);
    }
    params.push(limit);
    return this.storage
      .all<CaseRow>(
        `SELECT * FROM moderation_cases ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        params,
      )
      .map(toRecord);
  }

  /** False when the case does not exist or its current status does not allow the change. */
  setStatus(id: number, status: 'reverted' | 'dismissed', by: string, nowIso: string): boolean {
    const from = ALLOWED_FROM[status];
    // reverted_by/reverted_at also record who dismissed the case and when.
    return this.storage.transaction(() => {
      const placeholders = from.map(() => '?').join(', ');
      const result = this.storage.run(
        `UPDATE moderation_cases SET status = ?, reverted_by = ?, reverted_at = ?
         WHERE id = ? AND status IN (${placeholders})`,
        [status, by, nowIso, id, ...from],
      );
      return result.changes > 0;
    });
  }
}
