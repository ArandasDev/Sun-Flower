import { describe, expect, it, vi } from 'vitest';

import type { AdminService } from '../../shared/contracts/admin.ts';
import type { Actor } from '../../shared/contracts/commands.ts';
import type { ModuleContext } from '../../shared/contracts/module.ts';
import type { OperationDefinition } from '../../shared/contracts/operations.ts';
import { registerAdministrationOperations } from './operations.ts';

const ACTOR: Actor = { userId: '111111111111111111', roleIds: [], isOwner: false };
const USER = '222222222222222222';
const ROLE = '333333333333333333';
const REF = '0123456789abcdef';
const RESULT = { ok: true, data: { marker: 1 } };

interface Parser {
  safeParse(value: unknown): { success: boolean; data?: unknown };
}

function setup() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const record =
    (fn: string, result: unknown) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
      return result;
    };
  const admin = {
    developers: {
      list: record('developers.list', [{ userId: USER, addedAt: 'x' }]),
      add: record('developers.add', RESULT),
      remove: record('developers.remove', RESULT),
    },
    grants: {
      list: record('grants.list', { grants: [], grantable: ['a.b.c'] }),
      grant: record('grants.grant', RESULT),
      revoke: record('grants.revoke', RESULT),
    },
    modules: {
      list: record('modules.list', []),
      setEnabled: vi.fn((...args: unknown[]) => {
        calls.push({ fn: 'modules.setEnabled', args });
        return Promise.resolve(RESULT);
      }),
    },
    logs: { recent: record('logs.recent', []) },
    sessions: {
      list: record('sessions.list', []),
      revoke: record('sessions.revoke', RESULT),
      revokeAll: record('sessions.revokeAll', RESULT),
    },
  } as unknown as AdminService;
  const definitions = new Map<string, OperationDefinition>();
  const context: Pick<ModuleContext, 'admin' | 'operations'> = {
    admin,
    operations: {
      register: <I, O>(definition: OperationDefinition<I, O>) => {
        definitions.set(definition.name, definition);
      },
      execute: () => Promise.reject(new Error('not used')),
    },
  };
  registerAdministrationOperations(context);
  const run = (name: string, input: unknown) => {
    const definition = definitions.get(name);
    if (definition === undefined) throw new Error(`missing ${name}`);
    const parsed = (definition.input as Parser).safeParse(input);
    if (!parsed.success) throw new Error('invalid');
    return definition.handler(ACTOR, parsed.data);
  };
  const accepts = (name: string, input: unknown): boolean =>
    (definitions.get(name)?.input as Parser).safeParse(input).success;
  return { calls, definitions, run, accepts };
}

describe('administration operations', () => {
  it('registers the 12 operations with their permissions', () => {
    const { definitions } = setup();
    const table = [...definitions.values()].map((d) => [d.name, d.permission]);
    expect(table).toEqual([
      ['administration.grants.list', 'administration.grants.manage'],
      ['administration.grants.grant', 'administration.grants.manage'],
      ['administration.grants.revoke', 'administration.grants.manage'],
      ['administration.developers.list', 'core.developers.manage'],
      ['administration.developers.add', 'core.developers.manage'],
      ['administration.developers.remove', 'core.developers.manage'],
      ['administration.modules.list', 'core.modules.manage'],
      ['administration.modules.set-enabled', 'core.modules.manage'],
      ['administration.logs.recent', 'core.logs.read'],
      ['administration.sessions.list', 'core.sessions.manage'],
      ['administration.sessions.revoke', 'core.sessions.manage'],
      ['administration.sessions.revoke-all', 'core.sessions.manage'],
    ]);
  });

  it('wraps list results and passes the actor and input to mutations', async () => {
    const { run, calls } = setup();
    expect(await run('administration.grants.list', {})).toEqual({
      ok: true,
      data: { grants: [], grantable: ['a.b.c'] },
    });
    expect(await run('administration.developers.list', {})).toMatchObject({
      ok: true,
      data: { developers: [{ userId: USER }] },
    });
    expect(await run('administration.modules.list', {})).toEqual({
      ok: true,
      data: { modules: [] },
    });
    expect(await run('administration.sessions.list', {})).toEqual({
      ok: true,
      data: { sessions: [] },
    });
    expect(await run('administration.logs.recent', {})).toEqual({
      ok: true,
      data: { entries: [] },
    });

    calls.length = 0;
    expect(await run('administration.grants.grant', { permission: 'a.b.c', roleId: ROLE })).toBe(
      RESULT,
    );
    await run('administration.grants.revoke', { permission: 'a.b.c', roleId: ROLE });
    await run('administration.developers.add', { userId: USER });
    await run('administration.developers.remove', { userId: USER });
    await run('administration.modules.set-enabled', { moduleId: 'ping', enabled: false });
    await run('administration.logs.recent', { limit: 5, minLevel: 'warn' });
    await run('administration.sessions.revoke', { ref: REF });
    await run('administration.sessions.revoke-all', { userId: USER });
    expect(calls).toEqual([
      { fn: 'grants.grant', args: [ACTOR, 'a.b.c', ROLE] },
      { fn: 'grants.revoke', args: [ACTOR, 'a.b.c', ROLE] },
      { fn: 'developers.add', args: [ACTOR, USER] },
      { fn: 'developers.remove', args: [ACTOR, USER] },
      { fn: 'modules.setEnabled', args: [ACTOR, 'ping', false] },
      { fn: 'logs.recent', args: [{ limit: 5, minLevel: 'warn' }] },
      { fn: 'sessions.revoke', args: [ACTOR, REF] },
      { fn: 'sessions.revokeAll', args: [ACTOR, USER] },
    ]);
  });

  it('defaults the log query to 200 entries from info', async () => {
    const { run, calls } = setup();
    await run('administration.logs.recent', {});
    expect(calls.at(-1)).toEqual({ fn: 'logs.recent', args: [{ limit: 200, minLevel: 'info' }] });
  });

  it('rejects extra fields on every operation', () => {
    const { definitions, accepts } = setup();
    const valid: Record<string, unknown> = {
      'administration.grants.grant': { permission: 'a.b.c', roleId: ROLE },
      'administration.grants.revoke': { permission: 'a.b.c', roleId: ROLE },
      'administration.developers.add': { userId: USER },
      'administration.developers.remove': { userId: USER },
      'administration.modules.set-enabled': { moduleId: 'ping', enabled: true },
      'administration.sessions.revoke': { ref: REF },
      'administration.sessions.revoke-all': { userId: USER },
    };
    for (const name of definitions.keys()) {
      const base = valid[name] ?? {};
      expect(accepts(name, base), name).toBe(true);
      expect(accepts(name, { ...base, extra: 1 }), name).toBe(false);
    }
  });

  it('validates ids, ranges and shapes', () => {
    const { accepts } = setup();
    expect(accepts('administration.developers.add', { userId: '012345678901234567' })).toBe(false);
    expect(accepts('administration.developers.add', { userId: '99999999999999999999' })).toBe(
      false,
    );
    expect(accepts('administration.developers.add', { userId: '123' })).toBe(false);
    expect(accepts('administration.logs.recent', { limit: 0 })).toBe(false);
    expect(accepts('administration.logs.recent', { limit: 501 })).toBe(false);
    expect(accepts('administration.logs.recent', { minLevel: 'debug' })).toBe(false);
    expect(accepts('administration.sessions.revoke', { ref: 'ABCDEF0123456789' })).toBe(false);
    expect(accepts('administration.sessions.revoke', { ref: 'abc' })).toBe(false);
    expect(
      accepts('administration.grants.grant', { permission: 'a'.repeat(101), roleId: ROLE }),
    ).toBe(false);
    expect(
      accepts('administration.modules.set-enabled', { moduleId: 'x'.repeat(65), enabled: true }),
    ).toBe(false);
    expect(accepts('administration.modules.set-enabled', { moduleId: 'ping' })).toBe(false);
  });

  it('rejects non-numeric ids without throwing', () => {
    const { accepts } = setup();
    for (const bad of ['abc', '12x', '1e18']) {
      for (const name of [
        'administration.developers.add',
        'administration.developers.remove',
        'administration.sessions.revoke-all',
      ]) {
        expect(() => accepts(name, { userId: bad }), `${name} ${bad}`).not.toThrow();
        expect(accepts(name, { userId: bad }), `${name} ${bad}`).toBe(false);
      }
      for (const name of ['administration.grants.grant', 'administration.grants.revoke']) {
        const input = { permission: 'a.b.c', roleId: bad };
        expect(() => accepts(name, input), `${name} ${bad}`).not.toThrow();
        expect(accepts(name, input), `${name} ${bad}`).toBe(false);
      }
    }
  });
});
