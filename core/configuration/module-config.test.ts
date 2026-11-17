import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { InvalidModuleConfigError, ModuleConfigStore } from './module-config.ts';

let db: DatabaseSync;
let store: ModuleConfigStore;
const schema = z.object({ greeting: z.string().default('hi') });

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  store = new ModuleConfigStore(db);
});

describe('ModuleConfigStore', () => {
  it('uses enabledByDefault when nothing is stored, stored value otherwise', () => {
    expect(store.isEnabled('ping', true)).toBe(true);
    expect(store.isEnabled('ping', false)).toBe(false);
    store.setEnabled('ping', true);
    expect(store.isEnabled('ping', false)).toBe(true);
    store.setEnabled('ping', false);
    expect(store.isEnabled('ping', true)).toBe(false);
    store.setEnabled('ping', null);
    expect(store.isEnabled('ping', true)).toBe(true);
    expect(store.isEnabled('ping', false)).toBe(false);
  });

  it('returns {} without a schema, with or without a stored row', () => {
    expect(store.loadSettings('ping')).toEqual({});
    store.setSettings('ping', { greeting: 'yo' });
    expect(store.loadSettings('ping')).toEqual({});
  });

  it('applies schema defaults', () => {
    expect(store.loadSettings('ping', schema)).toEqual({ greeting: 'hi' });
    store.setSettings('ping', {});
    expect(store.loadSettings('ping', schema)).toEqual({ greeting: 'hi' });
  });

  it('round-trips settings and keeps enabled on settings update', () => {
    store.setEnabled('ping', true);
    store.setSettings('ping', { greeting: 'yo' });
    expect(store.loadSettings('ping', schema)).toEqual({ greeting: 'yo' });
    expect(store.isEnabled('ping', false)).toBe(true);
  });

  it('keeps settings when enabled changes', () => {
    store.setSettings('ping', { greeting: 'yo' });
    store.setEnabled('ping', false);
    expect(store.loadSettings('ping', schema)).toEqual({ greeting: 'yo' });
  });

  it('rejects invalid settings without echoing values', () => {
    store.setSettings('ping', { greeting: 424242 });
    expect(() => store.loadSettings('ping', schema)).toThrow(InvalidModuleConfigError);
    expect(() => store.loadSettings('ping', schema)).toThrow(/greeting/);
    expect(() => store.loadSettings('ping', schema)).not.toThrow(/424242/);
  });

  it('does not echo string values in the error message', () => {
    const strict = z.object({ mode: z.enum(['a', 'b']) });
    store.setSettings('ping', { mode: 'SECRET-VALUE' });
    expect(() => store.loadSettings('ping', strict)).toThrow(/mode/);
    expect(() => store.loadSettings('ping', strict)).not.toThrow(/SECRET-VALUE/);
  });
});
