import type { Actor, CommandDefinition } from './commands.ts';
import type { EventContext, EventHandler } from './events.ts';
import type { Logger } from './logger.ts';

export const CORE_API_VERSION = '1.0.0';

export interface ModuleManifest {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly entrypoint: string;
  readonly dependencies: readonly string[];
  readonly permissions: readonly string[];
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
  readonly permissions: { check(actor: Actor, permission: string): boolean };
  readonly config: { get<T>(): T };
  readonly commands: { register(command: CommandDefinition): void };
}

export interface SunFlowerModule {
  register(context: ModuleContext): Promise<void>;
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export type ModuleFactory = () => SunFlowerModule;
