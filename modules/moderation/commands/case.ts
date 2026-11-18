import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import type { GuildActionResult } from '../../../shared/contracts/guild.ts';
import type { CaseRecord } from '../cases.ts';
import { isLookalike } from '../detection/lookalike.ts';
import type { ModCommandDeps } from './mod-command.ts';
import {
  CASE_DISMISSED,
  CASE_NOT_FOUND,
  CASE_NOT_OPEN,
  CASE_NOT_REVERTIBLE,
  CASE_REVERTED,
  DISCORD_REFUSED,
  LOOKALIKE_NOT_ALLOWED,
} from './replies.ts';

const EPHEMERAL = { ephemeral: true } as const;
const RECENT_LIMIT = 10;
const MAX_DOMAINS = 5;
const DOMAIN_MAX = 100;
const REPLY_MAX = 2000;

const clip = (text: string): string =>
  text.length > DOMAIN_MAX ? `${text.slice(0, DOMAIN_MAX - 1)}…` : text;

const nowIso = (deps: ModCommandDeps): string => (deps.now ?? (() => new Date()))().toISOString();

function readCase(interaction: CommandInteraction, deps: ModCommandDeps): CaseRecord | undefined {
  const number = interaction.options.getInteger('number');
  return number === undefined ? undefined : deps.cases.get(number);
}

export async function caseView(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const record = readCase(interaction, deps);
  if (record === undefined) {
    await interaction.reply(CASE_NOT_FOUND, EPHEMERAL);
    return;
  }
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
    lines.push(`Reversão: revertido por <@${record.revertedBy}> em ${record.revertedAt}`);
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
  const records = deps.cases.listRecent(RECENT_LIMIT, user);
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

function undoOnDiscord(record: CaseRecord, deps: ModCommandDeps): Promise<GuildActionResult> {
  switch (record.action) {
    case 'delete_timeout':
    case 'timeout':
      return deps.guild.removeTimeout(record.targetUserId);
    case 'ban':
      return deps.guild.unban(record.targetUserId);
    case 'kick':
    case 'warn':
    case 'none':
      return Promise.resolve({ ok: true });
  }
}

export async function caseRevert(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const record = readCase(interaction, deps);
  if (record === undefined) {
    await interaction.reply(CASE_NOT_FOUND, EPHEMERAL);
    return;
  }
  if (record.status !== 'open' && record.status !== 'actioned') {
    await interaction.reply(CASE_NOT_REVERTIBLE, EPHEMERAL);
    return;
  }
  const allowDomain = interaction.options.getBoolean('allow-domain') === true;
  // Validate before any Discord call so a refusal leaves everything untouched.
  if (allowDomain && record.domains.some((domain) => isLookalike(domain))) {
    await interaction.reply(LOOKALIKE_NOT_ALLOWED, EPHEMERAL);
    return;
  }

  const result = await undoOnDiscord(record, deps);
  if (!result.ok && result.error !== 'not_found') {
    await interaction.reply(
      DISCORD_REFUSED(result.error === 'forbidden' ? 'sem permissão' : 'falha'),
      EPHEMERAL,
    );
    return;
  }

  const now = nowIso(deps);
  if (!deps.cases.setStatus(record.id, 'reverted', interaction.actor.userId, now)) {
    await interaction.reply(CASE_NOT_REVERTIBLE, EPHEMERAL);
    return;
  }
  if (allowDomain) {
    for (const domain of record.domains) {
      deps.domains.set(domain, 'allow', interaction.actor.userId, now);
    }
  }
  deps.publish('moderation.case.reverted', { caseId: record.id });
  await interaction.reply(CASE_REVERTED(record.id, record.action === 'delete_timeout'), EPHEMERAL);
}

export async function caseDismiss(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const record = readCase(interaction, deps);
  if (record === undefined) {
    await interaction.reply(CASE_NOT_FOUND, EPHEMERAL);
    return;
  }
  const ok = deps.cases.setStatus(record.id, 'dismissed', interaction.actor.userId, nowIso(deps));
  await interaction.reply(ok ? CASE_DISMISSED(record.id) : CASE_NOT_OPEN, EPHEMERAL);
}
