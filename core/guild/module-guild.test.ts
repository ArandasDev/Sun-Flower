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

function setup(
  capabilities: Capability[],
  portOverride?: Partial<GuildActions>,
  isActive?: () => boolean,
) {
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
    bulkDeleteMessages: record('bulkDeleteMessages', { ok: true, deleted: 2, individually: 1 }),
    getMemberRoleIds: record('getMemberRoleIds', [channel]),
    ...portOverride,
  } as GuildActions;
  const entries: LogEntry[] = [];
  const manifest = { id: 'moderation', capabilities } as unknown as ModuleManifest;
  const guild = createModuleGuild({
    manifest,
    port,
    isDeveloper: (id) => id === dev,
    isActive: isActive ?? (() => true),
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

  it('masks snowflakes in the logged reason but sends the original to the port', async () => {
    const { guild, calls, entries } = setup(['guild.moderate']);
    const reason = `golpe contra <@${dev}> e 12345678901234567890 (id 1234567890123456)`;
    await guild.ban(target, reason, 0);
    await guild.timeout(target, 60_000, reason);
    await guild.kick(target, reason);
    const masked = 'golpe contra <@[id]> e [id] (id 1234567890123456)';
    for (const index of [0, 1, 2]) {
      expect(calls[index]?.args).toContain(reason);
      expect(entries[index]?.obj).toMatchObject({ reason: masked });
    }
    expect(JSON.stringify(entries)).not.toContain(dev);
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

  it('passes a null getMemberRoleIds (not a member) through unchanged', async () => {
    const { guild, entries } = setup(['guild.moderate'], {
      getMemberRoleIds: () => Promise.resolve(null),
    });
    expect(await guild.getMemberRoleIds(target)).toBeNull();
    expect(entries).toHaveLength(0);
  });

  it('converts a throwing getMemberRoleIds into undefined and logs an error', async () => {
    const { guild, entries } = setup(['guild.moderate'], {
      getMemberRoleIds: () => Promise.reject(new Error('boom ' + target)),
    });
    expect(await guild.getMemberRoleIds(target)).toBeUndefined();
    expect(entries).toEqual([
      {
        level: 'error',
        obj: { module: 'moderation', action: 'getMemberRoleIds' },
        msg: 'guild action failed unexpectedly',
      },
    ]);
  });

  it('refuses every action without calling the port while the module is inactive', async () => {
    const { guild, calls, entries } = setup(
      ['guild.moderate', 'guild.message'],
      undefined,
      () => false,
    );
    const failed = { ok: false, error: 'failed' };
    expect(await guild.deleteMessage(channel, message)).toEqual(failed);
    expect(await guild.timeout(target, 60_000, 'r')).toEqual(failed);
    expect(await guild.removeTimeout(target)).toEqual(failed);
    expect(await guild.kick(target, 'r')).toEqual(failed);
    expect(await guild.ban(target, 'r', 0)).toEqual(failed);
    expect(await guild.unban(target)).toEqual(failed);
    expect(await guild.sendMessage(channel, 'x')).toEqual(failed);
    expect(await guild.sendDirectMessage(target, 'x')).toEqual(failed);
    expect(await guild.getMemberRoleIds(target)).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(entries).toHaveLength(9);
    expect(entries[0]).toEqual({
      level: 'warn',
      obj: { module: 'moderation', action: 'deleteMessage' },
      msg: 'guild action refused: module is not active',
    });
    expect(entries.every((entry) => entry.level === 'warn')).toBe(true);
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
    expect(await UNAVAILABLE_GUILD.bulkDeleteMessages(channel, [message])).toEqual({
      ok: false,
      error: 'failed',
      deleted: 0,
    });
  });
});

describe('createModuleGuild bulkDeleteMessages', () => {
  const ids = ['333333333333333333', '444444444444444444'];
  const failed = { ok: false, error: 'failed', deleted: 0 };

  it('throws CapabilityError without guild.moderate', async () => {
    const { guild, calls } = setup([]);
    await expect(guild.bulkDeleteMessages(channel, ids)).rejects.toBeInstanceOf(CapabilityError);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['an empty list', []],
    [
      '101 unique ids',
      Array.from({ length: 101 }, (_, i) => String(100_000_000_000_000_000n + BigInt(i))),
    ],
    ['a malformed id', ['333333333333333333', 'abc']],
  ])('refuses %s without calling the port', async (_name, list) => {
    const { guild, calls } = setup(['guild.moderate']);
    await expect(guild.bulkDeleteMessages(channel, list)).resolves.toEqual(failed);
    expect(calls).toHaveLength(0);
  });

  it('dedupes ids keeping the first occurrence order', async () => {
    const { guild, calls } = setup(['guild.moderate']);
    const a = '333333333333333333';
    const b = '444444444444444444';
    await guild.bulkDeleteMessages(channel, [b, a, b, a]);
    expect(calls).toEqual([{ name: 'bulkDeleteMessages', args: [channel, [b, a]] }]);
  });

  it('counts unique ids against the limit of 100', async () => {
    const { guild, calls } = setup(['guild.moderate']);
    const list = Array.from({ length: 100 }, (_, i) =>
      String(100_000_000_000_000_000n + BigInt(i)),
    );
    await guild.bulkDeleteMessages(channel, [...list, ...list]);
    expect(calls).toHaveLength(1);
  });

  it('refuses without calling the port when the module is inactive', async () => {
    const { guild, calls } = setup(['guild.moderate'], undefined, () => false);
    await expect(guild.bulkDeleteMessages(channel, ids)).resolves.toEqual(failed);
    expect(calls).toHaveLength(0);
  });

  it('turns a throwing port into a failed result', async () => {
    const { guild } = setup(['guild.moderate'], {
      bulkDeleteMessages: () => Promise.reject(new Error('boom')),
    });
    await expect(guild.bulkDeleteMessages(channel, ids)).resolves.toEqual(failed);
  });

  it('logs the throw path with only module and action', async () => {
    const { guild, entries } = setup(['guild.moderate'], {
      bulkDeleteMessages: () => Promise.reject(new Error(`boom ${ids.join(' ')}`)),
    });
    await guild.bulkDeleteMessages(channel, ids);
    const errors = entries.filter((entry) => entry.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toEqual({ module: 'moderation', action: 'bulkDeleteMessages' });
    expect(JSON.stringify(entries)).not.toMatch(/\d{17,20}/);
  });

  it('returns the port result and logs counts without ids', async () => {
    const { guild, entries } = setup(['guild.moderate']);
    await expect(guild.bulkDeleteMessages(channel, [...ids, ids[0] ?? ''])).resolves.toEqual({
      ok: true,
      deleted: 2,
      individually: 1,
    });
    expect(entries).toEqual([
      {
        level: 'info',
        obj: {
          module: 'moderation',
          action: 'bulkDeleteMessages',
          requested: 2,
          deleted: 2,
          individually: 1,
          result: 'ok',
        },
        msg: 'guild action executed',
      },
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/\d{17,20}/);
  });
});
