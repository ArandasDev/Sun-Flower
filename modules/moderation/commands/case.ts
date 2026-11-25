import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import type { CaseDetail, CaseSummary } from '../operations/cases.ts';
import type { ModCommandDeps } from './mod-command.ts';
import { CASE_DISMISSED, CASE_NOT_FOUND, CASE_REVERTED } from './replies.ts';

const EPHEMERAL = { ephemeral: true } as const;
const RECENT_LIMIT = 10;
const MAX_DOMAINS = 5;
const DOMAIN_MAX = 100;
const REPLY_MAX = 2000;

const clip = (text: string): string =>
  text.length > DOMAIN_MAX ? `${text.slice(0, DOMAIN_MAX - 1)}…` : text;

export async function caseView(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const number = interaction.options.getInteger('number');
  if (number === undefined) {
    await interaction.reply(CASE_NOT_FOUND, EPHEMERAL);
    return;
  }
  const result = await deps.operations.execute('moderation.cases.view', interaction.actor, {
    id: number,
  });
  if (!result.ok) {
    await interaction.reply(result.error.message, EPHEMERAL);
    return;
  }
  const record = result.data as CaseDetail;
  const lines = [
    `Caso #${String(record.id)}`,
    `Nível: ${record.level ?? 'manual'}`,
    `Ação: ${record.action}`,
    `Status: ${record.status}`,
    `Usuário: <@${record.targetUserId}>`,
  ];
  if (record.channelId !== null) lines.push(`Canal: <#${record.channelId}>`);
  if (record.domains.length > 0) {
    const shown = record.domains.slice(0, MAX_DOMAINS).map((d) => `\`${clip(d)}\``);
    const more = record.domains.length - shown.length;
    const suffix = more > 0 ? ` e mais ${String(more)}` : '';
    lines.push(`Domínios: ${shown.join(', ')}${suffix}`);
  }
  if (record.signals.length > 0) {
    lines.push(
      `Sinais: ${record.signals.map((s) => `${s.name} (${String(s.points)})`).join(', ')}`,
    );
  }
  lines.push(`Motivo: ${record.reason}`);
  const steps = Object.entries(record.outcome);
  if (steps.length > 0) {
    lines.push(`Resultado: ${steps.map(([step, result]) => `${step}: ${result}`).join(', ')}`);
  }
  lines.push(`Criado em: ${record.createdAt}`);
  if (record.revertedBy !== null && record.revertedAt !== null) {
    lines.push(
      record.status === 'dismissed'
        ? `Descarte: descartado por <@${record.revertedBy}> em ${record.revertedAt}`
        : `Reversão: revertido por <@${record.revertedBy}> em ${record.revertedAt}`,
    );
  }
  const text = lines.join('\n');
  await interaction.reply(
    text.length > REPLY_MAX ? `${text.slice(0, REPLY_MAX - 1)}…` : text,
    EPHEMERAL,
  );
}

export async function caseList(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const user = interaction.options.getUser('user');
  const result = await deps.operations.execute('moderation.cases.list', interaction.actor, {
    ...(user === undefined ? {} : { targetUserId: user }),
  });
  if (!result.ok) {
    await interaction.reply(result.error.message, EPHEMERAL);
    return;
  }
  const records = (result.data as { cases: CaseSummary[] }).cases.slice(0, RECENT_LIMIT);
  if (records.length === 0) {
    await interaction.reply('Nenhum caso.', EPHEMERAL);
    return;
  }
  const lines = records.map(
    (r) =>
      `#${String(r.id)} · ${r.level ?? 'manual'} · ${r.action} · ${r.status} · <@${r.targetUserId}> · ${r.createdAt}`,
  );
  await interaction.reply(lines.join('\n'), EPHEMERAL);
}

export async function caseRevert(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const number = interaction.options.getInteger('number');
  if (number === undefined) {
    await interaction.reply(CASE_NOT_FOUND, EPHEMERAL);
    return;
  }
  const result = await deps.operations.execute('moderation.cases.revert', interaction.actor, {
    id: number,
    allowDomains: interaction.options.getBoolean('allow-domain') === true,
  });
  if (!result.ok) {
    await interaction.reply(result.error.message, EPHEMERAL);
    return;
  }
  const data = result.data as { case: CaseDetail; deletedMessage: boolean };
  await interaction.reply(CASE_REVERTED(data.case.id, data.deletedMessage), EPHEMERAL);
}

export async function caseDismiss(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const number = interaction.options.getInteger('number');
  if (number === undefined) {
    await interaction.reply(CASE_NOT_FOUND, EPHEMERAL);
    return;
  }
  const result = await deps.operations.execute('moderation.cases.dismiss', interaction.actor, {
    id: number,
  });
  await interaction.reply(
    result.ok ? CASE_DISMISSED((result.data as CaseDetail).id) : result.error.message,
    EPHEMERAL,
  );
}
