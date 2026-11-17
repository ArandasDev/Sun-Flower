import { describe, expect, it } from 'vitest';

import type { GuildActionResult, GuildActions } from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { Capability, ModuleManifest } from '../../shared/contracts/module.ts';
import { CapabilityError, UNAVAILABLE_GUILD, createModuleGuild } from './module-guild.ts';

const dev = '000000000000000000';
const target = '111111111111111111';
const channel = '222222222222222222';
const message = '333333333333333333';

interface LogEntry {
  level: string;
  obj: unknown;
  msg: string | undefined;
}

function fakeLogger(entries: LogEntry[]): Logger {
  const at =
    (level: string) =>
    (obj: object | string, msg?: string): void => {
      entries.push({ level, obj, msg });
    };
  const logger: Logger = {
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: () => logger,
  };
  return logger;
}

function setup(capabilities: Capability[], portOverride?: Partial<GuildActions>) {
  const calls: { name: string; args: unknown[] }[] = [];
  const ok: GuildActionResult = { ok: true };
  const record =
    (name: string, result: unknown = ok) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    };
  const port = {
    deleteMessage: record('deleteMessage'),
    timeout: record('timeout'),
    removeTimeout: record('removeTimeout'),
    kick: record('kick'),
    ban: record('ban'),
    unban: record('unban'),
    sendMessage: record('sendMessage'),
    sendDirectMessage: record('sendDirectMessage'),
    getMemberRoleIds: record('getMemberRoleIds', [channel]),
    ...portOverride,
  } as GuildActions;
  const entries: LogEntry[] = [];
  const manifest = { id: 'moderation', capabilities } as unknown as ModuleManifest;
  const guild = createModuleGuild({
    manifest,
    port,
    isDeveloper: (id) => id === dev,
    logger: fakeLogger(entries),
  });
  return { guild, calls, entries };
}

describe('createModuleGuild', () => {
  it('refuses moderation actions without guild.moderate and warns', async () => {
    const { guild, calls, entries } = setup([]);
    await expect(guild.timeout(target, 60_000, 'r')).rejects.toBeInstanceOf(CapabilityError);
    expect(calls).toHaveLength(0);
    expect(entries).toEqual([
      {
        level: 'warn',
        obj: { module: 'moderation', action: 'timeout' },
        msg: 'guild action refused: missing capability',
      },
    ]);
  });

  it('refuses sendMessage without guild.message', async () => {
    const { guild } = setup([]);
    await expect(guild.sendMessage(channel, 'x')).rejects.toBeInstanceOf(CapabilityError);
  });

  it('keeps capabilities separate', async () => {
    const moderate = setup(['guild.moderate']);
    await expect(moderate.guild.sendMessage(channel, 'x')).rejects.toBeInstanceOf(CapabilityError);
    const messaging = setup(['guild.message']);
    await expect(messaging.guild.deleteMessage(channel, message)).rejects.toBeInstanceOf(
      CapabilityError,
    );
    await expect(messaging.guild.sendMessage(channel, 'x')).resolves.toEqual({ ok: true });
  });

  it('requires guild.moderate for getMemberRoleIds without logging', async () => {
    const denied = setup([]);
    await expect(denied.guild.getMemberRoleIds(target)).rejects.toBeInstanceOf(CapabilityError);
    const allowed = setup(['guild.moderate']);
    await expect(allowed.guild.getMemberRoleIds(target)).resolves.toEqual([channel]);
    expect(allowed.entries).toHaveLength(0);
  });

  it.each(['timeout', 'kick', 'ban'] as const)('refuses %s against a developer', async (action) => {
    const { guild, calls, entries } = setup(['guild.moderate']);
    const result =
      action === 'timeout'
        ? await guild.timeout(dev, 60_000, 'r')
        : action === 'kick'
          ? await guild.kick(dev, 'r')
          : await guild.ban(dev, 'r', 0);
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(entries)).not.toContain(dev);
  });

  it('rejects out-of-range or non-integer values without calling the port', async () => {
    const { guild, calls } = setup(['guild.moderate']);
    const failed = { ok: false, error: 'failed' };
    expect(await guild.timeout(target, 59_999, 'r')).toEqual(failed);
    expect(await guild.timeout(target, 2_419_200_001, 'r')).toEqual(failed);
    expect(await guild.timeout(target, 60_000.5, 'r')).toEqual(failed);
    expect(await guild.timeout(target, Number.NaN, 'r')).toEqual(failed);
    expect(await guild.ban(target, 'r', 604_801)).toEqual(failed);
    expect(await guild.ban(target, 'r', -1)).toEqual(failed);
    expect(await guild.ban(target, 'r', 1.5)).toEqual(failed);
    expect(calls).toHaveLength(0);
  });

  it('accepts the range boundaries', async () => {
    const { guild, calls } = setup(['guild.moderate']);
    expect(await guild.timeout(target, 60_000, 'r')).toEqual({ ok: true });
    expect(await guild.timeout(target, 2_419_200_000, 'r')).toEqual({ ok: true });
    expect(await guild.ban(target, 'r', 0)).toEqual({ ok: true });
    expect(await guild.ban(target, 'r', 604_800)).toEqual({ ok: true });
    expect(calls).toHaveLength(4);
  });

  it('truncates the reason to 512 characters', async () => {
    const { guild, calls, entries } = setup(['guild.moderate']);
    await guild.kick(target, 'a'.repeat(600));
    expect(calls[0]?.args).toEqual([target, 'a'.repeat(512)]);
    expect(entries[0]?.obj).toMatchObject({ reason: 'a'.repeat(512) });
  });

  it('logs executed actions without identifiers', async () => {
    const { guild, entries } = setup(['guild.moderate', 'guild.message']);
    await guild.timeout(target, 60_000, 'spam');
    await guild.deleteMessage(channel, message);
    await guild.sendMessage(channel, 'secret content');
    expect(entries[0]).toEqual({
      level: 'info',
      obj: { module: 'moderation', action: 'timeout', reason: 'spam', result: 'ok' },
      msg: 'guild action executed',
    });
    expect(entries[1]?.obj).toEqual({
      module: 'moderation',
      action: 'deleteMessage',
      result: 'ok',
    });
    const text = JSON.stringify(entries);
    for (const secret of [target, channel, message, 'secret content']) {
      expect(text).not.toContain(secret);
    }
  });

  it('logs the error result of the port', async () => {
    const { guild, entries } = setup(['guild.moderate'], {
      unban: () => Promise.resolve({ ok: false, error: 'not_found' }),
    });
    expect(await guild.unban(target)).toEqual({ ok: false, error: 'not_found' });
    expect(entries[0]?.obj).toMatchObject({ action: 'unban', result: 'not_found' });
  });

  it('converts a throwing port into failed and logs an error', async () => {
    const { guild, entries } = setup(['guild.moderate'], {
      removeTimeout: () => Promise.reject(new Error('boom ' + target)),
    });
    expect(await guild.removeTimeout(target)).toEqual({ ok: false, error: 'failed' });
    expect(entries).toEqual([
      {
        level: 'error',
        obj: { module: 'moderation', action: 'removeTimeout' },
        msg: 'guild action failed unexpectedly',
      },
    ]);
  });
});

describe('UNAVAILABLE_GUILD', () => {
  it('fails every action', async () => {
    expect(await UNAVAILABLE_GUILD.kick(target, 'r')).toEqual({ ok: false, error: 'failed' });
    expect(await UNAVAILABLE_GUILD.sendMessage(channel, 'x')).toEqual({
      ok: false,
      error: 'failed',
    });
    expect(await UNAVAILABLE_GUILD.getMemberRoleIds(target)).toBeUndefined();
  });
});
