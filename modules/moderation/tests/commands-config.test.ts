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

const ACTOR = { userId: '111111111111111111', roleIds: ['222222222222222222'] };
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
  const deps: ModCommandDeps = {
    permissions: { check, isDeveloper: () => false, hasAnyGrant: () => false },
    config: { get: <T>() => current as T, set },
    guild,
    cases: new CaseStore(ctx.storage),
    domains: new DomainStore(ctx.storage),
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
    expect(set).toHaveBeenCalledWith({ alertChannelId: CHANNEL });
    expect(reply).toHaveBeenCalledWith('Configuração atualizada.', { ephemeral: true });
  });

  it('timeout sets timeoutMinutes', async () => {
    const { command, set } = setup();
    const { value, reply } = interaction('config', 'timeout', { minutes: 120 });
    await command.handle(value);
    expect(set).toHaveBeenCalledWith({ timeoutMinutes: 120 });
    expect(reply).toHaveBeenCalledWith('Configuração atualizada.', { ephemeral: true });
  });

  it('thresholds sets the complete object', async () => {
    const { command, set } = setup();
    const { value } = interaction('config', 'thresholds', { confirmed: 90, suspicious: 30 });
    await command.handle(value);
    expect(set).toHaveBeenCalledWith({ thresholds: { confirmed: 90, suspicious: 30 } });
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
    expect(set).toHaveBeenLastCalledWith({ exemptRoleIds: [ROLE_A] });
    const add2 = interaction('config', 'exempt-role', { role: ROLE_B, action: 'add' });
    await command.handle(add2.value);
    expect(set).toHaveBeenLastCalledWith({ exemptRoleIds: [ROLE_A, ROLE_B] });
    const remove = interaction('config', 'exempt-role', { role: ROLE_A, action: 'remove' });
    await command.handle(remove.value);
    expect(set).toHaveBeenLastCalledWith({ exemptRoleIds: [ROLE_B] });
    const absent = interaction('config', 'exempt-role', { role: ROLE_A, action: 'remove' });
    await command.handle(absent.value);
    expect(absent.reply).toHaveBeenCalledWith('Configuração atualizada.', { ephemeral: true });
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
