import type { ModuleStorage } from '../../shared/contracts/storage.ts';
import { parentDomains } from './detection/links.ts';
import { OFFICIAL_DOMAINS } from './detection/lookalike.ts';
import type { DomainLists } from './detection/score.ts';

export type DomainList = 'block' | 'allow';

/** Block and allow lists of domains, persisted in `moderation_domains`. */
export class DomainStore implements DomainLists {
  private readonly storage: ModuleStorage;

  constructor(storage: ModuleStorage) {
    this.storage = storage;
  }

  /** Inserts the official domains as `allow`; never overrides an existing entry. */
  seedOfficial(nowIso: string): void {
    this.storage.transaction(() => {
      for (const domain of OFFICIAL_DOMAINS) {
        this.storage.run(
          `INSERT OR IGNORE INTO moderation_domains (domain, list, added_by, added_at)
           VALUES (?, 'allow', NULL, ?)`,
          [domain, nowIso],
        );
      }
    });
  }

  set(domain: string, list: DomainList, addedBy: string | null, nowIso: string): void {
    this.storage.run(
      `INSERT INTO moderation_domains (domain, list, added_by, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET
         list = excluded.list, added_by = excluded.added_by, added_at = excluded.added_at`,
      [domain, list, addedBy, nowIso],
    );
  }

  remove(domain: string): boolean {
    return (
      this.storage.run('DELETE FROM moderation_domains WHERE domain = ?', [domain]).changes > 0
    );
  }

  list(list: DomainList, limit: number): string[] {
    return this.storage
      .all<{ domain: string }>(
        'SELECT domain FROM moderation_domains WHERE list = ? ORDER BY domain ASC LIMIT ?',
        [list, limit],
      )
      .map((row) => row.domain);
  }

  isBlocked(domain: string): boolean {
    return this.matches(domain, 'block');
  }

  isAllowed(domain: string): boolean {
    return this.matches(domain, 'allow');
  }

  private matches(domain: string, list: DomainList): boolean {
    const candidates = parentDomains(domain);
    if (candidates.length === 0) return false;
    const placeholders = candidates.map(() => '?').join(', ');
    return (
      this.storage.get(
        `SELECT 1 AS found FROM moderation_domains WHERE list = ? AND domain IN (${placeholders})`,
        [list, ...candidates],
      ) !== undefined
    );
  }
}
