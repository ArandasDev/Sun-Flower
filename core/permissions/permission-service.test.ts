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
  ProtectedPermissionGrantError,
  UndeclaredPermissionError,
} from './permission-service.ts';

const dev = '000000000000000000';
const mod = '111111111111111111';
const role = '222222222222222222';
const declared: ReadonlySet<string> = new Set([
  'ping.cmd.use',
  'ping.b.use',
  'ping.a.use',
  'moderation.warn.use',
  'moderation.actions.ban',
]);
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

describe('PermissionService access levels', () => {
  const member = { userId: mod, roleIds: [role], isOwner: false };

  it('gives developers every permission without roles', () => {
    perms.addDeveloper(dev);
    const actor = { userId: dev, roleIds: [], isOwner: false };
    expect(perms.check(actor, 'moderation.actions.ban')).toBe(true);
    expect(perms.check(actor, 'core.modules.manage')).toBe(true);
  });

  it('gives the owner module permissions but not core.*', () => {
    const owner = { userId: mod, roleIds: [], isOwner: true };
    expect(perms.check(owner, 'moderation.actions.ban')).toBe(true);
    expect(perms.check(owner, 'core.modules.manage')).toBe(false);
    expect(perms.check({ ...owner, isOwner: false }, 'moderation.actions.ban')).toBe(false);
  });

  it('gives staff only what their roles hold', () => {
    perms.grant('moderation.actions.ban', role, declared);
    expect(perms.check(member, 'moderation.actions.ban')).toBe(true);
    expect(perms.check({ ...member, roleIds: [] }, 'moderation.actions.ban')).toBe(false);
  });

  it('reports the highest level', () => {
    perms.addDeveloper(dev);
    perms.grant('moderation.actions.ban', role, declared);
    expect(perms.level({ userId: dev, roleIds: [role], isOwner: true })).toBe('developer');
    expect(perms.level({ userId: mod, roleIds: [], isOwner: true })).toBe('owner');
    expect(perms.level(member)).toBe('staff');
    expect(perms.level({ ...member, roleIds: [] })).toBe('member');
  });

  it('lists effective permissions alphabetically', () => {
    perms.addDeveloper(dev);
    perms.grant('ping.cmd.use', role, declared);
    const all = new Set(['ping.cmd.use', 'core.modules.manage', 'moderation.warn.use']);
    expect(perms.effective({ userId: mod, roleIds: [], isOwner: false }, all)).toEqual([]);
    expect(perms.effective(member, all)).toEqual(['ping.cmd.use']);
    expect(perms.effective({ userId: dev, roleIds: [], isOwner: false }, all)).toEqual([
      'core.modules.manage',
      'moderation.warn.use',
      'ping.cmd.use',
    ]);
    expect(perms.effective({ userId: mod, roleIds: [], isOwner: true }, all)).toEqual([
      'moderation.warn.use',
      'ping.cmd.use',
    ]);
  });

  it('refuses protected and undeclared grants', () => {
    expect(() => {
      perms.grant('administration.grants.manage', role, new Set(['administration.grants.manage']));
    }).toThrow(ProtectedPermissionGrantError);
    expect(() => {
      perms.grant('moderation.unknown.use', role, declared);
    }).toThrow(UndeclaredPermissionError);
    expect(() => {
      perms.grant('core.x.y', role, declared);
    }).toThrow(CorePermissionGrantError);
  });
});

describe('PermissionService', () => {
  it('denies by default', () => {
    expect(perms.check({ userId: mod, roleIds: [role], isOwner: false }, 'ping.cmd.use')).toBe(
      false,
    );
  });

  it('grants core.* only to developers', () => {
    perms.addDeveloper(dev);
    expect(perms.check({ userId: dev, roleIds: [], isOwner: false }, 'core.modules.manage')).toBe(
      true,
    );
    expect(
      perms.check({ userId: mod, roleIds: [role], isOwner: false }, 'core.modules.manage'),
    ).toBe(false);
  });

  it('refuses to grant core.* to a role', () => {
    expect(() => {
      perms.grant('core.modules.manage', role, declared);
    }).toThrow(CorePermissionGrantError);
  });

  it('ignores core.* rows that somehow exist in permission_grants', () => {
    db.prepare('INSERT INTO permission_grants VALUES (?, ?, ?)').run(
      'core.modules.manage',
      role,
      new Date().toISOString(),
    );
    expect(
      perms.check({ userId: mod, roleIds: [role], isOwner: false }, 'core.modules.manage'),
    ).toBe(false);
  });

  it('grants module permissions through roles, and to developers without roles', () => {
    perms.addDeveloper(dev);
    perms.grant('ping.cmd.use', role, declared);
    expect(perms.check({ userId: mod, roleIds: [role], isOwner: false }, 'ping.cmd.use')).toBe(
      true,
    );
    expect(perms.check({ userId: dev, roleIds: [], isOwner: false }, 'ping.cmd.use')).toBe(true);
  });

  it('revokes a grant', () => {
    perms.grant('ping.cmd.use', role, declared);
    perms.revoke('ping.cmd.use', role);
    expect(perms.check({ userId: mod, roleIds: [role], isOwner: false }, 'ping.cmd.use')).toBe(
      false,
    );
  });

  it('grant is idempotent', () => {
    perms.grant('ping.cmd.use', role, declared);
    expect(() => {
      perms.grant('ping.cmd.use', role, declared);
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
      perms.grant('ping.cmd.use', 'abc', declared);
    }).toThrow(InvalidSnowflakeError);
    expect(() => {
      perms.revoke('ping.cmd.use', 'abc');
    }).toThrow(InvalidSnowflakeError);
  });

  it('rejects SQL-injection-looking ids as invalid snowflakes', () => {
    expect(() => perms.addDeveloper(injection)).toThrow(InvalidSnowflakeError);
    expect(() => perms.removeDeveloper(injection)).toThrow(InvalidSnowflakeError);
    expect(() => {
      perms.grant('ping.cmd.use', injection, declared);
    }).toThrow(InvalidSnowflakeError);
    expect(() => {
      perms.revoke('ping.cmd.use', injection);
    }).toThrow(InvalidSnowflakeError);
  });

  it('rejects malformed permission names on grant', () => {
    expect(() => {
      perms.grant('ping', role, declared);
    }).toThrow(InvalidPermissionError);
    expect(() => {
      perms.grant('Ping.cmd.use', role, declared);
    }).toThrow(InvalidPermissionError);
  });

  describe('forModule', () => {
    it('restricts a module to its declared permissions', () => {
      expect(() =>
        perms
          .forModule(manifest({ permissions: ['ping.cmd.use'] }))
          .check({ userId: mod, roleIds: [], isOwner: false }, 'ping.other.use'),
      ).toThrow(UndeclaredPermissionError);
    });

    it('rejects undeclared core.* permissions even for developers', () => {
      perms.addDeveloper(dev);
      expect(() =>
        perms
          .forModule(manifest({ permissions: ['ping.cmd.use'] }))
          .check({ userId: dev, roleIds: [], isOwner: false }, 'core.modules.manage'),
      ).toThrow(UndeclaredPermissionError);
    });

    it('checks declared permissions normally', () => {
      perms.grant('ping.cmd.use', role, declared);
      const scoped = perms.forModule(manifest({ permissions: ['ping.cmd.use'] }));
      expect(scoped.check({ userId: mod, roleIds: [role], isOwner: false }, 'ping.cmd.use')).toBe(
        true,
      );
      expect(scoped.check({ userId: mod, roleIds: [], isOwner: false }, 'ping.cmd.use')).toBe(
        false,
      );
    });
  });

  describe('hasAnyGrant and listGrants', () => {
    it('detects grants by prefix on any role', () => {
      perms.grant('moderation.warn.use', role, declared);
      expect(perms.hasAnyGrant([mod, role], 'moderation.')).toBe(true);
      expect(perms.hasAnyGrant([role], 'ping.')).toBe(false);
      expect(perms.hasAnyGrant([], 'moderation.')).toBe(false);
    });

    it('does not treat % or _ in the prefix as wildcards', () => {
      perms.grant('moderation.warn.use', role, declared);
      expect(perms.hasAnyGrant([role], '%')).toBe(false);
      expect(perms.hasAnyGrant([role], 'moderation%')).toBe(false);
      expect(perms.hasAnyGrant([role], 'moderation_')).toBe(false);
    });

    it('scopes hasAnyGrant to the module prefix', () => {
      perms.grant('moderation.warn.use', role, declared);
      const scoped = perms.forModule(manifest({ id: 'moderation' }));
      expect(scoped.hasAnyGrant([role], 'moderation.')).toBe(true);
      expect(() => scoped.hasAnyGrant([role], 'ping.')).toThrow(UndeclaredPermissionError);
    });

    it('lists grants ordered by permission and role', () => {
      perms.grant('ping.b.use', role, declared);
      perms.grant('ping.a.use', role, declared);
      perms.grant('ping.a.use', mod, declared);
      expect(perms.listGrants().map((g) => [g.permission, g.roleId])).toEqual([
        ['ping.a.use', mod],
        ['ping.a.use', role],
        ['ping.b.use', role],
      ]);
      expect(typeof perms.listGrants()[0]?.grantedAt).toBe('string');
    });
  });
});
