import type { DiscordMessagePayload } from '../../shared/contracts/discord-events.ts';
import type { GuildActionResult, GuildActions } from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { formatAlert } from './alert.ts';
import type { CaseRecord, CaseStore, NewCase } from './cases.ts';
import type { ModerationConfig } from './config.ts';
import type { MultiChannelTracker } from './detection/multi-channel.ts';
import { analyzeMessage } from './detection/score.ts';
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

  constructor(deps: ResponderDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
  }

  /** Never rejects: any failure is logged without the message content. */
  async handle(payload: DiscordMessagePayload): Promise<void> {
    try {
      await this.process(payload);
    } catch (error) {
      this.deps.logger.error({ error: errorMessage(error) }, 'moderation analysis failed');
    }
  }

  private async process(payload: DiscordMessagePayload): Promise<void> {
    const { guild, cases, lists, tracker } = this.deps;
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

    // One case per message: an edit only opens a new case when the level goes up.
    const previous = cases.findLatestByMessage(payload.messageId);
    if (previous !== undefined && rank(previous.level) >= rank(level)) return;

    const confirmed = level === 'confirmed';
    const reason = `phishing: ${analysis.signals.map((s) => s.name).join(', ')}`;
    const timeoutMs = config.timeoutMinutes * 60_000;
    let outcome: Record<string, string> = {};
    if (confirmed) {
      const [deleted, timedOut] = await Promise.allSettled([
        Promise.resolve().then(() => guild.deleteMessage(payload.channelId, payload.messageId)),
        Promise.resolve().then(() => guild.timeout(payload.authorId, timeoutMs, reason)),
      ]);
      outcome = { delete: outcomeOf(deleted), timeout: outcomeOf(timedOut) };
    }

    const newCase: NewCase = {
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
      timeoutUntil: confirmed ? new Date(now.getTime() + timeoutMs).toISOString() : null,
      createdAt: now.toISOString(),
    };
    const caseId = cases.create(newCase);
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
