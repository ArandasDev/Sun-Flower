import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import type { ModerationConfig } from '../config.ts';
import type { ModCommandDeps } from './mod-command.ts';
import { CONFIG_INVALID, CONFIG_UPDATED } from './replies.ts';

const EPHEMERAL = { ephemeral: true } as const;

function invalidFields(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== 'InvalidModuleConfigError') return undefined;
  const marker = ' at: ';
  const index = error.message.indexOf(marker);
  return index === -1 ? error.message : error.message.slice(index + marker.length);
}

async function applyConfig(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
  partial: Record<string, unknown>,
): Promise<void> {
  try {
    deps.config.set(partial);
  } catch (error) {
    const fields = invalidFields(error);
    if (fields === undefined) throw error;
    await interaction.reply(CONFIG_INVALID(fields), EPHEMERAL);
    return;
  }
  await interaction.reply(CONFIG_UPDATED, EPHEMERAL);
}

export async function configView(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const config = deps.config.get<ModerationConfig>();
  const channel =
    config.alertChannelId === undefined ? 'não configurado' : `<#${config.alertChannelId}>`;
  const roles =
    config.exemptRoleIds.length === 0
      ? 'nenhum'
      : config.exemptRoleIds.map((id) => `<@&${id}>`).join(', ');
  await interaction.reply(
    [
      `Canal de alertas: ${channel}`,
      `Timeout: ${String(config.timeoutMinutes)} minutos`,
      `Limites: confirmado ${String(config.thresholds.confirmed)}, suspeito ${String(config.thresholds.suspicious)}`,
      `Cargos isentos: ${roles}`,
    ].join('\n'),
    EPHEMERAL,
  );
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
