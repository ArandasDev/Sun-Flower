import {
  ApplicationCommandOptionType,
  type APIApplicationCommandBasicOption,
  type APIApplicationCommandOption,
  type APIApplicationCommandSubcommandGroupOption,
  type APIApplicationCommandSubcommandOption,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

import type {
  CommandDefinition,
  CommandInteraction,
  CommandOption,
  CommandOptions,
  CommandOptionType,
  ReplyOptions,
  Subcommand,
  SubcommandGroup,
} from '../../shared/contracts/commands.ts';
import type { Logger } from '../../shared/contracts/logger.ts';

export const UNAVAILABLE_MESSAGE = 'Comando indisponível.';
export const ERROR_MESSAGE = 'Ocorreu um erro.';
export const DEFAULT_DEFER_AFTER_MS = 2500;

export interface CommandTarget {
  setGuildCommands(commands: RESTPostAPIChatInputApplicationCommandsJSONBody[]): Promise<void>;
  clearGlobalCommands(): Promise<void>;
}

const OPTION_TYPES = {
  string: ApplicationCommandOptionType.String,
  integer: ApplicationCommandOptionType.Integer,
  boolean: ApplicationCommandOptionType.Boolean,
  user: ApplicationCommandOptionType.User,
  channel: ApplicationCommandOptionType.Channel,
  role: ApplicationCommandOptionType.Role,
} as const satisfies Record<CommandOptionType, ApplicationCommandOptionType>;

// Discord rejects undefined-valued keys in serialized payloads, so optional fields are
// only added when present. The cast is confined to this builder.
function toOption(option: CommandOption): APIApplicationCommandBasicOption {
  const data: Record<string, unknown> = {
    type: OPTION_TYPES[option.type],
    name: option.name,
    description: option.description,
  };
  if (option.required !== undefined) data['required'] = option.required;
  if (option.minValue !== undefined) data['min_value'] = option.minValue;
  if (option.maxValue !== undefined) data['max_value'] = option.maxValue;
  if (option.maxLength !== undefined) data['max_length'] = option.maxLength;
  if (option.choices !== undefined) {
    data['choices'] = option.choices.map((value) => ({ name: value, value }));
  }
  return data as unknown as APIApplicationCommandBasicOption;
}

function toSubcommand(sub: Subcommand): APIApplicationCommandSubcommandOption {
  const data: APIApplicationCommandSubcommandOption = {
    type: ApplicationCommandOptionType.Subcommand,
    name: sub.name,
    description: sub.description,
  };
  if (sub.options !== undefined) data.options = sub.options.map(toOption);
  return data;
}

function toGroup(group: SubcommandGroup): APIApplicationCommandSubcommandGroupOption {
  return {
    type: ApplicationCommandOptionType.SubcommandGroup,
    name: group.name,
    description: group.description,
    options: group.subcommands.map(toSubcommand),
  };
}

/** Translates a module command into the Discord registration payload (options, groups, subcommands). */
export function toDiscordCommandData(
  command: CommandDefinition,
): RESTPostAPIChatInputApplicationCommandsJSONBody {
  const data: RESTPostAPIChatInputApplicationCommandsJSONBody = {
    name: command.name,
    description: command.description,
  };
  const options: APIApplicationCommandOption[] = [
    ...(command.options ?? []).map(toOption),
    ...(command.groups ?? []).map(toGroup),
    ...(command.subcommands ?? []).map(toSubcommand),
  ];
  if (options.length > 0) data.options = options;
  return data;
}

/** Replaces the guild command list (even with an empty list) and removes global commands. */
export async function syncCommands(
  target: CommandTarget,
  commands: Iterable<CommandDefinition>,
): Promise<void> {
  const payload = [...commands]
    .map(toDiscordCommandData)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  await target.setGuildCommands(payload);
  await target.clearGlobalCommands();
}

export interface RawInteraction {
  readonly commandName: string;
  readonly userId: string;
  readonly roleIds: string[];
  readonly guildId: string | null;
  readonly channelId: string;
  readonly subcommandGroup: string | undefined;
  readonly subcommand: string | undefined;
  readonly options: CommandOptions;
  reply(content: string, ephemeral: boolean): Promise<void>;
  /** Defers the reply; the dispatcher always passes `true`, so a deferred reply is ephemeral. */
  deferReply(ephemeral: boolean): Promise<void>;
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
 * If the handler has not replied within `deferAfterMs`, the interaction is deferred as an
 * ephemeral reply and the later reply goes through `editReply`. Discord does not let an edited
 * deferred reply change its visibility, so a slow reply is always ephemeral and never leaks to
 * the channel; a command that wants a public reply must answer within `deferAfterMs`.
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
    deferral = raw.deferReply(true).catch((error: unknown) => {
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
    channelId: raw.channelId,
    subcommandGroup: raw.subcommandGroup,
    subcommand: raw.subcommand,
    options: raw.options,
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
