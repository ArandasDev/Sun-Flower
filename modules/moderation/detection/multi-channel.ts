interface Entry {
  domain: string;
  channelId: string;
  atMs: number;
}

export interface MultiChannelLimits {
  maxAuthors?: number;
  maxEntries?: number;
}

const DEFAULT_MAX_AUTHORS = 1000;
const DEFAULT_MAX_ENTRIES = 50;

/** In-memory, bounded record of which channels an author posted a domain in. */
export class MultiChannelTracker {
  private readonly authors = new Map<string, Entry[]>();
  private readonly maxAuthors: number;
  private readonly maxEntries: number;

  constructor(limits: MultiChannelLimits = {}) {
    this.maxAuthors = Math.max(1, limits.maxAuthors ?? DEFAULT_MAX_AUTHORS);
    this.maxEntries = Math.max(1, limits.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  get authorCount(): number {
    return this.authors.size;
  }

  /** Records a sighting and returns the distinct channels of that domain in the window. */
  record(
    authorId: string,
    domain: string,
    channelId: string,
    nowMs: number,
    windowMs: number,
  ): number {
    const entries = (this.authors.get(authorId) ?? []).filter((e) => nowMs - e.atMs < windowMs);
    entries.push({ domain, channelId, atMs: nowMs });
    while (entries.length > this.maxEntries) entries.shift();

    // Re-insert so Map order reflects the least recently recorded author.
    this.authors.delete(authorId);
    this.authors.set(authorId, entries);
    while (this.authors.size > this.maxAuthors) {
      const oldest = this.authors.keys().next();
      if (oldest.done === true) break;
      this.authors.delete(oldest.value);
    }

    const channels = new Set<string>();
    for (const e of entries) if (e.domain === domain) channels.add(e.channelId);
    return channels.size;
  }

  /** Drops expired entries and authors left without entries. */
  prune(nowMs: number, windowMs: number): void {
    for (const [authorId, entries] of this.authors) {
      const fresh = entries.filter((e) => nowMs - e.atMs < windowMs);
      if (fresh.length === 0) this.authors.delete(authorId);
      else if (fresh.length !== entries.length) this.authors.set(authorId, fresh);
    }
  }
}
