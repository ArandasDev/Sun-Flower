import type { FastifyInstance, FastifyReply } from 'fastify';

import type { CoreHandle } from '../../core/application/core.ts';
import type { OperationErrorCode } from '../../shared/contracts/operations.ts';
import type { SessionAuth } from './session.ts';

/** A well-formed operation name; anything else is answered 404 without reaching the Core. */
export const OPERATION_NAME = /^[a-z][a-z0-9.-]{2,100}$/;

const UNKNOWN_OPERATION = 'Operação desconhecida.';
const INVALID_ROOT = 'Entrada inválida: (raiz).';

const STATUS: Readonly<Record<OperationErrorCode, number>> = {
  forbidden: 403,
  invalid: 422,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
  failed: 500,
};

export interface OperationsRouteDeps {
  readonly core: CoreHandle;
  readonly auth: SessionAuth;
}

/** Errors of this route carry only the fixed message of the operation; the input is never echoed. */
function operationError(reply: FastifyReply, status: number, message: string): FastifyReply {
  return reply.code(status).send({ error: message });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `POST /api/operations/:name`: runs a module operation as the person behind the session. The
 * actor always comes from the session, never from the body; the Core checks module state,
 * permission and input.
 */
export function registerOperationsRoute(app: FastifyInstance, deps: OperationsRouteDeps): void {
  const { core, auth } = deps;
  app.post<{ Params: { name: string } }>(
    '/api/operations/:name',
    { preHandler: auth.requireSession },
    async (request, reply): Promise<FastifyReply> => {
      reply.header('cache-control', 'no-store');
      const { name } = request.params;
      if (!OPERATION_NAME.test(name)) return operationError(reply, 404, UNKNOWN_OPERATION);
      const body: unknown = request.body === undefined ? {} : request.body;
      if (!isJsonObject(body)) return operationError(reply, 422, INVALID_ROOT);
      const { actor } = auth.authenticated(request);
      const result = await core.operations.execute(name, actor, body, 'dashboard');
      if (result.ok) return reply.code(200).send({ data: result.data });
      return operationError(reply, STATUS[result.error.code], result.error.message);
    },
  );
}
