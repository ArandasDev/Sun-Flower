import type { Actor, CommandDefinition } from './commands.ts';
import type { GuildActions } from './guild.ts';
import type { EventContext, EventHandler } from './events.ts';
import type { Logger } from './logger.ts';
import type { OperationDefinition, OperationResult } from './operations.ts';
import type { ModuleStorage } from './storage.ts';

export const CORE_API_VERSION = '1.3.0';

export type Capability = 'guild.moderate' | 'guild.message';

export interface ModuleManifest {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly entrypoint: string;
  readonly dependencies: readonly string[];
  readonly permissions: readonly string[];
  readonly capabilities: readonly Capability[];
  readonly enabledByDefault: boolean;
  readonly events: {
    readonly subscribes: readonly string[];
    readonly publishes: readonly string[];
  };
}

export interface ModuleContext {
  readonly moduleId: string;
  readonly logger: Logger;
  readonly events: {
    publish(type: string, payload: unknown, context?: EventContext): void;
    subscribe(type: string, handler: EventHandler): void;
  };
  readonly permissions: {
    check(actor: Actor, permission: string): boolean;
    isDeveloper(userId: string): boolean;
    hasAnyGrant(roleIds: readonly string[], prefix: string): boolean;
  };
  readonly config: {
    get<T>(): T;
    /** With `expectedVersion`, a write over a newer version throws `ConfigVersionConflictError`. */
    set(partial: Record<string, unknown>, expectedVersion?: number): void;
    /** The settings version; 0 while nothing has been stored. */
    version(): number;
  };
  readonly guild: GuildActions;
  readonly storage: ModuleStorage;
  readonly commands: { register(command: CommandDefinition): void };
  readonly operations: {
    /** Only from register(); an invalid definition throws `InvalidOperationError`. */
    register<I, O>(definition: OperationDefinition<I, O>): void;
    /** Runs one of the module's own operations, with source `discord`. */
    execute(name: string, actor: Actor, input: unknown): Promise<OperationResult>;
  };
}

export interface SunFlowerModule {
  register(context: ModuleContext): Promise<void>;
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export type ModuleFactory = () => SunFlowerModule;

/**
 * Shape of a module's entrypoint. `configSchema` is a zod schema; it is typed as `unknown`
 * here to keep `shared/` free of a zod dependency, and the Core checks it at runtime.
 */
export interface ModuleEntrypoint {
  readonly default: ModuleFactory;
  readonly configSchema?: unknown;
}
