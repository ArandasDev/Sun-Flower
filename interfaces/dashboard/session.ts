import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { CoreHandle } from '../../core/application/core.ts';
import type { SessionRecord } from '../../core/sessions/session-store.ts';
import type { Actor } from '../../shared/contracts/commands.ts';
import { apiError } from './errors.ts';
import type { MemberDirectory, MemberInfo } from './ports.ts';

export const SESSION_COOKIE = '__Host-sf_session';
export const CSRF_HEADER = 'x-csrf-token';

const CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The flags of the session cookie; the cookie itself lives only for the browser session. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

export interface Authenticated {
  readonly record: SessionRecord;
  readonly actor: Actor;
  readonly member: MemberInfo;
}

export interface SessionAuth {
  /** The valid session behind the request's cookie, resolved at most once per request. */
  readonly resolve: (request: FastifyRequest) => SessionRecord | null;
  /**
   * Resolves the session and looks the person up in the directory. A person who is no longer a
   * member loses the session; a lookup that cannot answer only refuses this request.
   */
  readonly authenticate: (request: FastifyRequest) => Promise<Authenticated | null>;
  readonly csrfToken: (idHash: string) => string;
  /** Whether the request carries the CSRF token of this session. */
  readonly hasValidCsrf: (request: FastifyRequest, idHash: string) => boolean;
  /** preHandler: 401 without an authenticated session, 403 on a changing method without CSRF. */
  readonly requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<FastifyReply | undefined>;
  /** The result of `requireSession` for this request; throws if it did not run or refused. */
  readonly authenticated: (request: FastifyRequest) => Authenticated;
}

export interface SessionAuthDeps {
  readonly core: CoreHandle;
  readonly directory: MemberDirectory;
  readonly sessionSecret: Buffer;
}

export function unauthorized(reply: FastifyReply): FastifyReply {
  return apiError(reply, 401, 'unauthorized', 'Faça login para continuar.');
}

export function forbidden(reply: FastifyReply): FastifyReply {
  return apiError(reply, 403, 'forbidden', 'Sem permissão.');
}

function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSessionAuth(deps: SessionAuthDeps): SessionAuth {
  const { core, directory, sessionSecret } = deps;
  const resolved = new WeakMap<FastifyRequest, SessionRecord | null>();
  const authenticatedRequests = new WeakMap<FastifyRequest, Authenticated>();

  const resolve = (request: FastifyRequest): SessionRecord | null => {
    if (resolved.has(request)) return resolved.get(request) ?? null;
    const token = request.cookies[SESSION_COOKIE];
    let record: SessionRecord | null = null;
    if (token !== undefined && token !== '') {
      try {
        record = core.sessions.resolve(token);
      } catch {
        record = null;
      }
    }
    resolved.set(request, record);
    return record;
  };

  const csrfToken = (idHash: string): string =>
    createHmac('sha256', sessionSecret).update(`csrf:${idHash}`).digest('base64url');

  const hasValidCsrf = (request: FastifyRequest, idHash: string): boolean => {
    const given = request.headers[CSRF_HEADER];
    return typeof given === 'string' && safeEqual(given, csrfToken(idHash));
  };

  const authenticate = async (request: FastifyRequest): Promise<Authenticated | null> => {
    const record = resolve(request);
    if (record === null) return null;
    let member: MemberInfo | null | undefined;
    try {
      member = await directory.lookup(record.userId);
    } catch {
      member = undefined;
    }
    if (member === undefined) return null;
    if (member === null) {
      core.sessions.deleteByHash(record.idHash);
      resolved.set(request, null);
      return null;
    }
    const actor: Actor = {
      userId: record.userId,
      roleIds: [...member.roleIds],
      isOwner: member.isOwner,
    };
    return { record, actor, member };
  };

  return {
    resolve,
    authenticate,
    csrfToken,
    hasValidCsrf,
    requireSession: async (request, reply) => {
      const auth = await authenticate(request);
      if (auth === null) return unauthorized(reply);
      if (CHANGING_METHODS.has(request.method) && !hasValidCsrf(request, auth.record.idHash)) {
        return forbidden(reply);
      }
      authenticatedRequests.set(request, auth);
      return undefined;
    },
    authenticated: (request) => {
      const auth = authenticatedRequests.get(request);
      if (auth === undefined) throw new Error('requireSession did not run for this request');
      return auth;
    },
  };
}
