import { describe, expect, it, vi } from 'vitest';

import { createGuildActions, type GuildGateway } from './guild-actions.ts';

const BOT = '000000000000000000';
const USER = '111111111111111111';
const CHANNEL = '222222222222222222';

function fakeGateway(overrides: Partial<GuildGateway> = {}): GuildGateway {
  return {
    botUserId: () => BOT,
    deleteMessage: vi.fn(() => Promise.resolve()),
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

  it('removeTimeout calls setTimeout with null', async () => {
    const setTimeoutSpy = vi.fn(() => Promise.resolve());
    await createGuildActions(fakeGateway({ setTimeout: setTimeoutSpy })).removeTimeout(USER);
    expect(setTimeoutSpy).toHaveBeenCalledWith(USER, null);
  });

  it('getMemberRoleIds returns roles, and undefined on any failure', async () => {
    expect(await createGuildActions(fakeGateway()).getMemberRoleIds(USER)).toEqual([
      '333333333333333333',
    ]);
    const failing = fakeGateway({ memberRoleIds: () => Promise.reject(discordError(10007)) });
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
