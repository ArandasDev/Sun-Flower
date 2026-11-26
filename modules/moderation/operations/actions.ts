import { z } from 'zod';

import type { Actor } from '../../../shared/contracts/commands.ts';
import type { GuildActionError, GuildActions } from '../../../shared/contracts/guild.ts';
import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { fail, ok } from '../../../shared/contracts/operations.ts';
import type { OperationResult } from '../../../shared/contracts/operations.ts';
import type { CaseStore, NewCase } from '../cases.ts';
import {
  DISCORD_REFUSED,
  NOT_A_MEMBER,
  PROTECTED_TARGET,
  SELF_TARGET,
  WARN_DM,
} from '../commands/replies.ts';
import { CASE_CREATED } from '../responder.ts';
import { snowflake } from '../config.ts';
import type { ModerationConfig } from '../config.ts';

export const REASON_MAX = 512;
export const TIMEOUT_MIN_MINUTES = 1;
export const TIMEOUT_MAX_MINUTES = 40320;
export const DELETE_DAYS_MAX = 7;
const MINUTE_MS = 60_000;
const DAY_SECONDS = 86_400;

type ManualAction = 'warn' | 'timeout' | 'kick' | 'ban';

export interface ActionOperationDeps {
  readonly cases: () => CaseStore;
  readonly guild: GuildActions;
  publish(type: string, payload: unknown): void;
  readonly now?: () => Date;
}

export interface ActionResult {
  readonly caseId: number;
  readonly dmFailed?: boolean;
}

const REFUSAL_LABEL: Record<GuildActionError, 'sem permissão' | 'não encontrado' | 'falha'> = {
  forbidden: 'sem permissão',
  not_found: 'não encontrado',
  failed: 'falha',
};

const CONTROL = /\p{Cc}/u;
/** Bidirectional controls (U+200D, which composes emoji, stays allowed). */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/u;
const INVISIBLE = /\p{Cf}/gu;

/** 1 to 512 characters, no control characters, and not made only of invisible ones. */
const reason = z
  .string()
  .trim()
  .min(1)
  .max(REASON_MAX)
  .refine((text) => !CONTROL.test(text) && !BIDI.test(text))
  .refine((text) => text.replace(INVISIBLE, '').trim().length > 0);
/** `channelId` is informational: the channel shown on the case (/mod passes where it ran). */
const base = { userId: snowflake, reason, channelId: snowflake.optional() };

export const warnInput = z.strictObject(base);
export const timeoutInput = z.strictObject({
  ...base,
  minutes: z.number().int().min(TIMEOUT_MIN_MINUTES).max(TIMEOUT_MAX_MINUTES),
});
export const kickInput = z.strictObject(base);
export const banInput = z.strictObject({
  ...base,
  deleteDays: z.number().int().min(0).max(DELETE_DAYS_MAX).optional(),
});

interface Target {
  readonly userId: string;
  readonly reason: string;
  readonly channelId?: string | undefined;
}

export function registerActionOperations(
  ctx: Pick<ModuleContext, 'config' | 'operations' | 'permissions'>,
  deps: ActionOperationDeps,
): void {
  const now = deps.now ?? ((): Date => new Date());

  /** The protections of spec 4.7. Returns the refusal, or `undefined` to proceed. */
  async function protect(
    actor: Actor,
    userId: string,
    requireMember: boolean,
  ): Promise<OperationResult<never> | undefined> {
    if (userId === actor.userId) return fail('forbidden', SELF_TARGET);
    if (ctx.permissions.isDeveloper(userId)) return fail('forbidden', PROTECTED_TARGET);
    const roleIds = await deps.guild.getMemberRoleIds(userId);
    // The lookup failed: the protections cannot be checked, so fail closed.
    if (roleIds === undefined) return fail('unavailable', DISCORD_REFUSED('falha'));
    if (roleIds === null) {
      return requireMember ? fail('not_found', NOT_A_MEMBER) : undefined;
    }
    const exempt = new Set(ctx.config.get<ModerationConfig>().exemptRoleIds);
    if (
      roleIds.some((roleId) => exempt.has(roleId)) ||
      ctx.permissions.hasAnyGrant(roleIds, 'moderation.')
    ) {
      return fail('forbidden', PROTECTED_TARGET);
    }
    return undefined;
  }

  const refuse = (error: GuildActionError): OperationResult<never> =>
    fail(error, DISCORD_REFUSED(REFUSAL_LABEL[error]));

  function record(
    actor: Actor,
    action: ManualAction,
    target: Target,
    outcome: Record<string, string>,
    at: Date,
    timeoutUntil: string | null = null,
  ): number {
    const newCase: NewCase = {
      kind: 'manual',
      level: null,
      action,
      targetUserId: target.userId,
      actorUserId: actor.userId,
      channelId: target.channelId ?? null,
      messageId: null,
      domains: [],
      signals: [],
      score: 0,
      reason: target.reason,
      outcome,
      status: 'actioned',
      timeoutUntil,
      createdAt: at.toISOString(),
    };
    const caseId = deps.cases().create(newCase);
    deps.publish(CASE_CREATED, { caseId, kind: 'manual', level: null, action });
    return caseId;
  }

  ctx.operations.register({
    name: 'moderation.actions.warn',
    permission: 'moderation.actions.warn',
    input: warnInput,
    handler: async (
      actor,
      input: z.output<typeof warnInput>,
    ): Promise<OperationResult<ActionResult>> => {
      const refusal = await protect(actor, input.userId, true);
      if (refusal !== undefined) return refusal;
      const at = now();
      const dm = await deps.guild.sendDirectMessage(input.userId, WARN_DM(input.reason));
      if (!dm.ok && dm.error === 'forbidden') {
        // The target cannot be warned (for example, the bot itself): no case is recorded.
        return fail('forbidden', PROTECTED_TARGET);
      }
      const caseId = record(actor, 'warn', input, { warn: 'ok', dm: dm.ok ? 'ok' : dm.error }, at);
      return ok(dm.ok ? { caseId } : { caseId, dmFailed: true });
    },
  });

  ctx.operations.register({
    name: 'moderation.actions.timeout',
    permission: 'moderation.actions.timeout',
    input: timeoutInput,
    handler: async (
      actor,
      input: z.output<typeof timeoutInput>,
    ): Promise<OperationResult<ActionResult>> => {
      const refusal = await protect(actor, input.userId, true);
      if (refusal !== undefined) return refusal;
      const durationMs = input.minutes * MINUTE_MS;
      const at = now();
      const result = await deps.guild.timeout(input.userId, durationMs, input.reason);
      if (!result.ok) return refuse(result.error);
      const until = new Date(at.getTime() + durationMs).toISOString();
      return ok({ caseId: record(actor, 'timeout', input, { timeout: 'ok' }, at, until) });
    },
  });

  ctx.operations.register({
    name: 'moderation.actions.kick',
    permission: 'moderation.actions.kick',
    input: kickInput,
    handler: async (
      actor,
      input: z.output<typeof kickInput>,
    ): Promise<OperationResult<ActionResult>> => {
      const refusal = await protect(actor, input.userId, true);
      if (refusal !== undefined) return refusal;
      const at = now();
      const result = await deps.guild.kick(input.userId, input.reason);
      if (!result.ok) return refuse(result.error);
      return ok({ caseId: record(actor, 'kick', input, { kick: 'ok' }, at) });
    },
  });

  ctx.operations.register({
    name: 'moderation.actions.ban',
    permission: 'moderation.actions.ban',
    input: banInput,
    handler: async (
      actor,
      input: z.output<typeof banInput>,
    ): Promise<OperationResult<ActionResult>> => {
      const refusal = await protect(actor, input.userId, false);
      if (refusal !== undefined) return refusal;
      const at = now();
      const days = input.deleteDays ?? 0;
      const result = await deps.guild.ban(input.userId, input.reason, days * DAY_SECONDS);
      if (!result.ok) return refuse(result.error);
      return ok({ caseId: record(actor, 'ban', input, { ban: 'ok' }, at) });
    },
  });
}
