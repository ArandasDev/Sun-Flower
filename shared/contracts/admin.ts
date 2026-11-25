import type { Actor } from './commands.ts';
import type { ModuleState } from './module.ts';
import type { OperationResult } from './operations.ts';

export interface DeveloperEntry {
  readonly userId: string;
  readonly addedAt: string;
}

export interface GrantEntry {
  readonly permission: string;
  readonly roleId: string;
  readonly grantedAt: string;
}

export interface ModuleEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly state: ModuleState;
  readonly enabled: boolean;
  /** False for modules that hold `core.admin`. */
  readonly canDisable: boolean;
  readonly dependencies: readonly string[];
  /** Modules that declare a dependency on this one. */
  readonly dependents: readonly string[];
  readonly failedAt?: string;
}

export type LogLevelName = 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  readonly time: string;
  readonly level: LogLevelName;
  readonly message: string;
  readonly module?: string;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SessionEntry {
  /** An opaque reference; the session hash never leaves the Core. */
  readonly ref: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

/** Core administration, available only to modules that hold the `core.admin` capability. */
export interface AdminService {
  readonly developers: {
    list(): DeveloperEntry[];
    add(actor: Actor, userId: string): OperationResult<{ added: boolean }>;
    remove(actor: Actor, userId: string): OperationResult<{ removed: boolean }>;
  };
  readonly grants: {
    list(): { grants: GrantEntry[]; grantable: string[] };
    grant(actor: Actor, permission: string, roleId: string): OperationResult<{ granted: boolean }>;
    revoke(actor: Actor, permission: string, roleId: string): OperationResult<{ revoked: boolean }>;
  };
  readonly modules: {
    list(): ModuleEntry[];
    setEnabled(
      actor: Actor,
      moduleId: string,
      enabled: boolean,
    ): Promise<OperationResult<{ changed: boolean; module: ModuleEntry }>>;
  };
  readonly logs: {
    recent(options: { limit: number; minLevel: LogLevelName }): LogEntry[];
  };
  readonly sessions: {
    list(): SessionEntry[];
    revoke(actor: Actor, ref: string): OperationResult<{ revoked: boolean }>;
    revokeAll(actor: Actor, userId: string): OperationResult<{ revoked: number }>;
  };
}
