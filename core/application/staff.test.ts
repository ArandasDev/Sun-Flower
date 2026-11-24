import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRecordingLogger,
  type RecordingLogger,
} from '../../tests/helpers/recording-logger.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { PermissionService } from '../permissions/permission-service.ts';
import { runStaff, STAFF_USAGE } from './staff.ts';

const USER = '000000000000000000';
const OTHER = '111111111111111111';
const ROLE = '222222222222222222';
const PERMISSION = 'moderation.rules.read';

let db: DatabaseSync;
let logger: RecordingLogger;
let out: string[];
let declared: Set<string>;
let deps: Parameters<typeof runStaff>[1];

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  logger = createRecordingLogger();
  out = [];
  declared = new Set([PERMISSION]);
  deps = {
    permissions: new PermissionService(db),
    logger,
    out: (line) => out.push(line),
    declaredPermissions: () => declared,
  };
});

afterEach(() => {
  db.close();
});

describe('runStaff', () => {
  it('adds, lists and removes developers', () => {
    expect(runStaff(['add', USER], deps)).toBe(0);
    expect(out).toEqual(['Desenvolvedor adicionado.']);
    runStaff(['list'], deps);
    expect(out).toContainEqual(expect.stringContaining(USER));
    expect(runStaff(['remove', USER], deps)).toBe(0);
    expect(out.at(-1)).toBe('Desenvolvedor removido.');
    out.length = 0;
    expect(runStaff(['list'], deps)).toBe(0);
    expect(out).toEqual(['Nenhum desenvolvedor.']);
  });

  it('lists one line per developer with the date it was added', () => {
    runStaff(['add', USER], deps);
    runStaff(['add', OTHER], deps);
    out.length = 0;
    expect(runStaff(['list'], deps)).toBe(0);
    expect(out).toHaveLength(2);
    for (const line of out) expect(line).toMatch(/^\d{17,20} \d{4}-\d{2}-\d{2}T\S+$/);
    expect(out.map((line) => line.split(' ')[0]).sort()).toEqual([USER, OTHER]);
  });

  it('reports adding an existing developer and removing a missing one, both with code 0', () => {
    runStaff(['add', USER], deps);
    expect(runStaff(['add', USER], deps)).toBe(0);
    expect(out.at(-1)).toBe('Já era desenvolvedor.');
    expect(runStaff(['remove', OTHER], deps)).toBe(0);
    expect(out.at(-1)).toBe('Não era desenvolvedor.');
  });

  it('rejects invalid ids and usage', () => {
    expect(runStaff(['add', 'abc'], deps)).toBe(2);
    expect(out.at(-1)).toBe('ID de usuário inválido.');
    expect(runStaff(['remove', '123'], deps)).toBe(2);
    expect(out.at(-1)).toBe('ID de usuário inválido.');
    expect(runStaff([], deps)).toBe(2);
    expect(out.at(-1)).toBe(STAFF_USAGE);
  });

  it.each([
    [['add']],
    [['remove']],
    [['grant', USER]],
    [['grant', PERMISSION]],
    [['revoke', PERMISSION]],
    [['grants', ROLE]],
    [['list', USER]],
    [['add', USER, OTHER]],
  ])('prints the usage and returns 2 for %j', (args) => {
    expect(runStaff(args, deps)).toBe(2);
    expect(out).toEqual([STAFF_USAGE]);
    expect(deps.permissions.listDevelopers()).toEqual([]);
  });

  it('uses the exact usage string', () => {
    expect(STAFF_USAGE).toBe(
      'Uso: npm run staff -- add|remove|list [userId] | grant|revoke <permissão> <roleId> | grants',
    );
  });

  it('logs each change with its action and never the user id', () => {
    runStaff(['add', USER], deps);
    runStaff(['add', USER], deps);
    runStaff(['remove', USER], deps);
    runStaff(['remove', USER], deps);
    runStaff(['add', 'abc'], deps);
    const infos = logger.entries.filter((call) => call.level === 'info');
    expect(infos.map((call) => (call.obj as { action?: string }).action)).toEqual([
      'add',
      'add',
      'remove',
      'remove',
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain(USER);
    expect(JSON.stringify(logger.entries)).not.toContain('abc');
  });
});

describe('runStaff role grants', () => {
  it('grants, lists and revokes a permission for a role', () => {
    expect(runStaff(['grant', PERMISSION, ROLE], deps)).toBe(0);
    expect(out).toEqual(['Permissão associada ao cargo.']);
    out.length = 0;
    expect(runStaff(['grants'], deps)).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]?.startsWith(`${PERMISSION} ${ROLE} `)).toBe(true);
    expect(out[0]?.split(' ')[2]).toMatch(/^\d{4}-\d{2}-\d{2}T\S+$/);
    out.length = 0;
    expect(runStaff(['revoke', PERMISSION, ROLE], deps)).toBe(0);
    expect(out).toEqual(['Permissão removida do cargo.']);
    out.length = 0;
    runStaff(['grants'], deps);
    expect(out).toEqual(['Nenhuma associação.']);
  });

  it('reports revoking an association that does not exist', () => {
    expect(runStaff(['revoke', PERMISSION, ROLE], deps)).toBe(0);
    expect(out).toEqual(['Nenhuma associação.']);
  });

  it('refuses a permission no module declares with code 1', () => {
    declared = new Set();
    expect(runStaff(['grant', PERMISSION, ROLE], deps)).toBe(1);
    expect(out).toEqual([`Nenhum módulo declara a permissão ${PERMISSION}.`]);
    expect(deps.permissions.listGrants()).toEqual([]);
  });

  it('refuses administration.* permissions with code 2', () => {
    declared = new Set(['administration.grants.manage']);
    expect(runStaff(['grant', 'administration.grants.manage', ROLE], deps)).toBe(2);
    expect(out.at(-1)).toBe('Permissões administration.* não podem ser associadas a cargos.');
    expect(deps.permissions.listGrants()).toEqual([]);
  });

  it('rejects invalid role ids, invalid permissions and core permissions with code 2', () => {
    expect(runStaff(['grant', PERMISSION, 'abc'], deps)).toBe(2);
    expect(out.at(-1)).toBe('ID de cargo inválido.');
    expect(runStaff(['revoke', PERMISSION, 'abc'], deps)).toBe(2);
    expect(out.at(-1)).toBe('ID de cargo inválido.');
    expect(runStaff(['grant', 'Bad Permission', ROLE], deps)).toBe(2);
    expect(out.at(-1)).toBe('Permissão inválida.');
    expect(runStaff(['revoke', 'Bad Permission', ROLE], deps)).toBe(2);
    expect(out.at(-1)).toBe('Permissão inválida.');
    expect(runStaff(['grant', 'core.bot.manage', ROLE], deps)).toBe(2);
    expect(out.at(-1)).toBe('Permissões core.* não podem ser associadas a cargos.');
    expect(deps.permissions.listGrants()).toEqual([]);
  });

  it('logs grants with action and permission but never the role id', () => {
    runStaff(['grant', PERMISSION, ROLE], deps);
    runStaff(['revoke', PERMISSION, ROLE], deps);
    const infos = logger.entries.filter((call) => call.level === 'info');
    expect(infos.map((call) => call.obj)).toEqual([
      { action: 'grant', permission: PERMISSION },
      { action: 'revoke', permission: PERMISSION },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain(ROLE);
  });
});
