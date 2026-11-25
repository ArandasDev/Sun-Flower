import { z } from 'zod';

import type { Actor } from '../../../shared/contracts/commands.ts';
import type { GuildActionResult, GuildActions } from '../../../shared/contracts/guild.ts';
import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { fail, ok } from '../../../shared/contracts/operations.ts';
import type { OperationResult } from '../../../shared/contracts/operations.ts';
import type { CaseRecord, CaseStore, RuleHit } from '../cases.ts';
import {
  CASE_NOT_FOUND,
  CASE_NOT_OPEN,
  CASE_NOT_REVERTIBLE,
  DISCORD_REFUSED,
  LOOKALIKE_NOT_ALLOWED,
} from '../commands/replies.ts';
import { SPAM_RULES, snowflake } from '../config.ts';
import { isLookalike } from '../detection/lookalike.ts';
import type { DomainStore } from '../domains.ts';

const READ_PERMISSION = 'moderation.cases.read';
const REVERT_PERMISSION = 'moderation.cases.revert';
const PAGE_SIZE = 50;
const MINE_LIMIT = 50;

export interface CaseOperationDeps {
  readonly cases: () => CaseStore;
  readonly domains: () => DomainStore;
  readonly guild: GuildActions;
  publish(type: string, payload: unknown): void;
  readonly now?: () => Date;
}

export type CaseSummary = Pick<
  CaseRecord,
  'id' | 'kind' | 'level' | 'action' | 'status' | 'targetUserId' | 'createdAt'
> & { rules: RuleHit['rule'][] };

/** The panel does not build the message link in this stage, so the message id is left out. */
export type CaseDetail = Omit<CaseRecord, 'messageId'>;

export const listInput = z.object({
  status: z.enum(['open', 'actioned', 'reverted', 'dismissed']).optional(),
  rule: z.enum(SPAM_RULES).optional(),
  targetUserId: snowflake.optional(),
  cursor: z.number().int().min(1).optional(),
});
export const idInput = z.object({ id: z.number().int().min(1) });
export const revertInput = z.object({
  id: z.number().int().min(1),
  allowDomains: z.boolean().optional(),
});
export const mineInput = z.object({});

function summary(record: CaseRecord): CaseSummary {
  return {
    id: record.id,
    kind: record.kind,
    level: record.level,
    action: record.action,
    status: record.status,
    targetUserId: record.targetUserId,
    rules: record.rules.map((hit) => hit.rule),
    createdAt: record.createdAt,
  };
}

function detail(record: CaseRecord): CaseDetail {
  return {
    id: record.id,
    kind: record.kind,
    level: record.level,
    action: record.action,
    status: record.status,
    targetUserId: record.targetUserId,
    actorUserId: record.actorUserId,
    channelId: record.channelId,
    domains: record.domains,
    signals: record.signals,
    rules: record.rules,
    score: record.score,
    reason: record.reason,
    outcome: record.outcome,
    timeoutUntil: record.timeoutUntil,
    createdAt: record.createdAt,
    revertedBy: record.revertedBy,
    revertedAt: record.revertedAt,
  };
}

function undoOnDiscord(record: CaseRecord, guild: GuildActions): Promise<GuildActionResult> {
  switch (record.action) {
    case 'delete_timeout':
    case 'timeout':
      return guild.removeTimeout(record.targetUserId);
    case 'ban':
      return guild.unban(record.targetUserId);
    case 'kick':
    case 'warn':
    case 'none':
      return Promise.resolve({ ok: true });
  }
}

/** Whether the case removed messages that a revert cannot bring back. */
function deletedMessages(record: CaseRecord): boolean {
  if (record.action === 'delete_timeout') return true;
  const spam = record.kind === 'automatic' && record.rules.length > 0;
  return (
    spam &&
    (record.action === 'kick' || record.action === 'ban') &&
    Number(record.outcome['deleted'] ?? '0') > 0
  );
}

export function registerCaseOperations(
  ctx: Pick<ModuleContext, 'operations'>,
  deps: CaseOperationDeps,
): void {
  const now = deps.now ?? ((): Date => new Date());

  ctx.operations.register({
    name: 'moderation.cases.list',
    permission: READ_PERMISSION,
    input: listInput,
    handler: (_actor, input: z.output<typeof listInput>) => {
      // One extra row tells whether another page exists.
      const rows = deps.cases().listPage({
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.rule === undefined ? {} : { rule: input.rule }),
        ...(input.targetUserId === undefined ? {} : { targetUserId: input.targetUserId }),
        ...(input.cursor === undefined ? {} : { before: input.cursor }),
        limit: PAGE_SIZE + 1,
      });
      const page = rows.slice(0, PAGE_SIZE);
      const last = page.at(-1);
      const nextCursor = rows.length > PAGE_SIZE && last !== undefined ? last.id : null;
      return Promise.resolve(ok({ cases: page.map(summary), nextCursor }));
    },
  });

  ctx.operations.register({
    name: 'moderation.cases.view',
    permission: READ_PERMISSION,
    input: idInput,
    handler: (_actor, input: z.output<typeof idInput>) => {
      const record = deps.cases().get(input.id);
      return Promise.resolve(
        record === undefined ? fail('not_found', CASE_NOT_FOUND) : ok(detail(record)),
      );
    },
  });

  ctx.operations.register({
    name: 'moderation.cases.revert',
    permission: REVERT_PERMISSION,
    input: revertInput,
    handler: async (
      actor: Actor,
      input: z.output<typeof revertInput>,
    ): Promise<OperationResult<{ case: CaseDetail; deletedMessage: boolean }>> => {
      const cases = deps.cases();
      const record = cases.get(input.id);
      if (record === undefined) return fail('not_found', CASE_NOT_FOUND);
      if (record.status !== 'open' && record.status !== 'actioned') {
        return fail('conflict', CASE_NOT_REVERTIBLE);
      }
      const allowDomains = input.allowDomains === true;
      // Validate before any Discord call so a refusal leaves everything untouched.
      if (allowDomains && record.domains.some((domain) => isLookalike(domain))) {
        return fail('invalid', LOOKALIKE_NOT_ALLOWED);
      }

      const result = await undoOnDiscord(record, deps.guild);
      if (!result.ok && result.error !== 'not_found') {
        return fail(
          'failed',
          DISCORD_REFUSED(result.error === 'forbidden' ? 'sem permissão' : 'falha'),
        );
      }

      const at = now().toISOString();
      if (!cases.setStatus(record.id, 'reverted', actor.userId, at)) {
        return fail('conflict', CASE_NOT_REVERTIBLE);
      }
      if (allowDomains) {
        for (const domain of record.domains) deps.domains().set(domain, 'allow', actor.userId, at);
      }
      deps.publish('moderation.case.reverted', { caseId: record.id });
      const updated = cases.get(record.id) ?? record;
      return ok({ case: detail(updated), deletedMessage: deletedMessages(record) });
    },
  });

  ctx.operations.register({
    name: 'moderation.cases.dismiss',
    permission: REVERT_PERMISSION,
    input: idInput,
    handler: (actor, input: z.output<typeof idInput>) => {
      const cases = deps.cases();
      const record = cases.get(input.id);
      if (record === undefined) return Promise.resolve(fail('not_found', CASE_NOT_FOUND));
      if (!cases.setStatus(record.id, 'dismissed', actor.userId, now().toISOString())) {
        return Promise.resolve(fail('conflict', CASE_NOT_OPEN));
      }
      deps.publish('moderation.case.dismissed', { caseId: record.id });
      return Promise.resolve(ok(detail(cases.get(record.id) ?? record)));
    },
  });

  ctx.operations.register({
    name: 'moderation.cases.mine',
    permission: null,
    input: mineInput,
    handler: (actor) =>
      Promise.resolve(
        ok({
          cases: deps
            .cases()
            .listForTarget(actor.userId, MINE_LIMIT)
            .map((r) => ({
              id: r.id,
              createdAt: r.createdAt,
              kind: r.kind,
              action: r.action,
              status: r.status,
            })),
        }),
      ),
  });
}
