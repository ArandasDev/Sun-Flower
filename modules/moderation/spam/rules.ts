import type { RuleHit } from '../cases.ts';
import type { ModerationConfig, SpamRuleName } from '../config.ts';
import { fingerprintOf } from './activity.ts';
import type { ActivityLog } from './activity.ts';

const COOLDOWN_MS = 30_000;
const BROADCAST_WEIGHT = 3;

export interface SpamHit extends RuleHit {
  /** Messages that made the rule fire (for `mentions`, only the current one). */
  messageIds: readonly string[];
}

export interface SpamInput {
  authorId: string;
  messageId: string;
  channelId: string;
  content: string;
  nowMs: number;
  isEdit: boolean;
}

export interface SpamDeps {
  activity: ActivityLog;
  cooldown: SpamCooldown;
  config: ModerationConfig['spam'];
}

/** Distinct user and role mentions, plus 3 for each literal @everyone or @here. */
export function countMentions(content: string): number {
  const text = content
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`[^`\n]*`/gu, ' ')
    .replace(/\\<@[!&]?\d+>/gu, ' ')
    .replace(/\\@(?:everyone|here)/gu, ' ');
  const users = new Set<string>();
  const roles = new Set<string>();
  for (const match of text.matchAll(/<@(!|&)?(\d{17,20})>/gu)) {
    const id = match[2];
    if (id === undefined) continue;
    (match[1] === '&' ? roles : users).add(id);
  }
  // Both boundaries, so e-mail-like text (`fulano@everyone.com.br`) never counts.
  const broadcasts =
    text.match(/(?<![\p{L}\p{N}_.])@(?:everyone|here)(?![\p{L}\p{N}_])/gu)?.length ?? 0;
  return users.size + roles.size + broadcasts * BROADCAST_WEIGHT;
}

export class SpamCooldown {
  private readonly marks = new Map<string, number>();

  isCooling(authorId: string, rule: SpamRuleName, nowMs: number): boolean {
    const markedAt = this.marks.get(`${authorId}:${rule}`);
    return markedAt !== undefined && nowMs - markedAt < COOLDOWN_MS;
  }

  mark(authorId: string, rule: SpamRuleName, nowMs: number): void {
    this.marks.set(`${authorId}:${rule}`, nowMs);
  }

  prune(nowMs: number): void {
    for (const [key, markedAt] of this.marks) {
      if (nowMs - markedAt > COOLDOWN_MS) this.marks.delete(key);
    }
  }
}

export function evaluateSpam(input: SpamInput, deps: SpamDeps): SpamHit[] {
  const { authorId, messageId, channelId, content, nowMs, isEdit } = input;
  const { activity, cooldown, config } = deps;
  if (config.ignoredChannelIds.includes(channelId)) return [];

  const hits: SpamHit[] = [];
  const fire = (hit: SpamHit): void => {
    if (cooldown.isCooling(authorId, hit.rule, nowMs)) return;
    cooldown.mark(authorId, hit.rule, nowMs);
    hits.push(hit);
  };

  if (!isEdit) {
    const fingerprint = fingerprintOf(content);
    activity.record(authorId, { messageId, channelId, atMs: nowMs, fingerprint });

    const { flood, repeat } = config;
    if (flood.enabled) {
      const entries = activity.since(authorId, nowMs - flood.seconds * 1000);
      if (entries.length >= flood.limit) {
        fire({
          rule: 'flood',
          count: entries.length,
          seconds: flood.seconds,
          messageIds: entries.map((entry) => entry.messageId),
        });
      }
    }
    if (repeat.enabled && fingerprint !== null) {
      const entries = activity
        .since(authorId, nowMs - repeat.seconds * 1000)
        .filter((entry) => entry.fingerprint === fingerprint);
      if (entries.length >= repeat.limit) {
        fire({
          rule: 'repeat',
          count: entries.length,
          seconds: repeat.seconds,
          messageIds: entries.map((entry) => entry.messageId),
        });
      }
    }
  }

  if (config.mentions.enabled) {
    const count = countMentions(content);
    if (count >= config.mentions.limit) fire({ rule: 'mentions', count, messageIds: [messageId] });
  }
  return hits;
}
