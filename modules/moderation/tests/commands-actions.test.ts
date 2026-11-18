import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import type { GuildActionResult } from '../../../shared/contracts/guild.ts';
import { createFakeGuild } from '../../../tests/helpers/fake-guild.ts';
import { createTestModuleStorage } from '../../../tests/helpers/module-storage.ts';
import { CaseStore } from '../cases.ts';
import { configSchema } from '../config.ts';
import { buildModCommand } from '../commands/mod-command.ts';
import type { ModCommandDeps } from '../commands/mod-command.ts';
import { DomainStore } from '../domains.ts';

const ACTOR = { userId: '111111111111111111', roleIds: ['222222222222222222'] };
const TARGET = '333333333333333333';
const CHANNEL = '444444444444444444';
const MEMBER_ROLE = '555555555555555555';
const EXEMPT_ROLE = '666666666666666666';
const STAFF_ROLE = '777777777777777777';
const NOW = new Date('2026-11-18T12:00:00.000Z');
const EPHEMERAL = { ephemeral: true };

type ActionName = 'warn' | 'timeout' | 'kick' | 'ban';
type Values = Record<string, string | number | boolean>;

interface SetupOptions {
  readonly developers?: readonly string[];
  readonly guild?: Parameters<typeof createFakeGuild>[0];
}

function setup(options: SetupOptions = {}) {
  const config = configSchema.parse({ exemptRoleIds: [EXEMPT_ROLE] });
  const guild = createFakeGuild(options.guild);
  guild.memberRoles.set(TARGET, [MEMBER_ROLE]);
  const ctx = createTestModuleStorage(fileURLToPath(new URL('..', import.meta.url)));
  const publish = vi.fn();
  const developers = new Set(options.developers ?? []);
  const deps: ModCommandDeps = {
    permissions: {
      check: () => true,
      isDeveloper: (userId) => developers.has(userId),
      hasAnyGrant: (roleIds, prefix) => prefix === 'moderation.' && roleIds.includes(STAFF_ROLE),
    },
    config: { get: <T>() => config as T, set: vi.fn() },
    guild,
    cases: new CaseStore(ctx.storage),
    domains: new DomainStore(ctx.storage),
    publish,
    now: () => NOW,
  };
  const create = vi.spyOn(deps.cases, 'create');
  return { deps, guild, publish, create, command: buildModCommand(deps) };
}

type Setup = ReturnType<typeof setup>;

function interaction(subcommand: string, values: Values) {
  const reply = vi.fn<CommandInteraction['reply']>(() => Promise.resolve());
  const pick = (name: string, type: string): unknown => {
    const value = values[name];
    return typeof value === type ? value : undefined;
  };
  const value: CommandInteraction = {
    actor: ACTOR,
    channelId: CHANNEL,
    subcommandGroup: undefined,
    subcommand,
    options: {
      getString: (name) => pick(name, 'string') as string | undefined,
      getInteger: (name) => pick(name, 'number') as number | undefined,
      getBoolean: (name) => pick(name, 'boolean') as boolean | undefined,
      getUser: (name) => pick(name, 'string') as string | undefined,
      getChannel: (name) => pick(name, 'string') as string | undefined,
      getRole: (name) => pick(name, 'string') as string | undefined,
    },
    reply,
  };
  return { value, reply };
}

const BASE: Record<ActionName, Values> = {
  warn: { reason: 'spam' },
  timeout: { minutes: 30, reason: 'spam' },
  kick: { reason: 'spam' },
  ban: { reason: 'spam' },
};

async function run(t: Setup, action: ActionName, values: Values = {}): Promise<string> {
  const { value, reply } = interaction(action, { user: TARGET, ...BASE[action], ...values });
  await t.command.handle(value);
  expect(reply).toHaveBeenCalledOnce();
  expect(reply.mock.calls[0]?.[1]).toEqual(EPHEMERAL);
  return reply.mock.calls[0]?.[0] ?? '';
}

const discordCalls = (t: Setup) => t.guild.calls.filter((c) => c.action !== 'getMemberRoleIds');

const ACTIONS: readonly ActionName[] = ['warn', 'timeout', 'kick', 'ban'];

describe('/mod manual action protections', () => {
  it.each(ACTIONS)('%s against the actor replies SELF_TARGET', async (action) => {
    const t = setup();
    const text = await run(t, action, { user: ACTOR.userId });
    expect(text).toBe('Não é possível agir contra você mesmo.');
    expect(discordCalls(t)).toHaveLength(0);
    expect(t.create).not.toHaveBeenCalled();
    expect(t.publish).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s against a developer replies PROTECTED_TARGET', async (action) => {
    const t = setup({ developers: [TARGET] });
    const text = await run(t, action);
    expect(text).toBe('Não é possível agir contra este membro.');
    expect(discordCalls(t)).toHaveLength(0);
    expect(t.create).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s against a member with an exempt role is protected', async (action) => {
    const t = setup();
    t.guild.memberRoles.set(TARGET, [MEMBER_ROLE, EXEMPT_ROLE]);
    const text = await run(t, action);
    expect(text).toBe('Não é possível agir contra este membro.');
    expect(discordCalls(t)).toHaveLength(0);
    expect(t.create).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s against a member with a moderation.* grant is protected', async (action) => {
    const t = setup();
    t.guild.memberRoles.set(TARGET, [STAFF_ROLE]);
    const text = await run(t, action);
    expect(text).toBe('Não é possível agir contra este membro.');
    expect(discordCalls(t)).toHaveLength(0);
    expect(t.create).not.toHaveBeenCalled();
  });

  it.each(['warn', 'timeout', 'kick'] as const)(
    '%s against a non-member replies NOT_A_MEMBER',
    async (action) => {
      const t = setup();
      t.guild.memberRoles.delete(TARGET);
      const text = await run(t, action);
      expect(text).toBe('Este usuário não é membro do servidor.');
      expect(discordCalls(t)).toHaveLength(0);
      expect(t.create).not.toHaveBeenCalled();
    },
  );

  it('ban accepts a non-member', async () => {
    const t = setup();
    t.guild.memberRoles.delete(TARGET);
    const text = await run(t, 'ban');
    expect(text).toBe('Usuário banido (caso #1).');
    expect(discordCalls(t)).toEqual([{ action: 'ban', args: [TARGET, 'spam', 0] }]);
  });

  it.each(ACTIONS)('%s with a missing or overlong reason is rejected', async (action) => {
    const t = setup();
    expect(await run(t, action, { reason: '' })).toBe('Opção inválida: reason.');
    expect(await run(t, action, { reason: 'x'.repeat(513) })).toBe('Opção inválida: reason.');
    expect(discordCalls(t)).toHaveLength(0);
    expect(t.create).not.toHaveBeenCalled();
  });
});

describe('/mod warn', () => {
  it('records a manual warn case and sends the warning DM', async () => {
    const t = setup();
    const text = await run(t, 'warn', { reason: 'linguagem ofensiva' });
    expect(text).toBe('Advertência registrada (caso #1).');
    expect(discordCalls(t)).toEqual([
      {
        action: 'sendDirectMessage',
        args: [TARGET, 'Você recebeu uma advertência no servidor. Motivo: linguagem ofensiva'],
      },
    ]);
    const record = t.deps.cases.get(1);
    expect(record).toMatchObject({
      kind: 'manual',
      level: null,
      action: 'warn',
      status: 'actioned',
      targetUserId: TARGET,
      actorUserId: ACTOR.userId,
      channelId: CHANNEL,
      messageId: null,
      reason: 'linguagem ofensiva',
      outcome: { warn: 'ok', dm: 'ok' },
      timeoutUntil: null,
      createdAt: NOW.toISOString(),
    });
    expect(t.publish).toHaveBeenCalledExactlyOnceWith('moderation.case.created', {
      caseId: 1,
      kind: 'manual',
      level: null,
      action: 'warn',
    });
  });

  it('keeps the case and reports a failed DM', async () => {
    const t = setup({ guild: { sendDirectMessage: { ok: false, error: 'forbidden' } } });
    const text = await run(t, 'warn');
    expect(text).toBe('Advertência registrada (caso #1). Não foi possível enviar mensagem direta.');
    expect(t.deps.cases.get(1)?.outcome).toEqual({ warn: 'ok', dm: 'forbidden' });
    expect(t.publish).toHaveBeenCalledOnce();
  });
});

describe('/mod timeout, kick and ban', () => {
  it('timeout 30 applies 1 800 000 ms and records timeout_until', async () => {
    const t = setup();
    const text = await run(t, 'timeout', { minutes: 30 });
    expect(text).toBe('Timeout aplicado (caso #1).');
    expect(discordCalls(t)).toEqual([{ action: 'timeout', args: [TARGET, 1_800_000, 'spam'] }]);
    expect(t.deps.cases.get(1)).toMatchObject({
      kind: 'manual',
      action: 'timeout',
      status: 'actioned',
      outcome: { timeout: 'ok' },
      timeoutUntil: '2026-11-18T12:30:00.000Z',
    });
    expect(t.publish).toHaveBeenCalledExactlyOnceWith('moderation.case.created', {
      caseId: 1,
      kind: 'manual',
      level: null,
      action: 'timeout',
    });
  });

  it.each([0, 40321])('timeout rejects %i minutes', async (minutes) => {
    const t = setup();
    expect(await run(t, 'timeout', { minutes })).toBe('Opção inválida: minutes.');
    expect(discordCalls(t)).toHaveLength(0);
  });

  it('kick expels the member and records the case', async () => {
    const t = setup();
    const text = await run(t, 'kick');
    expect(text).toBe('Membro expulso (caso #1).');
    expect(discordCalls(t)).toEqual([{ action: 'kick', args: [TARGET, 'spam'] }]);
    expect(t.deps.cases.get(1)).toMatchObject({ action: 'kick', outcome: { kick: 'ok' } });
  });

  it('ban with delete-days 2 deletes 172 800 seconds of messages', async () => {
    const t = setup();
    const text = await run(t, 'ban', { 'delete-days': 2 });
    expect(text).toBe('Usuário banido (caso #1).');
    expect(discordCalls(t)).toEqual([{ action: 'ban', args: [TARGET, 'spam', 172_800] }]);
    expect(t.deps.cases.get(1)).toMatchObject({ action: 'ban', outcome: { ban: 'ok' } });
  });

  it('ban rejects delete-days out of range', async () => {
    const t = setup();
    expect(await run(t, 'ban', { 'delete-days': 8 })).toBe('Opção inválida: delete-days.');
    expect(discordCalls(t)).toHaveLength(0);
  });

  const REFUSALS: readonly [GuildActionResult, string][] = [
    [{ ok: false, error: 'forbidden' }, 'sem permissão'],
    [{ ok: false, error: 'not_found' }, 'não encontrado'],
    [{ ok: false, error: 'failed' }, 'falha'],
  ];

  it.each(['timeout', 'kick', 'ban'] as const)(
    '%s refused by Discord replies DISCORD_REFUSED and creates no case',
    async (action) => {
      for (const [result, label] of REFUSALS) {
        const t = setup({ guild: { [action]: result } });
        const text = await run(t, action);
        expect(text).toBe(`O Discord recusou a ação: ${label}.`);
        expect(t.create).not.toHaveBeenCalled();
        expect(t.publish).not.toHaveBeenCalled();
      }
    },
  );

  it('the bot itself as target is refused by the guild service as forbidden', async () => {
    // The module cannot know the bot ID; the Core guild wrapper answers `forbidden`.
    const t = setup({ guild: { kick: { ok: false, error: 'forbidden' } } });
    const text = await run(t, 'kick');
    expect(text).toBe('O Discord recusou a ação: sem permissão.');
    expect(t.create).not.toHaveBeenCalled();
  });
});
