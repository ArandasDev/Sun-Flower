import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from './database.ts';
import { MIGRATIONS_DIR, MigrationError, runMigrations } from './migrations.ts';

let dir: string;
let db: DatabaseSync;

function write(name: string, sql: string): void {
  fs.writeFileSync(path.join(dir, name), sql);
}

function applied(database: DatabaseSync): string[] {
  const rows = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
    version: string;
  }[];
  return rows.map((row) => row.version);
}

function tables(database: DatabaseSync): string[] {
  const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sun-flower-migrations-'));
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('runMigrations', () => {
  it('applies migrations in order and records them', () => {
    write('0002-b.sql', 'CREATE TABLE b (id INTEGER PRIMARY KEY);');
    write('0001-a.sql', 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
    expect(runMigrations(db, dir)).toEqual(['0001-a', '0002-b']);
    expect(runMigrations(db, dir)).toEqual([]);
    expect(tables(db)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('rolls back a failing migration and stops', () => {
    write('0001-a.sql', 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
    write('0002-b.sql', 'CREATE TABLE b (id INTEGER PRIMARY KEY); NOT VALID SQL;');
    write('0003-c.sql', 'CREATE TABLE c (id INTEGER PRIMARY KEY);');
    expect(() => runMigrations(db, dir)).toThrow(MigrationError);
    expect(applied(db)).toEqual(['0001-a']);
    expect(tables(db)).not.toContain('b');
    expect(tables(db)).not.toContain('c');
  });

  it('reports the failing version', () => {
    write('0001-a.sql', 'NOT VALID SQL;');
    try {
      runMigrations(db, dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).version).toBe('0001-a');
    }
  });

  it('ignores files that are not migrations', () => {
    write('README.md', 'notes');
    write('0001-a.sql', 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
    expect(runMigrations(db, dir)).toEqual(['0001-a']);
  });

  it('creates the core tables', () => {
    runMigrations(db, MIGRATIONS_DIR);
    expect(tables(db)).toEqual(
      expect.arrayContaining(['developers', 'permission_grants', 'module_config']),
    );
  });
});

describe('core schema constraints', () => {
  const insert =
    'INSERT INTO module_config (module_id, enabled, settings, updated_at) VALUES (?, ?, ?, ?)';

  it('rejects enabled values other than null, 0 and 1', () => {
    runMigrations(db, MIGRATIONS_DIR);
    expect(() => db.prepare(insert).run('m1', 2, '{}', 'now')).toThrow();
    expect(() => db.prepare(insert).run('m2', null, '{}', 'now')).not.toThrow();
    expect(() => db.prepare(insert).run('m3', 1, '{}', 'now')).not.toThrow();
  });

  it('rejects settings that are not valid JSON', () => {
    runMigrations(db, MIGRATIONS_DIR);
    expect(() => db.prepare(insert).run('m1', 1, 'not json', 'now')).toThrow();
  });
});

describe('openDatabase', () => {
  it('sets a 5000 ms busy timeout', () => {
    const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    expect(row.timeout).toBe(5000);
  });

  it('creates missing parent directories for file databases', () => {
    const file = path.join(dir, 'nested', 'deeper', 'bot.db');
    const fileDb = openDatabase(file);
    try {
      expect(fs.existsSync(file)).toBe(true);
      const mode = fileDb.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(mode.journal_mode).toBe('wal');
    } finally {
      fileDb.close();
    }
  });

  it('enables foreign keys', () => {
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });
});
