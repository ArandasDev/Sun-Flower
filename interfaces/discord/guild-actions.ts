import type { Client, Guild } from 'discord.js';

import { withTimeout } from '../../core/infrastructure/timeout.ts';
import type { GuildActionResult, GuildActions } from '../../shared/contracts/guild.ts';

/** Thin Discord operations; every method throws the discord.js error on failure. */
export interface GuildGateway {
  botUserId(): string | undefined;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  setTimeout(userId: string, durationMs: number | null, reason?: string): Promise<void>;
  kick(userId: string, reason: string): Promise<void>;
  ban(userId: string, reason: string, deleteMessageSeconds: number): Promise<void>;
  unban(userId: string): Promise<void>;
  send(channelId: string, content: string): Promise<void>;
  sendDirect(userId: string, content: string): Promise<void>;
  /** Resolves `null` when the user is not a member (Unknown Member / Unknown User). */
  memberRoleIds(userId: string): Promise<readonly string[] | null>;
}

const DEFAULT_CALL_TIMEOUT_MS = 10_000;
const MISSING_PERMISSIONS = 50013;
const NOT_FOUND_CODES: ReadonlySet<number> = new Set([10003, 10007, 10008, 10013, 10026]);
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_USER = 10013;

/** Reads only the numeric code: the error message may echo content and is never used. */
function toResult(error: unknown): GuildActionResult {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === MISSING_PERMISSIONS) return { ok: false, error: 'forbidden' };
  if (typeof code === 'number' && NOT_FOUND_CODES.has(code)) {
    return { ok: false, error: 'not_found' };
  }
  return { ok: false, error: 'failed' };
}

export function createGuildActions(
  gateway: GuildGateway,
  options: { callTimeoutMs?: number } = {},
): GuildActions {
  const timeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;

  const run = async (label: string, work: () => Promise<void>): Promise<GuildActionResult> => {
    try {
      await withTimeout(work, timeoutMs, label);
      return { ok: true };
    } catch (error) {
      return toResult(error);
    }
  };

  const isSelf = (userId: string): boolean => userId === gateway.botUserId();
  const forbidden: GuildActionResult = { ok: false, error: 'forbidden' };

  return {
    deleteMessage: (channelId, messageId) =>
      run('deleteMessage', () => gateway.deleteMessage(channelId, messageId)),
    timeout: (userId, durationMs, reason) =>
      isSelf(userId)
        ? Promise.resolve(forbidden)
        : run('timeout', () => gateway.setTimeout(userId, durationMs, reason)),
    removeTimeout: (userId) => run('removeTimeout', () => gateway.setTimeout(userId, null)),
    kick: (userId, reason) =>
      isSelf(userId) ? Promise.resolve(forbidden) : run('kick', () => gateway.kick(userId, reason)),
    ban: (userId, reason, deleteMessageSeconds) =>
      isSelf(userId)
        ? Promise.resolve(forbidden)
        : run('ban', () => gateway.ban(userId, reason, deleteMessageSeconds)),
    unban: (userId) => run('unban', () => gateway.unban(userId)),
    sendMessage: (channelId, content) => run('sendMessage', () => gateway.send(channelId, content)),
    sendDirectMessage: (userId, content) =>
      isSelf(userId)
        ? Promise.resolve(forbidden)
        : run('sendDirectMessage', () => gateway.sendDirect(userId, content)),
    getMemberRoleIds: async (userId) => {
      try {
        return await withTimeout(() => gateway.memberRoleIds(userId), timeoutMs, 'memberRoleIds');
      } catch {
        return undefined;
      }
    },
  };
}

export function createDiscordGateway(client: Client, guildId: string): GuildGateway {
  const guild = (): Guild => {
    const found = client.guilds.cache.get(guildId);
    if (found === undefined) throw new Error('guild unavailable');
    return found;
  };

  const textChannel = async (channelId: string) => {
    const channels = guild().channels;
    const channel = channels.cache.get(channelId) ?? (await channels.fetch(channelId));
    if (channel === null || !channel.isTextBased()) throw new Error('channel is not text-based');
    return channel;
  };

  const noMentions = { parse: [] as [] };

  return {
    botUserId: () => client.user?.id,
    deleteMessage: async (channelId, messageId) => {
      const channel = await textChannel(channelId);
      await channel.messages.delete(messageId);
    },
    setTimeout: async (userId, durationMs, reason) => {
      const member = await guild().members.fetch(userId);
      await member.timeout(durationMs, reason);
    },
    kick: async (userId, reason) => {
      await guild().members.kick(userId, reason);
    },
    ban: async (userId, reason, deleteMessageSeconds) => {
      await guild().bans.create(userId, { reason, deleteMessageSeconds });
    },
    unban: async (userId) => {
      await guild().bans.remove(userId);
    },
    send: async (channelId, content) => {
      const channel = await textChannel(channelId);
      await channel.send({ content, allowedMentions: noMentions });
    },
    sendDirect: async (userId, content) => {
      const user = await client.users.fetch(userId);
      await user.send({ content, allowedMentions: noMentions });
    },
    memberRoleIds: async (userId) => {
      const current = guild();
      try {
        const member = await current.members.fetch(userId);
        return [...member.roles.cache.keys()].filter((id) => id !== current.id);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === UNKNOWN_MEMBER || code === UNKNOWN_USER) return null;
        throw error;
      }
    },
  };
}
