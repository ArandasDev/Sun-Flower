import type { AdminService } from '../../shared/contracts/admin.ts';
import type { ModuleManifest } from '../../shared/contracts/module.ts';

export interface ModuleAdminOptions {
  readonly manifest: ModuleManifest;
  /** Undefined until the Core wires the service in. */
  readonly service: AdminService | undefined;
  /** False once the module failed, stopped or was replaced by a new instance; defaults to true. */
  readonly isActive?: () => boolean;
}

/** Lists every AdminService method: adding one to the contract fails the typecheck until listed. */
type Surface = { [G in keyof AdminService]: { [M in keyof AdminService[G]]: true } };

const SURFACE: Surface = {
  developers: { list: true, add: true, remove: true },
  grants: { list: true, grant: true, revoke: true },
  modules: { list: true, setEnabled: true },
  logs: { recent: true },
  sessions: { list: true, revoke: true, revokeAll: true },
};

/** Methods that return a Promise reject instead of throwing. */
const ASYNC_METHODS: ReadonlySet<string> = new Set(['modules.setEnabled']);

/**
 * The `admin` of a module context: a frozen object that checks the `core.admin` capability on
 * every call. Reading the property never throws, so modules may destructure the context.
 */
export function createModuleAdmin(options: ModuleAdminOptions): AdminService {
  const { manifest, service } = options;
  const isActive = options.isActive ?? ((): boolean => true);
  const allowed = manifest.capabilities.includes('core.admin');

  const groups: Record<string, Record<string, (...args: unknown[]) => unknown>> = {};
  for (const [group, methods] of Object.entries(SURFACE)) {
    const wrapped: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of Object.keys(methods)) {
      wrapped[method] = (...args: unknown[]): unknown => {
        try {
          if (!allowed) {
            throw new Error(`Module "${manifest.id}" lacks capability core.admin`);
          }
          if (!isActive()) throw new Error(`Module "${manifest.id}" is not active`);
          if (service === undefined) throw new Error('Admin service is not available');
          const target = (service as unknown as Record<string, Record<string, unknown>>)[group];
          const fn = target?.[method] as ((...a: unknown[]) => unknown) | undefined;
          if (fn === undefined) throw new Error('Admin service is not available');
          return fn.apply(target, args);
        } catch (error) {
          if (ASYNC_METHODS.has(`${group}.${method}`))
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
      };
    }
    groups[group] = Object.freeze(wrapped);
  }
  return Object.freeze(groups) as unknown as AdminService;
}
