import type { FastifyReply } from 'fastify';

export interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

/** Every API error, whatever the status, has this one shape. */
export function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  const body: ApiErrorBody = { error: { code, message } };
  return reply.code(status).send(body);
}
