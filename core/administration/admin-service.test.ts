import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleEntry } from '../../shared/contracts/admin.ts';
import type { Actor } from '../../shared/contracts/commands.ts';
import {
  createRecordingLogger,
  type RecordingLogger,
} from '../../tests/helpers/recording-logger.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { RecentLogs } from '../infrastructure/recent-logs.ts';
import { SURFACE } from '../module-registry/module-admin.ts';
import type { ModuleRegistry, SetEnabledOutcome } from '../module-registry/registry.ts';
import { PermissionService } from '../permissions/permission-service.ts';
import { SessionStore } from '../sessions/session-store.ts';
import { createAdminService } from './admin-service.ts';

const A = '111111111111115678';
const B = '222222222222221234';
const ROLE = '333333333333339999';
const actor: Actor = { userId: A, roleIds: [], isOwner: false };

const entry: ModuleEntry = {
  id: 'moderation',
  name: 'Moderation',
  description: 'd',
  version: '1.0.0',
  state: 'RUNNING',
  enabled: true,
  canDisable: true,
  dependencies: [],
  dependents: [],
};

let db: DatabaseSync;
let logger: RecordingLogger;
let permissions: PermissionService;
let sessions: SessionStore;
let outcome: SetEnabledOutcome | Error;
let declared: Set<string>;
let recentLogs: RecentLogs | undefined;

function build(): ReturnType<typeof createAdminService> {
  const registry = {
    entries: () => [entry],
    declaredPermissions: () => declared,
    setEnabled: () =>
      outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome),
  } as unknown as ModuleRegistry;
  return createAdminService({
    permissions,
    sessions,
    registry: () => registry,
    ...(recentLogs === undefined ? {} : { recentLogs }),
    logger,
  });
}

const changes = (): unknown[] =>
  logger.entries.filter((e) => e.msg === 'admin change').map((e) => e.obj);

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  permissions = new PermissionService(db);
  sessions = new SessionStore(db);
  logger = createRecordingLogger();
  outcome = { kind: 'changed', entry };
  recentLogs = undefined;
  declared = new Set([
    'moderation.cases.read',
    'core.logs.read',
    'administration.grants.manage',
    'ping.cmd.use',
  ]);
});

describe('admin service surface', () => {
  it('has exactly the groups and methods of the module admin surface', () => {
    const service = build();
    const shape = (o: object): Record<string, string[]> =>
      Object.fromEntries(Object.entries(o).map(([g, m]) => [g, Object.keys(m as object).sort()]));
    expect(shape(service)).toEqual(shape(SURFACE));
    expect(Object.keys(service).sort()).toEqual(Object.keys(SURFACE).sort());
  });
});

describe('developers', () => {
  it('adds and removes with idempotence and audit', () => {
    permissions.addDeveloper(A);
    const s = build();
    expect(s.developers.add(actor, B)).toEqual({ ok: true, data: { added: true } });
    expect(s.developers.add(actor, B)).toEqual({ ok: true, data: { added: false } });
    expect(s.developers.remove(actor, B)).toEqual({ ok: true, data: { removed: true } });
    expect(s.developers.remove(actor, B)).toEqual({ ok: true, data: { removed: false } });
    expect(changes()).toHaveLength(2);
    expect(s.developers.list().map((d) => d.userId)).toEqual([A]);
  });

  it('refuses removing oneself', () => {
    permissions.addDeveloper(A);
    permissions.addDeveloper(B);
    expect(build().developers.remove(actor, A)).toEqual({
      ok: false,
      error: {
        code: 'conflict',
        message: 'Você não pode remover a si mesmo dos desenvolvedores.',
      },
    });
    expect(permissions.listDevelopers()).toHaveLength(2);
  });

  it('refuses removing the last developer', () => {
    permissions.addDeveloper(B);
    expect(build().developers.remove(actor, B)).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'Não é possível remover o último desenvolvedor.' },
    });
    expect(permissions.isDeveloper(B)).toBe(true);
  });

  it('rejects non-canonical IDs', () => {
    const s = build();
    for (const bad of ['0123456789012345678', '1234', 'abc', '99999999999999999999']) {
      expect(s.developers.add(actor, bad)).toEqual({
        ok: false,
        error: { code: 'invalid', message: 'Entrada inválida: userId.' },
      });
      expect(s.developers.remove(actor, bad).ok).toBe(false);
      expect(s.sessions.revokeAll(actor, bad).ok).toBe(false);
    }
    expect(permissions.listDevelopers()).toEqual([]);
  });
});

describe('grants', () => {
  it.each([
    ['administration.grants.manage', 'Esta permissão não pode ser associada a cargos.'],
    ['core.logs.read', 'Esta permissão não pode ser associada a cargos.'],
    ['other.cmd.use', 'Nenhum módulo declara esta permissão.'],
    ['x', 'Permissão inválida.'],
  ])('rejects %s', (permission, message) => {
    expect(build().grants.grant(actor, permission, ROLE)).toEqual({
      ok: false,
      error: { code: 'invalid', message },
    });
    expect(changes()).toEqual([]);
  });

  it('grants once and revokes once', () => {
    const s = build();
    const grant = (): unknown => s.grants.grant(actor, 'moderation.cases.read', ROLE);
    const revoke = (): unknown => s.grants.revoke(actor, 'moderation.cases.read', ROLE);
    expect(grant()).toEqual({ ok: true, data: { granted: true } });
    expect(grant()).toEqual({ ok: true, data: { granted: false } });
    expect(s.grants.list().grants).toHaveLength(1);
    expect(revoke()).toEqual({ ok: true, data: { revoked: true } });
    expect(revoke()).toEqual({ ok: true, data: { revoked: false } });
    expect(changes()).toHaveLength(2);
  });

  it('lists grantable permissions without core and administration', () => {
    expect(build().grants.list().grantable).toEqual(['moderation.cases.read', 'ping.cmd.use']);
  });
});

describe('modules', () => {
  const cases: [SetEnabledOutcome, unknown][] = [
    [{ kind: 'unknown' }, { code: 'not_found', message: 'Módulo desconhecido.' }],
    [{ kind: 'protected' }, { code: 'conflict', message: 'Este módulo não pode ser desligado.' }],
    [
      { kind: 'dependents', ids: ['a', 'b'] },
      { code: 'conflict', message: 'Outros módulos dependem deste: a, b.' },
    ],
    [
      { kind: 'dependencies', ids: ['a'] },
      { code: 'conflict', message: 'Ligue antes: a.' },
    ],
    [
      { kind: 'failed', entry },
      { code: 'failed', message: 'O módulo não conseguiu iniciar.' },
    ],
    [{ kind: 'stopping' }, { code: 'unavailable', message: 'O bot está encerrando.' }],
  ];

  it.each(cases)('maps %j', async (given, error) => {
    outcome = given;
    await expect(build().modules.setEnabled(actor, 'moderation', true)).resolves.toEqual({
      ok: false,
      error,
    });
    expect(changes()).toEqual([]);
  });

  it('maps changed and unchanged, logging only changes', async () => {
    const s = build();
    await expect(s.modules.setEnabled(actor, 'moderation', false)).resolves.toEqual({
      ok: true,
      data: { changed: true, module: entry },
    });
    outcome = { kind: 'unchanged', entry };
    await expect(s.modules.setEnabled(actor, 'moderation', false)).resolves.toEqual({
      ok: true,
      data: { changed: false, module: entry },
    });
    expect(changes()).toEqual([
      { action: 'modules.disable', actor: '…5678', moduleId: 'moderation' },
    ]);
  });

  it('keeps the FAILED entry of a disable whose stop failed', async () => {
    const failed = { ...entry, state: 'FAILED' as const };
    outcome = { kind: 'changed', entry: failed };
    await expect(build().modules.setEnabled(actor, 'moderation', false)).resolves.toEqual({
      ok: true,
      data: { changed: true, module: failed },
    });
  });

  it('turns a rejection into Erro interno, logging only the error name', async () => {
    outcome = new TypeError('secret detail');
    await expect(build().modules.setEnabled(actor, 'moderation', true)).resolves.toEqual({
      ok: false,
      error: { code: 'failed', message: 'Erro interno.' },
    });
    expect(JSON.stringify(logger.entries)).not.toContain('secret');
    expect(JSON.stringify(logger.entries)).toContain('TypeError');
  });
});

describe('sessions and logs', () => {
  it('lists with a ref and no hash, and revokes by ref', () => {
    const { record } = sessions.create(B);
    const s = build();
    const [item] = s.sessions.list();
    expect(item?.ref).toBe(sessions.refOf(record.idHash));
    expect(JSON.stringify(item)).not.toContain(record.idHash);
    expect(item?.createdAt).toBe(new Date(record.createdAt).toISOString());
    expect(s.sessions.revoke(actor, 'nope')).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Sessão não encontrada.' },
    });
    expect(s.sessions.revoke(actor, item!.ref)).toEqual({ ok: true, data: { revoked: true } });
    expect(s.sessions.list()).toEqual([]);
  });

  it('revokes all sessions of a user, logging only when any', () => {
    sessions.create(B);
    sessions.create(B);
    const s = build();
    expect(s.sessions.revokeAll(actor, B)).toEqual({ ok: true, data: { revoked: 2 } });
    expect(s.sessions.revokeAll(actor, B)).toEqual({ ok: true, data: { revoked: 0 } });
    expect(changes()).toEqual([
      { action: 'sessions.revoke-all', actor: '…5678', target: '…1234', count: 2 },
    ]);
  });

  it('returns no logs without a memory and delegates with one', () => {
    expect(build().logs.recent({ limit: 5, minLevel: 'info' })).toEqual([]);
    recentLogs = new RecentLogs();
    const spy = vi.spyOn(recentLogs, 'recent');
    build().logs.recent({ limit: 5, minLevel: 'warn' });
    expect(spy).toHaveBeenCalledWith({ limit: 5, minLevel: 'warn' });
  });
});

describe('audit entries', () => {
  it('records one exact entry per audited action', async () => {
    permissions.addDeveloper(A);
    sessions.create(B);
    const s = build();
    const [session] = s.sessions.list();
    s.developers.add(actor, B);
    s.developers.remove(actor, B);
    s.grants.grant(actor, 'ping.cmd.use', ROLE);
    s.grants.revoke(actor, 'ping.cmd.use', ROLE);
    await s.modules.setEnabled(actor, 'moderation', true);
    s.sessions.revoke(actor, session!.ref);
    sessions.create(B);
    s.sessions.revokeAll(actor, B);
    expect(changes()).toEqual([
      { action: 'developers.add', actor: '…5678', target: '…1234' },
      { action: 'developers.remove', actor: '…5678', target: '…1234' },
      { action: 'grants.grant', actor: '…5678', target: '…9999', permission: 'ping.cmd.use' },
      { action: 'grants.revoke', actor: '…5678', target: '…9999', permission: 'ping.cmd.use' },
      { action: 'modules.enable', actor: '…5678', moduleId: 'moderation' },
      { action: 'sessions.revoke', actor: '…5678' },
      { action: 'sessions.revoke-all', actor: '…5678', target: '…1234', count: 1 },
    ]);
  });

  it('rejects a non-canonical roleId on revoke', () => {
    expect(build().grants.revoke(actor, 'ping.cmd.use', '0123')).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'Entrada inválida: roleId.' },
    });
  });
});

describe('audit log', () => {
  it('masks IDs and never logs a full one', () => {
    permissions.addDeveloper(B);
    const s = build();
    s.developers.add(actor, '444444444444446666');
    s.grants.grant(actor, 'ping.cmd.use', ROLE);
    expect(changes()[0]).toEqual({ action: 'developers.add', actor: '…5678', target: '…6666' });
    expect(JSON.stringify(logger.entries)).not.toMatch(/\d{17}/);
  });
});
