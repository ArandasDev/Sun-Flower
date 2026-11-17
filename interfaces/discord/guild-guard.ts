import type { Logger } from '../../shared/contracts/logger.ts';

export interface LeavableGuild {
  readonly id: string;
  leave(): Promise<unknown>;
}

/**
 * Leaves every guild other than the allowed one and reports whether the allowed guild is present.
 * Guild IDs are never logged; only the fact that a guild was left and the final count.
 * A failure to leave one guild is logged and does not stop the others.
 */
export async function leaveUnauthorizedGuilds(
  guilds: Iterable<LeavableGuild>,
  allowedGuildId: string,
  logger: Logger,
): Promise<boolean> {
  let allowedPresent = false;
  let left = 0;
  for (const guild of guilds) {
    if (guild.id === allowedGuildId) {
      allowedPresent = true;
      continue;
    }
    try {
      await guild.leave();
      left += 1;
      logger.warn('Left an unauthorized guild');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to leave an unauthorized guild',
      );
    }
  }
  if (left > 0) {
    logger.warn({ count: left }, 'Left unauthorized guilds');
  }
  return allowedPresent;
}

export function isAllowedInteraction(
  interaction: { readonly guildId: string | null },
  allowedGuildId: string,
): boolean {
  return interaction.guildId !== null && interaction.guildId === allowedGuildId;
}
