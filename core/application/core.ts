import type { Actor, CommandDefinition } from '../../shared/contracts/commands.ts';
import type { EventContext, EventHandler } from '../../shared/contracts/events.ts';
import type { GuildActions } from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { OperationResult, OperationSource } from '../../shared/contracts/operations.ts';
import { ModuleConfigStore } from '../configuration/module-config.ts';
import { EventBus } from '../event-bus/event-bus.ts';
import { UNAVAILABLE_GUILD } from '../guild/module-guild.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { ModuleRegistry, type ModuleStatus } from '../module-registry/registry.ts';
import { PermissionService } from '../permissions/permission-service.ts';
import { PURGE_INTERVAL_MS, SessionStore } from '../sessions/session-store.ts';

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
  readonly sessions: SessionStore;
  /** Subscribes an interface to an event type; the returned function cancels it. */
  subscribe(type: string, handler: EventHandler): () => void;
  /** The permissions declared by the manifests of the loaded modules. */
  declaredPermissions(): ReadonlySet<string>;
  /** The module operations; the Core checks module state, permission and input before each one. */
  readonly operations: {
    names(): string[];
    execute(
      name: string,
      actor: Actor,
      input: unknown,
      source: OperationSource,
    ): Promise<OperationResult>;
  };
  /**
   * Publishes a `discord.*` or `core.*` event with source `core`. Once stop() has begun the event is
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
  let purgeTimer: NodeJS.Timeout | undefined;

  const shutdown = async (): Promise<void> => {
    clearInterval(purgeTimer);
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
    const sessions = new SessionStore(db);
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
    purgeTimer = setInterval(() => {
      try {
        sessions.purgeExpired();
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'panel session purge failed',
        );
      }
    }, PURGE_INTERVAL_MS);
    purgeTimer.unref();
    logger.info({ modules: started.status().size }, 'core started');

    return {
      commands: () => started.commands(),
      status: () => started.status(),
      permissions,
      sessions,
      subscribe: (type, handler) => events.subscribeFromCore(type, handler),
      declaredPermissions: () => started.declaredPermissions(),
      operations: Object.freeze({
        names: () => started.operations.names(),
        execute: (name: string, actor: Actor, input: unknown, source: OperationSource) =>
          started.operations.execute(name, actor, input, source),
      }),
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
