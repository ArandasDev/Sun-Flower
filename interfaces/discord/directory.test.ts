import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Client } from 'discord.js';

import { createBotStatus, createMemberDirectory } from './directory.ts';

const GUILD = '999999999999999999';
const OWNER = '111111111111111111';
const USER = '222222222222222222';
const ROLE = '333333333333333333';

function fakeMember(id: string) {
  return {
    id,
    displayName: 'Maria',
    displayAvatarURL: vi.fn(() => 'https://example.com/avatar.png'),
    roles: {
      cache: new Map([
        [GUILD, {}],
        [ROLE, {}],
      ]),
    },
  };
}

function fakeClient(options: {
  cached?: ReturnType<typeof fakeMember>;
  fetch?: () => Promise<unknown>;
  noGuild?: boolean;
}): Client {
  const members = {
    cache: new Map(options.cached === undefined ? [] : [[options.cached.id, options.cached]]),
    fetch: vi.fn(options.fetch ?? (() => Promise.resolve(fakeMember(USER)))),
  };
  const guild = { id: GUILD, ownerId: OWNER, members };
  return {
    guilds: { cache: new Map(options.noGuild === true ? [] : [[GUILD, guild]]) },
  } as unknown as Client;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createMemberDirectory', () => {
  it('returns a cached member without roles of @everyone', async () => {
    const member = fakeMember(USER);
    const info = await createMemberDirectory(fakeClient({ cached: member }), GUILD).lookup(USER);
    expect(info).toEqual({
      roleIds: [ROLE],
      isOwner: false,
      displayName: 'Maria',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(member.displayAvatarURL).toHaveBeenCalledWith({ size: 128 });
  });

  it('flags the guild owner', async () => {
    const info = await createMemberDirectory(
      fakeClient({ cached: fakeMember(OWNER) }),
      GUILD,
    ).lookup(OWNER);
    expect(info?.isOwner).toBe(true);
  });

  it('fetches a member that is not cached', async () => {
    const client = fakeClient({});
    const info = await createMemberDirectory(client, GUILD).lookup(USER);
    expect(info?.displayName).toBe('Maria');
    const guild = client.guilds.cache.get(GUILD) as unknown as { members: { fetch: unknown } };
    expect(guild.members.fetch).toHaveBeenCalledWith(USER);
  });

  it('returns null on Unknown Member (10007)', async () => {
    const client = fakeClient({
      fetch: () => Promise.reject(Object.assign(new Error('x'), { code: 10007 })),
    });
    expect(await createMemberDirectory(client, GUILD).lookup(USER)).toBeNull();
  });

  it('returns undefined on a generic error', async () => {
    const client = fakeClient({ fetch: () => Promise.reject(new Error('boom')) });
    expect(await createMemberDirectory(client, GUILD).lookup(USER)).toBeUndefined();
  });

  it('returns undefined when the guild is not cached', async () => {
    const client = fakeClient({ noGuild: true });
    expect(await createMemberDirectory(client, GUILD).lookup(USER)).toBeUndefined();
  });

  it('returns undefined after the 10 s limit', async () => {
    vi.useFakeTimers();
    const client = fakeClient({ fetch: () => new Promise(() => undefined) });
    const pending = createMemberDirectory(client, GUILD).lookup(USER);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBeUndefined();
  });
});

describe('createBotStatus', () => {
  it('follows the connection events', () => {
    const emitter = new EventEmitter();
    const status = createBotStatus(emitter as unknown as Client, () => 1234);
    expect(status.connection()).toBe('connecting');
    expect(status.startedAt).toBe(1234);
    emitter.emit('clientReady');
    expect(status.connection()).toBe('ready');
    emitter.emit('shardDisconnect');
    expect(status.connection()).toBe('disconnected');
    emitter.emit('shardReconnecting');
    expect(status.connection()).toBe('connecting');
  });
});
