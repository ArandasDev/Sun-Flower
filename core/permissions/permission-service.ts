import type { DatabaseSync } from 'node:sqlite';
import type { Actor } from '../../shared/contracts/commands.ts';
import type { ModuleContext, ModuleManifest } from '../../shared/contracts/module.ts';

const SNOWFLAKE = /^\d{17,20}$/;
const PERMISSION = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const CORE_PREFIX = 'core.';
const PROTECTED_PREFIX = 'administration.';

export type AccessLevel = 'developer' | 'owner' | 'staff' | 'member';

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

export class ProtectedPermissionGrantError extends Error {
  constructor(permission: string) {
    super(`Permission "${permission}" is protected and cannot be granted to roles`);
    this.name = 'ProtectedPermissionGrantError';
  }
}

export class UndeclaredPermissionError extends Error {
  /** `moduleId` is `null` when no module is involved (granting to a role). */
  constructor(moduleId: string | null, permission: string) {
    super(
      moduleId === null
        ? `No module declares permission "${permission}"`
        : `Module "${moduleId}" is not allowed to check undeclared permission "${permission}"`,
    );
    this.name = 'UndeclaredPermissionError';
  }
}

export interface DeveloperRecord {
  readonly userId: string;
  readonly addedAt: string;
}

export interface GrantRecord {
  readonly permission: string;
  readonly roleId: string;
  readonly grantedAt: string;
}

/** Whether `permission` has the `<module>.<resource>.<action>` format. */
export function isValidPermission(permission: string): boolean {
  return PERMISSION.test(permission);
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

  grant(permission: string, roleId: string, declared: ReadonlySet<string>): void {
    assertSnowflake(roleId);
    if (!PERMISSION.test(permission)) throw new InvalidPermissionError();
    if (permission.startsWith(CORE_PREFIX)) throw new CorePermissionGrantError(permission);
    if (permission.startsWith(PROTECTED_PREFIX))
      throw new ProtectedPermissionGrantError(permission);
    if (!declared.has(permission)) throw new UndeclaredPermissionError(null, permission);
    this.#db
      .prepare(
        'INSERT OR IGNORE INTO permission_grants (permission, role_id, granted_at) VALUES (?, ?, ?)',
      )
      .run(permission, roleId, new Date().toISOString());
  }

  /** Whether a grant was actually removed. */
  revoke(permission: string, roleId: string): boolean {
    assertSnowflake(roleId);
    const result = this.#db
      .prepare('DELETE FROM permission_grants WHERE permission = ? AND role_id = ?')
      .run(permission, roleId);
    return result.changes > 0;
  }

  check(actor: Actor, permission: string): boolean {
    if (!PERMISSION.test(permission)) return false;
    if (this.isDeveloper(actor.userId)) return true;
    if (permission.startsWith(CORE_PREFIX)) return false;
    if (permission.startsWith(PROTECTED_PREFIX)) return actor.isOwner;
    if (actor.isOwner) return true;
    const statement = this.#db.prepare(
      'SELECT 1 AS found FROM permission_grants WHERE permission = ? AND role_id = ?',
    );
    return actor.roleIds.some((roleId) => statement.get(permission, roleId) !== undefined);
  }

  /** The highest access level of the actor: developer, owner, staff or member. */
  level(actor: Actor): AccessLevel {
    if (this.isDeveloper(actor.userId)) return 'developer';
    if (actor.isOwner) return 'owner';
    return this.hasModuleGrant(actor.roleIds) ? 'staff' : 'member';
  }

  /** Declared permissions the actor passes `check` for, plus declared `core.*` for developers. */
  effective(actor: Actor, declared: ReadonlySet<string>): string[] {
    return [...declared].filter((permission) => this.check(actor, permission)).sort();
  }

  /** Whether any role holds a grant row for a module permission (not `core.*` or `administration.*`). */
  private hasModuleGrant(roleIds: readonly string[]): boolean {
    if (roleIds.length === 0) return false;
    const statement = this.#db.prepare(
      'SELECT 1 AS found FROM permission_grants WHERE role_id = ? AND permission NOT LIKE ? AND permission NOT LIKE ? LIMIT 1',
    );
    return roleIds.some(
      (roleId) => statement.get(roleId, `${CORE_PREFIX}%`, `${PROTECTED_PREFIX}%`) !== undefined,
    );
  }

  hasAnyGrant(roleIds: readonly string[], prefix: string): boolean {
    if (roleIds.length === 0) return false;
    const pattern = `${prefix.replace(/[\\%_]/g, '\\$&')}%`;
    const statement = this.#db.prepare(
      'SELECT 1 AS found FROM permission_grants WHERE role_id = ? AND permission LIKE ? ESCAPE ? LIMIT 1',
    );
    return roleIds.some((roleId) => statement.get(roleId, pattern, '\\') !== undefined);
  }

  listGrants(): GrantRecord[] {
    const rows = this.#db
      .prepare(
        'SELECT permission, role_id, granted_at FROM permission_grants ORDER BY permission, role_id',
      )
      .all() as { permission: string; role_id: string; granted_at: string }[];
    return rows.map((row) => ({
      permission: row.permission,
      roleId: row.role_id,
      grantedAt: row.granted_at,
    }));
  }

  forModule(manifest: ModuleManifest): ModuleContext['permissions'] {
    const declared = new Set(manifest.permissions);
    return {
      check: (actor, permission) => {
        if (!declared.has(permission)) throw new UndeclaredPermissionError(manifest.id, permission);
        return this.check(actor, permission);
      },
      isDeveloper: (userId) => this.isDeveloper(userId),
      hasAnyGrant: (roleIds, prefix) => {
        if (!prefix.startsWith(`${manifest.id}.`)) {
          throw new UndeclaredPermissionError(manifest.id, prefix);
        }
        return this.hasAnyGrant(roleIds, prefix);
      },
    };
  }
}
