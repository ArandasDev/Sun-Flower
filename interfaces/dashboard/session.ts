import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { CoreHandle } from '../../core/application/core.ts';
import type { SessionRecord } from '../../core/sessions/session-store.ts';
import type { Actor } from '../../shared/contracts/commands.ts';
import { apiError } from './errors.ts';
import type { MemberDirectory, MemberInfo } from './ports.ts';

export const SESSION_COOKIE = '__Host-sf_session';
export const CSRF_HEADER = 'x-csrf-token';

/** The methods that change state: they need the CSRF token and count against the change limit. */
export const CHANGING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The flags of the session cookie; the cookie itself lives only for the browser session. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

export const UNAVAILABLE_MESSAGE =
  'Não foi possível confirmar seu acesso agora. Tente de novo em instantes.';

export interface Authenticated {
  readonly record: SessionRecord;
  readonly actor: Actor;
  readonly member: MemberInfo;
}

/**
 * The outcome of authenticating a request: the person, or why not. `unavailable` means Discord
 * could not confirm the membership; the session is kept.
 */
export type AuthOutcome = Authenticated | 'unauthorized' | 'unavailable';

export interface SessionAuth {
  /** The valid session behind the request's cookie, read-only (`last_seen_at` untouched). */
  readonly peek: (request: FastifyRequest) => SessionRecord | null;
  /** The valid session behind the request's cookie, resolved (and touched) at most once per request. */
  readonly resolve: (request: FastifyRequest) => SessionRecord | null;
  /**
   * Resolves the session and looks the person up in the directory. A person who is no longer a
   * member loses the session; a lookup that cannot answer only refuses this request.
   */
  readonly authenticate: (request: FastifyRequest) => Promise<AuthOutcome>;
  readonly csrfToken: (idHash: string) => string;
  /** Whether the request carries the CSRF token of this session. */
  readonly hasValidCsrf: (request: FastifyRequest, idHash: string) => boolean;
  /**
   * preHandler: 401 without a session, 403 on a changing method without CSRF (checked before the
   * directory), 503 when the membership cannot be confirmed.
   */
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

export function unavailable(reply: FastifyReply): FastifyReply {
  return apiError(reply, 503, 'unavailable', UNAVAILABLE_MESSAGE);
}

/** Constant-time string comparison; strings of different lengths are simply unequal. */
export function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A directory lookup that never throws: a failure is `undefined`, like an unanswered lookup. */
export async function lookupMember(
  directory: MemberDirectory,
  userId: string,
): Promise<MemberInfo | null | undefined> {
  try {
    return await directory.lookup(userId);
  } catch {
    return undefined;
  }
}

/** The actor of a member, rebuilt from the directory every time it is needed. */
export function actorFor(userId: string, member: MemberInfo): Actor {
  return { userId, roleIds: [...member.roleIds], isOwner: member.isOwner };
}

export function createSessionAuth(deps: SessionAuthDeps): SessionAuth {
  const { core, directory, sessionSecret } = deps;
  const peeked = new WeakMap<FastifyRequest, SessionRecord | null>();
  const resolved = new WeakMap<FastifyRequest, SessionRecord | null>();
  const authenticatedRequests = new WeakMap<FastifyRequest, Authenticated>();

  const tokenOf = (request: FastifyRequest): string | undefined => {
    const token = request.cookies[SESSION_COOKIE];
    return token === undefined || token === '' ? undefined : token;
  };

  const cached = (
    cache: WeakMap<FastifyRequest, SessionRecord | null>,
    request: FastifyRequest,
    read: (token: string) => SessionRecord | null,
  ): SessionRecord | null => {
    if (cache.has(request)) return cache.get(request) ?? null;
    const token = tokenOf(request);
    let record: SessionRecord | null = null;
    if (token !== undefined) {
      try {
        record = read(token);
      } catch {
        record = null;
      }
    }
    cache.set(request, record);
    return record;
  };

  const peek = (request: FastifyRequest): SessionRecord | null =>
    cached(peeked, request, (token) => core.sessions.peek(token));

  const resolve = (request: FastifyRequest): SessionRecord | null =>
    cached(resolved, request, (token) => core.sessions.resolve(token));

  const csrfToken = (idHash: string): string =>
    createHmac('sha256', sessionSecret).update(`csrf:${idHash}`).digest('base64url');

  const hasValidCsrf = (request: FastifyRequest, idHash: string): boolean => {
    const given = request.headers[CSRF_HEADER];
    return typeof given === 'string' && safeEqual(given, csrfToken(idHash));
  };

  const confirm = async (request: FastifyRequest, record: SessionRecord): Promise<AuthOutcome> => {
    const member = await lookupMember(directory, record.userId);
    if (member === undefined) return 'unavailable';
    if (member === null) {
      core.sessions.deleteByHash(record.idHash);
      resolved.set(request, null);
      return 'unauthorized';
    }
    return { record, actor: actorFor(record.userId, member), member };
  };

  const authenticate = async (request: FastifyRequest): Promise<AuthOutcome> => {
    const record = resolve(request);
    return record === null ? 'unauthorized' : confirm(request, record);
  };

  return {
    peek,
    resolve,
    authenticate,
    csrfToken,
    hasValidCsrf,
    requireSession: async (request, reply) => {
      const record = resolve(request);
      if (record === null) return unauthorized(reply);
      if (CHANGING_METHODS.has(request.method) && !hasValidCsrf(request, record.idHash)) {
        return forbidden(reply);
      }
      const outcome = await confirm(request, record);
      if (outcome === 'unauthorized') return unauthorized(reply);
      if (outcome === 'unavailable') return unavailable(reply);
      authenticatedRequests.set(request, outcome);
      return undefined;
    },
    authenticated: (request) => {
      const auth = authenticatedRequests.get(request);
      if (auth === undefined) throw new Error('requireSession did not run for this request');
      return auth;
    },
  };
}
