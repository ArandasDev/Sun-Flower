import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type { Actor } from '../../../shared/contracts/commands.ts';
import type { GuildActionResult } from '../../../shared/contracts/guild.ts';
import type { OperationResult } from '../../../shared/contracts/operations.ts';
import { createFakeGuild } from '../../../tests/helpers/fake-guild.ts';
import { createTestModuleStorage } from '../../../tests/helpers/module-storage.ts';
import { CaseStore } from '../cases.ts';
import { configSchema } from '../config.ts';
import { DomainStore } from '../domains.ts';
import { createLocalOperations } from '../tests/operations-harness.ts';

const ACTOR: Actor = { userId: '111111111111111111', roleIds: [], isOwner: false };
const TARGET = '333333333333333333';
const CHANNEL = '444444444444444444';
const MEMBER_ROLE = '555555555555555555';
const EXEMPT_ROLE = '666666666666666666';
const STAFF_ROLE = '777777777777777777';
const NOW = new Date('2026-11-18T12:00:00.000Z');

type ActionName = 'warn' | 'timeout' | 'kick' | 'ban';
const ACTIONS: readonly ActionName[] = ['warn', 'timeout', 'kick', 'ban'];

function setup(
  guildOverrides: Parameters<typeof createFakeGuild>[0] = {},
  developers: string[] = [],
) {
  const config = configSchema.parse({ exemptRoleIds: [EXEMPT_ROLE] });
  const guild = createFakeGuild(guildOverrides);
  guild.memberRoles.set(TARGET, [MEMBER_ROLE]);
  const ctx = createTestModuleStorage(fileURLToPath(new URL('..', import.meta.url)));
  const cases = new CaseStore(ctx.storage);
  const publish = vi.fn();
  const operations = createLocalOperations({
    config: { get: <T>() => config as T, set: vi.fn(), version: () => 0 },
    permissions: {
      check: () => true,
      isDeveloper: (userId) => developers.includes(userId),
      hasAnyGrant: (roleIds, prefix) => prefix === 'moderation.' && roleIds.includes(STAFF_ROLE),
    },
    domains: new DomainStore(ctx.storage),
    cases,
    guild,
    publish,
    now: () => NOW,
  });
  const create = vi.spyOn(cases, 'create');
  const run = (
    action: ActionName,
    extra: Record<string, unknown> = {},
    actor: Actor = ACTOR,
  ): Promise<OperationResult> =>
    operations.execute(`moderation.actions.${action}`, actor, {
      userId: TARGET,
      reason: ' spam ',
      ...(action === 'timeout' ? { minutes: 30 } : {}),
      ...extra,
    });
  const discordCalls = () => guild.calls.filter((c) => c.action !== 'getMemberRoleIds');
  return { run, guild, cases, create, publish, discordCalls };
}

describe('moderation.actions success', () => {
  it('warn sends the DM, records a manual case and publishes', async () => {
    const t = setup();
    expect(await t.run('warn', { channelId: CHANNEL })).toEqual({ ok: true, data: { caseId: 1 } });
    expect(t.discordCalls()).toEqual([
      {
        action: 'sendDirectMessage',
        args: [TARGET, 'Você recebeu uma advertência no servidor. Motivo: spam'],
      },
    ]);
    expect(t.cases.get(1)).toMatchObject({
      kind: 'manual',
      action: 'warn',
      status: 'actioned',
      targetUserId: TARGET,
      actorUserId: ACTOR.userId,
      channelId: CHANNEL,
      reason: 'spam',
      outcome: { warn: 'ok', dm: 'ok' },
      createdAt: NOW.toISOString(),
    });
    expect(t.publish).toHaveBeenCalledExactlyOnceWith('moderation.case.created', {
      caseId: 1,
      kind: 'manual',
      level: null,
      action: 'warn',
    });
  });

  it('warn keeps the case and reports dmFailed when the DM fails', async () => {
    const t = setup({ sendDirectMessage: { ok: false, error: 'failed' } });
    expect(await t.run('warn')).toEqual({ ok: true, data: { caseId: 1, dmFailed: true } });
    expect(t.cases.get(1)?.outcome).toEqual({ warn: 'ok', dm: 'failed' });
    expect(t.cases.get(1)?.channelId).toBeNull();
  });

  it('warn refuses a forbidden DM target as protected and records nothing', async () => {
    const t = setup({ sendDirectMessage: { ok: false, error: 'forbidden' } });
    expect(await t.run('warn')).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'Não é possível agir contra este membro.' },
    });
    expect(t.create).not.toHaveBeenCalled();
    expect(t.publish).not.toHaveBeenCalled();
  });

  it('timeout applies the duration and records timeoutUntil', async () => {
    const t = setup();
    expect(await t.run('timeout')).toEqual({ ok: true, data: { caseId: 1 } });
    expect(t.discordCalls()).toEqual([{ action: 'timeout', args: [TARGET, 1_800_000, 'spam'] }]);
    expect(t.cases.get(1)).toMatchObject({
      action: 'timeout',
      timeoutUntil: '2026-11-18T12:30:00.000Z',
      outcome: { timeout: 'ok' },
    });
  });

  it('kick expels the member', async () => {
    const t = setup();
    expect(await t.run('kick')).toEqual({ ok: true, data: { caseId: 1 } });
    expect(t.discordCalls()).toEqual([{ action: 'kick', args: [TARGET, 'spam'] }]);
  });

  it('ban converts deleteDays to seconds and accepts a non-member', async () => {
    const t = setup();
    t.guild.memberRoles.delete(TARGET);
    expect(await t.run('ban', { deleteDays: 2 })).toEqual({ ok: true, data: { caseId: 1 } });
    expect(t.discordCalls()).toEqual([{ action: 'ban', args: [TARGET, 'spam', 172_800] }]);
    expect(t.cases.get(1)).toMatchObject({ action: 'ban', outcome: { ban: 'ok' } });
  });
});

describe('moderation.actions protections', () => {
  const none = (t: ReturnType<typeof setup>) => {
    expect(t.discordCalls()).toHaveLength(0);
    expect(t.create).not.toHaveBeenCalled();
    expect(t.publish).not.toHaveBeenCalled();
  };

  it.each(ACTIONS)('%s against the actor is forbidden', async (action) => {
    const t = setup();
    expect(await t.run(action, { userId: ACTOR.userId })).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'Não é possível agir contra você mesmo.' },
    });
    none(t);
  });

  it.each(ACTIONS)('%s against a developer is forbidden', async (action) => {
    const t = setup({}, [TARGET]);
    expect(await t.run(action)).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'Não é possível agir contra este membro.' },
    });
    none(t);
  });

  it.each([EXEMPT_ROLE, STAFF_ROLE])('%s role protects the target', async (role) => {
    for (const action of ACTIONS) {
      const t = setup();
      t.guild.memberRoles.set(TARGET, [MEMBER_ROLE, role]);
      expect(await t.run(action)).toMatchObject({
        ok: false,
        error: { code: 'forbidden', message: 'Não é possível agir contra este membro.' },
      });
      none(t);
    }
  });

  it.each(['warn', 'timeout', 'kick'] as const)(
    '%s against a non-member is not_found',
    async (a) => {
      const t = setup();
      t.guild.memberRoles.delete(TARGET);
      expect(await t.run(a)).toEqual({
        ok: false,
        error: { code: 'not_found', message: 'Este usuário não é membro do servidor.' },
      });
      none(t);
    },
  );

  it.each(ACTIONS)('%s fails closed when the role lookup fails', async (action) => {
    const t = setup();
    t.guild.lookupFails.add(TARGET);
    expect(await t.run(action)).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'O Discord recusou a ação: falha.' },
    });
    none(t);
  });

  const REFUSALS: readonly [GuildActionResult, string, string][] = [
    [{ ok: false, error: 'forbidden' }, 'forbidden', 'sem permissão'],
    [{ ok: false, error: 'not_found' }, 'not_found', 'não encontrado'],
    [{ ok: false, error: 'failed' }, 'failed', 'falha'],
  ];

  it.each(['timeout', 'kick', 'ban'] as const)(
    '%s refused by Discord records no case',
    async (a) => {
      for (const [result, code, label] of REFUSALS) {
        const t = setup({ [a]: result });
        expect(await t.run(a)).toEqual({
          ok: false,
          error: { code, message: `O Discord recusou a ação: ${label}.` },
        });
        expect(t.create).not.toHaveBeenCalled();
        expect(t.publish).not.toHaveBeenCalled();
      }
    },
  );
});

describe('moderation.actions input', () => {
  it.each([
    ['warn', { reason: '' }],
    ['warn', { reason: '   ' }],
    ['kick', { reason: 'x'.repeat(513) }],
    ['timeout', { minutes: 0 }],
    ['timeout', { minutes: 40321 }],
    ['ban', { deleteDays: 8 }],
    ['ban', { deleteDays: -1 }],
    ['warn', { userId: '123' }],
  ] as const)('%s rejects %j', async (action, extra) => {
    const t = setup();
    expect(await t.run(action, extra)).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(t.guild.calls).toHaveLength(0);
    expect(t.create).not.toHaveBeenCalled();
  });
});
