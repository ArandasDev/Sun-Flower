import type { DiscordMessagePayload } from '../../shared/contracts/discord-events.ts';
import type {
  BulkDeleteResult,
  GuildActionResult,
  GuildActions,
} from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { formatAlert } from './alert.ts';
import type { SpamAlertDetails } from './alert.ts';
import type { CaseAction, CaseRecord, CaseStore, NewCase, RuleHit } from './cases.ts';
import type { ModerationConfig, Punishment } from './config.ts';
import { decide } from './decision.ts';
import type { Decision } from './decision.ts';
import type { MultiChannelTracker } from './detection/multi-channel.ts';
import { analyzeMessage } from './detection/score.ts';
import type { Analysis } from './detection/score.ts';
import type { DomainStore } from './domains.ts';
import type { ActivityLog } from './spam/activity.ts';
import { evaluateSpam } from './spam/rules.ts';
import type { SpamCooldown, SpamHit } from './spam/rules.ts';

export const CASE_CREATED = 'moderation.case.created';

export interface ResponderDeps {
  guild: GuildActions;
  cases: CaseStore;
  lists: DomainStore;
  tracker: MultiChannelTracker;
  activity: ActivityLog;
  cooldown: SpamCooldown;
  config: () => ModerationConfig;
  isDeveloper(userId: string): boolean;
  publish(type: string, payload: unknown): void;
  logger: Logger;
  now?: () => Date;
}

type Level = 'confirmed' | 'suspicious';

const LEVEL_RANK: Readonly<Record<Level, number>> = { suspicious: 1, confirmed: 2 };

function rank(level: Level | null): number {
  return level === null ? 0 : LEVEL_RANK[level];
}

/** Only the error class: a message could echo message content or IDs. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** A timeout the Discord side refused leaves no timeout to track or revert. */
const TIMEOUT_NOT_APPLIED: ReadonlySet<string> = new Set(['forbidden', 'not_found']);

/** Bulk deletion accepts at most this many IDs per call. */
const BULK_LIMIT = 100;

const SPAM_ACTIONS: Readonly<Record<Punishment['kind'], CaseAction>> = {
  none: 'none',
  timeout: 'delete_timeout',
  kick: 'kick',
  ban: 'ban',
};

function outcomeOf(settled: PromiseSettledResult<GuildActionResult>): string {
  if (settled.status === 'rejected') return 'failed';
  return settled.value.ok ? 'ok' : settled.value.error;
}

/**
 * Analyzes each message and responds: deletes and times out on `confirmed`, records the case
 * and alerts the staff. Logs never carry message content or IDs other than the case number.
 */
export class Responder {
  private readonly deps: ResponderDeps;
  private readonly now: () => Date;
  private warnedNoAlertChannel = false;
  /** Level of each analysis still between its dedupe check and `cases.create`. */
  private readonly inFlight = new Map<string, Level>();
  /** Confirmed spam cases per author still between the dedupe check and `cases.create`. */
  private readonly inFlightSpam = new Map<string, number>();

  constructor(deps: ResponderDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Never rejects: any failure is logged without the message content. Edits (`updated`) are not
   * recorded as activity, so they never count toward flood or repeat.
   */
  async handle(
    payload: DiscordMessagePayload,
    kind: 'created' | 'updated' = 'created',
  ): Promise<void> {
    try {
      await this.process(payload, kind);
    } catch (error) {
      this.deps.logger.error({ error: errorName(error) }, 'moderation analysis failed');
    }
  }

  /** A failing spam rule must not stop the phishing analysis of the same message. */
  private spamHits(
    payload: DiscordMessagePayload,
    kind: 'created' | 'updated',
    config: ModerationConfig,
    nowMs: number,
  ): SpamHit[] {
    const { activity, cooldown, logger } = this.deps;
    try {
      return evaluateSpam(
        {
          authorId: payload.authorId,
          messageId: payload.messageId,
          channelId: payload.channelId,
          content: payload.content,
          nowMs,
          isEdit: kind === 'updated',
        },
        { activity, cooldown, config: config.spam },
      );
    } catch (error) {
      logger.error({ error: errorName(error) }, 'moderation spam rules failed');
      return [];
    }
  }

  private async process(
    payload: DiscordMessagePayload,
    kind: 'created' | 'updated',
  ): Promise<void> {
    const { cases, lists, tracker } = this.deps;
    const config = this.deps.config();
    if (payload.authorRoleIds.some((role) => config.exemptRoleIds.includes(role))) return;
    if (this.deps.isDeveloper(payload.authorId)) return;

    const now = this.now();
    const analysis = analyzeMessage(
      {
        content: payload.content,
        authorId: payload.authorId,
        channelId: payload.channelId,
        authorAccountCreatedAt: payload.authorAccountCreatedAt,
        authorJoinedAt: payload.authorJoinedAt,
        now,
      },
      { lists, config, tracker },
    );
    const nowMs = now.getTime();
    const spamHits = this.spamHits(payload, kind, config, nowMs);
    if (analysis.level === undefined && spamHits.length === 0) return;

    // Counted before this message's case exists, so the first surge is step 1. Confirmed spam
    // cases of the same author still in flight count as actioned, so concurrent cases escalate.
    const { authorId } = payload;
    const priorActionedSpam =
      spamHits.length === 0
        ? 0
        : cases.countActionedSpamSince(
            authorId,
            new Date(nowMs - config.spam.escalation.windowHours * 3_600_000).toISOString(),
          ) + (this.inFlightSpam.get(authorId) ?? 0);
    const decision = decide({
      analysis,
      spamHits,
      config,
      priorActionedSpam,
      messageId: payload.messageId,
    });
    const { level } = decision;
    if (level === undefined) return;

    // One case per message: an edit only opens a new case when the level goes up. Handlers run
    // concurrently, so an analysis still in flight counts like a stored case. Everything from
    // here to `inFlight.set` is synchronous, so no other handler can interleave.
    const { messageId } = payload;
    const previous = cases.findLatestByMessage(messageId);
    if (previous !== undefined && rank(previous.level) >= rank(level)) return;
    const pending = this.inFlight.get(messageId);
    if (pending !== undefined && rank(pending) >= rank(level)) return;
    this.inFlight.set(messageId, level);
    const countsAsSpam = spamHits.length > 0 && level === 'confirmed';
    if (countsAsSpam) this.inFlightSpam.set(authorId, (this.inFlightSpam.get(authorId) ?? 0) + 1);

    let newCase: NewCase;
    let caseId: number;
    let spamDetails: SpamAlertDetails | undefined;
    try {
      if (spamHits.length === 0) {
        newCase = await this.act(payload, analysis, level, config, now);
      } else {
        const acted = await this.actOnSpam(payload, analysis, decision, level, now);
        newCase = acted.newCase;
        spamDetails = { requested: acted.requested, escalationStep: decision.escalationStep };
      }
      caseId = cases.create(newCase);
    } finally {
      // A higher-level analysis may have replaced the entry; leave that one alone.
      if (this.inFlight.get(messageId) === level) this.inFlight.delete(messageId);
      if (countsAsSpam) {
        const remaining = (this.inFlightSpam.get(authorId) ?? 1) - 1;
        if (remaining > 0) this.inFlightSpam.set(authorId, remaining);
        else this.inFlightSpam.delete(authorId);
      }
    }
    this.deps.publish(CASE_CREATED, {
      caseId,
      kind: newCase.kind,
      level,
      action: newCase.action,
    });

    await this.alert(
      config,
      { ...newCase, rules: newCase.rules ?? [], id: caseId, revertedBy: null, revertedAt: null },
      payload,
      spamDetails,
    );
  }

  /**
   * Message IDs to bulk-delete, grouped by channel in batches of up to 100: the author's messages
   * in the deletion window (or only the triggering ones when it is 0), plus the current message.
   */
  private deletionBatches(
    payload: DiscordMessagePayload,
    decision: Decision,
    nowMs: number,
  ): { channelId: string; ids: string[] }[] {
    const { activity } = this.deps;
    const channelOf = new Map<string, string>();
    for (const entry of activity.since(payload.authorId, Number.NEGATIVE_INFINITY)) {
      channelOf.set(entry.messageId, entry.channelId);
    }
    channelOf.set(payload.messageId, payload.channelId);

    const ids =
      decision.deleteMinutes > 0
        ? activity
            .since(payload.authorId, nowMs - decision.deleteMinutes * 60_000)
            .map((entry) => entry.messageId)
        : [...decision.deleteMessageIds];
    ids.push(payload.messageId);

    const byChannel = new Map<string, string[]>();
    for (const id of new Set(ids)) {
      const channelId = channelOf.get(id);
      if (channelId === undefined) continue;
      const list = byChannel.get(channelId) ?? [];
      list.push(id);
      byChannel.set(channelId, list);
    }
    const batches: { channelId: string; ids: string[] }[] = [];
    for (const [channelId, list] of byChannel) {
      for (let i = 0; i < list.length; i += BULK_LIMIT) {
        batches.push({ channelId, ids: list.slice(i, i + BULK_LIMIT) });
      }
    }
    return batches;
  }

  private async bulkDelete(
    batches: readonly { channelId: string; ids: string[] }[],
  ): Promise<Record<string, string>> {
    const { guild } = this.deps;
    const results = await Promise.allSettled(
      batches.map((batch) =>
        Promise.resolve().then(() => guild.bulkDeleteMessages(batch.channelId, batch.ids)),
      ),
    );
    let deleted = 0;
    let individually = 0;
    let firstError: string | undefined;
    for (const settled of results) {
      const result: BulkDeleteResult =
        settled.status === 'fulfilled' ? settled.value : { ok: false, error: 'failed', deleted: 0 };
      deleted += result.deleted;
      if (result.ok) individually += result.individually;
      else firstError ??= result.error;
    }
    return {
      deleted: String(deleted),
      individually: String(individually),
      bulk: firstError ?? 'ok',
    };
  }

  private punish(
    authorId: string,
    punishment: Punishment,
    reason: string,
    banDeleteSeconds: number,
  ): Promise<GuildActionResult> | undefined {
    const { guild } = this.deps;
    switch (punishment.kind) {
      case 'timeout':
        return Promise.resolve().then(() =>
          guild.timeout(authorId, punishment.minutes * 60_000, reason),
        );
      case 'kick':
        return Promise.resolve().then(() => guild.kick(authorId, reason));
      case 'ban':
        return Promise.resolve().then(() => guild.ban(authorId, reason, banDeleteSeconds));
      case 'none':
        return undefined;
    }
  }

  /** Bulk deletion and punishment run in parallel; only a `confirmed` decision acts. */
  private async actOnSpam(
    payload: DiscordMessagePayload,
    analysis: Analysis,
    decision: Decision,
    level: Level,
    now: Date,
  ): Promise<{ newCase: NewCase; requested: number }> {
    const { punishment, reason } = decision;
    const nowMs = now.getTime();
    const confirmed = level === 'confirmed';
    let outcome: Record<string, string> = {};
    let timeoutUntil: string | null = null;
    let punished = false;
    let requested = 0;

    if (confirmed) {
      // A ban with a deletion window lets Discord remove the messages in every channel.
      const banDeletes = punishment.kind === 'ban' && decision.deleteMinutes > 0;
      const batches = banDeletes ? [] : this.deletionBatches(payload, decision, nowMs);
      const sentIds = batches.flatMap((batch) => batch.ids);
      requested = sentIds.length;
      // Forgotten before any await, so a concurrent case of the same author (another rule on a
      // later message) cannot read and send these IDs again, whatever the batch results.
      this.deps.activity.forget(payload.authorId, sentIds);
      const punishing = this.punish(
        payload.authorId,
        punishment,
        reason,
        banDeletes ? decision.deleteMinutes * 60 : 0,
      );
      const [deletion, punishmentResult] = await Promise.allSettled([
        batches.length === 0 ? Promise.resolve(undefined) : this.bulkDelete(batches),
        punishing ?? Promise.resolve<GuildActionResult>({ ok: true }),
      ]);

      if (deletion.status === 'fulfilled' && deletion.value !== undefined) {
        outcome = { ...deletion.value };
      }
      if (punishing !== undefined && punishment.kind !== 'none') {
        const result = outcomeOf(punishmentResult);
        outcome[punishment.kind] = result;
        punished = result === 'ok';
        if (punishment.kind === 'timeout' && !TIMEOUT_NOT_APPLIED.has(result)) {
          timeoutUntil = new Date(nowMs + punishment.minutes * 60_000).toISOString();
        }
      }
    }

    const rules: RuleHit[] = decision.spamHits.map((hit) =>
      hit.seconds === undefined
        ? { rule: hit.rule, count: hit.count }
        : { rule: hit.rule, count: hit.count, seconds: hit.seconds },
    );
    return {
      requested,
      newCase: {
        kind: 'automatic',
        level,
        action: confirmed ? SPAM_ACTIONS[punishment.kind] : 'none',
        targetUserId: payload.authorId,
        actorUserId: null,
        channelId: payload.channelId,
        messageId: payload.messageId,
        domains: analysis.domains,
        signals: analysis.signals,
        rules,
        score: analysis.score,
        reason,
        outcome,
        status: punished ? 'actioned' : 'open',
        timeoutUntil,
        createdAt: now.toISOString(),
      },
    };
  }

  private async act(
    payload: DiscordMessagePayload,
    analysis: Analysis,
    level: Level,
    config: ModerationConfig,
    now: Date,
  ): Promise<NewCase> {
    const { guild } = this.deps;
    const confirmed = level === 'confirmed';
    const reason = `phishing: ${analysis.signals.map((s) => s.name).join(', ')}`;
    const timeoutMs = config.timeoutMinutes * 60_000;
    let outcome: Record<string, string> = {};
    let timeoutUntil: string | null = null;
    if (confirmed) {
      const [deleted, timedOut] = await Promise.allSettled([
        Promise.resolve().then(() => guild.deleteMessage(payload.channelId, payload.messageId)),
        Promise.resolve().then(() => guild.timeout(payload.authorId, timeoutMs, reason)),
      ]);
      outcome = { delete: outcomeOf(deleted), timeout: outcomeOf(timedOut) };
      // `failed` may still have reached Discord (e.g. our 10 s limit), so it keeps the deadline.
      if (!TIMEOUT_NOT_APPLIED.has(outcome['timeout'] ?? '')) {
        timeoutUntil = new Date(now.getTime() + timeoutMs).toISOString();
      }
    }

    return {
      kind: 'automatic',
      level,
      action: confirmed ? 'delete_timeout' : 'none',
      targetUserId: payload.authorId,
      actorUserId: null,
      channelId: payload.channelId,
      messageId: payload.messageId,
      domains: analysis.domains,
      signals: analysis.signals,
      score: analysis.score,
      reason,
      outcome,
      status: confirmed ? 'actioned' : 'open',
      timeoutUntil,
      createdAt: now.toISOString(),
    };
  }

  private async alert(
    config: ModerationConfig,
    record: CaseRecord,
    payload: DiscordMessagePayload,
    spam?: SpamAlertDetails,
  ): Promise<void> {
    const { logger, guild } = this.deps;
    if (config.alertChannelId === undefined) {
      if (!this.warnedNoAlertChannel) {
        this.warnedNoAlertChannel = true;
        logger.warn({ module: 'moderation' }, 'moderation alert channel not configured');
      }
      return;
    }
    let error: string | undefined;
    try {
      const result = await guild.sendMessage(
        config.alertChannelId,
        formatAlert(record, payload.messageUrl, spam),
      );
      if (!result.ok) error = result.error;
    } catch {
      error = 'failed';
    }
    if (error !== undefined) {
      logger.warn({ module: 'moderation', caseId: record.id, error }, 'moderation alert failed');
    }
  }
}
