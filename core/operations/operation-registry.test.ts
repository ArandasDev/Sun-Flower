import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { z } from 'zod';
import type { Actor } from '../../shared/contracts/commands.ts';
import type { ModuleManifest } from '../../shared/contracts/module.ts';
import { fail, ok, type OperationDefinition } from '../../shared/contracts/operations.ts';
import {
  createRecordingLogger,
  type RecordingLogger,
} from '../../tests/helpers/recording-logger.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { PermissionService } from '../permissions/permission-service.ts';
import { InvalidOperationError, OperationRegistry } from './operation-registry.ts';

const ROLE = '222222222222222222';
const MEMBER: Actor = { userId: '111111111111111111', roleIds: [], isOwner: false };
const STAFF: Actor = { userId: '333333333333333333', roleIds: [ROLE], isOwner: false };
const OWNER: Actor = { userId: '444444444444444444', roleIds: [], isOwner: true };
const DEVELOPER: Actor = { userId: '555555555555555555', roleIds: [], isOwner: false };

const manifest: ModuleManifest = {
  id: 'sample',
  name: 'Sample',
  description: 'Test module',
  version: '1.0.0',
  apiVersion: '1.3.0',
  entrypoint: 'index.ts',
  dependencies: [],
  permissions: ['sample.items.write', 'sample.items.read'],
  capabilities: [],
  enabledByDefault: true,
  events: { subscribes: [], publishes: [] },
};

let db: DatabaseSync;
let logger: RecordingLogger;
let permissions: PermissionService;
let active: Set<string>;
let registry: OperationRegistry;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  logger = createRecordingLogger();
  permissions = new PermissionService(db);
  permissions.addDeveloper(DEVELOPER.userId);
  permissions.grant('sample.items.write', ROLE, new Set(manifest.permissions));
  active = new Set(['sample']);
  registry = new OperationRegistry({
    permissions,
    logger,
    isActive: (moduleId) => active.has(moduleId),
  });
});

afterEach(() => {
  db.close();
});

/** A definition whose default handler is the spy mock. */
function definition(
  overrides: Partial<OperationDefinition> = {},
): OperationDefinition & { readonly spy: Mock } {
  const spy = vi.fn(() => Promise.resolve(ok({ done: true })));
  return {
    name: 'sample.items.mute',
    permission: 'sample.items.write',
    input: z.object({ minutes: z.number().int().positive() }),
    handler: spy,
    ...overrides,
    spy,
  };
}

function operationLogs(): object[] {
  return logger.entries
    .filter((entry) => typeof entry.obj === 'object' && 'operation' in entry.obj)
    .map((entry) => entry.obj as object);
}

describe('OperationRegistry.register', () => {
  it.each([
    ['a name outside the module prefix', { name: 'other.items.mute' }],
    ['a name with a single segment after the prefix', { name: 'sample.mute' }],
    ['a name with invalid characters', { name: 'sample.Items.mute' }],
    ['a permission the manifest does not declare', { permission: 'sample.items.delete' }],
    ['a null permission on a name that does not end in .mine', { permission: null }],
    ['an input without safeParse', { input: {} }],
    ['an input that is not an object', { input: undefined }],
    ['a handler that is not a function', { handler: 'nope' as never }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => {
      registry.register(manifest, definition(overrides));
    }).toThrow(InvalidOperationError);
    expect(registry.names()).toEqual([]);
  });

  it('refuses a repeated name', () => {
    registry.register(manifest, definition());
    expect(() => {
      registry.register(manifest, definition());
    }).toThrow(InvalidOperationError);
    expect(registry.names()).toEqual(['sample.items.mute']);
  });

  it('accepts a null permission on a .mine operation', () => {
    registry.register(manifest, definition({ name: 'sample.items.mine', permission: null }));
    expect(registry.names()).toEqual(['sample.items.mine']);
  });

  it('keeps a frozen copy that later changes to the definition never reach', async () => {
    const original = { ...definition() };
    registry.register(manifest, original);
    (original as { permission: string | null }).permission = null;
    await expect(
      registry.execute('sample.items.mute', MEMBER, { minutes: 5 }, 'dashboard'),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('drops every operation of a module', () => {
    registry.register(manifest, definition());
    registry.register(manifest, definition({ name: 'sample.items.mine', permission: null }));
    registry.dropModule('sample');
    expect(registry.names()).toEqual([]);
    registry.register(manifest, definition());
    expect(registry.names()).toEqual(['sample.items.mute']);
  });
});

describe('OperationRegistry.execute', () => {
  it('returns not_found for an unknown operation', async () => {
    await expect(registry.execute('sample.items.nope', OWNER, {}, 'dashboard')).resolves.toEqual(
      fail('not_found', 'Operação desconhecida.'),
    );
  });

  it('returns unavailable while the module is not active, without running the handler', async () => {
    const op = definition();
    registry.register(manifest, op);
    active.delete('sample');
    await expect(
      registry.execute('sample.items.mute', DEVELOPER, { minutes: 5 }, 'dashboard'),
    ).resolves.toEqual(fail('unavailable', 'Módulo indisponível.'));
    expect(op.spy).not.toHaveBeenCalled();
  });

  it('returns forbidden to a member without the permission, without running the handler', async () => {
    const op = definition();
    registry.register(manifest, op);
    await expect(
      registry.execute('sample.items.mute', MEMBER, { minutes: 5 }, 'dashboard'),
    ).resolves.toEqual(fail('forbidden', 'Você não tem permissão para isso.'));
    expect(op.spy).not.toHaveBeenCalled();
  });

  it('checks the permission before the input', async () => {
    registry.register(manifest, definition());
    await expect(
      registry.execute('sample.items.mute', MEMBER, { minutes: 'x' }, 'dashboard'),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('returns invalid with the paths and never the received values', async () => {
    const op = definition({
      input: z.object({ minutes: z.number(), reason: z.object({ text: z.string() }) }),
    });
    registry.register(manifest, op);
    const result = await registry.execute(
      'sample.items.mute',
      STAFF,
      { minutes: 'x', reason: { text: 42 } },
      'dashboard',
    );
    expect(result).toEqual(fail('invalid', 'Entrada inválida: minutes, reason.text.'));
    expect(JSON.stringify(result)).not.toMatch(/"x"|42/);
    expect(op.spy).not.toHaveBeenCalled();
  });

  it('lists each invalid path once', async () => {
    registry.register(
      manifest,
      definition({ input: z.object({ minutes: z.string().min(5).regex(/^\d+$/) }) }),
    );
    await expect(
      registry.execute('sample.items.mute', STAFF, { minutes: 'ab' }, 'dashboard'),
    ).resolves.toEqual(fail('invalid', 'Entrada inválida: minutes.'));
  });

  it('masks path segments that are not plain keys and marks the root', async () => {
    registry.register(
      manifest,
      definition({ input: z.object({ tags: z.record(z.string(), z.number()) }) }),
    );
    await expect(
      registry.execute('sample.items.mute', STAFF, { tags: { 'a b<x>': 'v' } }, 'dashboard'),
    ).resolves.toEqual(fail('invalid', 'Entrada inválida: tags.*.'));
    await expect(registry.execute('sample.items.mute', STAFF, 'x', 'dashboard')).resolves.toEqual(
      fail('invalid', 'Entrada inválida: (raiz).'),
    );
  });

  it('runs the handler with the actor and the parsed input', async () => {
    const op = definition({ input: z.object({ minutes: z.coerce.number() }) });
    registry.register(manifest, op);
    await expect(
      registry.execute('sample.items.mute', STAFF, { minutes: '5', extra: true }, 'discord'),
    ).resolves.toEqual(ok({ done: true }));
    expect(op.spy).toHaveBeenCalledWith(STAFF, { minutes: 5 });
  });

  it('passes a typed error returned by the handler through unchanged', async () => {
    registry.register(
      manifest,
      definition({ handler: () => Promise.resolve(fail('conflict', 'Já existe.')) }),
    );
    await expect(
      registry.execute('sample.items.mute', STAFF, { minutes: 5 }, 'dashboard'),
    ).resolves.toEqual(fail('conflict', 'Já existe.'));
  });

  it('turns a thrown error into failed and logs only error.name', async () => {
    registry.register(
      manifest,
      definition({
        handler: () => {
          const error = new Error('secret detail 111111111111111111');
          error.name = 'StorageError';
          throw error;
        },
      }),
    );
    await expect(
      registry.execute('sample.items.mute', STAFF, { minutes: 5 }, 'dashboard'),
    ).resolves.toEqual(fail('failed', 'Erro interno.'));
    expect(operationLogs()).toEqual([
      {
        module: 'sample',
        operation: 'sample.items.mute',
        source: 'dashboard',
        result: 'failed',
        error: 'StorageError',
      },
    ]);
    expect(JSON.stringify(logger.entries)).not.toMatch(/secret|111111111111111111/);
  });

  it('turns a handler that returns something other than a result into failed', async () => {
    registry.register(manifest, definition({ handler: () => Promise.resolve('oops' as never) }));
    registry.register(
      manifest,
      definition({
        name: 'sample.items.odd',
        handler: () =>
          Promise.resolve({ ok: false, error: { code: 'teapot', message: '' } } as never),
      }),
    );
    await expect(
      registry.execute('sample.items.odd', STAFF, { minutes: 5 }, 'dashboard'),
    ).resolves.toEqual(fail('failed', 'Erro interno.'));
    await expect(
      registry.execute('sample.items.mute', STAFF, { minutes: 5 }, 'dashboard'),
    ).resolves.toEqual(fail('failed', 'Erro interno.'));
  });

  it('accepts any actor on a null permission', async () => {
    const op = definition({ name: 'sample.items.mine', permission: null, input: z.object({}) });
    registry.register(manifest, op);
    await expect(registry.execute('sample.items.mine', MEMBER, {}, 'dashboard')).resolves.toEqual(
      ok({ done: true }),
    );
    expect(op.spy).toHaveBeenCalledWith(MEMBER, {});
  });

  it.each([
    ['the developer', DEVELOPER],
    ['the owner', OWNER],
  ])('lets %s through module permissions', async (_label, actor) => {
    registry.register(
      manifest,
      definition({ name: 'sample.items.list', permission: 'sample.items.read' }),
    );
    await expect(
      registry.execute('sample.items.list', actor, { minutes: 1 }, 'dashboard'),
    ).resolves.toEqual(ok({ done: true }));
  });

  it('logs every call with module, operation, source and result, never the input', async () => {
    registry.register(manifest, definition());
    await registry.execute('sample.items.mute', STAFF, { minutes: 7 }, 'discord');
    await registry.execute('sample.items.mute', MEMBER, { minutes: 7 }, 'dashboard');
    await registry.execute('sample.items.mute', STAFF, { minutes: 'secret' }, 'dashboard');
    await registry.execute('sample.items.nope', STAFF, {}, 'dashboard');
    expect(operationLogs()).toEqual([
      { module: 'sample', operation: 'sample.items.mute', source: 'discord', result: 'ok' },
      {
        module: 'sample',
        operation: 'sample.items.mute',
        source: 'dashboard',
        result: 'forbidden',
      },
      { module: 'sample', operation: 'sample.items.mute', source: 'dashboard', result: 'invalid' },
      { module: null, operation: null, source: 'dashboard', result: 'not_found' },
    ]);
    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toMatch(/secret|minutes|111111111111111111|333333333333333333/);
  });

  it('returns not_found to a module calling an operation of another module', async () => {
    const other: ModuleManifest = { ...manifest, id: 'other', permissions: [] };
    active.add('other');
    const op = definition({ name: 'other.items.mine', permission: null });
    registry.register(other, op);
    await expect(
      registry.executeOwn('sample', 'other.items.mine', OWNER, { minutes: 1 }),
    ).resolves.toEqual(fail('not_found', 'Operação desconhecida.'));
    expect(op.spy).not.toHaveBeenCalled();
    await expect(
      registry.executeOwn('other', 'other.items.mine', OWNER, { minutes: 1 }),
    ).resolves.toEqual(ok({ done: true }));
    expect(operationLogs().at(-1)).toEqual({
      module: 'other',
      operation: 'other.items.mine',
      source: 'discord',
      result: 'ok',
    });
  });
});
