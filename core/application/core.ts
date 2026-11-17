import type { CommandDefinition } from '../../shared/contracts/commands.ts';
import type { EventContext } from '../../shared/contracts/events.ts';
import type { GuildActions } from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { ModuleConfigStore } from '../configuration/module-config.ts';
import { EventBus } from '../event-bus/event-bus.ts';
import { UNAVAILABLE_GUILD } from '../guild/module-guild.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { ModuleRegistry, type ModuleStatus } from '../module-registry/registry.ts';
import { PermissionService } from '../permissions/permission-service.ts';

export interface StartCoreOptions {
  readonly dbPath: string;
  readonly modulesDir: string;
  readonly logger: Logger;
  readonly stepTimeoutMs?: number;
  /** Defaults to the Core's own migrations; injectable for tests. */
  readonly migrationsDir?: string;
  /** The Discord port given to modules; defaults to one where every action fails. */
  readonly guild?: GuildActions;
}

export interface CoreHandle {
  commands(): ReadonlyMap<string, CommandDefinition>;
  status(): ReadonlyMap<string, ModuleStatus>;
  readonly permissions: PermissionService;
  /**
   * Publishes a `discord.*` event with source `core`. Once stop() has begun the event is
   * dropped with a warning instead of thrown.
   */
  publishCoreEvent(type: string, payload: unknown, context?: EventContext): void;
  /** Idempotent: every call returns the same shutdown, and the database closes once. */
  stop(): Promise<void>;
}

/**
 * Opens and migrates the database, builds the Core services and loads and starts the modules.
 * If any step after opening the database fails, everything started so far is shut down and the
 * database is closed before the error is rethrown.
 */
export async function startCore(options: StartCoreOptions): Promise<CoreHandle> {
  const { logger } = options;
  const db = openDatabase(options.dbPath);
  const events = new EventBus(logger);
  let registry: ModuleRegistry | undefined;
  let stopping: Promise<void> | undefined;

  const shutdown = async (): Promise<void> => {
    try {
      if (registry !== undefined) await registry.stop();
      await events.idle();
    } finally {
      db.close();
    }
  };

  try {
    runMigrations(db, options.migrationsDir ?? MIGRATIONS_DIR);
    const permissions = new PermissionService(db);
    registry = new ModuleRegistry({
      modulesDir: options.modulesDir,
      logger,
      events,
      permissions,
      config: new ModuleConfigStore(db),
      db,
      guild: options.guild ?? UNAVAILABLE_GUILD,
      ...(options.stepTimeoutMs === undefined ? {} : { stepTimeoutMs: options.stepTimeoutMs }),
    });
    await registry.load();
    await registry.start();
    const started = registry;
    logger.info({ modules: started.status().size }, 'core started');

    return {
      commands: () => started.commands(),
      status: () => started.status(),
      permissions,
      publishCoreEvent: (type, payload, context) => {
        if (stopping !== undefined) {
          logger.warn({ event: type }, 'core event dropped: core is stopping');
          return;
        }
        events.publishFromCore(type, payload, context);
      },
      stop: () => {
        stopping ??= shutdown().then(() => {
          logger.info('core stopped');
        });
        return stopping;
      },
    };
  } catch (error) {
    try {
      await shutdown();
    } catch (cleanupError) {
      logger.error(
        { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) },
        'core cleanup failed after a startup error',
      );
    }
    throw error;
  }
}
