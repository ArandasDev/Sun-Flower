/** A member of the Discord server, as the panel needs to know them. */
export interface MemberInfo {
  readonly roleIds: readonly string[];
  readonly isOwner: boolean;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface MemberDirectory {
  /**
   * Resolves `null` when the person is not a member and `undefined` when the lookup fails or the
   * server is not available yet.
   */
  lookup(userId: string): Promise<MemberInfo | null | undefined>;
}

export type ConnectionState = 'connecting' | 'ready' | 'disconnected';

export interface BotStatus {
  connection(): ConnectionState;
  /** Epoch milliseconds when the bot process started. */
  startedAt: number;
}

/** The Discord OAuth2 client the login flow uses; implemented by the Discord adapter. */
export interface OAuthClient {
  authorizeUrl(state: string, challenge: string): string;
  exchange(code: string, verifier: string): Promise<string>;
  fetchUserId(accessToken: string): Promise<string>;
}
