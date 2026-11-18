import type { CaseRecord, RuleHit } from './cases.ts';

const FAILURE_LABELS: Readonly<Record<string, string>> = {
  forbidden: 'sem permissão',
  not_found: 'não encontrado',
  failed: 'falha',
};

function failureLabel(result: string): string {
  return FAILURE_LABELS[result] ?? 'falha';
}

function timeoutMinutes(record: CaseRecord): number {
  if (record.timeoutUntil === null) return 0;
  return Math.round((Date.parse(record.timeoutUntil) - Date.parse(record.createdAt)) / 60_000);
}

function confirmedAction(record: CaseRecord): string {
  const parts: string[] = [];
  const deleted = record.outcome['delete'];
  if (deleted !== undefined) {
    parts.push(
      deleted === 'ok' ? 'mensagem apagada' : `mensagem não apagada (${failureLabel(deleted)})`,
    );
  }
  const timeout = record.outcome['timeout'];
  if (timeout !== undefined) {
    parts.push(
      timeout === 'ok'
        ? `timeout de ${String(timeoutMinutes(record))} min`
        : `timeout não aplicado (${failureLabel(timeout)})`,
    );
  }
  return parts.length === 0 ? 'nenhuma' : parts.join(', ');
}

/** Discord rejects messages longer than this, which would drop the alert. */
export const MAX_ALERT_LENGTH = 2000;
const MAX_LISTED_DOMAINS = 5;
const MAX_DOMAIN_LENGTH = 100;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatDomains(domains: readonly string[]): string {
  if (domains.length === 0) return '—';
  const listed = domains
    .slice(0, MAX_LISTED_DOMAINS)
    .map((d) => `\`${truncate(d, MAX_DOMAIN_LENGTH)}\``)
    .join(', ');
  const rest = domains.length - MAX_LISTED_DOMAINS;
  return rest > 0 ? `${listed} e mais ${String(rest)}` : listed;
}

/** Spam details the case record does not keep. */
export interface SpamAlertDetails {
  /** How many message IDs were sent to bulk deletion. */
  requested: number;
  /** 1-based escalation step, when escalation applied. */
  escalationStep?: number | undefined;
}

const MAX_RULES_LINE_LENGTH = 500;

function formatRule(hit: RuleHit): string {
  const count = String(hit.count);
  const window = hit.seconds === undefined ? '' : ` em ${String(hit.seconds)} s`;
  switch (hit.rule) {
    case 'flood':
      return `flood (${count} mensagens${window})`;
    case 'repeat':
      return `repeat (${count} cópias${window})`;
    case 'mentions':
      return `mentions (${count} menções)`;
  }
}

const PUNISHMENT_LABELS = {
  kick: { ok: 'expulsão', failed: 'expulsão não aplicada' },
  ban: { ok: 'banimento', failed: 'banimento não aplicado' },
} as const;

/** Whether the current message may still be up after a spam response. */
function spamMessageMayRemain(record: CaseRecord, requested: number): boolean {
  const bulk = record.outcome['bulk'];
  if (bulk === undefined) return record.outcome['ban'] !== 'ok';
  return Number(record.outcome['deleted'] ?? '0') < requested;
}

function spamAction(record: CaseRecord, spam: SpamAlertDetails): string {
  const { outcome } = record;
  const parts: string[] = [];
  const bulk = outcome['bulk'];
  if (bulk !== undefined) {
    const deleted = Number(outcome['deleted'] ?? '0');
    const requested = Math.max(spam.requested, deleted);
    if (deleted === 0) parts.push(`mensagens não apagadas (${failureLabel(bulk)})`);
    else if (deleted < requested) {
      parts.push(`exclusão parcial: ${String(deleted)} de ${String(requested)} apagadas`);
    } else
      parts.push(deleted === 1 ? '1 mensagem apagada' : `${String(deleted)} mensagens apagadas`);
  }
  const timeout = outcome['timeout'];
  if (timeout !== undefined) {
    parts.push(
      timeout === 'ok'
        ? `timeout de ${String(timeoutMinutes(record))} min`
        : `timeout não aplicado (${failureLabel(timeout)})`,
    );
  }
  for (const kind of ['kick', 'ban'] as const) {
    const result = outcome[kind];
    if (result === undefined) continue;
    const labels = PUNISHMENT_LABELS[kind];
    if (result !== 'ok') parts.push(`${labels.failed} (${failureLabel(result)})`);
    // Without a bulk deletion, the ban itself removed the recent messages.
    else if (kind === 'ban' && bulk === undefined) {
      parts.push('banimento com exclusão das mensagens recentes');
    } else parts.push(labels.ok);
  }
  const text = parts.length === 0 ? 'nenhuma' : parts.join(', ');
  const step = spam.escalationStep;
  return step !== undefined && step > 1 ? `${text} (reincidência ${String(step)})` : text;
}

/** Staff alert for an automatic case, in the exact format of spec §4.6 (stage 1) and §4.8. */
export function formatAlert(
  record: CaseRecord,
  messageUrl: string,
  spam: SpamAlertDetails = { requested: 0 },
): string {
  const id = String(record.id);
  const confirmed = record.level === 'confirmed';
  const isSpam = record.rules.length > 0;
  const channel = record.channelId === null ? '—' : `<#${record.channelId}>`;
  const domains = formatDomains(record.domains);
  const signals = record.signals.map((s) => `${s.name} (${String(s.points)})`).join(', ');

  const lines = [
    confirmed ? `🚨 Caso #${id} — violação confirmada` : `⚠️ Caso #${id} — suspeito`,
    `Usuário: <@${record.targetUserId}> · Canal: ${channel}`,
  ];
  // A spam-only case has no link analysis to show.
  if (!isSpam || record.signals.length > 0 || record.domains.length > 0) {
    lines.push(`Domínios: ${domains}`, `Sinais: ${signals} = ${String(record.score)}`);
  }
  if (isSpam) {
    const rules = record.rules.map(formatRule).join(', ');
    lines.push(truncate(`Regras: ${rules}`, MAX_RULES_LINE_LENGTH));
  }
  if (confirmed && isSpam) {
    lines.push(`Ação: ${spamAction(record, spam)}`);
    if (spamMessageMayRemain(record, spam.requested)) lines.push(`Mensagem: ${messageUrl}`);
    lines.push(`Reverter: /mod case revert ${id}`);
  } else if (confirmed) {
    lines.push(`Ação: ${confirmedAction(record)}`);
    // The message is still up: give staff the link to remove it by hand.
    if (record.outcome['delete'] !== 'ok') lines.push(`Mensagem: ${messageUrl}`);
    lines.push(`Reverter: /mod case revert ${id}`);
  } else {
    lines.push(
      'Ação: nenhuma',
      `Mensagem: ${messageUrl}`,
      `Sugestão: /mod case dismiss ${id} ou /mod timeout`,
    );
  }
  return truncate(lines.join('\n'), MAX_ALERT_LENGTH);
}
