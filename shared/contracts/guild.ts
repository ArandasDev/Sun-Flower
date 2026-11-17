export type GuildActionError = 'forbidden' | 'not_found' | 'failed';

export type GuildActionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: GuildActionError };

export interface GuildActions {
  deleteMessage(channelId: string, messageId: string): Promise<GuildActionResult>;
  timeout(userId: string, durationMs: number, reason: string): Promise<GuildActionResult>;
  removeTimeout(userId: string): Promise<GuildActionResult>;
  kick(userId: string, reason: string): Promise<GuildActionResult>;
  ban(userId: string, reason: string, deleteMessageSeconds: number): Promise<GuildActionResult>;
  unban(userId: string): Promise<GuildActionResult>;
  sendMessage(channelId: string, content: string): Promise<GuildActionResult>;
  sendDirectMessage(userId: string, content: string): Promise<GuildActionResult>;
  getMemberRoleIds(userId: string): Promise<readonly string[] | undefined>;
}
