import type {
  BulkDeleteResult,
  GuildActionResult,
  GuildActions,
} from '../../shared/contracts/guild.ts';

export interface FakeGuild extends GuildActions {
  readonly calls: { action: string; args: unknown[] }[];
  /** Users present here are members with these roles; any other user is not a member (null). */
  readonly memberRoles: Map<string, string[]>;
  /** Users whose member lookup fails: getMemberRoleIds resolves undefined. */
  readonly lookupFails: Set<string>;
}

type ActionName = Exclude<keyof GuildActions, 'getMemberRoleIds' | 'bulkDeleteMessages'>;

export function createFakeGuild(
  overrides: Partial<Record<ActionName, GuildActionResult>> = {},
  bulkResult?: BulkDeleteResult,
): FakeGuild {
  const calls: { action: string; args: unknown[] }[] = [];
  const memberRoles = new Map<string, string[]>();
  const lookupFails = new Set<string>();
  const record =
    (action: ActionName) =>
    async (...args: unknown[]): Promise<GuildActionResult> => {
      await Promise.resolve();
      calls.push({ action, args });
      return overrides[action] ?? { ok: true };
    };
  return {
    calls,
    memberRoles,
    lookupFails,
    deleteMessage: record('deleteMessage'),
    timeout: record('timeout'),
    removeTimeout: record('removeTimeout'),
    kick: record('kick'),
    ban: record('ban'),
    unban: record('unban'),
    sendMessage: record('sendMessage'),
    sendDirectMessage: record('sendDirectMessage'),
    bulkDeleteMessages: async (channelId, ids) => {
      await Promise.resolve();
      calls.push({ action: 'bulkDeleteMessages', args: [channelId, ids] });
      return bulkResult ?? { ok: true, deleted: ids.length, individually: 0 };
    },
    getMemberRoleIds: async (userId) => {
      await Promise.resolve();
      calls.push({ action: 'getMemberRoleIds', args: [userId] });
      if (lookupFails.has(userId)) return undefined;
      return memberRoles.get(userId) ?? null;
    },
  };
}
