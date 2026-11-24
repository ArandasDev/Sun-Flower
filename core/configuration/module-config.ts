import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';

export class InvalidModuleConfigError extends Error {
  constructor(moduleId: string, paths: readonly string[]) {
    super(`Invalid settings for module "${moduleId}" at: ${paths.join(', ')}`);
    this.name = 'InvalidModuleConfigError';
  }
}

export class ConfigVersionConflictError extends Error {
  constructor(moduleId: string, expected: number, actual: number) {
    super(
      `Settings of module "${moduleId}" changed: expected version ${expected}, current is ${actual}`,
    );
    this.name = 'ConfigVersionConflictError';
  }
}

export class ModuleConfigStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  isEnabled(moduleId: string, enabledByDefault: boolean): boolean {
    const row = this.#db
      .prepare('SELECT enabled FROM module_config WHERE module_id = ?')
      .get(moduleId) as { enabled: number | null } | undefined;
    if (row?.enabled === undefined || row.enabled === null) return enabledByDefault;
    return row.enabled === 1;
  }

  setEnabled(moduleId: string, enabled: boolean | null): void {
    const value = enabled === null ? null : enabled ? 1 : 0;
    this.#db
      .prepare(
        `INSERT INTO module_config (module_id, enabled, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(module_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      )
      .run(moduleId, value, new Date().toISOString());
  }

  /** The settings version of a module; 0 while nothing has been stored. */
  getVersion(moduleId: string): number {
    const row = this.#db
      .prepare('SELECT version FROM module_config WHERE module_id = ?')
      .get(moduleId) as { version: number } | undefined;
    return row?.version ?? 0;
  }

  setSettings(moduleId: string, settings: unknown): void {
    this.#db
      .prepare(
        `INSERT INTO module_config (module_id, settings, updated_at, version) VALUES (?, ?, ?, 1)
         ON CONFLICT(module_id) DO UPDATE SET settings = excluded.settings,
           updated_at = excluded.updated_at, version = module_config.version + 1`,
      )
      .run(moduleId, JSON.stringify(settings), new Date().toISOString());
  }

  loadSettings<T>(moduleId: string, schema?: z.ZodType<T>): T {
    if (schema === undefined) return {} as T;
    const row = this.#db
      .prepare('SELECT settings FROM module_config WHERE module_id = ?')
      .get(moduleId) as { settings: string } | undefined;
    const stored: unknown = row === undefined ? {} : JSON.parse(row.settings);
    return parseSettings(moduleId, schema, stored);
  }

  updateSettings<T>(
    moduleId: string,
    schema: z.ZodType<T> | undefined,
    partial: Record<string, unknown>,
    expectedVersion?: number,
  ): T {
    if (schema === undefined) throw new InvalidModuleConfigError(moduleId, ['(no schema)']);
    // The read, the version comparison and the write below run in one synchronous call on a
    // synchronous SQLite driver, so no concurrent writer can slip in between them.
    const row = this.#db
      .prepare('SELECT settings, version FROM module_config WHERE module_id = ?')
      .get(moduleId) as { settings: string; version: number } | undefined;
    if (expectedVersion !== undefined && expectedVersion !== (row?.version ?? 0)) {
      throw new ConfigVersionConflictError(moduleId, expectedVersion, row?.version ?? 0);
    }
    const parsed: unknown = row === undefined ? {} : JSON.parse(row.settings);
    const stored =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const merged = { ...stored, ...partial };
    const result = parseSettings(moduleId, schema, merged);
    this.setSettings(moduleId, merged);
    return result;
  }
}

function parseSettings<T>(moduleId: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const paths = result.error.issues.map((issue) =>
      issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    );
    throw new InvalidModuleConfigError(moduleId, [...new Set(paths)]);
  }
  return result.data;
}
