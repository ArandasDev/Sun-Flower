import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import {
  ModuleMigrationError,
  applyModuleMigrations,
  validateModuleMigration,
} from './module-migrations.ts';

describe('validateModuleMigration', () => {
  const ok = (sql: string): void => expect(validateModuleMigration('moderation', sql)).toEqual([]);
  const bad = (sql: string): void =>
    expect(validateModuleMigration('moderation', sql)).not.toEqual([]);

  it('accepts prefixed names', () => {
    ok('CREATE TABLE moderation_cases (id INTEGER PRIMARY KEY);');
    ok('CREATE INDEX IF NOT EXISTS moderation_x ON moderation_cases (id);');
    ok('CREATE UNIQUE INDEX moderation_u ON moderation_cases (id);');
    ok('CREATE TRIGGER moderation_t AFTER INSERT ON moderation_cases BEGIN SELECT 1; END;');
    ok('CREATE TABLE "moderation_a" (id INTEGER);');
    ok('CREATE TABLE `moderation_a` (id INTEGER);');
    ok('CREATE TABLE [moderation_a] (id INTEGER);');
    ok('CREATE VIRTUAL TABLE moderation_fts USING fts5(body);');
    ok('INSERT INTO moderation_cases (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id = 2;');
  });

  it('rejects names outside the prefix and dangerous statements', () => {
    bad('CREATE TABLE cases (id INTEGER);');
    bad('CREATE TABLE main.moderation_x (id INTEGER);');
    bad('CREATE TABLE IF NOT EXISTS developers (id INTEGER);');
    bad('DROP TABLE developers;');
    bad('ALTER TABLE permission_grants ADD x TEXT;');
    bad("ATTACH DATABASE 'x' AS y;");
    bad('PRAGMA foreign_keys = OFF;');
    bad('CREATE VIRTUAL TABLE docs USING fts5(body);');
    bad('CREATE INDEX moderation_i ON developers (user_id);');
    bad('CREATE TRIGGER moderation_t AFTER INSERT ON developers BEGIN SELECT 1; END;');
  });

  it('ignores comments and string literals', () => {
    ok('-- CREATE TABLE x\nCREATE TABLE moderation_a (id INTEGER);');
    ok('/* CREATE TABLE x */ CREATE TABLE moderation_a (id INTEGER);');
    ok("INSERT INTO moderation_a (v) VALUES ('CREATE TABLE x; PRAGMA y');");
  });
});

describe('applyModuleMigrations', () => {
  let dir: string;
  let db: DatabaseSync;
  const write = (name: string, sql: string): void => fs.writeFileSync(path.join(dir, name), sql);
  const tables = (): string[] =>
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sun-flower-module-migrations-'));
    db = openDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('applies in order and is idempotent', () => {
    write('0002-b.sql', 'CREATE TABLE moderation_b (id INTEGER);');
    write('0001-a.sql', 'CREATE TABLE moderation_a (id INTEGER);');
    expect(applyModuleMigrations(db, 'moderation', dir)).toEqual(['0001-a', '0002-b']);
    expect(applyModuleMigrations(db, 'moderation', dir)).toEqual([]);
  });

  it('returns an empty list when the directory is missing', () => {
    expect(applyModuleMigrations(db, 'moderation', path.join(dir, 'nope'))).toEqual([]);
  });

  it('rejects a numbering gap without applying anything', () => {
    write('0001-a.sql', 'CREATE TABLE moderation_a (id INTEGER);');
    write('0003-c.sql', 'CREATE TABLE moderation_c (id INTEGER);');
    expect(() => applyModuleMigrations(db, 'moderation', dir)).toThrow(ModuleMigrationError);
    expect(tables()).not.toContain('moderation_a');
  });

  it('validates every migration before applying any', () => {
    write('0001-a.sql', 'CREATE TABLE moderation_a (id INTEGER);');
    write('0002-b.sql', 'CREATE TABLE other_b (id INTEGER);');
    expect(() => applyModuleMigrations(db, 'moderation', dir)).toThrow(ModuleMigrationError);
    expect(tables()).not.toContain('moderation_a');
  });

  it('rolls back only the failing migration and reports it without SQL text', () => {
    write('0001-a.sql', 'CREATE TABLE moderation_a (id INTEGER);');
    write('0002-b.sql', 'CREATE TABLE moderation_b (id INTEGER); SELEKT oops;');
    let error: unknown;
    try {
      applyModuleMigrations(db, 'moderation', dir);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ModuleMigrationError);
    const failure = error as ModuleMigrationError;
    expect(failure.moduleId).toBe('moderation');
    expect(failure.version).toBe('0002-b');
    expect(failure.message).not.toContain('SELEKT');
    expect(tables()).toContain('moderation_a');
    expect(tables()).not.toContain('moderation_b');
    expect(db.isTransaction).toBe(false);
  });

  it('keeps each module versions separate', () => {
    write('0001-a.sql', 'CREATE TABLE moderation_a (id INTEGER);');
    applyModuleMigrations(db, 'moderation', dir);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sun-flower-module-migrations-'));
    try {
      fs.writeFileSync(path.join(other, '0001-a.sql'), 'CREATE TABLE audit_a (id INTEGER);');
      expect(applyModuleMigrations(db, 'audit', other)).toEqual(['0001-a']);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
