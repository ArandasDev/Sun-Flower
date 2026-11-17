import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';

import type { RawInteraction } from './commands.ts';

export function createDiscordClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
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
    guildId: interaction.guildId,
    reply: async (content, ephemeral) => {
      await interaction.reply(ephemeral ? { content, flags: MessageFlags.Ephemeral } : { content });
    },
    deferReply: async () => {
      await interaction.deferReply();
    },
    editReply: async (content) => {
      await interaction.editReply({ content });
    },
  };
}
