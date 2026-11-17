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

type Token =
  | { kind: 'word'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'string' }
  | { kind: 'punct'; value: string };

const WORD_CHAR = /[\w$\u0080-\uffff]/;
const IDENT_CLOSERS: Record<string, string> = { '"': '"', '`': '`', '[': ']' };

/**
 * One left-to-right pass that understands quoted identifiers, string literals and
 * comments, so a marker inside one never changes how the rest is read. Comments and
 * whitespace are dropped; string contents are discarded; quoted identifiers keep their
 * unquoted value. Returns an error description for an unterminated construct.
 */
function tokenize(sql: string): { tokens: Token[]; unterminated?: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '-' && sql.charAt(i + 1) === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
    } else if (ch === '/' && sql.charAt(i + 1) === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return { tokens, unterminated: 'comment' };
      i = end + 2;
    } else if (ch === "'" || ch in IDENT_CLOSERS) {
      const closer = IDENT_CLOSERS[ch] ?? ch;
      // A doubled quote is an escape inside '...', "..." and `...` (not in [...]).
      const escapes = closer !== ']';
      let value = '';
      let j = i + 1;
      for (;;) {
        const end = sql.indexOf(closer, j);
        if (end === -1)
          return { tokens, unterminated: ch === "'" ? 'string literal' : 'identifier' };
        value += sql.slice(j, end);
        if (escapes && sql.charAt(end + 1) === closer) {
          value += closer;
          j = end + 2;
          continue;
        }
        j = end + 1;
        break;
      }
      tokens.push(ch === "'" ? { kind: 'string' } : { kind: 'ident', value });
      i = j;
    } else if (WORD_CHAR.test(ch)) {
      let j = i + 1;
      while (j < sql.length && WORD_CHAR.test(sql.charAt(j))) j += 1;
      tokens.push({ kind: 'word', value: sql.slice(i, j) });
      i = j;
    } else {
      tokens.push({ kind: 'punct', value: ch });
      i += 1;
    }
  }
  return { tokens };
}

const OBJECT_KINDS = new Set(['TABLE', 'INDEX', 'VIEW', 'TRIGGER']);
const FORBIDDEN = new Set(['ATTACH', 'DETACH', 'PRAGMA', 'VACUUM']);

/**
 * Defense in depth over code review, not a SQL parser: every table, index, view and
 * trigger a module creates, drops, alters or renames to must be named `<moduleId>_...`.
 * Works on tokens, so whitespace and quoting style do not matter.
 * Returns the list of problems; empty when valid.
 */
export function validateModuleMigration(moduleId: string, sql: string): string[] {
  const { tokens, unterminated } = tokenize(sql);
  if (unterminated !== undefined) return [`unterminated ${unterminated}`];
  const problems: string[] = [];
  const prefix = `${moduleId}_`.toLowerCase();

  const word = (index: number): string => {
    const token = tokens[index];
    return token?.kind === 'word' ? token.value.toUpperCase() : '';
  };
  const skipWords = (index: number, ...sequence: string[]): number =>
    sequence.every((expected, offset) => word(index + offset) === expected)
      ? index + sequence.length
      : index;

  // Checks the name token at `index` and returns the index after it.
  const checkName = (index: number): number => {
    const token = tokens[index];
    if (token?.kind !== 'word' && token?.kind !== 'ident') {
      problems.push('expected an object name');
      return index;
    }
    const next = tokens[index + 1];
    if (next?.kind === 'punct' && next.value === '.') {
      problems.push(`name ${token.value} must not be schema-qualified`);
    } else if (!token.value.toLowerCase().startsWith(prefix)) {
      problems.push(`name ${token.value} must start with "${prefix}"`);
    }
    return index + 1;
  };

  // Finds the first ON before the end of the statement and checks the name after it.
  const checkOnTarget = (from: number): void => {
    for (let j = from; j < tokens.length; j += 1) {
      const token = tokens[j];
      if (token?.kind === 'punct' && token.value === ';') return;
      if (word(j) === 'ON') {
        checkName(j + 1);
        return;
      }
    }
  };

  const forbidden = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    const current = word(i);
    if (FORBIDDEN.has(current)) forbidden.add(current);

    if (current === 'CREATE') {
      let j = i + 1;
      while (['TEMP', 'TEMPORARY', 'UNIQUE', 'VIRTUAL'].includes(word(j))) j += 1;
      const kind = word(j);
      if (!OBJECT_KINDS.has(kind)) continue;
      j = skipWords(j + 1, 'IF', 'NOT', 'EXISTS');
      const after = checkName(j);
      if (kind === 'INDEX' || kind === 'TRIGGER') checkOnTarget(after);
    } else if (current === 'DROP' && OBJECT_KINDS.has(word(i + 1))) {
      checkName(skipWords(i + 2, 'IF', 'EXISTS'));
    } else if (current === 'ALTER' && word(i + 1) === 'TABLE') {
      checkName(i + 2);
    } else if (current === 'RENAME' && word(i + 1) === 'TO') {
      checkName(i + 2);
    }
  }
  for (const keyword of forbidden) problems.push(`${keyword} is not allowed`);
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
