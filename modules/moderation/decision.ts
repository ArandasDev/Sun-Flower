import type { ModerationConfig, Punishment } from './config.ts';
import type { Analysis } from './detection/score.ts';
import { escalationStep, mostSevere } from './spam/escalation.ts';
import type { SpamHit } from './spam/rules.ts';

export interface Decision {
  level: 'confirmed' | 'suspicious' | undefined;
  punishment: Punishment;
  deleteMinutes: number;
  deleteMessageIds: readonly string[];
  spamHits: readonly SpamHit[];
  /** 1-based escalation step; set only when escalation applied. */
  escalationStep: number | undefined;
  reason: string;
}

export interface DecideInput {
  analysis: Analysis;
  spamHits: readonly SpamHit[];
  config: ModerationConfig;
  priorActionedSpam: number;
  messageId: string;
}

function rulePunishment(rule: SpamHit['rule'], config: ModerationConfig): Punishment {
  const settings = config.spam[rule];
  switch (settings.punishment) {
    case 'timeout':
      return { kind: 'timeout', minutes: settings.timeoutMinutes };
    case 'kick':
      return { kind: 'kick' };
    case 'ban':
      return { kind: 'ban' };
    case 'none':
      return { kind: 'none' };
  }
}

export function decide(input: DecideInput): Decision {
  const { analysis, spamHits, config, priorActionedSpam, messageId } = input;
  const phishingConfirmed = analysis.level === 'confirmed';
  const phishingTimeout: Punishment = { kind: 'timeout', minutes: config.timeoutMinutes };
  const phishingReason = `phishing: ${analysis.signals.map((s) => s.name).join(', ')}`;

  if (spamHits.length === 0) {
    return {
      level: analysis.level,
      punishment: phishingConfirmed ? phishingTimeout : { kind: 'none' },
      deleteMinutes: 0,
      deleteMessageIds: phishingConfirmed ? [messageId] : [],
      spamHits: [],
      escalationStep: undefined,
      reason: phishingReason,
    };
  }

  const punishing = spamHits
    .map((hit) => rulePunishment(hit.rule, config))
    .filter((p) => p.kind !== 'none');

  let step: number | undefined;
  const candidates: Punishment[] = [...punishing];
  if (config.spam.escalation.enabled && punishing.length > 0) {
    const escalated = escalationStep(config.spam.escalation.steps, priorActionedSpam);
    step = escalated.step;
    candidates.push(escalated.punishment);
  }
  if (phishingConfirmed) candidates.push(phishingTimeout);

  const deleteMinutes = Math.max(...spamHits.map((hit) => config.spam[hit.rule].deleteMinutes));
  const ids = new Set<string>();
  for (const hit of spamHits) for (const id of hit.messageIds) ids.add(id);
  ids.add(messageId);

  const reasons = [`spam: ${spamHits.map((hit) => hit.rule).join(', ')}`];
  if (analysis.level !== undefined) reasons.push(phishingReason);

  return {
    level: punishing.length > 0 || phishingConfirmed ? 'confirmed' : 'suspicious',
    punishment: mostSevere(...candidates),
    deleteMinutes,
    deleteMessageIds: [...ids],
    spamHits,
    escalationStep: step,
    reason: reasons.join('; '),
  };
}
