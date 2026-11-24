import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import type { GuildActionResult } from '../../../shared/contracts/guild.ts';
import { createFakeGuild } from '../../../tests/helpers/fake-guild.ts';
import { createTestModuleStorage } from '../../../tests/helpers/module-storage.ts';
import { buildModCommand } from '../commands/mod-command.ts';
import { CaseStore } from '../cases.ts';
import type { CaseAction, CaseStatus, NewCase } from '../cases.ts';
import { configSchema } from '../config.ts';
import { DomainStore } from '../domains.ts';
import { createLocalOperations } from './operations-harness.ts';

const ACTOR = { userId: '111111111111111111', roleIds: ['222222222222222222'], isOwner: false };
const TARGET = '333333333333333333';
const OTHER = '444444444444444444';
const CHANNEL = '555555555555555555';
const NOW = new Date('2026-11-18T12:00:00.000Z');
const EPHEMERAL = { ephemeral: true };

function setup(guildOverrides: Parameters<typeof createFakeGuild>[0] = {}) {
  const config = configSchema.parse({});
  const guild = createFakeGuild(guildOverrides);
  const ctx = createTestModuleStorage(fileURLToPath(new URL('..', import.meta.url)));
  const publish = vi.fn();
  const configApi = { get: <T>() => config as T, set: vi.fn(), version: () => 0 };
  const domains = new DomainStore(ctx.storage);
  const cases = new CaseStore(ctx.storage);
  const permissions = { check: () => true, isDeveloper: () => false, hasAnyGrant: () => false };
  const deps = {
    permissions,
    config: configApi,
    operations: createLocalOperations({
      config: configApi,
      permissions,
      domains,
      cases,
      guild,
      publish,
      now: () => NOW,
    }),
    guild,
    cases,
    domains,
    publish,
    now: () => NOW,
  };
  return { deps, guild, publish, command: buildModCommand(deps) };
}

type Setup = ReturnType<typeof setup>;
type Values = Record<string, string | number | boolean>;

function interaction(group: string, subcommand: string, values: Values = {}) {
  const reply = vi.fn<CommandInteraction['reply']>(() => Promise.resolve());
  const pick = (name: string, type: string): unknown => {
    const value = values[name];
    return typeof value === type ? value : undefined;
  };
  const value: CommandInteraction = {
    actor: ACTOR,
    channelId: CHANNEL,
    subcommandGroup: group,
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

function newCase(overrides: Partial<NewCase> = {}): NewCase {
  return {
    kind: 'automatic',
    level: 'confirmed',
    action: 'delete_timeout',
    targetUserId: TARGET,
    actorUserId: null,
    channelId: CHANNEL,
    messageId: '666666666666666666',
    domains: ['golpe.example'],
    signals: [{ name: 'blocked', points: 100 }],
    score: 100,
    reason: 'phishing',
    outcome: { delete: 'ok', timeout: 'ok' },
    status: 'actioned',
    timeoutUntil: null,
    createdAt: '2026-11-17T10:00:00.000Z',
    ...overrides,
  };
}

async function run(t: Setup, group: string, subcommand: string, values: Values = {}) {
  const { value, reply } = interaction(group, subcommand, values);
  await t.command.handle(value);
  expect(reply).toHaveBeenCalledOnce();
  expect(reply.mock.calls[0]?.[1]).toEqual(EPHEMERAL);
  return reply.mock.calls[0]?.[0] ?? '';
}

function seed(t: Setup, action: CaseAction, extra: Partial<NewCase> = {}): number {
  return t.deps.cases.create(newCase({ action, ...extra }));
}

const statusOf = (t: Setup, id: number): CaseStatus | undefined => t.deps.cases.get(id)?.status;

describe('/mod domain', () => {
  it('block normalizes the domain', async () => {
    const t = setup();
    const text = await run(t, 'domain', 'block', { domain: 'https://Golpe.COM/abc' });
    expect(text).toBe('Domínio bloqueado: `golpe.com`.');
    expect(t.deps.domains.isBlocked('golpe.com')).toBe(true);
  });

  it('allow moves a blocked domain to the allow list', async () => {
    const t = setup();
    await run(t, 'domain', 'block', { domain: 'exemplo.com' });
    const text = await run(t, 'domain', 'allow', { domain: 'exemplo.com' });
    expect(text).toBe('Domínio permitido: `exemplo.com`.');
    expect(t.deps.domains.isAllowed('exemplo.com')).toBe(true);
    expect(t.deps.domains.isBlocked('exemplo.com')).toBe(false);
  });

  it('rejects invalid or missing domains', async () => {
    const t = setup();
    expect(await run(t, 'domain', 'allow', { domain: 'nao-e-dominio' })).toBe('Domínio inválido.');
    expect(await run(t, 'domain', 'block', {})).toBe('Domínio inválido.');
    expect(t.deps.domains.list('block', 10)).toEqual([]);
  });

  it('remove deletes a listed domain and reports unknown ones', async () => {
    const t = setup();
    await run(t, 'domain', 'block', { domain: 'golpe.com' });
    expect(await run(t, 'domain', 'remove', { domain: 'Golpe.com' })).toBe(
      'Domínio removido: `golpe.com`.',
    );
    expect(await run(t, 'domain', 'remove', { domain: 'golpe.com' })).toBe(
      'Domínio não estava em nenhuma lista.',
    );
    expect(await run(t, 'domain', 'remove', { domain: 'x' })).toBe('Domínio inválido.');
  });

  it('list shows both lists, with empty markers', async () => {
    const t = setup();
    await run(t, 'domain', 'block', { domain: 'golpe.com' });
    const text = await run(t, 'domain', 'list');
    expect(text).toBe('Bloqueados:\n`golpe.com`\nPermitidos:\nNenhum domínio.');
  });

  it('list reads through moderation.domains.list', async () => {
    const t = setup();
    const execute = vi.spyOn(t.deps.operations, 'execute');
    await run(t, 'domain', 'list', { list: 'allow' });
    expect(execute).toHaveBeenCalledExactlyOnceWith('moderation.domains.list', ACTOR, {
      list: 'allow',
    });
  });

  it('list block shows only that list and at most 50 domains', async () => {
    const t = setup();
    for (let i = 0; i < 60; i += 1) {
      const name = `d${String(i).padStart(2, '0')}.example`;
      t.deps.domains.set(name, 'block', null, NOW.toISOString());
    }
    const text = await run(t, 'domain', 'list', { list: 'block' });
    expect(text).not.toContain('Permitidos:');
    expect(text.match(/`/g)).toHaveLength(100);
  });

  it('list stays within the Discord limit with long domains', async () => {
    const t = setup();
    for (let i = 0; i < 50; i += 1) {
      const name = `${'a'.repeat(110)}${String(i).padStart(2, '0')}.example`;
      t.deps.domains.set(name, 'block', null, NOW.toISOString());
      t.deps.domains.set(`b${name}`, 'allow', null, NOW.toISOString());
    }
    const text = await run(t, 'domain', 'list');
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain('(+');
    expect(text).toContain('…');
    expect(text).toContain('Bloqueados:');
    expect(text).toContain('Permitidos:');
  });

  it('list allow shows only the allow list', async () => {
    const t = setup();
    t.deps.domains.set('ok.example', 'allow', null, NOW.toISOString());
    const text = await run(t, 'domain', 'list', { list: 'allow' });
    expect(text).toBe('Permitidos:\n`ok.example`');
  });
});

describe('/mod case view and list', () => {
  it('view of an unknown case replies CASE_NOT_FOUND', async () => {
    const t = setup();
    expect(await run(t, 'case', 'view', { number: 999 })).toBe('Caso não encontrado.');
  });

  it('view summarizes the case', async () => {
    const t = setup();
    const id = seed(t, 'delete_timeout');
    t.deps.cases.setStatus(id, 'reverted', OTHER, '2026-11-18T09:00:00.000Z');
    const text = await run(t, 'case', 'view', { number: id });
    expect(text).toContain(`Caso #${String(id)}`);
    expect(text).toContain('confirmed');
    expect(text).toContain('delete_timeout');
    expect(text).toContain('reverted');
    expect(text).toContain(`<@${TARGET}>`);
    expect(text).toContain(`<#${CHANNEL}>`);
    expect(text).toContain('`golpe.example`');
    expect(text).toContain('blocked (100)');
    expect(text).toContain('phishing');
    expect(text).toContain('delete: ok');
    expect(text).toContain('2026-11-17T10:00:00.000Z');
    expect(text).toContain(`Reversão: revertido por <@${OTHER}> em 2026-11-18T09:00:00.000Z`);
    expect(text).not.toContain('Descarte');
  });

  it('view labels a dismissed case as descartado, not revertido', async () => {
    const t = setup();
    const id = seed(t, 'none', { status: 'open' });
    t.deps.cases.setStatus(id, 'dismissed', OTHER, '2026-11-18T09:00:00.000Z');
    const text = await run(t, 'case', 'view', { number: id });
    expect(text).toContain(`Descarte: descartado por <@${OTHER}> em 2026-11-18T09:00:00.000Z`);
    expect(text).not.toContain('revertido');
  });

  it('view bounds many long domains', async () => {
    const t = setup();
    const domains = Array.from({ length: 20 }, (_, i) => `${'a'.repeat(120)}${String(i)}.example`);
    const id = seed(t, 'delete_timeout', { domains });
    const text = await run(t, 'case', 'view', { number: id });
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain('e mais 15');
    expect(text).toContain('…');
  });

  it('list reads through moderation.cases.list with the user filter', async () => {
    const t = setup();
    const execute = vi.spyOn(t.deps.operations, 'execute');
    await run(t, 'case', 'list', { user: OTHER });
    expect(execute).toHaveBeenCalledWith('moderation.cases.list', ACTOR, { targetUserId: OTHER });
    await run(t, 'case', 'list');
    expect(execute).toHaveBeenLastCalledWith('moderation.cases.list', ACTOR, {});
  });

  it('list replies with an empty marker', async () => {
    const t = setup();
    expect(await run(t, 'case', 'list')).toBe('Nenhum caso.');
  });

  it('list shows the 10 most recent, optionally per user', async () => {
    const t = setup();
    for (let i = 0; i < 12; i += 1) {
      t.deps.cases.create(
        newCase({
          targetUserId: i === 0 ? OTHER : TARGET,
          createdAt: `2026-11-17T10:${String(i).padStart(2, '0')}:00.000Z`,
          ...(i === 11 ? { kind: 'manual' as const, level: null, action: 'warn' as const } : {}),
        }),
      );
    }
    const lines = (await run(t, 'case', 'list')).split('\n');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe(
      `#12 · manual · warn · actioned · <@${TARGET}> · 2026-11-17T10:11:00.000Z`,
    );
    expect(lines[1]).toContain('#11 · confirmed · delete_timeout · actioned');
    const filtered = await run(t, 'case', 'list', { user: OTHER });
    expect(filtered.split('\n')).toHaveLength(1);
    expect(filtered).toContain(`<@${OTHER}>`);
  });
});

describe('/mod case revert', () => {
  it('delete_timeout calls removeTimeout, warns about the deleted message and publishes', async () => {
    const t = setup();
    const id = seed(t, 'delete_timeout');
    const text = await run(t, 'case', 'revert', { number: id });
    expect(text).toBe(`Caso #${String(id)} revertido. A mensagem apagada não pode ser recuperada.`);
    expect(t.guild.calls).toEqual([{ action: 'removeTimeout', args: [TARGET] }]);
    const record = t.deps.cases.get(id);
    expect(record?.status).toBe('reverted');
    expect(record?.revertedBy).toBe(ACTOR.userId);
    expect(record?.revertedAt).toBe(NOW.toISOString());
    expect(t.publish).toHaveBeenCalledExactlyOnceWith('moderation.case.reverted', { caseId: id });
  });

  it('timeout calls removeTimeout without the deleted-message note', async () => {
    const t = setup();
    const id = seed(t, 'timeout');
    expect(await run(t, 'case', 'revert', { number: id })).toBe(`Caso #${String(id)} revertido.`);
    expect(t.guild.calls.map((c) => c.action)).toEqual(['removeTimeout']);
  });

  it('ban calls unban', async () => {
    const t = setup();
    const id = seed(t, 'ban');
    await run(t, 'case', 'revert', { number: id });
    expect(t.guild.calls).toEqual([{ action: 'unban', args: [TARGET] }]);
    expect(statusOf(t, id)).toBe('reverted');
  });

  it.each(['kick', 'ban'] as const)(
    'automatic spam %s with deleted messages warns about them',
    async (action) => {
      const t = setup();
      const id = seed(t, action, {
        rules: [{ rule: 'flood', count: 8, seconds: 5 }],
        outcome: { deleted: '8', individually: '0', bulk: 'ok', [action]: 'ok' },
      });
      expect(await run(t, 'case', 'revert', { number: id })).toBe(
        `Caso #${String(id)} revertido. A mensagem apagada não pode ser recuperada.`,
      );
    },
  );

  it.each([
    ['spam kick with nothing deleted', 'kick', { deleted: '0', bulk: 'forbidden', kick: 'ok' }],
    ['automatic ban without spam rules', 'ban', { ban: 'ok' }],
  ] as const)('%s has no deleted-message note', async (_label, action, outcome) => {
    const t = setup();
    const id = seed(t, action, {
      rules: action === 'kick' ? [{ rule: 'flood', count: 8, seconds: 5 }] : [],
      outcome: { ...outcome },
    });
    expect(await run(t, 'case', 'revert', { number: id })).toBe(`Caso #${String(id)} revertido.`);
  });

  it('a manual ban case has no deleted-message note even with a deleted count', async () => {
    const t = setup();
    const id = seed(t, 'ban', {
      kind: 'manual',
      level: null,
      outcome: { deleted: '3', ban: 'ok' },
    });
    expect(await run(t, 'case', 'revert', { number: id })).toBe(`Caso #${String(id)} revertido.`);
  });

  it.each(['kick', 'warn', 'none'] as const)('%s makes no Discord call', async (action) => {
    const t = setup();
    const id = seed(t, action, { status: 'open' });
    await run(t, 'case', 'revert', { number: id });
    expect(t.guild.calls).toHaveLength(0);
    expect(statusOf(t, id)).toBe('reverted');
    expect(t.publish).toHaveBeenCalledOnce();
  });

  it('not_found from Discord still reverts', async () => {
    const t = setup({ removeTimeout: { ok: false, error: 'not_found' } });
    const id = seed(t, 'timeout');
    await run(t, 'case', 'revert', { number: id });
    expect(statusOf(t, id)).toBe('reverted');
  });

  it.each([
    ['forbidden', 'sem permissão'],
    ['failed', 'falha'],
  ] as const)('%s from Discord refuses and leaves the case untouched', async (error, label) => {
    const result: GuildActionResult = { ok: false, error };
    const t = setup({ removeTimeout: result });
    const id = seed(t, 'timeout');
    expect(await run(t, 'case', 'revert', { number: id })).toBe(
      `O Discord recusou a ação: ${label}.`,
    );
    expect(statusOf(t, id)).toBe('actioned');
    expect(t.publish).not.toHaveBeenCalled();
  });

  it('unknown case replies CASE_NOT_FOUND', async () => {
    const t = setup();
    expect(await run(t, 'case', 'revert', { number: 42 })).toBe('Caso não encontrado.');
  });

  it('reverting twice fails the second time without calling Discord', async () => {
    const t = setup();
    const id = seed(t, 'timeout');
    await run(t, 'case', 'revert', { number: id });
    t.guild.calls.length = 0;
    expect(await run(t, 'case', 'revert', { number: id })).toBe(
      'Este caso não pode ser revertido.',
    );
    expect(t.guild.calls).toHaveLength(0);
    expect(t.publish).toHaveBeenCalledOnce();
  });

  it('dismissed cases cannot be reverted', async () => {
    const t = setup();
    const id = seed(t, 'none', { status: 'open' });
    t.deps.cases.setStatus(id, 'dismissed', OTHER, NOW.toISOString());
    expect(await run(t, 'case', 'revert', { number: id })).toBe(
      'Este caso não pode ser revertido.',
    );
  });

  it('a lost race on setStatus replies CASE_NOT_REVERTIBLE', async () => {
    const t = setup();
    const id = seed(t, 'timeout');
    vi.spyOn(t.deps.cases, 'setStatus').mockReturnValue(false);
    expect(await run(t, 'case', 'revert', { number: id })).toBe(
      'Este caso não pode ser revertido.',
    );
    expect(t.publish).not.toHaveBeenCalled();
  });

  it('allow-domain moves the case domains to the allow list', async () => {
    const t = setup();
    t.deps.domains.set('golpe.example', 'block', null, NOW.toISOString());
    const id = seed(t, 'timeout', { domains: ['golpe.example', 'outro.example'] });
    await run(t, 'case', 'revert', { number: id, 'allow-domain': true });
    expect(t.deps.domains.isAllowed('golpe.example')).toBe(true);
    expect(t.deps.domains.isBlocked('golpe.example')).toBe(false);
    expect(t.deps.domains.isAllowed('outro.example')).toBe(true);
  });

  it('without allow-domain the lists are untouched', async () => {
    const t = setup();
    const id = seed(t, 'timeout');
    await run(t, 'case', 'revert', { number: id });
    expect(t.deps.domains.isAllowed('golpe.example')).toBe(false);
  });

  it('allow-domain with a lookalike domain is refused before any Discord call', async () => {
    const t = setup();
    const id = seed(t, 'timeout', { domains: ['golpe.example', 'discord-nitro.com'] });
    expect(await run(t, 'case', 'revert', { number: id, 'allow-domain': true })).toBe(
      'Domínios que imitam marcas protegidas não podem ser permitidos.',
    );
    expect(t.guild.calls).toHaveLength(0);
    expect(statusOf(t, id)).toBe('actioned');
    expect(t.deps.domains.isAllowed('golpe.example')).toBe(false);
    expect(t.publish).not.toHaveBeenCalled();
  });
});

describe('/mod case dismiss', () => {
  it('dismisses an open case and publishes moderation.case.dismissed', async () => {
    const t = setup();
    const id = seed(t, 'none', { status: 'open' });
    expect(await run(t, 'case', 'dismiss', { number: id })).toBe(`Caso #${String(id)} descartado.`);
    const record = t.deps.cases.get(id);
    expect(record?.status).toBe('dismissed');
    expect(record?.revertedBy).toBe(ACTOR.userId);
    expect(t.publish).toHaveBeenCalledExactlyOnceWith('moderation.case.dismissed', { caseId: id });
    expect(t.guild.calls).toHaveLength(0);
  });

  it('refuses an actioned case', async () => {
    const t = setup();
    const id = seed(t, 'timeout');
    expect(await run(t, 'case', 'dismiss', { number: id })).toBe(
      'Só casos abertos podem ser descartados.',
    );
    expect(statusOf(t, id)).toBe('actioned');
  });

  it('unknown case replies CASE_NOT_FOUND', async () => {
    const t = setup();
    expect(await run(t, 'case', 'dismiss', { number: 7 })).toBe('Caso não encontrado.');
  });
});
