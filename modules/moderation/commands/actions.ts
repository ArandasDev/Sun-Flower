import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import type { ActionResult } from '../operations/actions.ts';
import type { ModCommandDeps } from './mod-command.ts';
import { BANNED, DM_FAILED, INVALID_OPTION, KICKED, TIMED_OUT, WARNED } from './replies.ts';

const EPHEMERAL = { ephemeral: true } as const;
const REASON_MAX = 512;
const TIMEOUT_MIN_MINUTES = 1;
const TIMEOUT_MAX_MINUTES = 40320;
const DELETE_DAYS_MAX = 7;

type ManualAction = 'warn' | 'timeout' | 'kick' | 'ban';

const isIntegerIn = (value: number | undefined, min: number, max: number): value is number =>
  value !== undefined && Number.isInteger(value) && value >= min && value <= max;

/** Reads and checks the user and reason options. Replies and returns `undefined` when invalid. */
async function readTarget(
  interaction: CommandInteraction,
): Promise<{ userId: string; reason: string } | undefined> {
  const userId = interaction.options.getUser('user');
  if (userId === undefined) {
    await interaction.reply(INVALID_OPTION('user'), EPHEMERAL);
    return undefined;
  }
  const reason = interaction.options.getString('reason')?.trim();
  if (reason === undefined || reason.length === 0 || reason.length > REASON_MAX) {
    await interaction.reply(INVALID_OPTION('reason'), EPHEMERAL);
    return undefined;
  }
  return { userId, reason };
}

/** Runs the operation (which applies the protections) and replies with the current texts. */
async function execute(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
  action: ManualAction,
  input: Record<string, unknown>,
  success: (data: ActionResult) => string,
): Promise<void> {
  const result = await deps.operations.execute(`moderation.actions.${action}`, interaction.actor, {
    ...input,
    channelId: interaction.channelId,
  });
  if (!result.ok) {
    await interaction.reply(result.error.message, EPHEMERAL);
    return;
  }
  await interaction.reply(success(result.data as ActionResult), EPHEMERAL);
}

export async function actionWarn(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const target = await readTarget(interaction);
  if (target === undefined) return;
  await execute(
    interaction,
    deps,
    'warn',
    target,
    (data) => `${WARNED(data.caseId)}${data.dmFailed === true ? DM_FAILED : ''}`,
  );
}

export async function actionTimeout(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const minutes = interaction.options.getInteger('minutes');
  if (!isIntegerIn(minutes, TIMEOUT_MIN_MINUTES, TIMEOUT_MAX_MINUTES)) {
    await interaction.reply(INVALID_OPTION('minutes'), EPHEMERAL);
    return;
  }
  const target = await readTarget(interaction);
  if (target === undefined) return;
  await execute(interaction, deps, 'timeout', { ...target, minutes }, (d) => TIMED_OUT(d.caseId));
}

export async function actionKick(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const target = await readTarget(interaction);
  if (target === undefined) return;
  await execute(interaction, deps, 'kick', target, (d) => KICKED(d.caseId));
}

export async function actionBan(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const days = interaction.options.getInteger('delete-days') ?? 0;
  if (!isIntegerIn(days, 0, DELETE_DAYS_MAX)) {
    await interaction.reply(INVALID_OPTION('delete-days'), EPHEMERAL);
    return;
  }
  const target = await readTarget(interaction);
  if (target === undefined) return;
  await execute(interaction, deps, 'ban', { ...target, deleteDays: days }, (d) => BANNED(d.caseId));
}
