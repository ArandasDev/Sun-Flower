import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModuleStorage } from '../../shared/contracts/storage.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { createModuleStorage } from './module-storage.ts';

let db: DatabaseSync;
let storage: ModuleStorage;

beforeEach(() => {
  db = openDatabase(':memory:');
  db.exec('CREATE TABLE t_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  storage = createModuleStorage(db);
});

afterEach(() => {
  db.close();
});

describe('createModuleStorage', () => {
  it('run returns changes and lastInsertRowid', () => {
    const result = storage.run('INSERT INTO t_items (name) VALUES (?)', ['a']);
    expect(result.changes).toBe(1);
    expect(Number(result.lastInsertRowid)).toBe(1);
  });

  it('get returns undefined without a row', () => {
    expect(storage.get('SELECT * FROM t_items WHERE id = ?', [9])).toBeUndefined();
  });

  it('all supports parameters', () => {
    storage.run('INSERT INTO t_items (name) VALUES (?)', ['a']);
    storage.run('INSERT INTO t_items (name) VALUES (?)', ['b']);
    expect(storage.all<{ name: string }>('SELECT name FROM t_items WHERE name > ?', ['a'])).toEqual(
      [{ name: 'b' }],
    );
  });

  it('transaction commits on return and rolls back on throw', () => {
    const value = storage.transaction(() => {
      storage.run('INSERT INTO t_items (name) VALUES (?)', ['a']);
      return 42;
    });
    expect(value).toBe(42);
    expect(() =>
      storage.transaction(() => {
        storage.run('INSERT INTO t_items (name) VALUES (?)', ['b']);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(storage.all('SELECT name FROM t_items')).toHaveLength(1);
    expect(db.isTransaction).toBe(false);
  });

  it('rejects nested transactions', () => {
    expect(() => storage.transaction(() => storage.transaction(() => 1))).toThrow(
      'nested transactions are not supported',
    );
    expect(db.isTransaction).toBe(false);
  });

  it('rejects an async callback and rolls back', () => {
    expect(() =>
      storage.transaction(async () => {
        storage.run('INSERT INTO t_items (name) VALUES (?)', ['a']);
        await Promise.resolve();
      }),
    ).toThrow('transaction callback must be synchronous');
    expect(storage.all('SELECT name FROM t_items')).toHaveLength(0);
    expect(db.isTransaction).toBe(false);
  });
});
