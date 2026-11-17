import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

const MIGRATION_FILE = /^\d{4}-.+\.sql$/;

export class MigrationError extends Error {
  readonly version: string;

  constructor(version: string, cause: unknown) {
    super(`migration ${version} failed`, { cause });
    this.name = 'MigrationError';
    this.version = version;
  }
}

export function runMigrations(db: DatabaseSync, directory: string): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const done = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
      (row) => row.version,
    ),
  );
  const files = fs
    .readdirSync(directory)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const version = file.slice(0, -'.sql'.length);
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    let alreadyRecorded: boolean;
    try {
      // IMMEDIATE takes the write lock first, so another process cannot apply the same
      // migration between our check and our write.
      db.exec('BEGIN IMMEDIATE');
      alreadyRecorded =
        db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version) !== undefined;
      if (alreadyRecorded) {
        db.exec('COMMIT');
      } else {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
          version,
          new Date().toISOString(),
        );
        db.exec('COMMIT');
      }
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw new MigrationError(version, error);
    }
    if (!alreadyRecorded) applied.push(version);
  }
  return applied;
}
