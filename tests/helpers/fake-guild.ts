import type { GuildActionResult, GuildActions } from '../../shared/contracts/guild.ts';

export interface FakeGuild extends GuildActions {
  readonly calls: { action: string; args: unknown[] }[];
  readonly memberRoles: Map<string, string[]>;
}

type ActionName = Exclude<keyof GuildActions, 'getMemberRoleIds'>;

export function createFakeGuild(
  overrides: Partial<Record<keyof GuildActions, GuildActionResult>> = {},
): FakeGuild {
  const calls: { action: string; args: unknown[] }[] = [];
  const memberRoles = new Map<string, string[]>();
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
    deleteMessage: record('deleteMessage'),
    timeout: record('timeout'),
    removeTimeout: record('removeTimeout'),
    kick: record('kick'),
    ban: record('ban'),
    unban: record('unban'),
    sendMessage: record('sendMessage'),
    sendDirectMessage: record('sendDirectMessage'),
    getMemberRoleIds: async (userId) => {
      await Promise.resolve();
      calls.push({ action: 'getMemberRoleIds', args: [userId] });
      return memberRoles.get(userId);
    },
  };
}
