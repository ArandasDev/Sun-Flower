import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import type { GuildActionError } from '../../../shared/contracts/guild.ts';
import type { NewCase } from '../cases.ts';
import type { ModerationConfig } from '../config.ts';
import { CASE_CREATED } from '../responder.ts';
import type { ModCommandDeps } from './mod-command.ts';
import {
  BANNED,
  DISCORD_REFUSED,
  DM_FAILED,
  INVALID_OPTION,
  KICKED,
  NOT_A_MEMBER,
  PROTECTED_TARGET,
  SELF_TARGET,
  TIMED_OUT,
  WARN_DM,
  WARNED,
} from './replies.ts';

const EPHEMERAL = { ephemeral: true } as const;
const REASON_MAX = 512;
const TIMEOUT_MIN_MINUTES = 1;
const TIMEOUT_MAX_MINUTES = 40320;
const DELETE_DAYS_MAX = 7;
const MINUTE_MS = 60_000;
const DAY_SECONDS = 86_400;

type ManualAction = 'warn' | 'timeout' | 'kick' | 'ban';

interface Target {
  readonly userId: string;
  readonly reason: string;
}

const REFUSAL_LABEL: Record<GuildActionError, 'sem permissão' | 'não encontrado' | 'falha'> = {
  forbidden: 'sem permissão',
  not_found: 'não encontrado',
  failed: 'falha',
};

const isIntegerIn = (value: number | undefined, min: number, max: number): value is number =>
  value !== undefined && Number.isInteger(value) && value >= min && value <= max;

/**
 * Reads the target and reason and applies the protections of spec §4.7. Replies and returns
 * `undefined` when the action must not proceed; nothing is sent to Discord in that case.
 */
async function resolveTarget(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
  requireMember: boolean,
): Promise<Target | undefined> {
  const userId = interaction.options.getUser('user');
  if (userId === undefined) {
    await interaction.reply(INVALID_OPTION('user'), EPHEMERAL);
    return undefined;
  }
  const reason = interaction.options.getString('reason')?.trim();
  if (reason === undefined || reason.length === 0 || reason.length > REASON_MAX) {
    await interaction.reply(INVALID_OPTION('reason'), EPHEMERAL);
    return undefined;
  }
  if (userId === interaction.actor.userId) {
    await interaction.reply(SELF_TARGET, EPHEMERAL);
    return undefined;
  }
  if (deps.permissions.isDeveloper(userId)) {
    await interaction.reply(PROTECTED_TARGET, EPHEMERAL);
    return undefined;
  }
  const roleIds = await deps.guild.getMemberRoleIds(userId);
  if (roleIds === undefined) {
    // The lookup failed: the protections cannot be checked, so fail closed.
    await interaction.reply(DISCORD_REFUSED('falha'), EPHEMERAL);
    return undefined;
  }
  if (roleIds === null) {
    if (!requireMember) return { userId, reason };
    await interaction.reply(NOT_A_MEMBER, EPHEMERAL);
    return undefined;
  }
  const exempt = new Set(deps.config.get<ModerationConfig>().exemptRoleIds);
  if (
    roleIds.some((roleId) => exempt.has(roleId)) ||
    deps.permissions.hasAnyGrant(roleIds, 'moderation.')
  ) {
    await interaction.reply(PROTECTED_TARGET, EPHEMERAL);
    return undefined;
  }
  return { userId, reason };
}

function recordCase(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
  action: ManualAction,
  target: Target,
  outcome: Record<string, string>,
  now: Date,
  timeoutUntil: string | null = null,
): number {
  const newCase: NewCase = {
    kind: 'manual',
    level: null,
    action,
    targetUserId: target.userId,
    actorUserId: interaction.actor.userId,
    channelId: interaction.channelId,
    messageId: null,
    domains: [],
    signals: [],
    score: 0,
    reason: target.reason,
    outcome,
    status: 'actioned',
    timeoutUntil,
    createdAt: now.toISOString(),
  };
  const caseId = deps.cases.create(newCase);
  deps.publish(CASE_CREATED, { caseId, kind: 'manual', level: null, action });
  return caseId;
}

async function refuse(interaction: CommandInteraction, error: GuildActionError): Promise<void> {
  await interaction.reply(DISCORD_REFUSED(REFUSAL_LABEL[error]), EPHEMERAL);
}

const clock = (deps: ModCommandDeps): Date => (deps.now ?? (() => new Date()))();

export async function actionWarn(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const target = await resolveTarget(interaction, deps, true);
  if (target === undefined) return;
  const now = clock(deps);
  const dm = await deps.guild.sendDirectMessage(target.userId, WARN_DM(target.reason));
  const caseId = recordCase(
    interaction,
    deps,
    'warn',
    target,
    { warn: 'ok', dm: dm.ok ? 'ok' : dm.error },
    now,
  );
  await interaction.reply(`${WARNED(caseId)}${dm.ok ? '' : DM_FAILED}`, EPHEMERAL);
}

export async function actionTimeout(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const minutes = interaction.options.getInteger('minutes');
  if (!isIntegerIn(minutes, TIMEOUT_MIN_MINUTES, TIMEOUT_MAX_MINUTES)) {
    await interaction.reply(INVALID_OPTION('minutes'), EPHEMERAL);
    return;
  }
  const target = await resolveTarget(interaction, deps, true);
  if (target === undefined) return;
  const durationMs = minutes * MINUTE_MS;
  const now = clock(deps);
  const result = await deps.guild.timeout(target.userId, durationMs, target.reason);
  if (!result.ok) {
    await refuse(interaction, result.error);
    return;
  }
  const until = new Date(now.getTime() + durationMs).toISOString();
  const caseId = recordCase(interaction, deps, 'timeout', target, { timeout: 'ok' }, now, until);
  await interaction.reply(TIMED_OUT(caseId), EPHEMERAL);
}

export async function actionKick(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const target = await resolveTarget(interaction, deps, true);
  if (target === undefined) return;
  const now = clock(deps);
  const result = await deps.guild.kick(target.userId, target.reason);
  if (!result.ok) {
    await refuse(interaction, result.error);
    return;
  }
  const caseId = recordCase(interaction, deps, 'kick', target, { kick: 'ok' }, now);
  await interaction.reply(KICKED(caseId), EPHEMERAL);
}

export async function actionBan(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const days = interaction.options.getInteger('delete-days') ?? 0;
  if (!isIntegerIn(days, 0, DELETE_DAYS_MAX)) {
    await interaction.reply(INVALID_OPTION('delete-days'), EPHEMERAL);
    return;
  }
  const target = await resolveTarget(interaction, deps, false);
  if (target === undefined) return;
  const now = clock(deps);
  const result = await deps.guild.ban(target.userId, target.reason, days * DAY_SECONDS);
  if (!result.ok) {
    await refuse(interaction, result.error);
    return;
  }
  const caseId = recordCase(interaction, deps, 'ban', target, { ban: 'ok' }, now);
  await interaction.reply(BANNED(caseId), EPHEMERAL);
}
