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
  /**
   * The member's role IDs (without @everyone) when the user is a member; `null` when the
   * user is confirmed not to be a member (Unknown Member / Unknown User); `undefined` when the
   * lookup failed (error, timeout, guild unavailable or module not allowed to act).
   */
  getMemberRoleIds(userId: string): Promise<readonly string[] | null | undefined>;
}
