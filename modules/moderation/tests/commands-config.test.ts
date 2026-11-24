import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import { createFakeGuild } from '../../../tests/helpers/fake-guild.ts';
import { createTestModuleStorage } from '../../../tests/helpers/module-storage.ts';
import { CaseStore } from '../cases.ts';
import { configSchema } from '../config.ts';
import type { ModerationConfig } from '../config.ts';
import { buildModCommand } from '../commands/mod-command.ts';
import type { ModCommandDeps } from '../commands/mod-command.ts';
import { DomainStore } from '../domains.ts';
import { createLocalOperations } from './operations-harness.ts';

const ACTOR = { userId: '111111111111111111', roleIds: ['222222222222222222'], isOwner: false };
const CHANNEL = '333333333333333333';
const ROLE_A = '444444444444444444';
const ROLE_B = '555555555555555555';

const CONFIG = 'moderation.config.manage';
const DOMAINS = 'moderation.domains.manage';
const READ = 'moderation.cases.read';
const REVERT = 'moderation.cases.revert';

const ALL_SUBCOMMANDS: readonly [string | undefined, string, string][] = [
  ['config', 'view', CONFIG],
  ['config', 'alert-channel', CONFIG],
  ['config', 'timeout', CONFIG],
  ['config', 'thresholds', CONFIG],
  ['config', 'exempt-role', CONFIG],
  ['config', 'spam-rule', CONFIG],
  ['config', 'spam-escalation', CONFIG],
  ['config', 'spam-ignore', CONFIG],
  ['domain', 'block', DOMAINS],
  ['domain', 'allow', DOMAINS],
  ['domain', 'remove', DOMAINS],
  ['domain', 'list', DOMAINS],
  ['case', 'view', READ],
  ['case', 'list', READ],
  ['case', 'revert', REVERT],
  ['case', 'dismiss', REVERT],
  [undefined, 'warn', 'moderation.actions.warn'],
  [undefined, 'timeout', 'moderation.actions.timeout'],
  [undefined, 'kick', 'moderation.actions.kick'],
  [undefined, 'ban', 'moderation.actions.ban'],
];

function setup(initial: Partial<ModerationConfig> = {}, granted = true) {
  let current = configSchema.parse(initial);
  const set = vi.fn((partial: Record<string, unknown>) => {
    const result = configSchema.safeParse({ ...current, ...partial });
    if (!result.success) {
      const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
      const error = new Error(`Invalid settings for module "moderation" at: ${paths.join(', ')}`);
      error.name = 'InvalidModuleConfigError';
      throw error;
    }
    current = result.data;
  });
  const check = vi.fn(() => granted);
  const guild = createFakeGuild();
  const ctx = createTestModuleStorage(fileURLToPath(new URL('..', import.meta.url)));
  const config = { get: <T>() => current as T, set, version: () => 0 };
  const domains = new DomainStore(ctx.storage);
  const deps: ModCommandDeps = {
    permissions: { check, isDeveloper: () => false, hasAnyGrant: () => false },
    config,
    operations: createLocalOperations(config, domains),
    guild,
    cases: new CaseStore(ctx.storage),
    domains,
    publish: vi.fn(),
  };
  return { deps, set, check, guild, command: buildModCommand(deps), current: () => current };
}

function interaction(
  group: string | undefined,
  subcommand: string,
  values: Record<string, string | number | boolean> = {},
) {
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

describe('/mod permissions', () => {
  it.each(ALL_SUBCOMMANDS)(
    '%s %s without permission replies NO_PERMISSION and has no side effects',
    async (group, subcommand, permission) => {
      const { command, deps, set, guild, check } = setup({}, false);
      const cases = vi.spyOn(deps.cases, 'create');
      const domains = vi.spyOn(deps.domains, 'set');
      const { value, reply } = interaction(group, subcommand);
      await command.handle(value);
      expect(check).toHaveBeenCalledExactlyOnceWith(ACTOR, permission);
      expect(reply).toHaveBeenCalledExactlyOnceWith('Você não tem permissão para isso.', {
        ephemeral: true,
      });
      expect(set).not.toHaveBeenCalled();
      expect(guild.calls).toHaveLength(0);
      expect(cases).not.toHaveBeenCalled();
      expect(domains).not.toHaveBeenCalled();
    },
  );

  it('covers every route declared in the definition', () => {
    const { command } = setup();
    const declared = [
      ...(command.groups ?? []).flatMap((g) => g.subcommands.map((s) => [g.name, s.name])),
      ...(command.subcommands ?? []).map((s) => [undefined, s.name]),
    ];
    expect(declared).toHaveLength(ALL_SUBCOMMANDS.length);
    expect(declared).toEqual(
      expect.arrayContaining(ALL_SUBCOMMANDS.map(([group, subcommand]) => [group, subcommand])),
    );
  });
});

describe('/mod config', () => {
  it('view shows current values', async () => {
    const { command } = setup({
      alertChannelId: CHANNEL,
      timeoutMinutes: 30,
      thresholds: { confirmed: 90, suspicious: 50 },
      exemptRoleIds: [ROLE_A, ROLE_B],
    });
    const { value, reply } = interaction('config', 'view');
    await command.handle(value);
    const text = reply.mock.calls[0]?.[0] ?? '';
    expect(text).toContain(`<#${CHANNEL}>`);
    expect(text).toContain('30 minutos');
    expect(text).toContain('confirmado 90');
    expect(text).toContain('suspeito 50');
    expect(text).toContain(`<@&${ROLE_A}>, <@&${ROLE_B}>`);
    expect(reply.mock.calls[0]?.[1]).toEqual({ ephemeral: true });
  });

  it('view shows placeholders when unset', async () => {
    const { command } = setup();
    const { value, reply } = interaction('config', 'view');
    await command.handle(value);
    const text = reply.mock.calls[0]?.[0] ?? '';
    expect(text).toContain('não configurado');
    expect(text).toContain('nenhum');
  });

  it('alert-channel sets alertChannelId', async () => {
    const { command, set } = setup();
    const { value, reply } = interaction('config', 'alert-channel', { channel: CHANNEL });
    await command.handle(value);
    expect(set).toHaveBeenCalledWith({ alertChannelId: CHANNEL }, 0);
    expect(reply).toHaveBeenCalledWith('Configuração atualizada.', { ephemeral: true });
  });

  it('timeout sets timeoutMinutes', async () => {
    const { command, set } = setup();
    const { value, reply } = interaction('config', 'timeout', { minutes: 120 });
    await command.handle(value);
    expect(set).toHaveBeenCalledWith({ timeoutMinutes: 120 }, 0);
    expect(reply).toHaveBeenCalledWith('Configuração atualizada.', { ephemeral: true });
  });

  it('thresholds sets the complete object', async () => {
    const { command, set } = setup();
    const { value } = interaction('config', 'thresholds', { confirmed: 90, suspicious: 30 });
    await command.handle(value);
    expect(set).toHaveBeenCalledWith({ thresholds: { confirmed: 90, suspicious: 30 } }, 0);
  });

  it('thresholds 40 40 replies CONFIG_INVALID naming thresholds', async () => {
    const { command, current } = setup();
    const { value, reply } = interaction('config', 'thresholds', { confirmed: 40, suspicious: 40 });
    await command.handle(value);
    expect(reply).toHaveBeenCalledWith('Configuração inválida: thresholds.', { ephemeral: true });
    expect(current().thresholds).toEqual({ confirmed: 80, suspicious: 40 });
  });

  it('exempt-role add is idempotent and remove tolerates absent roles', async () => {
    const { command, set } = setup({ exemptRoleIds: [ROLE_A] });
    const add = interaction('config', 'exempt-role', { role: ROLE_A, action: 'add' });
    await command.handle(add.value);
    expect(set).toHaveBeenLastCalledWith({ exemptRoleIds: [ROLE_A] }, 0);
    const add2 = interaction('config', 'exempt-role', { role: ROLE_B, action: 'add' });
    await command.handle(add2.value);
    expect(set).toHaveBeenLastCalledWith({ exemptRoleIds: [ROLE_A, ROLE_B] }, 0);
    const remove = interaction('config', 'exempt-role', { role: ROLE_A, action: 'remove' });
    await command.handle(remove.value);
    expect(set).toHaveBeenLastCalledWith({ exemptRoleIds: [ROLE_B] }, 0);
    const absent = interaction('config', 'exempt-role', { role: ROLE_A, action: 'remove' });
    await command.handle(absent.value);
    expect(absent.reply).toHaveBeenCalledWith('Configuração atualizada.', { ephemeral: true });
  });

  it('view shows the spam summary within 2000 characters', async () => {
    const { command } = setup();
    const { value, reply } = interaction('config', 'view');
    await command.handle(value);
    const text = reply.mock.calls[0]?.[0] ?? '';
    expect(text).toContain('flood ligada');
    expect(text).toContain('limite 7');
    expect(text).toContain('janela 5 s');
    expect(text).toContain('timeout 10 min');
    expect(text).toContain('mentions ligada');
    expect(text).toContain('Reincidência: ligada, janela 24 h, degraus 10m,1h,ban');
    expect(text).toContain('Canais ignorados (spam): nenhum');
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  it('view truncates a long ignored-channel list to stay within 2000 characters', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => String(100000000000000000 + i));
    const { command, deps } = setup();
    const full = {
      ...configSchema.parse({}),
      spam: { ...configSchema.parse({}).spam, ignoredChannelIds: ids },
    };
    // The schema caps the list at 25, so bypass it to exercise the defensive truncation.
    (deps.config as { get: unknown }).get = () => full;
    const { value, reply } = interaction('config', 'view');
    await command.handle(value);
    const text = reply.mock.calls[0]?.[0] ?? '';
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/… \(\+\d+\)/);
  });

  it('replies the conflict text when the settings changed in between', async () => {
    const { command, set } = setup();
    set.mockImplementation(() => {
      const error = new Error('stale');
      error.name = 'ConfigVersionConflictError';
      throw error;
    });
    const { value, reply } = interaction('config', 'timeout', { minutes: 5 });
    await command.handle(value);
    expect(reply).toHaveBeenCalledExactlyOnceWith(
      'Outra pessoa alterou esta configuração. Recarregue para ver a versão atual.',
      { ephemeral: true },
    );
  });

  it('rethrows unexpected errors from config.set', async () => {
    const { command, set } = setup();
    set.mockImplementation(() => {
      throw new Error('boom');
    });
    const { value } = interaction('config', 'timeout', { minutes: 5 });
    await expect(command.handle(value)).rejects.toThrow('boom');
  });
});

describe('/mod config spam-*', () => {
  const UPDATED = ['Configuração atualizada.', { ephemeral: true }] as const;

  it('spam-rule changes only the provided fields of one rule', async () => {
    const { command, set, current } = setup();
    const before = current().spam;
    const { value, reply } = interaction('config', 'spam-rule', { rule: 'flood', limit: 10 });
    await command.handle(value);
    expect(set).toHaveBeenCalledTimes(1);
    expect(current().spam).toEqual({ ...before, flood: { ...before.flood, limit: 10 } });
    expect(reply).toHaveBeenCalledWith(...UPDATED);
  });

  it('spam-rule applies every provided field', async () => {
    const { command, current } = setup();
    const { value } = interaction('config', 'spam-rule', {
      rule: 'repeat',
      enabled: false,
      limit: 5,
      seconds: 30,
      'delete-minutes': 3,
      punishment: 'kick',
      'timeout-minutes': 90,
    });
    await command.handle(value);
    expect(current().spam.repeat).toEqual({
      enabled: false,
      limit: 5,
      seconds: 30,
      deleteMinutes: 3,
      punishment: 'kick',
      timeoutMinutes: 90,
    });
  });

  it('spam-rule mentions with seconds is INVALID_OPTION and writes nothing', async () => {
    const { command, set } = setup();
    const { value, reply } = interaction('config', 'spam-rule', { rule: 'mentions', seconds: 5 });
    await command.handle(value);
    expect(reply).toHaveBeenCalledWith('Opção inválida: seconds.', { ephemeral: true });
    expect(set).not.toHaveBeenCalled();
  });

  it('spam-rule without optional options replies updated and writes nothing', async () => {
    const { command, set } = setup();
    const { value, reply } = interaction('config', 'spam-rule', { rule: 'flood' });
    await command.handle(value);
    expect(reply).toHaveBeenCalledWith(...UPDATED);
    expect(set).not.toHaveBeenCalled();
  });

  it('spam-rule reports CONFIG_INVALID when the Core rejects the value', async () => {
    const { command, set } = setup();
    set.mockImplementation(() => {
      const error = new Error('Invalid settings for module "moderation" at: spam.flood.limit');
      error.name = 'InvalidModuleConfigError';
      throw error;
    });
    const { value, reply } = interaction('config', 'spam-rule', { rule: 'flood', limit: 10 });
    await command.handle(value);
    expect(reply).toHaveBeenCalledWith('Configuração inválida: spam.flood.limit.', {
      ephemeral: true,
    });
  });

  it('spam-escalation writes the parsed steps and keeps the rest', async () => {
    const { command, current } = setup();
    const { value } = interaction('config', 'spam-escalation', {
      steps: '10m,1h,ban',
      'window-hours': 48,
      enabled: false,
    });
    await command.handle(value);
    expect(current().spam.escalation).toEqual({
      enabled: false,
      windowHours: 48,
      steps: [{ kind: 'timeout', minutes: 10 }, { kind: 'timeout', minutes: 60 }, { kind: 'ban' }],
    });
  });

  it('spam-escalation with invalid steps replies CONFIG_INVALID and writes nothing', async () => {
    const { command, set } = setup();
    const { value, reply } = interaction('config', 'spam-escalation', { steps: 'abc' });
    await command.handle(value);
    expect(reply).toHaveBeenCalledWith('Configuração inválida: steps.', { ephemeral: true });
    expect(set).not.toHaveBeenCalled();
  });

  it('spam-ignore add is idempotent and remove tolerates absent channels', async () => {
    const { command, current } = setup();
    const run = async (action: string) => {
      const call = interaction('config', 'spam-ignore', { channel: CHANNEL, action });
      await command.handle(call.value);
      return call.reply;
    };
    await run('add');
    await run('add');
    expect(current().spam.ignoredChannelIds).toEqual([CHANNEL]);
    await run('remove');
    expect(current().spam.ignoredChannelIds).toEqual([]);
    expect(await run('remove')).toHaveBeenCalledWith(...UPDATED);
  });
});
