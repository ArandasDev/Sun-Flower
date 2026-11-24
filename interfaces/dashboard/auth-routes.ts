import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { CoreHandle } from '../../core/application/core.ts';
import type { PanelEnvironment } from '../../core/configuration/panel-environment.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { MemberDirectory, OAuthClient } from './ports.ts';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  forbidden,
  lookupMember,
  safeEqual,
  unauthorized,
  type SessionAuth,
} from './session.ts';

export const OAUTH_COOKIE = '__Host-sf_oauth';
/** How long a started login stays valid. */
export const OAUTH_TTL_MS = 600_000;

const OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;

export type LoginError = 'dev_not_member' | 'not_member' | 'retry' | 'failed';

export interface AuthRoutesDeps {
  readonly env: PanelEnvironment;
  readonly core: CoreHandle;
  readonly directory: MemberDirectory;
  readonly oauth: OAuthClient;
  readonly logger: Logger;
  readonly auth: SessionAuth;
  readonly now: () => number;
  /**
   * Called with the idHash of every session these routes end (a logout, or the previous session
   * of a browser that logs in again), so its live connections can be closed.
   */
  readonly onLogout?: (idHash: string) => void;
}

interface PendingLogin {
  readonly state: string;
  readonly verifier: string;
  readonly expiresAt: number;
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function parsePending(raw: string): PendingLogin | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    const { state, verifier, expiresAt } = value as Record<string, unknown>;
    if (typeof state !== 'string' || !BASE64URL_32.test(state)) return null;
    if (typeof verifier !== 'string' || !BASE64URL_32.test(verifier)) return null;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
    return { state, verifier, expiresAt };
  } catch {
    return null;
  }
}

/** A single query parameter as a string; repeated or missing parameters are `undefined`. */
function param(request: FastifyRequest, name: string): string | undefined {
  const value = (request.query as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'no-store');
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const { env, core, directory, oauth, logger, auth, now } = deps;
  const home = `${env.publicUrl}/`;
  const loginError = (error: LoginError): string => `${env.publicUrl}/login?error=${error}`;

  /** The pending login of the oauth cookie, if it is authentic, well formed and not expired. */
  const pendingLogin = (request: FastifyRequest): PendingLogin | null => {
    const raw = request.cookies[OAUTH_COOKIE];
    if (raw === undefined || raw === '') return null;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value === null) return null;
    const pending = parsePending(unsigned.value);
    if (pending === null || now() > pending.expiresAt) return null;
    return pending;
  };

  /** Resolves the user ID behind the callback, or null when the login failed. */
  const identify = async (request: FastifyRequest): Promise<string | null> => {
    const pending = pendingLogin(request);
    const state = param(request, 'state');
    const code = param(request, 'code');
    if (pending === null || state === undefined || code === undefined) return null;
    if (!safeEqual(state, pending.state)) return null;
    try {
      // The access token lives only in this local variable and is dropped after the user lookup.
      const accessToken = await oauth.exchange(code, pending.verifier);
      return await oauth.fetchUserId(accessToken);
    } catch {
      return null;
    }
  };

  /** Runs the session-ended hook; its errors are logged, never sent. */
  const sessionEnded = (idHash: string): void => {
    try {
      deps.onLogout?.(idHash);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.name : 'unknown' },
        'logout hook failed',
      );
    }
  };

  app.get('/auth/login', async (_request, reply) => {
    const state = randomToken();
    const verifier = randomToken();
    const pending: PendingLogin = { state, verifier, expiresAt: now() + OAUTH_TTL_MS };
    reply.setCookie(OAUTH_COOKIE, JSON.stringify(pending), {
      ...OAUTH_COOKIE_OPTIONS,
      signed: true,
      maxAge: OAUTH_TTL_MS / 1000,
    });
    return noStore(reply).redirect(oauth.authorizeUrl(state, challengeFor(verifier)), 302);
  });

  app.get('/auth/callback', async (request, reply) => {
    noStore(reply);
    // The pending login is single use, whatever the outcome.
    reply.clearCookie(OAUTH_COOKIE, OAUTH_COOKIE_OPTIONS);
    const identity = await identify(request);
    if (identity === null) {
      logger.info({ reason: 'oauth' }, 'panel login refused');
      return reply.redirect(loginError('failed'), 302);
    }
    const userId = identity;
    const member = await lookupMember(directory, userId);
    if (member === undefined) {
      logger.warn({ reason: 'lookup' }, 'panel login refused');
      return reply.redirect(loginError('retry'), 302);
    }
    // Discord already identified the person: any failure from here on is a plain failed login.
    try {
      if (member === null) {
        logger.info({ reason: 'not_member' }, 'panel login refused');
        const error = core.permissions.isDeveloper(userId) ? 'dev_not_member' : 'not_member';
        return reply.redirect(loginError(error), 302);
      }
      // A new login always gets a new session. The one the browser held before is dropped, but only
      // once the new one exists, so a failure here never leaves the browser without either.
      const previous = auth.peek(request);
      const { token } = core.sessions.create(userId);
      if (previous !== null) {
        core.sessions.deleteByHash(previous.idHash);
        sessionEnded(previous.idHash);
      }
      reply.setCookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
      logger.info('panel login succeeded');
      return reply.redirect(home, 302);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.name : 'unknown' },
        'panel login failed',
      );
      return reply.redirect(loginError('failed'), 302);
    }
  });

  app.get('/api/me', { preHandler: auth.requireSession }, async (request, reply) => {
    const { record, actor, member } = auth.authenticated(request);
    noStore(reply);
    return {
      id: actor.userId,
      name: member.displayName,
      avatarUrl: member.avatarUrl,
      level: core.permissions.level(actor),
      permissions: core.permissions.effective(actor, core.declaredPermissions()),
      csrfToken: auth.csrfToken(record.idHash),
    };
  });

  // Logout needs only a valid session and its CSRF token, not the directory: it must work even
  // when the membership cannot be confirmed.
  app.post('/api/logout', async (request, reply) => {
    const record = auth.resolve(request);
    if (record === null) return unauthorized(reply);
    if (!auth.hasValidCsrf(request, record.idHash)) return forbidden(reply);
    core.sessions.deleteByHash(record.idHash);
    reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    sessionEnded(record.idHash);
    return noStore(reply).code(204).send();
  });
}
