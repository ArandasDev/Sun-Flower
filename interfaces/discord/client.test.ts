import {
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import { describe, expect, it } from 'vitest';

import { createDiscordClient, toRawInteraction, toRawMessage } from './client.ts';

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
    deferReply: async (options: unknown) => {
      await Promise.resolve();
      calls.push({ deferReply: options });
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

  it('flags the guild owner and defaults to false without a cached guild', () => {
    const owner = fakeInteraction(null);
    (owner.interaction as unknown as { guild: unknown }).guild = { ownerId: roleId };
    expect(toRawInteraction(owner.interaction).isOwner).toBe(true);
    const other = fakeInteraction(null);
    (other.interaction as unknown as { guild: unknown }).guild = { ownerId: '333333333333333333' };
    expect(toRawInteraction(other.interaction).isOwner).toBe(false);
    expect(toRawInteraction(fakeInteraction(null).interaction).isOwner).toBe(false);
  });

  it('maps replies to discord.js calls with ephemeral flags and no mentions', async () => {
    const { calls, interaction } = fakeInteraction(null);
    const raw = toRawInteraction(interaction);
    await raw.reply('a', true);
    await raw.reply('b', false);
    await raw.deferReply(true);
    await raw.editReply('c');

    const noMentions = { parse: [] };
    expect(calls).toEqual([
      { reply: { content: 'a', flags: MessageFlags.Ephemeral, allowedMentions: noMentions } },
      { reply: { content: 'b', allowedMentions: noMentions } },
      { deferReply: { flags: MessageFlags.Ephemeral } },
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

describe('createDiscordClient', () => {
  it('requests the guild, message, content and member intents', () => {
    const client = createDiscordClient();
    for (const bit of [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ]) {
      expect(client.options.intents.has(bit)).toBe(true);
    }
    void client.destroy();
  });

  it('enables the Message partial so edits of uncached messages are delivered', () => {
    const client = createDiscordClient();
    expect(client.options.partials).toContain(Partials.Message);
    void client.destroy();
  });
});

describe('toRawMessage', () => {
  function fakeMessage(overrides: Record<string, unknown> = {}): Message {
    const fake = {
      guildId,
      id: '111111111111111111',
      url: 'https://example.test/m',
      channelId: '222222222222222222',
      author: { id: '333333333333333333', bot: false, createdAt: new Date('2025-01-01T00:00:00Z') },
      webhookId: null,
      content: 'hi',
      attachments: { size: 0 },
      embeds: [],
      stickers: { size: 0 },
      system: false,
      poll: null,
      messageSnapshots: { size: 0 },
      member: {
        joinedAt: new Date('2026-01-01T00:00:00Z'),
        roles: {
          cache: new Map([
            [guildId, {}],
            [roleId, {}],
          ]),
        },
      },
      ...overrides,
    };
    // Structural test double: only the members toRawMessage reads are provided.
    return fake as unknown as Message;
  }

  it('maps a plain guild message', () => {
    expect(toRawMessage(fakeMessage())).toEqual({
      guildId,
      messageId: '111111111111111111',
      messageUrl: 'https://example.test/m',
      channelId: '222222222222222222',
      authorId: '333333333333333333',
      authorIsBot: false,
      isWebhook: false,
      content: 'hi',
      isSystem: false,
      hasNonTextParts: false,
      authorRoleIds: [roleId],
      authorJoinedAt: '2026-01-01T00:00:00.000Z',
      authorAccountCreatedAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('handles a missing member, webhooks and non-text parts', () => {
    const raw = toRawMessage(fakeMessage({ member: null, webhookId: roleId }));
    expect(raw.authorRoleIds).toEqual([]);
    expect(raw.authorJoinedAt).toBeNull();
    expect(raw.isWebhook).toBe(true);
    expect(toRawMessage(fakeMessage({ attachments: { size: 1 } })).hasNonTextParts).toBe(true);
    expect(toRawMessage(fakeMessage({ embeds: [{}] })).hasNonTextParts).toBe(true);
    expect(toRawMessage(fakeMessage({ stickers: { size: 2 } })).hasNonTextParts).toBe(true);
  });

  it('flags system messages and treats polls and forwards as non-text parts', () => {
    expect(toRawMessage(fakeMessage({ system: true })).isSystem).toBe(true);
    expect(toRawMessage(fakeMessage({ poll: {} })).hasNonTextParts).toBe(true);
    expect(toRawMessage(fakeMessage({ messageSnapshots: { size: 1 } })).hasNonTextParts).toBe(true);
  });
});
