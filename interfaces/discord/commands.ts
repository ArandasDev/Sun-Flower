import type {
  CommandDefinition,
  CommandInteraction,
  ReplyOptions,
} from '../../shared/contracts/commands.ts';
import type { Logger } from '../../shared/contracts/logger.ts';

export const UNAVAILABLE_MESSAGE = 'Comando indisponível.';
export const ERROR_MESSAGE = 'Ocorreu um erro.';
export const DEFAULT_DEFER_AFTER_MS = 2500;

export interface CommandTarget {
  setGuildCommands(commands: { name: string; description: string }[]): Promise<void>;
  clearGlobalCommands(): Promise<void>;
}

/** Replaces the guild command list (even with an empty list) and removes global commands. */
export async function syncCommands(
  target: CommandTarget,
  commands: Iterable<CommandDefinition>,
): Promise<void> {
  const payload = [...commands]
    .map(({ name, description }) => ({ name, description }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  await target.setGuildCommands(payload);
  await target.clearGlobalCommands();
}

export interface RawInteraction {
  readonly commandName: string;
  readonly userId: string;
  readonly roleIds: string[];
  readonly guildId: string | null;
  reply(content: string, ephemeral: boolean): Promise<void>;
  deferReply(): Promise<void>;
  editReply(content: string): Promise<void>;
}

export interface DispatchOptions {
  readonly deferAfterMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the handler of `raw.commandName` and guarantees at most one response to the user.
 *
 * If the handler has not replied within `deferAfterMs`, the interaction is deferred
 * (non-ephemeral) and the later reply goes through `editReply`. Discord does not let an
 * edited deferred reply change its visibility, so the `ephemeral` option is lost after deferral.
 *
 * Never rejects: Discord API failures are logged. Logs carry only the command name and the
 * error message, never user, guild or role IDs.
 */
export async function dispatchCommand(
  raw: RawInteraction,
  commands: ReadonlyMap<string, CommandDefinition>,
  logger: Logger,
  options: DispatchOptions = {},
): Promise<void> {
  const name = raw.commandName;
  const command = commands.get(name);

  const send = async (content: string, ephemeral: boolean, deferral?: Promise<void>) => {
    try {
      if (deferral === undefined) {
        await raw.reply(content, ephemeral);
      } else {
        await deferral;
        await raw.editReply(content);
      }
    } catch (error) {
      logger.error({ command: name, error: errorMessage(error) }, 'Failed to send command reply');
    }
  };

  if (command === undefined) {
    await send(UNAVAILABLE_MESSAGE, true);
    return;
  }

  let responded = false;
  let deferral: Promise<void> | undefined;
  const timer = setTimeout(() => {
    if (responded) {
      return;
    }
    deferral = raw.deferReply().catch((error: unknown) => {
      logger.error({ command: name, error: errorMessage(error) }, 'Failed to defer command reply');
    });
  }, options.deferAfterMs ?? DEFAULT_DEFER_AFTER_MS);

  const respond = async (content: string, ephemeral: boolean): Promise<void> => {
    responded = true;
    clearTimeout(timer);
    await send(content, ephemeral, deferral);
  };

  const interaction: CommandInteraction = {
    actor: { userId: raw.userId, roleIds: [...raw.roleIds] },
    // Placeholders: the real translation of Discord options arrives with the options task.
    channelId: '',
    subcommandGroup: undefined,
    subcommand: undefined,
    options: {
      getString: () => undefined,
      getInteger: () => undefined,
      getBoolean: () => undefined,
      getUser: () => undefined,
      getChannel: () => undefined,
      getRole: () => undefined,
    },
    reply: async (content: string, replyOptions?: ReplyOptions) => {
      if (responded) {
        logger.warn({ command: name }, 'Ignored a second reply from a command handler');
        return;
      }
      await respond(content, replyOptions?.ephemeral ?? false);
    },
  };

  try {
    await command.handle(interaction);
  } catch (error) {
    logger.error({ command: name, error: errorMessage(error) }, 'Command handler failed');
    if (!responded) {
      await respond(ERROR_MESSAGE, true);
    }
  } finally {
    clearTimeout(timer);
    await deferral;
  }
}
