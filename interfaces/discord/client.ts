import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';

import type { RawInteraction } from './commands.ts';
import type { RawMessage } from './messages.ts';

/** Command replies never ping anyone, whatever text a module sends. */
const NO_MENTIONS = { parse: [] };

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    // Without it discord.js drops edits of messages that are not cached (old ones, or any after a restart).
    partials: [Partials.Message],
  });
}

/** Thin adapter from a discord.js interaction to the transport-neutral RawInteraction. */
export function toRawInteraction(interaction: ChatInputCommandInteraction): RawInteraction {
  const member = interaction.member;
  const roles =
    member === null
      ? []
      : Array.isArray(member.roles)
        ? member.roles
        : [...member.roles.cache.keys()];
  // The @everyone role shares the guild's ID; it is not a real role assignment.
  const roleIds = roles.filter((id) => id !== interaction.guildId);

  return {
    commandName: interaction.commandName,
    userId: interaction.user.id,
    roleIds,
    isOwner: interaction.guild?.ownerId === interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    subcommandGroup: interaction.options.getSubcommandGroup(false) ?? undefined,
    subcommand: interaction.options.getSubcommand(false) ?? undefined,
    options: {
      getString: (name) => interaction.options.getString(name, false) ?? undefined,
      getInteger: (name) => interaction.options.getInteger(name, false) ?? undefined,
      getBoolean: (name) => interaction.options.getBoolean(name, false) ?? undefined,
      getUser: (name) => interaction.options.getUser(name, false)?.id,
      getChannel: (name) => interaction.options.getChannel(name, false)?.id,
      getRole: (name) => interaction.options.getRole(name, false)?.id,
    },
    reply: async (content, ephemeral) => {
      await interaction.reply(
        ephemeral
          ? { content, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS }
          : { content, allowedMentions: NO_MENTIONS },
      );
    },
    deferReply: async (ephemeral) => {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    },
    editReply: async (content) => {
      await interaction.editReply({ content, allowedMentions: NO_MENTIONS });
    },
  };
}

/** Thin adapter from a discord.js message to the transport-neutral RawMessage. */
export function toRawMessage(message: Message): RawMessage {
  const member = message.member;
  return {
    guildId: message.guildId,
    messageId: message.id,
    messageUrl: message.url,
    channelId: message.channelId,
    authorId: message.author.id,
    authorIsBot: message.author.bot,
    isWebhook: message.webhookId !== null,
    isSystem: message.system,
    content: message.content,
    hasNonTextParts:
      message.attachments.size > 0 ||
      message.embeds.length > 0 ||
      message.stickers.size > 0 ||
      message.poll !== null ||
      message.messageSnapshots.size > 0,
    // The @everyone role shares the guild's ID; it is not a real role assignment.
    authorRoleIds:
      member === null ? [] : [...member.roles.cache.keys()].filter((id) => id !== message.guildId),
    authorJoinedAt: member?.joinedAt?.toISOString() ?? null,
    authorAccountCreatedAt: message.author.createdAt.toISOString(),
  };
}
