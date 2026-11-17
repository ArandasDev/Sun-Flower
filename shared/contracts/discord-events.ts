export const DISCORD_MESSAGE_CREATED = 'discord.message.created';
export const DISCORD_MESSAGE_UPDATED = 'discord.message.updated';

export interface DiscordMessagePayload {
  readonly messageId: string;
  readonly messageUrl: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly authorRoleIds: readonly string[];
  readonly authorJoinedAt: string | null; // ISO 8601; null if the member is not cached
  readonly authorAccountCreatedAt: string; // ISO 8601
  readonly content: string;
}
