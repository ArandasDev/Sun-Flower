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

describe('ModuleConfigStore.updateSettings', () => {
  const rawSettings = (): unknown => {
    const row = db.prepare('SELECT settings FROM module_config WHERE module_id = ?').get('ping') as
      { settings: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.settings);
  };

  it('merges top-level keys and returns parsed settings', () => {
    const two = z.object({ greeting: z.string().default('hi'), level: z.number().default(1) });
    store.setSettings('ping', { greeting: 'yo' });
    expect(store.updateSettings('ping', two, { level: 5 })).toEqual({ greeting: 'yo', level: 5 });
    expect(rawSettings()).toEqual({ greeting: 'yo', level: 5 });
    expect(store.updateSettings('ping', two, {})).toEqual({ greeting: 'yo', level: 5 });
  });

  it('applies defaults to the result without storing them', () => {
    const two = z.object({ greeting: z.string().default('hi'), level: z.number().default(1) });
    expect(store.updateSettings('ping', two, { level: 3 })).toEqual({ greeting: 'hi', level: 3 });
    expect(rawSettings()).toEqual({ level: 3 });
  });

  it('rejects an invalid merge without writing', () => {
    store.setSettings('ping', { greeting: 'yo' });
    expect(() => store.updateSettings('ping', schema, { greeting: 424242 })).toThrow(
      InvalidModuleConfigError,
    );
    expect(() => store.updateSettings('ping', schema, { greeting: 424242 })).toThrow(/greeting/);
    expect(() => store.updateSettings('ping', schema, { greeting: 424242 })).not.toThrow(/424242/);
    expect(store.loadSettings('ping', schema)).toEqual({ greeting: 'yo' });
    expect(rawSettings()).toEqual({ greeting: 'yo' });
  });

  it('throws when the module has no configSchema', () => {
    expect(() => store.updateSettings('ping', undefined, { greeting: 'yo' })).toThrow(
      InvalidModuleConfigError,
    );
    expect(rawSettings()).toBeUndefined();
  });

  it('replaces a nested object as a whole', () => {
    const nested = z.object({
      thresholds: z.object({
        confirmed: z.number().optional(),
        suspicious: z.number().optional(),
        extra: z.number().optional(),
      }),
    });
    store.setSettings('ping', { thresholds: { confirmed: 80, extra: 7 } });
    expect(
      store.updateSettings('ping', nested, { thresholds: { confirmed: 90, suspicious: 40 } }),
    ).toEqual({ thresholds: { confirmed: 90, suspicious: 40 } });
    expect(rawSettings()).toEqual({ thresholds: { confirmed: 90, suspicious: 40 } });
  });

  it('treats non-object stored settings as empty and keeps enabled', () => {
    store.setEnabled('ping', true);
    store.setSettings('ping', [1, 2]);
    expect(store.updateSettings('ping', schema, { greeting: 'yo' })).toEqual({ greeting: 'yo' });
    expect(store.isEnabled('ping', false)).toBe(true);
  });
});
