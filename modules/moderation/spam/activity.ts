import { createHash } from 'node:crypto';

const MIN_FINGERPRINT_LENGTH = 10;

export interface ActivityEntry {
  messageId: string;
  channelId: string;
  atMs: number;
  fingerprint: string | null;
}

export interface ActivityLimits {
  maxAuthors?: number;
  maxEntries?: number;
}

/**
 * Hash of the normalized text (lowercase, no accents or format characters,
 * collapsed whitespace). Texts shorter than 10 characters yield null. The
 * text itself is never kept.
 */
export function fingerprintOf(content: string): string | null {
  const normalized = content
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/(.)\1{2,}/gsu, '$1$1$1');
  if (normalized.length < MIN_FINGERPRINT_LENGTH) return null;
  return createHash('sha256').update(normalized).digest('hex');
}

export class ActivityLog {
  private readonly authors = new Map<string, ActivityEntry[]>();
  private readonly maxAuthors: number;
  private readonly maxEntries: number;

  constructor(limits: ActivityLimits = {}) {
    this.maxAuthors = limits.maxAuthors ?? 2000;
    this.maxEntries = limits.maxEntries ?? 200;
  }

  get authorCount(): number {
    return this.authors.size;
  }

  record(authorId: string, entry: ActivityEntry): void {
    const entries = this.authors.get(authorId) ?? [];
    this.authors.delete(authorId);
    entries.push(entry);
    while (entries.length > this.maxEntries) entries.shift();
    this.authors.set(authorId, entries);
    while (this.authors.size > this.maxAuthors) {
      const oldest = this.authors.keys().next();
      if (oldest.done) break;
      this.authors.delete(oldest.value);
    }
  }

  since(authorId: string, sinceMs: number): readonly ActivityEntry[] {
    const entries = this.authors.get(authorId);
    if (entries === undefined) return [];
    return entries.filter((entry) => entry.atMs >= sinceMs);
  }

  forget(authorId: string, messageIds: readonly string[]): void {
    const entries = this.authors.get(authorId);
    if (entries === undefined) return;
    const ids = new Set(messageIds);
    const kept = entries.filter((entry) => !ids.has(entry.messageId));
    if (kept.length === 0) this.authors.delete(authorId);
    else this.authors.set(authorId, kept);
  }

  prune(nowMs: number, maxAgeMs: number): void {
    const cutoff = nowMs - maxAgeMs;
    for (const [authorId, entries] of this.authors) {
      const kept = entries.filter((entry) => entry.atMs >= cutoff);
      if (kept.length === 0) this.authors.delete(authorId);
      else if (kept.length !== entries.length) this.authors.set(authorId, kept);
    }
  }
}
