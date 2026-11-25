import type { AdminService } from '../../shared/contracts/admin.ts';
import type { ModuleManifest } from '../../shared/contracts/module.ts';

export interface ModuleAdminOptions {
  readonly manifest: ModuleManifest;
  /** Undefined until the Core wires the service in. */
  readonly service: AdminService | undefined;
}

const METHODS = {
  developers: ['list', 'add', 'remove'],
  grants: ['list', 'grant', 'revoke'],
  modules: ['list', 'setEnabled'],
  logs: ['recent'],
  sessions: ['list', 'revoke', 'revokeAll'],
} as const;

/**
 * The `admin` of a module context: a frozen object that checks the `core.admin` capability on
 * every call. Reading the property never throws, so modules may destructure the context.
 */
export function createModuleAdmin(options: ModuleAdminOptions): AdminService {
  const { manifest, service } = options;
  const allowed = manifest.capabilities.includes('core.admin');

  const groups: Record<string, Record<string, (...args: unknown[]) => unknown>> = {};
  for (const [group, methods] of Object.entries(METHODS)) {
    const wrapped: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of methods) {
      wrapped[method] = (...args: unknown[]): unknown => {
        if (!allowed) {
          throw new Error(`Module "${manifest.id}" lacks capability core.admin`);
        }
        if (service === undefined) throw new Error('Admin service is not available');
        const target = (service as unknown as Record<string, Record<string, unknown>>)[group];
        const fn = target?.[method] as ((...a: unknown[]) => unknown) | undefined;
        if (fn === undefined) throw new Error('Admin service is not available');
        return fn.apply(target, args);
      };
    }
    groups[group] = Object.freeze(wrapped);
  }
  return Object.freeze(groups) as unknown as AdminService;
}
