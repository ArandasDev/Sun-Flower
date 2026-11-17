import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const MIGRATION_FILE = /^\d{4}-.+\.sql$/;

export class ModuleMigrationError extends Error {
  readonly moduleId: string;
  readonly version: string | undefined;

  /** The message never contains SQL text; `reason` must be a short description. */
  constructor(moduleId: string, version: string | undefined, reason: string, cause?: unknown) {
    super(
      `module ${moduleId} migration ${version === undefined ? '(set)' : version} failed: ${reason}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'ModuleMigrationError';
    this.moduleId = moduleId;
    this.version = version;
  }
}

const QUOTED = String.raw`"[^"]*"|\x60[^\x60]*\x60|\[[^\]]*\]`;
const NAME = String.raw`((?:${QUOTED}|[^\s(;"\x60\[])+)`;
const DECLARED_NAME = new RegExp(
  String.raw`\b(?:CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:UNIQUE\s+)?(?:VIRTUAL\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)(?:\s+IF\s+NOT\s+EXISTS)?` +
    String.raw`|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)(?:\s+IF\s+EXISTS)?|ALTER\s+TABLE)\s+` +
    NAME,
  'gi',
);
const RENAME_TARGET = new RegExp(
  String.raw`\bALTER\s+TABLE\s+(?:${QUOTED}|[^\s(;"\x60\[])+\s+RENAME\s+TO\s+` + NAME,
  'gi',
);
const INDEX_TARGET = new RegExp(
  String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:${QUOTED}|[^\s(;"\x60\[])+\s+ON\s+` +
    NAME,
  'gi',
);
const TRIGGER_TARGET = new RegExp(
  String.raw`\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:${QUOTED}|[^\s(;"\x60\[])+[\s\S]*?\bON\s+` +
    NAME,
  'gi',
);

/**
 * One left-to-right pass that understands quoted identifiers, string literals and
 * comments, so a marker inside one never changes how the rest is read.
 * Comments become a space and string contents are emptied; quoted identifiers are kept
 * (their names are checked). Returns `code` (identifiers kept, for name checks), `masked`
 * (identifier contents replaced, for keyword checks) and any unterminated construct.
 */
function tokenize(sql: string): { code: string; masked: string; unterminated: string | undefined } {
  const closers: Record<string, string> = { '"': '"', '`': '`', '[': ']', "'": "'" };
  let code = '';
  let masked = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    if (ch === '-' && sql.charAt(i + 1) === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      code += ' ';
      masked += ' ';
    } else if (ch === '/' && sql.charAt(i + 1) === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return { code, masked, unterminated: 'comment' };
      i = end + 2;
      code += ' ';
      masked += ' ';
    } else if (ch in closers) {
      const closer = closers[ch] ?? ch;
      let j = i + 1;
      for (;;) {
        const end = sql.indexOf(closer, j);
        if (end === -1) {
          return { code, masked, unterminated: ch === "'" ? 'string literal' : 'identifier' };
        }
        // Doubled quote is an escape inside "..." and '...' (not in [...] or `...`).
        if (closer !== ']' && closer !== '`' && sql.charAt(end + 1) === closer) {
          j = end + 2;
          continue;
        }
        j = end + 1;
        break;
      }
      if (ch === "'") {
        code += "''";
        masked += "''";
      } else {
        code += sql.slice(i, j);
        masked += `${ch}_${closer}`;
      }
      i = j;
    } else {
      code += ch;
      masked += ch;
      i += 1;
    }
  }
  return { code, masked, unterminated: undefined };
}

function unquote(name: string): string {
  return name.replace(/^["`[]/, '');
}

/**
 * Defense in depth over code review, not a SQL parser: every table, index, view and
 * trigger a module creates, drops, alters or renames to must be named `<moduleId>_...`.
 * Returns the list of problems; empty when valid.
 */
export function validateModuleMigration(moduleId: string, sql: string): string[] {
  const { code, masked, unterminated } = tokenize(sql);
  if (unterminated !== undefined) return [`unterminated ${unterminated}`];
  const problems: string[] = [];

  const forbidden = new Set<string>();
  for (const match of masked.matchAll(/\b(ATTACH|DETACH|PRAGMA|VACUUM)\b/gi)) {
    forbidden.add((match[1] ?? '').toUpperCase());
  }
  for (const keyword of forbidden) problems.push(`${keyword} is not allowed`);

  const prefix = `${moduleId}_`.toLowerCase();
  const names = new Set<string>();
  for (const pattern of [DECLARED_NAME, RENAME_TARGET, INDEX_TARGET, TRIGGER_TARGET]) {
    for (const match of code.matchAll(pattern)) names.add(match[1] ?? '');
  }
  for (const name of names) {
    const outsideQuotes = name.replace(new RegExp(QUOTED, 'g'), 'q');
    if (outsideQuotes.includes('.')) {
      problems.push(`name ${name} must not be schema-qualified`);
    } else if (!unquote(name).toLowerCase().startsWith(prefix)) {
      problems.push(`name ${name} must start with "${prefix}"`);
    }
  }
  return problems;
}

function listMigrations(moduleId: string, directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const files = fs
    .readdirSync(directory)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();
  files.forEach((file, index) => {
    const expected = String(index + 1).padStart(4, '0');
    if (!file.startsWith(`${expected}-`)) {
      throw new ModuleMigrationError(
        moduleId,
        undefined,
        `migration numbering must be sequential, expected ${expected}`,
      );
    }
  });
  return files;
}

/** Applies the module's pending SQL migrations in order; returns the applied versions. */
export function applyModuleMigrations(
  db: DatabaseSync,
  moduleId: string,
  directory: string,
): string[] {
  const files = listMigrations(moduleId, directory);
  const migrations = files.map((file) => {
    const version = file.slice(0, -'.sql'.length);
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    const problems = validateModuleMigration(moduleId, sql);
    if (problems.length > 0) {
      throw new ModuleMigrationError(moduleId, version, problems.join('; '));
    }
    return { version, sql };
  });

  const isRecorded = (version: string): boolean =>
    db
      .prepare('SELECT 1 FROM module_migrations WHERE module_id = ? AND version = ?')
      .get(moduleId, version) !== undefined;

  const applied: string[] = [];
  for (const { version, sql } of migrations) {
    if (isRecorded(version)) continue;
    let ran = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      if (!isRecorded(version)) {
        db.exec(sql);
        db.prepare(
          'INSERT INTO module_migrations (module_id, version, applied_at) VALUES (?, ?, ?)',
        ).run(moduleId, version, new Date().toISOString());
        ran = true;
      }
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw new ModuleMigrationError(moduleId, version, 'SQL execution failed', error);
    }
    if (ran) applied.push(version);
  }
  return applied;
}
