import type { FastifyInstance, FastifyReply } from 'fastify';

import type { CoreHandle } from '../../core/application/core.ts';
import type { Actor } from '../../shared/contracts/commands.ts';
import type { BotStatus, ConnectionState } from './ports.ts';
import { forbidden, type SessionAuth } from './session.ts';

export interface StatusSnapshot {
  readonly connection: ConnectionState;
  readonly uptimeMs: number;
  readonly modules: readonly { readonly id: string; readonly state: string }[];
}

export interface StatusRouteDeps {
  readonly core: CoreHandle;
  readonly status: BotStatus;
  readonly auth: SessionAuth;
  readonly now: () => number;
}

/** Only developers and the owner see the bot status. */
export function canSeeStatus(core: CoreHandle, actor: Actor): boolean {
  const level = core.permissions.level(actor);
  return level === 'developer' || level === 'owner';
}

/** The connection to Discord, how long the process has been up and each module's state. */
export function statusSnapshot(
  core: CoreHandle,
  status: BotStatus,
  now: () => number,
): StatusSnapshot {
  const modules = [...core.status()]
    .map(([id, module]) => ({ id, state: module.state }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    connection: status.connection(),
    uptimeMs: Math.max(0, now() - status.startedAt),
    modules,
  };
}

export function registerStatusRoute(app: FastifyInstance, deps: StatusRouteDeps): void {
  const { core, status, auth, now } = deps;
  app.get(
    '/api/status',
    { preHandler: auth.requireSession },
    async (request, reply): Promise<StatusSnapshot | FastifyReply> => {
      const { actor } = auth.authenticated(request);
      if (!canSeeStatus(core, actor)) return forbidden(reply);
      reply.header('cache-control', 'no-store');
      return statusSnapshot(core, status, now);
    },
  );
}
