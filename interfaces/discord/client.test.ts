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

  it('maps replies to discord.js calls with ephemeral flags', async () => {
    const { calls, interaction } = fakeInteraction(null);
    const raw = toRawInteraction(interaction);
    await raw.reply('a', true);
    await raw.reply('b', false);
    await raw.deferReply();
    await raw.editReply('c');

    expect(calls).toEqual([
      { reply: { content: 'a', flags: MessageFlags.Ephemeral } },
      { reply: { content: 'b' } },
      'deferReply',
      { editReply: { content: 'c' } },
    ]);
  });
});
