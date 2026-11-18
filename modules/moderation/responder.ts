import type { DiscordMessagePayload } from '../../shared/contracts/discord-events.ts';
import type { GuildActionResult, GuildActions } from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { formatAlert } from './alert.ts';
import type { CaseRecord, CaseStore, NewCase } from './cases.ts';
import type { ModerationConfig } from './config.ts';
import type { MultiChannelTracker } from './detection/multi-channel.ts';
import { analyzeMessage } from './detection/score.ts';
import type { Analysis } from './detection/score.ts';
import type { DomainStore } from './domains.ts';

export const CASE_CREATED = 'moderation.case.created';

export interface ResponderDeps {
  guild: GuildActions;
  cases: CaseStore;
  lists: DomainStore;
  tracker: MultiChannelTracker;
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

  constructor(deps: ResponderDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
  }

  /** Never rejects: any failure is logged without the message content. */
  async handle(payload: DiscordMessagePayload): Promise<void> {
    try {
      await this.process(payload);
    } catch (error) {
      this.deps.logger.error({ error: errorName(error) }, 'moderation analysis failed');
    }
  }

  private async process(payload: DiscordMessagePayload): Promise<void> {
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
    const { level } = analysis;
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

    let newCase: NewCase;
    let caseId: number;
    try {
      newCase = await this.act(payload, analysis, level, config, now);
      caseId = cases.create(newCase);
    } finally {
      // A higher-level analysis may have replaced the entry; leave that one alone.
      if (this.inFlight.get(messageId) === level) this.inFlight.delete(messageId);
    }
    this.deps.publish(CASE_CREATED, {
      caseId,
      kind: newCase.kind,
      level,
      action: newCase.action,
    });

    await this.alert(
      config,
      { ...newCase, id: caseId, revertedBy: null, revertedAt: null },
      payload,
    );
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
        formatAlert(record, payload.messageUrl),
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
