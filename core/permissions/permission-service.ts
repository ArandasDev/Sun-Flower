import type { DatabaseSync } from 'node:sqlite';
import type { Actor } from '../../shared/contracts/commands.ts';
import type { ModuleContext, ModuleManifest } from '../../shared/contracts/module.ts';

const SNOWFLAKE = /^\d{17,20}$/;
const PERMISSION = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const CORE_PREFIX = 'core.';

export class InvalidSnowflakeError extends Error {
  constructor() {
    super('Invalid Discord ID: expected 17 to 20 digits');
    this.name = 'InvalidSnowflakeError';
  }
}

export class InvalidPermissionError extends Error {
  constructor() {
    super('Invalid permission: expected the format module.resource.action');
    this.name = 'InvalidPermissionError';
  }
}

export class CorePermissionGrantError extends Error {
  constructor(permission: string) {
    super(`Permission "${permission}" belongs to the Core and cannot be granted to roles`);
    this.name = 'CorePermissionGrantError';
  }
}

export class UndeclaredPermissionError extends Error {
  constructor(moduleId: string, permission: string) {
    super(`Module "${moduleId}" is not allowed to check undeclared permission "${permission}"`);
    this.name = 'UndeclaredPermissionError';
  }
}

export interface DeveloperRecord {
  readonly userId: string;
  readonly addedAt: string;
}

function assertSnowflake(id: string): void {
  if (!SNOWFLAKE.test(id)) throw new InvalidSnowflakeError();
}

export class PermissionService {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  isDeveloper(userId: string): boolean {
    const row = this.#db.prepare('SELECT 1 AS found FROM developers WHERE user_id = ?').get(userId);
    return row !== undefined;
  }

  addDeveloper(userId: string): boolean {
    assertSnowflake(userId);
    const result = this.#db
      .prepare('INSERT OR IGNORE INTO developers (user_id, added_at) VALUES (?, ?)')
      .run(userId, new Date().toISOString());
    return result.changes > 0;
  }

  removeDeveloper(userId: string): boolean {
    assertSnowflake(userId);
    const result = this.#db.prepare('DELETE FROM developers WHERE user_id = ?').run(userId);
    return result.changes > 0;
  }

  listDevelopers(): DeveloperRecord[] {
    const rows = this.#db
      .prepare('SELECT user_id, added_at FROM developers ORDER BY added_at, user_id')
      .all() as { user_id: string; added_at: string }[];
    return rows.map((row) => ({ userId: row.user_id, addedAt: row.added_at }));
  }

  grant(permission: string, roleId: string): void {
    assertSnowflake(roleId);
    if (!PERMISSION.test(permission)) throw new InvalidPermissionError();
    if (permission.startsWith(CORE_PREFIX)) throw new CorePermissionGrantError(permission);
    this.#db
      .prepare(
        'INSERT OR IGNORE INTO permission_grants (permission, role_id, granted_at) VALUES (?, ?, ?)',
      )
      .run(permission, roleId, new Date().toISOString());
  }

  revoke(permission: string, roleId: string): void {
    assertSnowflake(roleId);
    this.#db
      .prepare('DELETE FROM permission_grants WHERE permission = ? AND role_id = ?')
      .run(permission, roleId);
  }

  check(actor: Actor, permission: string): boolean {
    if (permission.startsWith(CORE_PREFIX)) return this.isDeveloper(actor.userId);
    const statement = this.#db.prepare(
      'SELECT 1 AS found FROM permission_grants WHERE permission = ? AND role_id = ?',
    );
    return actor.roleIds.some((roleId) => statement.get(permission, roleId) !== undefined);
  }

  forModule(manifest: ModuleManifest): ModuleContext['permissions'] {
    const declared = new Set(manifest.permissions);
    return {
      check: (actor, permission) => {
        if (!declared.has(permission)) throw new UndeclaredPermissionError(manifest.id, permission);
        return this.check(actor, permission);
      },
    };
  }
}
