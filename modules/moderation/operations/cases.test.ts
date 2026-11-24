import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor } from '../../../shared/contracts/commands.ts';
import type { OperationDefinition } from '../../../shared/contracts/operations.ts';
import { createFakeGuild } from '../../../tests/helpers/fake-guild.ts';
import { createTestModuleStorage } from '../../../tests/helpers/module-storage.ts';
import { CaseStore } from '../cases.ts';
import type { CaseAction, CaseStatus, NewCase, RuleHit } from '../cases.ts';
import type { SpamRuleName } from '../config.ts';
import { DomainStore } from '../domains.ts';
import { registerCaseOperations } from './cases.ts';

const ACTOR: Actor = { userId: '111111111111111111', roleIds: [], isOwner: false };
const TARGETS = ['333333333333333333', '444444444444444444', '555555555555555555'] as const;
const NOW = new Date('2026-11-18T12:00:00.000Z');

let cases: CaseStore;
let domains: DomainStore;
let guild: ReturnType<typeof createFakeGuild>;
let publish: ReturnType<typeof vi.fn<(type: string, payload: unknown) => void>>;
let operations: Map<string, OperationDefinition>;

async function run(name: string, input: unknown, actor: Actor = ACTOR) {
  const definition = operations.get(name);
  if (definition === undefined) throw new Error(`missing ${name}`);
  const parsed = (
    definition.input as { safeParse(v: unknown): { success: boolean; data?: unknown } }
  ).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'invalid' } };
  return definition.handler(actor, parsed.data);
}

function newCase(overrides: Partial<NewCase> = {}): NewCase {
  return {
    kind: 'automatic',
    level: 'confirmed',
    action: 'delete_timeout',
    targetUserId: TARGETS[0],
    actorUserId: null,
    channelId: '666666666666666666',
    messageId: '777777777777777777',
    domains: ['golpe.example'],
    signals: [{ name: 'blocked', points: 100 }],
    score: 100,
    reason: 'phishing',
    outcome: { delete: 'ok' },
    status: 'actioned',
    timeoutUntil: null,
    createdAt: '2026-11-17T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  const ctx = createTestModuleStorage(fileURLToPath(new URL('..', import.meta.url)));
  cases = new CaseStore(ctx.storage);
  domains = new DomainStore(ctx.storage);
  guild = createFakeGuild();
  publish = vi.fn();
  operations = new Map();
  registerCaseOperations(
    {
      operations: {
        register: <I, O>(definition: OperationDefinition<I, O>) => {
          operations.set(definition.name, definition);
        },
        execute: () => Promise.reject(new Error('not used')),
      },
    },
    {
      cases: () => cases,
      domains: () => domains,
      guild,
      publish: (type, payload) => {
        publish(type, payload);
      },
      now: () => NOW,
    },
  );
});

interface ListData {
  cases: { id: number }[];
  nextCursor: number | null;
}

describe('moderation.cases.list pagination', () => {
  const STATUSES: CaseStatus[] = ['open', 'actioned', 'reverted', 'dismissed'];
  const RULES: SpamRuleName[] = ['flood', 'repeat', 'mentions'];

  function rulesFor(i: number): RuleHit[] {
    if (i % 3 === 0) return [];
    if (i % 3 === 1) return [{ rule: 'flood', count: 3 }];
    return [
      { rule: 'repeat', count: 2 },
      { rule: 'mentions', count: 5 },
    ];
  }

  beforeEach(() => {
    for (let i = 0; i < 120; i += 1) {
      cases.create(
        newCase({
          status: STATUSES[i % 4] ?? 'open',
          targetUserId: TARGETS[i % 3] ?? TARGETS[0],
          rules: rulesFor(i),
          createdAt: `2026-11-17T10:${String(i % 60).padStart(2, '0')}:00.000Z`,
        }),
      );
    }
  });

  async function walk(filter: Record<string, unknown>): Promise<number[]> {
    const ids: number[] = [];
    let cursor: number | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result = (await run('moderation.cases.list', {
        ...filter,
        ...(cursor === null ? {} : { cursor }),
      })) as { ok: true; data: ListData };
      expect(result.ok).toBe(true);
      expect(result.data.cases.length).toBeLessThanOrEqual(50);
      ids.push(...result.data.cases.map((c) => c.id));
      if (result.data.nextCursor === null) return ids;
      expect(result.data.nextCursor).toBe(result.data.cases.at(-1)?.id);
      cursor = result.data.nextCursor;
    }
    throw new Error('pagination did not end');
  }

  function expected(match: (i: number) => boolean): number[] {
    const ids: number[] = [];
    for (let i = 119; i >= 0; i -= 1) if (match(i)) ids.push(i + 1);
    return ids;
  }

  it('walks every case once, newest id first, with a null cursor on the last page', async () => {
    expect(await walk({})).toEqual(expected(() => true));
    const first = (await run('moderation.cases.list', {})) as { data: ListData };
    expect(first.data.cases).toHaveLength(50);
    expect(first.data.nextCursor).toBe(71);
  });

  it('gives a null cursor when the remainder fills exactly one page', async () => {
    const result = (await run('moderation.cases.list', { cursor: 51 })) as { data: ListData };
    expect(result.data.cases).toHaveLength(50);
    expect(result.data.nextCursor).toBeNull();
  });

  it('filters by status, rule and target, alone and combined', async () => {
    expect(await walk({ status: 'open' })).toEqual(expected((i) => i % 4 === 0));
    expect(await walk({ rule: RULES[0] })).toEqual(expected((i) => i % 3 === 1));
    expect(await walk({ rule: 'mentions' })).toEqual(expected((i) => i % 3 === 2));
    expect(await walk({ targetUserId: TARGETS[1] })).toEqual(expected((i) => i % 3 === 1));
    expect(await walk({ status: 'actioned', rule: 'repeat', targetUserId: TARGETS[2] })).toEqual(
      expected((i) => i % 4 === 1 && i % 3 === 2),
    );
  });

  it('returns summaries without message, reason or actor fields', async () => {
    const result = (await run('moderation.cases.list', {})) as {
      data: { cases: Record<string, unknown>[] };
    };
    expect(Object.keys(result.data.cases[0] ?? {}).sort()).toEqual(
      ['action', 'createdAt', 'id', 'kind', 'level', 'rules', 'status', 'targetUserId'].sort(),
    );
  });

  it('rejects bad filters at the schema', async () => {
    expect(await run('moderation.cases.list', { cursor: 0 })).toMatchObject({ ok: false });
    expect(await run('moderation.cases.list', { status: 'x' })).toMatchObject({ ok: false });
    expect(await run('moderation.cases.list', { rule: "x' OR 1=1" })).toMatchObject({ ok: false });
    expect(await run('moderation.cases.list', { targetUserId: '1; DROP' })).toMatchObject({
      ok: false,
    });
  });
});

describe('moderation.cases.view', () => {
  it('returns the detail without the message id', async () => {
    const id = cases.create(newCase());
    const result = (await run('moderation.cases.view', { id })) as {
      ok: true;
      data: Record<string, unknown>;
    };
    expect(result.ok).toBe(true);
    expect(result.data['id']).toBe(id);
    expect(result.data['reason']).toBe('phishing');
    expect('messageId' in result.data).toBe(false);
  });

  it('pins the exact key set of the detail', async () => {
    const id = cases.create(newCase());
    const result = (await run('moderation.cases.view', { id })) as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(result.data).sort()).toEqual(
      [
        'action',
        'actorUserId',
        'channelId',
        'createdAt',
        'domains',
        'id',
        'kind',
        'level',
        'outcome',
        'reason',
        'revertedAt',
        'revertedBy',
        'rules',
        'score',
        'signals',
        'status',
        'targetUserId',
        'timeoutUntil',
      ].sort(),
    );
  });

  it('answers not_found for an unknown case', async () => {
    expect(await run('moderation.cases.view', { id: 99 })).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Caso não encontrado.' },
    });
  });

  it('rejects ids below 1', async () => {
    expect(await run('moderation.cases.view', { id: 0 })).toMatchObject({ ok: false });
  });
});

describe('moderation.cases.revert', () => {
  const seed = (action: CaseAction, extra: Partial<NewCase> = {}): number =>
    cases.create(newCase({ action, ...extra }));

  it('undoes the action, marks the case and publishes', async () => {
    const id = seed('timeout');
    const result = await run('moderation.cases.revert', { id });
    expect(result).toMatchObject({
      ok: true,
      data: { case: { id, status: 'reverted', revertedBy: ACTOR.userId }, deletedMessage: false },
    });
    expect(publish).toHaveBeenCalledExactlyOnceWith('moderation.case.reverted', { caseId: id });
  });

  it('flags a deleted message for delete_timeout', async () => {
    const id = seed('delete_timeout');
    expect(await run('moderation.cases.revert', { id })).toMatchObject({
      ok: true,
      data: { deletedMessage: true },
    });
  });

  it('answers not_found, and conflict for a case that is not revertible', async () => {
    expect(await run('moderation.cases.revert', { id: 5 })).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Caso não encontrado.' },
    });
    const id = seed('none', { status: 'dismissed' });
    expect(await run('moderation.cases.revert', { id })).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'Este caso não pode ser revertido.' },
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('refuses allowDomains for lookalike domains before any Discord call', async () => {
    const id = seed('timeout', { domains: ['golpe.example', 'discord-nitro.com'] });
    const result = await run('moderation.cases.revert', { id, allowDomains: true });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(guild.calls).toHaveLength(0);
    expect(cases.get(id)?.status).toBe('actioned');
    expect(publish).not.toHaveBeenCalled();
  });

  it('allows the domains when asked', async () => {
    const id = seed('none', { domains: ['golpe.example'] });
    await run('moderation.cases.revert', { id, allowDomains: true });
    expect(domains.isAllowed('golpe.example')).toBe(true);
  });
});

describe('moderation.cases.dismiss', () => {
  it('dismisses an open case and publishes moderation.case.dismissed', async () => {
    const id = cases.create(newCase({ action: 'none', status: 'open' }));
    expect(await run('moderation.cases.dismiss', { id })).toMatchObject({
      ok: true,
      data: { id, status: 'dismissed', revertedBy: ACTOR.userId },
    });
    expect(publish).toHaveBeenCalledExactlyOnceWith('moderation.case.dismissed', { caseId: id });
  });

  it('refuses a case that is not open, and an unknown one', async () => {
    const id = cases.create(newCase());
    expect(await run('moderation.cases.dismiss', { id })).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'Só casos abertos podem ser descartados.' },
    });
    expect(await run('moderation.cases.dismiss', { id: 99 })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('moderation.cases.mine', () => {
  it('returns only the actor own cases, newest first, in the minimal shape', async () => {
    const mine = cases.create(newCase({ targetUserId: ACTOR.userId, reason: 'secret' }));
    cases.create(newCase({ targetUserId: TARGETS[0] }));
    const later = cases.create(
      newCase({ targetUserId: ACTOR.userId, actorUserId: TARGETS[1], kind: 'manual', level: null }),
    );
    const result = (await run('moderation.cases.mine', {})) as {
      ok: true;
      data: { cases: Record<string, unknown>[] };
    };
    expect(result.data.cases.map((c) => c['id'])).toEqual([later, mine]);
    for (const entry of result.data.cases) {
      expect(Object.keys(entry).sort()).toEqual(['action', 'createdAt', 'id', 'kind', 'status']);
    }
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('caps at 50 cases and ignores any input', async () => {
    for (let i = 0; i < 55; i += 1) cases.create(newCase({ targetUserId: ACTOR.userId }));
    const result = (await run('moderation.cases.mine', { userId: TARGETS[0] })) as {
      data: { cases: unknown[] };
    };
    expect(result.data.cases).toHaveLength(50);
  });
});

describe('registration', () => {
  it('uses a null permission only for .mine', () => {
    expect(operations.size).toBe(5);
    for (const [name, definition] of operations) {
      expect(definition.permission === null).toBe(name.endsWith('.mine'));
    }
  });
});
