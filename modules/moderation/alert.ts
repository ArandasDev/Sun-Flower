import type { CaseRecord } from './cases.ts';

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

/** Staff alert for an automatic case, in the exact format of spec §4.6. */
export function formatAlert(record: CaseRecord, messageUrl: string): string {
  const id = String(record.id);
  const confirmed = record.level === 'confirmed';
  const channel = record.channelId === null ? '—' : `<#${record.channelId}>`;
  const domains = formatDomains(record.domains);
  const signals = record.signals.map((s) => `${s.name} (${String(s.points)})`).join(', ');

  const lines = [
    confirmed ? `🚨 Caso #${id} — violação confirmada` : `⚠️ Caso #${id} — suspeito`,
    `Usuário: <@${record.targetUserId}> · Canal: ${channel}`,
    `Domínios: ${domains}`,
    `Sinais: ${signals} = ${String(record.score)}`,
  ];
  if (confirmed) {
    lines.push(`Ação: ${confirmedAction(record)}`, `Reverter: /mod case revert ${id}`);
  } else {
    lines.push(
      'Ação: nenhuma',
      `Mensagem: ${messageUrl}`,
      `Sugestão: /mod case dismiss ${id} ou /mod timeout`,
    );
  }
  return truncate(lines.join('\n'), MAX_ALERT_LENGTH);
}
