import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ModuleManifest } from '../../shared/contracts/module.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import {
  CorePermissionGrantError,
  InvalidPermissionError,
  InvalidSnowflakeError,
  PermissionService,
  UndeclaredPermissionError,
} from './permission-service.ts';

const dev = '000000000000000000';
const mod = '111111111111111111';
const role = '222222222222222222';
const injection = "1' OR '1'='1";

function manifest(overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id: 'ping',
    name: 'Ping',
    description: 'Ping module',
    version: '1.0.0',
    apiVersion: '1.0.0',
    entrypoint: 'index.ts',
    dependencies: [],
    permissions: [],
    capabilities: [],
    enabledByDefault: false,
    events: { subscribes: [], publishes: [] },
    ...overrides,
  };
}

let db: DatabaseSync;
let perms: PermissionService;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  perms = new PermissionService(db);
});

describe('PermissionService', () => {
  it('denies by default', () => {
    expect(perms.check({ userId: mod, roleIds: [role] }, 'ping.cmd.use')).toBe(false);
  });

  it('grants core.* only to developers', () => {
    perms.addDeveloper(dev);
    expect(perms.check({ userId: dev, roleIds: [] }, 'core.modules.manage')).toBe(true);
    expect(perms.check({ userId: mod, roleIds: [role] }, 'core.modules.manage')).toBe(false);
  });

  it('refuses to grant core.* to a role', () => {
    expect(() => {
      perms.grant('core.modules.manage', role);
    }).toThrow(CorePermissionGrantError);
  });

  it('ignores core.* rows that somehow exist in permission_grants', () => {
    db.prepare('INSERT INTO permission_grants VALUES (?, ?, ?)').run(
      'core.modules.manage',
      role,
      new Date().toISOString(),
    );
    expect(perms.check({ userId: mod, roleIds: [role] }, 'core.modules.manage')).toBe(false);
  });

  it('grants module permissions through roles, not developer status', () => {
    perms.addDeveloper(dev);
    perms.grant('ping.cmd.use', role);
    expect(perms.check({ userId: mod, roleIds: [role] }, 'ping.cmd.use')).toBe(true);
    expect(perms.check({ userId: dev, roleIds: [] }, 'ping.cmd.use')).toBe(false);
  });

  it('revokes a grant', () => {
    perms.grant('ping.cmd.use', role);
    perms.revoke('ping.cmd.use', role);
    expect(perms.check({ userId: mod, roleIds: [role] }, 'ping.cmd.use')).toBe(false);
  });

  it('grant is idempotent', () => {
    perms.grant('ping.cmd.use', role);
    expect(() => {
      perms.grant('ping.cmd.use', role);
    }).not.toThrow();
  });

  it('manages developers', () => {
    expect(perms.isDeveloper(dev)).toBe(false);
    expect(perms.addDeveloper(dev)).toBe(true);
    expect(perms.addDeveloper(dev)).toBe(false);
    expect(perms.isDeveloper(dev)).toBe(true);
    const list = perms.listDevelopers();
    expect(list).toHaveLength(1);
    expect(list[0]?.userId).toBe(dev);
    expect(new Date(list[0]?.addedAt ?? '').toISOString()).toBe(list[0]?.addedAt);
    expect(perms.removeDeveloper(dev)).toBe(true);
    expect(perms.removeDeveloper(dev)).toBe(false);
    expect(perms.isDeveloper(dev)).toBe(false);
  });

  it('validates snowflakes', () => {
    expect(() => perms.addDeveloper('abc')).toThrow(InvalidSnowflakeError);
    expect(() => perms.removeDeveloper('abc')).toThrow(InvalidSnowflakeError);
    expect(() => {
      perms.grant('ping.cmd.use', 'abc');
    }).toThrow(InvalidSnowflakeError);
    expect(() => {
      perms.revoke('ping.cmd.use', 'abc');
    }).toThrow(InvalidSnowflakeError);
  });

  it('rejects SQL-injection-looking ids as invalid snowflakes', () => {
    expect(() => perms.addDeveloper(injection)).toThrow(InvalidSnowflakeError);
    expect(() => perms.removeDeveloper(injection)).toThrow(InvalidSnowflakeError);
    expect(() => {
      perms.grant('ping.cmd.use', injection);
    }).toThrow(InvalidSnowflakeError);
    expect(() => {
      perms.revoke('ping.cmd.use', injection);
    }).toThrow(InvalidSnowflakeError);
  });

  it('rejects malformed permission names on grant', () => {
    expect(() => {
      perms.grant('ping', role);
    }).toThrow(InvalidPermissionError);
    expect(() => {
      perms.grant('Ping.cmd.use', role);
    }).toThrow(InvalidPermissionError);
  });

  describe('forModule', () => {
    it('restricts a module to its declared permissions', () => {
      expect(() =>
        perms
          .forModule(manifest({ permissions: ['ping.cmd.use'] }))
          .check({ userId: mod, roleIds: [] }, 'ping.other.use'),
      ).toThrow(UndeclaredPermissionError);
    });

    it('rejects undeclared core.* permissions even for developers', () => {
      perms.addDeveloper(dev);
      expect(() =>
        perms
          .forModule(manifest({ permissions: ['ping.cmd.use'] }))
          .check({ userId: dev, roleIds: [] }, 'core.modules.manage'),
      ).toThrow(UndeclaredPermissionError);
    });

    it('checks declared permissions normally', () => {
      perms.grant('ping.cmd.use', role);
      const scoped = perms.forModule(manifest({ permissions: ['ping.cmd.use'] }));
      expect(scoped.check({ userId: mod, roleIds: [role] }, 'ping.cmd.use')).toBe(true);
      expect(scoped.check({ userId: mod, roleIds: [] }, 'ping.cmd.use')).toBe(false);
    });
  });
});
