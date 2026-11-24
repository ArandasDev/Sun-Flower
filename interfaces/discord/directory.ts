import { Events, type Client } from 'discord.js';

import { withTimeout } from '../../core/infrastructure/timeout.ts';
import type {
  BotStatus,
  ConnectionState,
  MemberDirectory,
  MemberInfo,
} from '../dashboard/ports.ts';

const LOOKUP_TIMEOUT_MS = 10_000;
const UNKNOWN_MEMBER = 10007;

/** Looks members up in the configured guild; never throws. */
export function createMemberDirectory(client: Client, guildId: string): MemberDirectory {
  return {
    lookup: async (userId): Promise<MemberInfo | null | undefined> => {
      const guild = client.guilds.cache.get(guildId);
      if (guild === undefined) return undefined;
      try {
        const member =
          guild.members.cache.get(userId) ??
          (await withTimeout(() => guild.members.fetch(userId), LOOKUP_TIMEOUT_MS, 'memberLookup'));
        return {
          // The @everyone role has the guild's ID.
          roleIds: [...member.roles.cache.keys()].filter((id) => id !== guild.id),
          isOwner: guild.ownerId === member.id,
          displayName: member.displayName,
          avatarUrl: member.displayAvatarURL({ size: 128 }),
        };
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        return code === UNKNOWN_MEMBER ? null : undefined;
      }
    },
  };
}

/** Tracks the latest connection state from the client events; `now` is injectable for tests. */
export function createBotStatus(client: Client, now: () => number = Date.now): BotStatus {
  let state: ConnectionState = 'connecting';
  client.on(Events.ClientReady, () => {
    state = 'ready';
  });
  client.on(Events.ShardDisconnect, () => {
    state = 'disconnected';
  });
  client.on(Events.ShardReconnecting, () => {
    state = 'connecting';
  });
  return { connection: () => state, startedAt: now() };
}
