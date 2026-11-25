import type {
  AdminService,
  GrantEntry,
  LogEntry,
  SessionEntry,
} from '../../shared/contracts/admin.ts';
import type { Actor } from '../../shared/contracts/commands.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { fail, ok } from '../../shared/contracts/operations.ts';
import type { RecentLogs } from '../infrastructure/recent-logs.ts';
import type { ModuleRegistry } from '../module-registry/registry.ts';
import {
  CorePermissionGrantError,
  InvalidPermissionError,
  InvalidSnowflakeError,
  ProtectedPermissionGrantError,
  UndeclaredPermissionError,
  type PermissionService,
} from '../permissions/permission-service.ts';
import type { SessionStore } from '../sessions/session-store.ts';

export interface AdminServiceDeps {
  readonly permissions: PermissionService;
  readonly sessions: SessionStore;
  /** A function because the service is created before the registry loads. */
  readonly registry: () => ModuleRegistry;
  readonly recentLogs?: RecentLogs;
  readonly logger: Logger;
}

const CANONICAL_SNOWFLAKE = /^[1-9]\d{16,19}$/;
const MAX_SNOWFLAKE = 2n ** 64n - 1n;

function isCanonicalSnowflake(id: unknown): id is string {
  return typeof id === 'string' && CANONICAL_SNOWFLAKE.test(id) && BigInt(id) <= MAX_SNOWFLAKE;
}

/** Masks a Discord ID for the audit log: an ellipsis and the last 4 digits. */
function maskId(id: string): string {
  return `…${id.slice(-4)}`;
}

const invalidInput = (field: string): ReturnType<typeof fail> =>
  fail('invalid', `Entrada inválida: ${field}.`);

interface AuditExtra {
  readonly target?: string;
  readonly permission?: string;
  readonly moduleId?: string;
  readonly count?: number;
  /** Set only when the change was stored but did not take effect, as an enable that failed. */
  readonly result?: 'failed';
}

/** Translates the Core services into the AdminService contract, with fixed texts and an audit log. */
export function createAdminService(deps: AdminServiceDeps): AdminService {
  const { permissions, sessions, logger } = deps;

  const audit = (action: string, actor: Actor, extra: AuditExtra = {}): void => {
    logger.info(
      {
        action,
        actor: maskId(actor.userId),
        ...(extra.target === undefined ? {} : { target: maskId(extra.target) }),
        ...(extra.permission === undefined ? {} : { permission: extra.permission }),
        ...(extra.moduleId === undefined ? {} : { moduleId: extra.moduleId }),
        ...(extra.count === undefined ? {} : { count: extra.count }),
        ...(extra.result === undefined ? {} : { result: extra.result }),
      },
      'admin change',
    );
  };

  return {
    developers: {
      list: () =>
        permissions.listDevelopers().map((d) => ({ userId: d.userId, addedAt: d.addedAt })),
      add: (actor, userId) => {
        if (!isCanonicalSnowflake(userId)) return invalidInput('userId');
        const added = permissions.addDeveloper(userId);
        if (added) audit('developers.add', actor, { target: userId });
        return ok({ added });
      },
      remove: (actor, userId) => {
        if (!isCanonicalSnowflake(userId)) return invalidInput('userId');
        if (actor.userId === userId) {
          return fail('conflict', 'Você não pode remover a si mesmo dos desenvolvedores.');
        }
        const current = permissions.listDevelopers();
        if (current.length === 1 && current[0]?.userId === userId) {
          return fail('conflict', 'Não é possível remover o último desenvolvedor.');
        }
        const removed = permissions.removeDeveloper(userId);
        if (removed) audit('developers.remove', actor, { target: userId });
        return ok({ removed });
      },
    },
    grants: {
      list: () => {
        const grants: GrantEntry[] = permissions.listGrants().map((g) => ({
          permission: g.permission,
          roleId: g.roleId,
          grantedAt: g.grantedAt,
        }));
        const grantable = [...deps.registry().declaredPermissions()]
          .filter((p) => !p.startsWith('core.') && !p.startsWith('administration.'))
          .sort();
        return { grants, grantable };
      },
      grant: (actor, permission, roleId) => {
        if (!isCanonicalSnowflake(roleId)) return invalidInput('roleId');
        const had = permissions
          .listGrants()
          .some((g) => g.permission === permission && g.roleId === roleId);
        try {
          permissions.grant(permission, roleId, deps.registry().declaredPermissions());
        } catch (error) {
          if (error instanceof InvalidSnowflakeError) return invalidInput('roleId');
          if (error instanceof InvalidPermissionError) {
            return fail('invalid', 'Permissão inválida.');
          }
          if (
            error instanceof CorePermissionGrantError ||
            error instanceof ProtectedPermissionGrantError
          ) {
            return fail('invalid', 'Esta permissão não pode ser associada a cargos.');
          }
          if (error instanceof UndeclaredPermissionError) {
            return fail('invalid', 'Nenhum módulo declara esta permissão.');
          }
          throw error;
        }
        if (!had) audit('grants.grant', actor, { target: roleId, permission });
        return ok({ granted: !had });
      },
      revoke: (actor, permission, roleId) => {
        if (!isCanonicalSnowflake(roleId)) return invalidInput('roleId');
        const revoked = permissions.revoke(permission, roleId);
        if (revoked) audit('grants.revoke', actor, { target: roleId, permission });
        return ok({ revoked });
      },
    },
    modules: {
      list: () => deps.registry().entries(),
      setEnabled: async (actor, moduleId, enabled) => {
        const action = enabled ? 'modules.enable' : 'modules.disable';
        let outcome;
        try {
          outcome = await deps.registry().setEnabled(moduleId, enabled);
        } catch (error) {
          logger.error(
            { action, error: error instanceof Error ? error.name : 'Error' },
            'admin failure',
          );
          return fail('failed', 'Erro interno.');
        }
        switch (outcome.kind) {
          case 'changed':
          case 'unchanged': {
            const changed = outcome.kind === 'changed';
            if (changed) audit(action, actor, { moduleId });
            return ok({ changed, module: outcome.entry });
          }
          case 'unknown':
            return fail('not_found', 'Módulo desconhecido.');
          case 'protected':
            return fail('conflict', 'Este módulo não pode ser desligado.');
          case 'dependents':
            return fail('conflict', `Outros módulos dependem deste: ${outcome.ids.join(', ')}.`);
          case 'dependencies':
            return fail('conflict', `Ligue antes: ${outcome.ids.join(', ')}.`);
          case 'failed':
            // The enabled flag is already stored, so the module is retried at the next start.
            audit(action, actor, { moduleId, result: 'failed' });
            return fail('failed', 'O módulo não conseguiu iniciar.');
          case 'stopping':
            return fail('unavailable', 'O bot está encerrando.');
        }
      },
    },
    logs: {
      recent: (options): LogEntry[] => deps.recentLogs?.recent(options) ?? [],
    },
    sessions: {
      list: (): SessionEntry[] =>
        sessions.list().map((s) => ({
          ref: sessions.refOf(s.idHash),
          userId: s.userId,
          createdAt: new Date(s.createdAt).toISOString(),
          lastSeenAt: new Date(s.lastSeenAt).toISOString(),
        })),
      revoke: (actor, ref) => {
        if (!sessions.revokeByRef(ref)) return fail('not_found', 'Sessão não encontrada.');
        audit('sessions.revoke', actor);
        return ok({ revoked: true });
      },
      revokeAll: (actor, userId) => {
        if (!isCanonicalSnowflake(userId)) return invalidInput('userId');
        const count = sessions.revokeForUser(userId);
        if (count > 0) audit('sessions.revoke-all', actor, { target: userId, count });
        return ok({ revoked: count });
      },
    },
  };
}
