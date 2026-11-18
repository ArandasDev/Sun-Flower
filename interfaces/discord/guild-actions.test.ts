import { describe, expect, it, vi } from 'vitest';

import type { Client } from 'discord.js';

import { createDiscordGateway, createGuildActions, type GuildGateway } from './guild-actions.ts';

const BOT = '000000000000000000';
const USER = '111111111111111111';
const CHANNEL = '222222222222222222';

function fakeGateway(overrides: Partial<GuildGateway> = {}): GuildGateway {
  return {
    botUserId: () => BOT,
    deleteMessage: vi.fn(() => Promise.resolve()),
    bulkDelete: vi.fn((_channelId: string, ids: readonly string[]) => Promise.resolve([...ids])),
    setTimeout: vi.fn(() => Promise.resolve()),
    kick: vi.fn(() => Promise.resolve()),
    ban: vi.fn(() => Promise.resolve()),
    unban: vi.fn(() => Promise.resolve()),
    send: vi.fn(() => Promise.resolve()),
    sendDirect: vi.fn(() => Promise.resolve()),
    memberRoleIds: vi.fn(() => Promise.resolve(['333333333333333333'])),
    ...overrides,
  };
}

function discordError(code: number): Error {
  return Object.assign(new Error('secret detail'), { code });
}

describe('createGuildActions', () => {
  it('returns ok when the gateway succeeds', async () => {
    const actions = createGuildActions(fakeGateway());
    expect(await actions.deleteMessage(CHANNEL, USER)).toEqual({ ok: true });
  });

  it('maps 50013 to forbidden', async () => {
    const gateway = fakeGateway({ kick: () => Promise.reject(discordError(50013)) });
    expect(await createGuildActions(gateway).kick(USER, 'r')).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it.each([10003, 10007, 10008, 10013, 10026])('maps %i to not_found', async (code) => {
    const gateway = fakeGateway({ unban: () => Promise.reject(discordError(code)) });
    expect(await createGuildActions(gateway).unban(USER)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('maps other errors and a missing guild to failed without the message', async () => {
    const other = fakeGateway({ send: () => Promise.reject(discordError(99999)) });
    const result = await createGuildActions(other).sendMessage(CHANNEL, 'x');
    expect(result).toEqual({ ok: false, error: 'failed' });
    expect(JSON.stringify(result)).not.toContain('secret');

    const noGuild = fakeGateway({
      sendDirect: () => Promise.reject(new Error('guild unavailable')),
    });
    expect(await createGuildActions(noGuild).sendDirectMessage(USER, 'x')).toEqual({
      ok: false,
      error: 'failed',
    });
  });

  it('fails a call that does not finish within callTimeoutMs', async () => {
    const gateway = fakeGateway({ deleteMessage: () => new Promise<void>(() => undefined) });
    const actions = createGuildActions(gateway, { callTimeoutMs: 20 });
    expect(await actions.deleteMessage(CHANNEL, USER)).toEqual({ ok: false, error: 'failed' });
  });

  it('refuses timeout, kick and ban against the bot without calling the gateway', async () => {
    const setTimeoutSpy = vi.fn(() => Promise.resolve());
    const kickSpy = vi.fn(() => Promise.resolve());
    const banSpy = vi.fn(() => Promise.resolve());
    const actions = createGuildActions(
      fakeGateway({ setTimeout: setTimeoutSpy, kick: kickSpy, ban: banSpy }),
    );
    const forbidden = { ok: false, error: 'forbidden' };
    expect(await actions.timeout(BOT, 1000, 'r')).toEqual(forbidden);
    expect(await actions.kick(BOT, 'r')).toEqual(forbidden);
    expect(await actions.ban(BOT, 'r', 0)).toEqual(forbidden);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(kickSpy).not.toHaveBeenCalled();
    expect(banSpy).not.toHaveBeenCalled();
  });

  it('refuses a direct message to the bot without calling the gateway', async () => {
    const sendDirectSpy = vi.fn(() => Promise.resolve());
    const actions = createGuildActions(fakeGateway({ sendDirect: sendDirectSpy }));
    expect(await actions.sendDirectMessage(BOT, 'x')).toEqual({ ok: false, error: 'forbidden' });
    expect(sendDirectSpy).not.toHaveBeenCalled();
    expect(await actions.sendDirectMessage(USER, 'x')).toEqual({ ok: true });
    expect(sendDirectSpy).toHaveBeenCalledExactlyOnceWith(USER, 'x');
  });

  it('removeTimeout calls setTimeout with null', async () => {
    const setTimeoutSpy = vi.fn(() => Promise.resolve());
    await createGuildActions(fakeGateway({ setTimeout: setTimeoutSpy })).removeTimeout(USER);
    expect(setTimeoutSpy).toHaveBeenCalledWith(USER, null);
  });

  it('getMemberRoleIds returns roles, passes null through and gives undefined on failure', async () => {
    expect(await createGuildActions(fakeGateway()).getMemberRoleIds(USER)).toEqual([
      '333333333333333333',
    ]);
    const notMember = fakeGateway({ memberRoleIds: () => Promise.resolve(null) });
    expect(await createGuildActions(notMember).getMemberRoleIds(USER)).toBeNull();
    const failing = fakeGateway({ memberRoleIds: () => Promise.reject(discordError(50013)) });
    expect(await createGuildActions(failing).getMemberRoleIds(USER)).toBeUndefined();
  });

  it('getMemberRoleIds returns undefined when the lookup times out', async () => {
    const hanging = fakeGateway({ memberRoleIds: () => new Promise<never>(() => undefined) });
    const actions = createGuildActions(hanging, { callTimeoutMs: 20 });
    expect(await actions.getMemberRoleIds(USER)).toBeUndefined();
  });

  it('passes reason and deleteMessageSeconds to the gateway unchanged', async () => {
    const setTimeoutSpy = vi.fn(() => Promise.resolve());
    const kickSpy = vi.fn(() => Promise.resolve());
    const banSpy = vi.fn(() => Promise.resolve());
    const actions = createGuildActions(
      fakeGateway({ setTimeout: setTimeoutSpy, kick: kickSpy, ban: banSpy }),
    );
    await actions.timeout(USER, 60_000, 'spam');
    await actions.kick(USER, 'raid');
    await actions.ban(USER, 'phishing', 3600);
    expect(setTimeoutSpy).toHaveBeenCalledWith(USER, 60_000, 'spam');
    expect(kickSpy).toHaveBeenCalledWith(USER, 'raid');
    expect(banSpy).toHaveBeenCalledWith(USER, 'phishing', 3600);
  });

  it('maps a non-numeric error code to failed', async () => {
    const error = Object.assign(new Error('x'), { code: 'GuildChannelUnowned' });
    const gateway = fakeGateway({ send: () => Promise.reject(error) });
    expect(await createGuildActions(gateway).sendMessage(CHANNEL, 'x')).toEqual({
      ok: false,
      error: 'failed',
    });
  });
});

describe('createGuildActions bulkDeleteMessages', () => {
  const ids = ['1', '2', '3', '4', '5'];

  it('deletes the leftovers one by one after a partial bulk', async () => {
    const deleteMessage = vi.fn(() => Promise.resolve());
    const gateway = fakeGateway({
      bulkDelete: () => Promise.resolve(['1', '2', '3']),
      deleteMessage,
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ids)).toEqual({
      ok: true,
      deleted: 5,
      individually: 2,
    });
    expect(deleteMessage).toHaveBeenCalledTimes(2);
    expect(deleteMessage).toHaveBeenCalledWith(CHANNEL, '4');
    expect(deleteMessage).toHaveBeenCalledWith(CHANNEL, '5');
  });

  it('falls back to one by one when the bulk call fails', async () => {
    const deleteMessage = vi.fn(() => Promise.resolve());
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(500)),
      deleteMessage,
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ids)).toEqual({
      ok: true,
      deleted: 5,
      individually: 5,
    });
    expect(deleteMessage).toHaveBeenCalledTimes(5);
  });

  it('returns forbidden without individual deletions when the bulk call is forbidden', async () => {
    const deleteMessage = vi.fn(() => Promise.resolve());
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(50013)),
      deleteMessage,
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ids)).toEqual({
      ok: false,
      error: 'forbidden',
      deleted: 0,
    });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('returns not_found without fallback when the channel is unknown', async () => {
    const deleteMessage = vi.fn(() => Promise.resolve());
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(10003)),
      deleteMessage,
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ids)).toEqual({
      ok: false,
      error: 'not_found',
      deleted: 0,
    });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('does not call bulkDelete for a single ID', async () => {
    const bulkDelete = vi.fn(() => Promise.resolve([] as string[]));
    const gateway = fakeGateway({ bulkDelete });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ['1'])).toEqual({
      ok: true,
      deleted: 1,
      individually: 1,
    });
    expect(bulkDelete).not.toHaveBeenCalled();
  });

  it('counts an individual not_found as deleted but not as individually', async () => {
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(500)),
      deleteMessage: (_c, id) =>
        id === '2' ? Promise.reject(discordError(10008)) : Promise.resolve(),
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ['1', '2'])).toEqual({
      ok: true,
      deleted: 2,
      individually: 1,
    });
  });

  it('returns forbidden when the first individual deletion is forbidden', async () => {
    const deleteMessage = vi.fn(() => Promise.reject(discordError(50013)));
    const gateway = fakeGateway({ deleteMessage });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ['1'])).toEqual({
      ok: false,
      error: 'forbidden',
      deleted: 0,
    });
  });

  it('stops on forbidden but reports what was deleted so far', async () => {
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(500)),
      deleteMessage: (_c, id) =>
        id === '2' ? Promise.reject(discordError(50013)) : Promise.resolve(),
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ['1', '2', '3'])).toEqual({
      ok: true,
      deleted: 1,
      individually: 1,
    });
  });

  it('returns failed when every individual deletion fails', async () => {
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(500)),
      deleteMessage: () => Promise.reject(discordError(500)),
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ['1', '2'])).toEqual({
      ok: false,
      error: 'failed',
      deleted: 0,
    });
  });

  it('stops the fallback after 3 consecutive failures', async () => {
    const deleteMessage = vi.fn(() => Promise.reject(discordError(500)));
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(500)),
      deleteMessage,
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ids)).toEqual({
      ok: false,
      error: 'failed',
      deleted: 0,
    });
    expect(deleteMessage).toHaveBeenCalledTimes(3);
  });

  it('keeps going when failures are not consecutive', async () => {
    const failing = new Set(['2', '4']);
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(500)),
      deleteMessage: (_c, id) =>
        failing.has(id) ? Promise.reject(discordError(500)) : Promise.resolve(),
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ids)).toEqual({
      ok: true,
      deleted: 3,
      individually: 3,
    });
  });

  it('returns what was deleted when the breaker trips after some deletions', async () => {
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(500)),
      deleteMessage: (_c, id) =>
        id === '1' ? Promise.resolve() : Promise.reject(discordError(500)),
    });
    expect(
      await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ['1', '2', '3', '4', '5']),
    ).toEqual({ ok: true, deleted: 1, individually: 1 });
  });

  it.each([50001, 50083])('does not fall back when the bulk call fails with %i', async (code) => {
    const deleteMessage = vi.fn(() => Promise.resolve());
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(code)),
      deleteMessage,
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ids)).toEqual({
      ok: false,
      error: 'forbidden',
      deleted: 0,
    });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('stops the fallback on an archived thread', async () => {
    const deleteMessage = vi.fn(() => Promise.reject(discordError(50083)));
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(500)),
      deleteMessage,
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ids)).toEqual({
      ok: false,
      error: 'forbidden',
      deleted: 0,
    });
    expect(deleteMessage).toHaveBeenCalledTimes(1);
  });

  it('returns not_found for a single ID in an unknown channel', async () => {
    const gateway = fakeGateway({ deleteMessage: () => Promise.reject(discordError(10003)) });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ['1'])).toEqual({
      ok: false,
      error: 'not_found',
      deleted: 0,
    });
  });

  it('stops the fallback on an unknown channel and keeps the counts', async () => {
    const deleteMessage = vi.fn((_c: string, id: string) =>
      id === '2' ? Promise.reject(discordError(10003)) : Promise.resolve(),
    );
    const gateway = fakeGateway({
      bulkDelete: () => Promise.reject(discordError(500)),
      deleteMessage,
    });
    expect(await createGuildActions(gateway).bulkDeleteMessages(CHANNEL, ids)).toEqual({
      ok: true,
      deleted: 1,
      individually: 1,
    });
    expect(deleteMessage).toHaveBeenCalledTimes(2);
  });

  it('falls back when the bulk call exceeds callTimeoutMs', async () => {
    const gateway = fakeGateway({ bulkDelete: () => new Promise<never>(() => undefined) });
    const actions = createGuildActions(gateway, { callTimeoutMs: 20 });
    expect(await actions.bulkDeleteMessages(CHANNEL, ['1', '2'])).toEqual({
      ok: true,
      deleted: 2,
      individually: 2,
    });
  });
});

describe('createDiscordGateway bulkDelete', () => {
  it('bulk-deletes in the text channel, skipping old messages, and returns the deleted IDs', async () => {
    const bulkDelete = vi.fn(() => Promise.resolve(new Map([['1', {}]])));
    const channel = { isTextBased: () => true, bulkDelete };
    const guild = { channels: { cache: { get: () => channel } } };
    const client = { guilds: { cache: { get: () => guild } } } as unknown as Client;
    const gateway = createDiscordGateway(client, '444444444444444444');
    expect(await gateway.bulkDelete(CHANNEL, ['1', '2'])).toEqual(['1']);
    expect(bulkDelete).toHaveBeenCalledWith(['1', '2'], true);
  });
});

describe('createDiscordGateway memberRoleIds', () => {
  const GUILD = '444444444444444444';

  function clientWith(fetch: () => Promise<unknown>, guildPresent = true): Client {
    const guild = { id: GUILD, members: { fetch } };
    return {
      guilds: { cache: { get: () => (guildPresent ? guild : undefined) } },
    } as unknown as Client;
  }

  it('returns the role IDs without @everyone', async () => {
    const member = {
      roles: {
        cache: new Map([
          [GUILD, {}],
          ['333333333333333333', {}],
        ]),
      },
    };
    const gateway = createDiscordGateway(
      clientWith(() => Promise.resolve(member)),
      GUILD,
    );
    expect(await gateway.memberRoleIds(USER)).toEqual(['333333333333333333']);
  });

  it.each([10007, 10013])('returns null for Discord error %i (not a member)', async (code) => {
    const gateway = createDiscordGateway(
      clientWith(() => Promise.reject(discordError(code))),
      GUILD,
    );
    expect(await gateway.memberRoleIds(USER)).toBeNull();
  });

  it('rethrows other errors, which createGuildActions turns into undefined', async () => {
    const gateway = createDiscordGateway(
      clientWith(() => Promise.reject(discordError(50013))),
      GUILD,
    );
    await expect(gateway.memberRoleIds(USER)).rejects.toMatchObject({ code: 50013 });
    expect(await createGuildActions(gateway).getMemberRoleIds(USER)).toBeUndefined();
  });

  it('gives undefined when the guild is unavailable', async () => {
    const gateway = createDiscordGateway(
      clientWith(() => Promise.resolve({}), false),
      GUILD,
    );
    expect(await createGuildActions(gateway).getMemberRoleIds(USER)).toBeUndefined();
  });
});
