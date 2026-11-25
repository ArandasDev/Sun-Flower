import type { LogEntry, LogLevelName } from '../../shared/contracts/admin.ts';

const LEVELS: Readonly<Record<number, LogLevelName>> = {
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};
const RANK: Readonly<Record<LogLevelName, number>> = { info: 30, warn: 40, error: 50, fatal: 60 };
/** Keys that are dropped from `fields` because they have their own place in the entry. */
const RESERVED = new Set(['pid', 'hostname', 'service', 'level', 'time', 'msg', 'module']);
const MAX_TEXT = 300;
const ID_RUN = /\d{17,20}/g;

function clean(text: string): string {
  return text.replace(ID_RUN, '[id]').slice(0, MAX_TEXT);
}

/**
 * An in-memory ring of the latest log entries (info and above). It is a pino stream
 * destination, so it sees records after pino's redaction, and it never throws.
 */
export class RecentLogs {
  readonly #capacity: number;
  readonly #entries: LogEntry[] = [];

  constructor(capacity = 500) {
    this.#capacity = capacity;
  }

  write(line: string): void {
    try {
      for (const part of line.split('\n')) this.#ingest(part);
    } catch {
      // A log sink must never break the logger.
    }
  }

  recent(options: { limit: number; minLevel: LogLevelName }): LogEntry[] {
    const limit = Math.min(Math.max(Math.trunc(options.limit) || 1, 1), this.#capacity);
    const min = RANK[options.minLevel];
    const result: LogEntry[] = [];
    for (let i = this.#entries.length - 1; i >= 0 && result.length < limit; i -= 1) {
      const entry = this.#entries[i]!;
      if (RANK[entry.level] >= min) result.push(entry);
    }
    return result;
  }

  #ingest(text: string): void {
    if (text.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
    const record = parsed as Record<string, unknown>;
    const level = typeof record.level === 'number' ? LEVELS[record.level] : undefined;
    if (level === undefined) return;

    const fields: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(record)) {
      if (RESERVED.has(key)) continue;
      if (typeof value === 'string') fields[key] = clean(value);
      else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        fields[key] = value;
      } else if (typeof value === 'object') fields[key] = '[objeto]';
    }

    const millis = typeof record.time === 'number' ? record.time : Date.now();
    const time = new Date(Number.isFinite(millis) ? millis : Date.now()).toISOString();
    const entry: LogEntry = {
      time,
      level,
      message: typeof record.msg === 'string' ? clean(record.msg) : '',
      ...(typeof record.module === 'string' ? { module: clean(record.module) } : {}),
      fields,
    };
    this.#entries.push(entry);
    if (this.#entries.length > this.#capacity) this.#entries.shift();
  }
}
