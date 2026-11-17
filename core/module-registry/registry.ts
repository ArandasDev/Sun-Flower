import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';
import type { CommandDefinition } from '../../shared/contracts/commands.ts';
import type { EventContext, EventHandler } from '../../shared/contracts/events.ts';
import type { GuildActions } from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { SqlValue } from '../../shared/contracts/storage.ts';
import {
  CORE_API_VERSION,
  type ModuleContext,
  type ModuleManifest,
  type SunFlowerModule,
} from '../../shared/contracts/module.ts';
import type { ModuleConfigStore } from '../configuration/module-config.ts';
import type { EventBus, ModuleEvents } from '../event-bus/event-bus.ts';
import { createModuleGuild } from '../guild/module-guild.ts';
import { withTimeout } from '../infrastructure/timeout.ts';
import type { PermissionService } from '../permissions/permission-service.ts';
import { applyModuleMigrations } from '../storage/module-migrations.ts';
import { createModuleStorage } from '../storage/module-storage.ts';
import { resolveOrder } from './dependencies.ts';
import { discoverModules } from './discovery.ts';
import { loadModule } from './entrypoint.ts';
import {
  assertValidCommand,
  canTransition,
  CommandRegistrationError,
  type ModuleState,
  type ModuleStatus,
} from './lifecycle.ts';

export { CommandRegistrationError, type ModuleState, type ModuleStatus } from './lifecycle.ts';

const DEFAULT_STEP_TIMEOUT_MS = 10_000;
/** States in which a module may use events, guild actions, config.set and storage writes. */
const ACTIVE_STATES: ReadonlySet<ModuleState> = new Set([
  'VALIDATED',
  'REGISTERED',
  'INITIALIZED',
  'RUNNING',
]);

export class RegistryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryStateError';
  }
}

export interface ModuleRegistryDeps {
  readonly modulesDir: string;
  readonly logger: Logger;
  readonly events: EventBus;
  readonly permissions: PermissionService;
  readonly config: ModuleConfigStore;
  /** The Core database; module migrations and storage run on it. */
  readonly db: DatabaseSync;
  /** The Discord port; each module receives it gated by its manifest capabilities. */
  readonly guild: GuildActions;
  readonly coreApiVersion?: string;
  readonly stepTimeoutMs?: number;
}

interface ModuleRecord {
  readonly manifest: ModuleManifest;
  readonly directory: string;
  instance?: SunFlowerModule;
  configSchema?: z.ZodType<unknown>;
  events?: ModuleEvents;
  settings?: { readonly value: unknown };
  rejectedCommand?: string;
  readonly commands: Map<string, CommandDefinition>;
}

type Phase = 'new' | 'loading' | 'loaded' | 'starting' | 'started' | 'stopping' | 'stopped';

/** Freezes plain data (objects and arrays) at every depth. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ModuleRegistry {
  readonly #deps: ModuleRegistryDeps;
  readonly #stepTimeoutMs: number;
  readonly #statuses = new Map<string, ModuleStatus>();
  readonly #records = new Map<string, ModuleRecord>();
  readonly #commandOwners = new Map<string, string>();
  readonly #disabled = new Set<string>();
  #order: string[] = [];
  #phase: Phase = 'new';
  #starting: Promise<void> | undefined;
  #stopping: Promise<void> | undefined;

  constructor(deps: ModuleRegistryDeps) {
    this.#deps = deps;
    this.#stepTimeoutMs = deps.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  }

  status(): ReadonlyMap<string, ModuleStatus> {
    return new Map(this.#statuses);
  }

  commands(): ReadonlyMap<string, CommandDefinition> {
    const result = new Map<string, CommandDefinition>();
    for (const id of this.#order) {
      if (this.#statuses.get(id)?.state !== 'RUNNING') continue;
      for (const [name, command] of this.#records.get(id)?.commands ?? []) {
        result.set(name, command);
      }
    }
    return result;
  }

  async load(): Promise<void> {
    if (this.#phase !== 'new') throw new RegistryStateError('load() can only be called once');
    this.#phase = 'loading';
    const { modulesDir, coreApiVersion = CORE_API_VERSION } = this.#deps;

    const discovered = discoverModules(modulesDir, coreApiVersion);
    if (discovered.length === 0) {
      this.#deps.logger.warn({ modulesDir }, 'no modules found');
    }
    const manifests: ModuleManifest[] = [];
    const invalid = new Set<string>();
    for (const entry of discovered) {
      const key = entry.manifest?.id ?? entry.directoryName;
      this.#statuses.set(key, { state: 'DISCOVERED' });
      if (entry.manifest === undefined) {
        invalid.add(entry.directoryName);
        if (entry.rawId !== undefined) invalid.add(entry.rawId);
        this.#fail(key, 'validation', entry.errors.join('; '));
        continue;
      }
      this.#transition(key, 'VALIDATED');
      this.#records.set(key, {
        manifest: entry.manifest,
        directory: entry.directory,
        commands: new Map(),
      });
      manifests.push(entry.manifest);
    }

    const { order, failed } = resolveOrder(manifests, invalid);
    for (const [id, reason] of failed) this.#fail(id, 'dependencies', reason);

    for (const id of order) {
      const record = this.#record(id);
      try {
        const loaded = await withTimeout(
          () => loadModule(record.directory, record.manifest.entrypoint),
          this.#stepTimeoutMs,
          `module "${id}" import`,
        );
        record.instance = loaded.instance;
        if (loaded.configSchema !== undefined) record.configSchema = loaded.configSchema;
      } catch (error) {
        this.#fail(id, 'import', describe(error));
      }
    }
    this.#order = order;
    this.#phase = 'loaded';
  }

  async start(): Promise<void> {
    if (this.#phase === 'new') throw new RegistryStateError('start() called before load()');
    if (this.#phase !== 'loaded') throw new RegistryStateError('start() can only be called once');
    this.#phase = 'starting';
    this.#starting = this.#startAll();
    await this.#starting;
    this.#phase = 'started';
  }

  /** Idempotent: concurrent calls share one shutdown, which never rethrows a failed start(). */
  stop(): Promise<void> {
    this.#stopping ??= this.#stopAll();
    return this.#stopping;
  }

  async #stopAll(): Promise<void> {
    if (this.#phase === 'starting') {
      try {
        await this.#starting;
      } catch (error) {
        this.#deps.logger.error({ error: describe(error) }, 'module start aborted');
      }
    }
    if (this.#phase !== 'started' && this.#phase !== 'starting') {
      if (this.#phase === 'new' || this.#phase === 'loaded') this.#phase = 'stopped';
      return;
    }
    this.#phase = 'stopping';
    for (const id of [...this.#order].reverse()) {
      if (this.#statuses.get(id)?.state !== 'RUNNING') continue;
      const record = this.#record(id);
      const instance = record.instance as SunFlowerModule;
      record.events?.unsubscribeAll();
      try {
        await this.#step(id, 'stop', () => instance.stop());
        this.#transition(id, 'STOPPED');
      } catch (error) {
        this.#fail(id, 'stop', describe(error));
      }
      this.#dropCommands(record);
      try {
        await this.#step(id, 'dispose', () => instance.dispose());
        if (this.#statuses.get(id)?.state === 'STOPPED') this.#transition(id, 'DISPOSED');
      } catch (error) {
        if (this.#statuses.get(id)?.state === 'FAILED') {
          this.#logDisposeFailure(id, error);
        } else {
          this.#fail(id, 'dispose', describe(error));
        }
      }
      // stop() and dispose() may still subscribe while the module is active; drop those too.
      record.events?.unsubscribeAll();
    }
    this.#phase = 'stopped';
  }

  async #startAll(): Promise<void> {
    for (const id of this.#order) {
      if (this.#statuses.get(id)?.state === 'FAILED') continue;
      const record = this.#record(id);
      const blocker = this.#blockingDependency(record.manifest);
      if (blocker !== undefined) {
        this.#fail(id, 'dependencies', blocker);
        continue;
      }
      if (!this.#deps.config.isEnabled(id, record.manifest.enabledByDefault)) {
        this.#disabled.add(id);
        this.#deps.logger.info({ module: id }, 'module disabled');
        continue;
      }
      await this.#startModule(record);
    }
  }

  #blockingDependency(manifest: ModuleManifest): string | undefined {
    for (const dependency of manifest.dependencies) {
      if (this.#disabled.has(dependency)) return `dependency "${dependency}" is disabled`;
      if (this.#statuses.get(dependency)?.state !== 'RUNNING') {
        return `dependency "${dependency}" failed`;
      }
    }
    return undefined;
  }

  async #startModule(record: ModuleRecord): Promise<void> {
    const { id } = record.manifest;
    const instance = record.instance as SunFlowerModule;
    const events = this.#deps.events.forModule(record.manifest);
    record.events = events;
    const context = this.#createContext(record, events);

    const steps: [string, () => Promise<void>, ModuleState][] = [
      [
        'register',
        async () => {
          applyModuleMigrations(this.#deps.db, id, path.join(record.directory, 'migrations'));
          await instance.register(context);
          if (record.rejectedCommand !== undefined) {
            throw new CommandRegistrationError(record.rejectedCommand);
          }
        },
        'REGISTERED',
      ],
      [
        'initialize',
        async () => {
          record.settings = { value: this.#deps.config.loadSettings(id, record.configSchema) };
          await instance.initialize();
        },
        'INITIALIZED',
      ],
      ['start', () => instance.start(), 'RUNNING'],
    ];
    for (const [step, work, next] of steps) {
      try {
        await this.#step(id, step, work);
      } catch (error) {
        this.#fail(id, step, describe(error));
        events.unsubscribeAll();
        this.#dropCommands(record);
        try {
          await this.#step(id, 'dispose', () => instance.dispose());
        } catch (disposeError) {
          this.#logDisposeFailure(id, disposeError);
        }
        events.unsubscribeAll();
        return;
      }
      this.#transition(id, next);
    }
    this.#deps.logger.info({ module: id }, 'module running');
  }

  #createContext(record: ModuleRecord, events: ModuleEvents): ModuleContext {
    const { id } = record.manifest;
    const settingsUnavailable = (): Error =>
      new Error(`Settings of module "${id}" are only available from initialize()`);
    const isActive = (): boolean => this.#isActive(id);
    const assertActive = (): void => {
      if (!isActive()) throw new Error(`Module "${id}" is not active`);
    };
    const storage = createModuleStorage(this.#deps.db);
    return Object.freeze({
      moduleId: id,
      logger: this.#deps.logger.child({ module: id }),
      events: Object.freeze({
        publish: (type: string, payload: unknown, context?: EventContext) => {
          if (this.#eventsAllowed(id, 'publish', type)) events.publish(type, payload, context);
        },
        subscribe: (type: string, handler: EventHandler) => {
          if (this.#eventsAllowed(id, 'subscribe', type)) events.subscribe(type, handler);
        },
      }),
      permissions: this.#deps.permissions.forModule(record.manifest),
      config: Object.freeze({
        get: <T>(): T => {
          if (record.settings === undefined) throw settingsUnavailable();
          return record.settings.value as T;
        },
        set: (partial: Record<string, unknown>) => {
          assertActive();
          if (record.settings === undefined) throw settingsUnavailable();
          const value = this.#deps.config.updateSettings(id, record.configSchema, partial);
          record.settings = { value };
        },
      }),
      guild: createModuleGuild({
        manifest: record.manifest,
        port: this.#deps.guild,
        isDeveloper: (userId) => this.#deps.permissions.isDeveloper(userId),
        isActive,
        logger: this.#deps.logger,
      }),
      // Reads stay allowed; writes from a FAILED or STOPPED module are refused.
      storage: Object.freeze({
        run: (sql: string, params?: readonly SqlValue[]) => {
          assertActive();
          return storage.run(sql, params);
        },
        get: <T>(sql: string, params?: readonly SqlValue[]): T | undefined =>
          storage.get<T>(sql, params),
        all: <T>(sql: string, params?: readonly SqlValue[]): T[] => storage.all<T>(sql, params),
        transaction: <T>(fn: () => T): T => {
          assertActive();
          return storage.transaction(fn);
        },
      }),
      commands: Object.freeze({
        register: (command: CommandDefinition) => {
          this.#registerCommand(record, command);
        },
      }),
    });
  }

  #registerCommand(record: ModuleRecord, command: CommandDefinition): void {
    const { id } = record.manifest;
    if (this.#statuses.get(id)?.state !== 'VALIDATED') {
      throw new CommandRegistrationError(`Module "${id}" can only register commands in register()`);
    }
    try {
      assertValidCommand(command);
      const owner = this.#commandOwners.get(command.name);
      if (owner !== undefined) {
        throw new CommandRegistrationError(
          `Command "${command.name}" is already registered by module "${owner}"`,
        );
      }
    } catch (error) {
      // Recorded so the register step fails even if the module swallows the error.
      record.rejectedCommand ??= describe(error);
      throw error;
    }
    // A frozen copy: later changes to the module's own object never reach commands().
    // Bound so a handle written as a method keeps its `this`.
    const { name, description, options, subcommands, groups } = command;
    const handle = command.handle.bind(command);
    const data = structuredClone({
      name,
      description,
      ...(options === undefined ? {} : { options }),
      ...(subcommands === undefined ? {} : { subcommands }),
      ...(groups === undefined ? {} : { groups }),
    });
    this.#commandOwners.set(name, id);
    record.commands.set(name, Object.freeze({ ...deepFreeze(data), handle }));
  }

  #isActive(id: string): boolean {
    const state = this.#statuses.get(id)?.state;
    return state !== undefined && ACTIVE_STATES.has(state);
  }

  /** Calls from failed or stopped modules are ignored, never thrown into abandoned work. */
  #eventsAllowed(id: string, action: 'publish' | 'subscribe', type: string): boolean {
    if (this.#isActive(id)) return true;
    const state = this.#statuses.get(id)?.state;
    this.#deps.logger.warn(
      { module: id, state, event: type },
      `event ${action} ignored: module is not active`,
    );
    return false;
  }

  #dropCommands(record: ModuleRecord): void {
    for (const name of record.commands.keys()) this.#commandOwners.delete(name);
    record.commands.clear();
  }

  #step(id: string, step: string, work: () => Promise<void>): Promise<void> {
    return withTimeout(work, this.#stepTimeoutMs, `module "${id}" ${step}()`);
  }

  #record(id: string): ModuleRecord {
    const record = this.#records.get(id);
    if (record === undefined) throw new Error(`Unknown module "${id}"`);
    return record;
  }

  #transition(id: string, next: ModuleState): void {
    const current = this.#statuses.get(id)?.state;
    if (current === undefined || !canTransition(current, next)) {
      throw new Error(`Invalid state transition for module "${id}": ${current} -> ${next}`);
    }
    this.#statuses.set(id, { state: next });
  }

  #fail(id: string, failedAt: string, error: string): void {
    this.#transition(id, 'FAILED');
    this.#statuses.set(id, { state: 'FAILED', failedAt, error });
    this.#deps.logger.error({ module: id, step: failedAt, error }, 'module lifecycle step failed');
  }

  #logDisposeFailure(id: string, error: unknown): void {
    this.#deps.logger.error(
      { module: id, step: 'dispose', error: describe(error) },
      'module dispose() failed after a failure',
    );
  }
}
