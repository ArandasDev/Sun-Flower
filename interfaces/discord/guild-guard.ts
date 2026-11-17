/**
 * Only interactions from the configured guild are handled; DMs and other guilds are ignored.
 * The bot does not leave other guilds (decision 0010): it simply never answers them.
 */
export function isAllowedInteraction(
  interaction: { readonly guildId: string | null },
  allowedGuildId: string,
): boolean {
  return interaction.guildId !== null && interaction.guildId === allowedGuildId;
}
