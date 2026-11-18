import type { Client, Guild } from 'discord.js';

import { withTimeout } from '../../core/infrastructure/timeout.ts';
import type {
  BulkDeleteResult,
  GuildActionError,
  GuildActionResult,
  GuildActions,
} from '../../shared/contracts/guild.ts';

/** Thin Discord operations; every method throws the discord.js error on failure. */
export interface GuildGateway {
  botUserId(): string | undefined;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  /** IDs removed by the bulk call (messages older than 14 days are skipped, not errors). */
  bulkDelete(channelId: string, messageIds: readonly string[]): Promise<readonly string[]>;
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
/** Missing permissions, Missing Access and archived thread: retrying other messages cannot help. */
const TERMINAL_CODES: ReadonlySet<number> = new Set([MISSING_PERMISSIONS, 50001, 50083]);
const NOT_FOUND_CODES: ReadonlySet<number> = new Set([10003, 10007, 10008, 10013, 10026]);
const UNKNOWN_CHANNEL = 10003;
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

  /** Failed individual deletions in a row after which the fallback gives up. */
  const MAX_CONSECUTIVE_FAILURES = 3;

  const individually = async (
    channelId: string,
    messageIds: readonly string[],
    alreadyDeleted: number,
  ): Promise<BulkDeleteResult> => {
    let deleted = alreadyDeleted;
    let removedOne = 0;
    let consecutiveFailures = 0;
    let stopped: GuildActionError = 'failed';
    for (const id of messageIds) {
      let code: unknown;
      try {
        await withTimeout(() => gateway.deleteMessage(channelId, id), timeoutMs, 'deleteMessage');
        deleted++;
        removedOne++;
        consecutiveFailures = 0;
        continue;
      } catch (error) {
        code = (error as { code?: unknown } | null)?.code;
      }
      if (code === UNKNOWN_CHANNEL) {
        stopped = 'not_found';
        break;
      }
      if (typeof code === 'number' && TERMINAL_CODES.has(code)) {
        stopped = 'forbidden';
        break;
      }
      if (typeof code === 'number' && NOT_FOUND_CODES.has(code)) {
        // Already gone: counts as deleted, but not as removed by this fallback.
        deleted++;
        consecutiveFailures = 0;
        continue;
      }
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
    }
    if (deleted === 0) return { ok: false, error: stopped, deleted: 0 };
    return { ok: true, deleted, individually: removedOne };
  };

  const bulkDeleteMessages = async (
    channelId: string,
    messageIds: readonly string[],
  ): Promise<BulkDeleteResult> => {
    if (messageIds.length === 1) return individually(channelId, messageIds, 0);
    let remaining = messageIds;
    let bulkDeleted = 0;
    try {
      const removed = new Set(
        await withTimeout(
          () => gateway.bulkDelete(channelId, messageIds),
          timeoutMs,
          'bulkDeleteMessages',
        ),
      );
      remaining = messageIds.filter((id) => !removed.has(id));
      bulkDeleted = messageIds.length - remaining.length;
    } catch (error) {
      // Permission, access, archived-thread or channel problems repeat for every message: no fallback.
      const code = (error as { code?: unknown } | null)?.code;
      if (code === UNKNOWN_CHANNEL) return { ok: false, error: 'not_found', deleted: 0 };
      if (typeof code === 'number' && TERMINAL_CODES.has(code)) {
        return { ok: false, error: 'forbidden', deleted: 0 };
      }
    }
    return individually(channelId, remaining, bulkDeleted);
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
    bulkDeleteMessages,
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
    bulkDelete: async (channelId, messageIds) => {
      const channel = await textChannel(channelId);
      if (!('bulkDelete' in channel)) throw new Error('channel does not support bulk delete');
      // discord.js deletes a lone remaining message individually and only returns it because
      // Partials.Message is enabled in client.ts.
      const removed = await channel.bulkDelete([...messageIds], true);
      return [...removed.keys()];
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
