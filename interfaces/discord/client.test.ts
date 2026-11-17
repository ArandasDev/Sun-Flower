import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { toRawInteraction } from './client.ts';

const guildId = '000000000000000000';
const roleId = '111111111111111111';

function fakeInteraction(member: unknown) {
  const calls: unknown[] = [];
  const fake = {
    commandName: 'ping',
    user: { id: roleId },
    member,
    guildId,
    channelId: '222222222222222222',
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => 'add',
      getString: (n: string) => (n === 's' ? 'txt' : null),
      getInteger: () => null,
      getBoolean: (n: string) => (n === 'b' ? false : null),
      getUser: (n: string) => (n === 'u' ? { id: '333333333333333333' } : null),
      getChannel: (n: string) => (n === 'c' ? { id: '222222222222222222' } : null),
      getRole: (n: string) => (n === 'r' ? { id: roleId } : null),
    },
    reply: async (options: unknown) => {
      await Promise.resolve();
      calls.push({ reply: options });
    },
    deferReply: async () => {
      await Promise.resolve();
      calls.push('deferReply');
    },
    editReply: async (options: unknown) => {
      await Promise.resolve();
      calls.push({ editReply: options });
    },
  };
  // Structural test double: only the members toRawInteraction reads are provided.
  return { calls, interaction: fake as unknown as ChatInputCommandInteraction };
}

describe('toRawInteraction', () => {
  it('reads role IDs from a cached GuildMember and drops @everyone', () => {
    const cache = new Map([
      [guildId, {}],
      [roleId, {}],
    ]);
    const { interaction } = fakeInteraction({ roles: { cache } });

    const raw = toRawInteraction(interaction);
    expect(raw).toMatchObject({ commandName: 'ping', userId: roleId, guildId, roleIds: [roleId] });
  });

  it('reads role IDs from an API member and handles a missing member', () => {
    expect(toRawInteraction(fakeInteraction({ roles: [roleId] }).interaction).roleIds).toEqual([
      roleId,
    ]);
    expect(toRawInteraction(fakeInteraction(null).interaction).roleIds).toEqual([]);
  });

  it('maps replies to discord.js calls with ephemeral flags and no mentions', async () => {
    const { calls, interaction } = fakeInteraction(null);
    const raw = toRawInteraction(interaction);
    await raw.reply('a', true);
    await raw.reply('b', false);
    await raw.deferReply();
    await raw.editReply('c');

    const noMentions = { parse: [] };
    expect(calls).toEqual([
      { reply: { content: 'a', flags: MessageFlags.Ephemeral, allowedMentions: noMentions } },
      { reply: { content: 'b', allowedMentions: noMentions } },
      'deferReply',
      { editReply: { content: 'c', allowedMentions: noMentions } },
    ]);
  });

  it('translates channel, subcommand and option values', () => {
    const raw = toRawInteraction(fakeInteraction(null).interaction);
    expect(raw.channelId).toBe('222222222222222222');
    expect(raw.subcommandGroup).toBeUndefined();
    expect(raw.subcommand).toBe('add');
    expect(raw.options.getString('s')).toBe('txt');
    expect(raw.options.getString('x')).toBeUndefined();
    expect(raw.options.getInteger('i')).toBeUndefined();
    expect(raw.options.getBoolean('b')).toBe(false);
    expect(raw.options.getBoolean('x')).toBeUndefined();
    expect(raw.options.getUser('u')).toBe('333333333333333333');
    expect(raw.options.getUser('x')).toBeUndefined();
    expect(raw.options.getChannel('c')).toBe('222222222222222222');
    expect(raw.options.getRole('r')).toBe(roleId);
    expect(raw.options.getRole('x')).toBeUndefined();
  });
});
