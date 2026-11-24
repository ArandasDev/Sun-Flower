import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import type { ModerationConfig, Punishment, SpamRuleName } from '../config.ts';
import type { ConfigSnapshot } from '../operations/config.ts';
import { formatSteps, parseSteps } from '../spam/escalation.ts';
import type { ModCommandDeps } from './mod-command.ts';
import { CONFIG_INVALID, CONFIG_UPDATED, INVALID_OPTION } from './replies.ts';

const EPHEMERAL = { ephemeral: true } as const;
const MAX_REPLY = 2000;
const RULES = ['flood', 'repeat', 'mentions'] as const;

async function applyConfig(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
  changes: Record<string, unknown>,
): Promise<void> {
  const result = await deps.operations.execute('moderation.config.update', interaction.actor, {
    expectedVersion: deps.config.version(),
    changes,
  });
  await interaction.reply(result.ok ? CONFIG_UPDATED : result.error.message, EPHEMERAL);
}

function describePunishment(p: Punishment): string {
  if (p.kind === 'none') return 'nenhuma';
  return p.kind === 'timeout' ? `timeout ${String(p.minutes)} min` : p.kind;
}

function onOff(enabled: boolean): string {
  return enabled ? 'ligada' : 'desligada';
}

function spamSummary(spam: ModerationConfig['spam']): string[] {
  const lines = ['Spam:'];
  for (const name of RULES) {
    const rule = spam[name];
    const punishment: Punishment =
      rule.punishment === 'timeout'
        ? { kind: 'timeout', minutes: rule.timeoutMinutes }
        : { kind: rule.punishment };
    const parts = [`${name} ${onOff(rule.enabled)}`, `limite ${String(rule.limit)}`];
    if ('seconds' in rule) parts.push(`janela ${String(rule.seconds)} s`);
    parts.push(`exclusão ${String(rule.deleteMinutes)} min`);
    parts.push(`punição ${describePunishment(punishment)}`);
    lines.push(parts.join(', '));
  }
  const esc = spam.escalation;
  lines.push(
    `Reincidência: ${onOff(esc.enabled)}, janela ${String(esc.windowHours)} h, degraus ${formatSteps(esc.steps)}`,
  );
  return lines;
}

function ignoredLine(ids: readonly string[], room: number): string {
  const label = 'Canais ignorados (spam): ';
  if (ids.length === 0) return `${label}nenhum`;
  const mentions = ids.map((id) => `<#${id}>`);
  const render = (n: number): string =>
    label +
    mentions.slice(0, n).join(', ') +
    (n < mentions.length ? ` … (+${String(mentions.length - n)})` : '');
  let shown = mentions.length;
  while (shown > 0 && render(shown).length > room) shown -= 1;
  return render(shown);
}

export async function configView(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const result = await deps.operations.execute('moderation.config.view', interaction.actor, {});
  if (!result.ok) {
    await interaction.reply(result.error.message, EPHEMERAL);
    return;
  }
  const { config } = result.data as ConfigSnapshot;
  const channel =
    config.alertChannelId === undefined ? 'não configurado' : `<#${config.alertChannelId}>`;
  const roles =
    config.exemptRoleIds.length === 0
      ? 'nenhum'
      : config.exemptRoleIds.map((id) => `<@&${id}>`).join(', ');
  const head = [
    `Canal de alertas: ${channel}`,
    `Timeout: ${String(config.timeoutMinutes)} minutos`,
    `Limites: confirmado ${String(config.thresholds.confirmed)}, suspeito ${String(config.thresholds.suspicious)}`,
    `Cargos isentos: ${roles}`,
    ...spamSummary(config.spam),
  ].join('\n');
  const ignored = ignoredLine(config.spam.ignoredChannelIds, MAX_REPLY - head.length - 1);
  await interaction.reply(`${head}\n${ignored}`.slice(0, MAX_REPLY), EPHEMERAL);
}

export async function configAlertChannel(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  await applyConfig(interaction, deps, {
    alertChannelId: interaction.options.getChannel('channel'),
  });
}

export async function configTimeout(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  await applyConfig(interaction, deps, {
    timeoutMinutes: interaction.options.getInteger('minutes'),
  });
}

export async function configThresholds(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  await applyConfig(interaction, deps, {
    thresholds: {
      confirmed: interaction.options.getInteger('confirmed'),
      suspicious: interaction.options.getInteger('suspicious'),
    },
  });
}

export async function configExemptRole(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const role = interaction.options.getRole('role');
  const action = interaction.options.getString('action');
  const current = deps.config.get<ModerationConfig>().exemptRoleIds;
  let next = [...current];
  if (role !== undefined) {
    if (action === 'add') next = current.includes(role) ? next : [...next, role];
    else next = current.filter((id) => id !== role);
  }
  await applyConfig(interaction, deps, { exemptRoleIds: next });
}

function isRule(value: string | undefined): value is SpamRuleName {
  return RULES.some((rule) => rule === value);
}

export async function configSpamRule(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const { options } = interaction;
  const rule = options.getString('rule');
  if (!isRule(rule)) {
    await interaction.reply(INVALID_OPTION('rule'), EPHEMERAL);
    return;
  }
  const seconds = options.getInteger('seconds');
  if (rule === 'mentions' && seconds !== undefined) {
    await interaction.reply(INVALID_OPTION('seconds'), EPHEMERAL);
    return;
  }
  const changes: Record<string, unknown> = {};
  const enabled = options.getBoolean('enabled');
  const limit = options.getInteger('limit');
  const deleteMinutes = options.getInteger('delete-minutes');
  const punishment = options.getString('punishment');
  const timeoutMinutes = options.getInteger('timeout-minutes');
  if (enabled !== undefined) changes.enabled = enabled;
  if (limit !== undefined) changes.limit = limit;
  if (seconds !== undefined) changes.seconds = seconds;
  if (deleteMinutes !== undefined) changes.deleteMinutes = deleteMinutes;
  if (punishment !== undefined) changes.punishment = punishment;
  if (timeoutMinutes !== undefined) changes.timeoutMinutes = timeoutMinutes;
  if (Object.keys(changes).length === 0) {
    await interaction.reply(CONFIG_UPDATED, EPHEMERAL);
    return;
  }
  const spam = deps.config.get<ModerationConfig>().spam;
  await applyConfig(interaction, deps, {
    spam: { ...spam, [rule]: { ...spam[rule], ...changes } },
  });
}

export async function configSpamEscalation(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const { options } = interaction;
  const spam = deps.config.get<ModerationConfig>().spam;
  const text = options.getString('steps');
  let steps = spam.escalation.steps;
  if (text !== undefined) {
    const parsed = parseSteps(text);
    if (parsed === undefined) {
      await interaction.reply(CONFIG_INVALID('steps'), EPHEMERAL);
      return;
    }
    steps = parsed as typeof steps;
  }
  await applyConfig(interaction, deps, {
    spam: {
      ...spam,
      escalation: {
        enabled: options.getBoolean('enabled') ?? spam.escalation.enabled,
        windowHours: options.getInteger('window-hours') ?? spam.escalation.windowHours,
        steps,
      },
    },
  });
}

export async function configSpamIgnore(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const channel = interaction.options.getChannel('channel');
  const action = interaction.options.getString('action');
  const spam = deps.config.get<ModerationConfig>().spam;
  const current = spam.ignoredChannelIds;
  let next = [...current];
  if (channel !== undefined) {
    if (action === 'add') next = current.includes(channel) ? next : [...next, channel];
    else next = current.filter((id) => id !== channel);
  }
  await applyConfig(interaction, deps, { spam: { ...spam, ignoredChannelIds: next } });
}
