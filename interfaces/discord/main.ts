import { fileURLToPath } from 'node:url';
import { Events, type Client, type Guild, type Interaction } from 'discord.js';

import { startCore, type CoreHandle } from '../../core/application/core.ts';
import { installShutdownHandlers } from '../../core/application/shutdown.ts';
import { EnvironmentError, loadEnvironment } from '../../core/configuration/environment.ts';
import { createLogger } from '../../core/infrastructure/logger.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { createDiscordClient, toRawInteraction } from './client.ts';
import { dispatchCommand, syncCommands } from './commands.ts';
import { isAllowedInteraction } from './guild-guard.ts';

export const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Name and code only: they identify the failure without echoing anything sent to Discord. */
function errorSummary(error: unknown): { name: string; code?: string | number } {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number'
    ? { name: error.name, code }
    : { name: error.name };
}

/** Connects the Core to the Discord client. Nothing here logs the token or any Discord ID. */
function wireClient(client: Client, core: CoreHandle, guildId: string, logger: Logger): void {
  // Command syncs run one at a time, in the order the events arrive.
  let queue = Promise.resolve();
  const enqueue = (task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      logger.error({ error: errorMessage(error) }, 'discord guild sync failed');
    });
  };

  const sync = async (): Promise<void> => {
    const guild = client.guilds.cache.get(guildId);
    const application = client.application;
    if (guild === undefined || application === null) return;
    const commands = [...core.commands().values()];
    await syncCommands(
      {
        setGuildCommands: async (payload) => {
          await guild.commands.set(payload);
        },
        clearGlobalCommands: async () => {
          await application.commands.set([]);
        },
      },
      commands,
    );
    logger.info({ commands: commands.length }, 'discord commands synced');
  };

  // The bot stays in other guilds and ignores them (decision 0010); it only syncs its own guild.
  client.once(Events.ClientReady, () => {
    logger.info('discord client ready');
    if (!client.guilds.cache.has(guildId)) {
      logger.error('the bot is not in the configured guild; waiting to be added');
      return;
    }
    enqueue(sync);
  });

  client.on(Events.GuildCreate, (guild: Guild) => {
    if (guild.id === guildId) enqueue(sync);
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!isAllowedInteraction(interaction, guildId)) return;
    // dispatchCommand never rejects; the catch only covers a failure building the interaction.
    void Promise.resolve()
      .then(() => dispatchCommand(toRawInteraction(interaction), core.commands(), logger))
      .catch((error: unknown) => {
        logger.error({ error: errorMessage(error) }, 'command dispatch failed');
      });
  });
}

/** Starts the bot: environment, logger, Core, shutdown handlers, Discord client and login. */
export async function main(): Promise<void> {
  let environment;
  try {
    environment = loadEnvironment(process.env);
  } catch (error) {
    if (!(error instanceof EnvironmentError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: environment.logLevel });
  let core: CoreHandle;
  try {
    core = await startCore({ dbPath: environment.dbPath, modulesDir: MODULES_DIR, logger });
  } catch (error) {
    logger.fatal({ error: errorMessage(error) }, 'core failed to start');
    process.exitCode = 1;
    return;
  }

  const client = createDiscordClient();
  const shutdown = async (): Promise<void> => {
    try {
      await client.destroy();
    } finally {
      await core.stop();
    }
  };
  const shutdownHandle = installShutdownHandlers(process, shutdown, logger);
  wireClient(client, core, environment.guildId, logger);

  try {
    await client.login(environment.discordToken);
  } catch (error) {
    logger.error(errorSummary(error), 'Discord login failed.');
    // Same once-only path as the signals: a concurrent SIGINT cannot rerun shutdown or exit 0.
    shutdownHandle.trigger(1);
  }
}

if (import.meta.main) await main();
