import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { CoreHandle } from '../../core/application/core.ts';
import type { PanelEnvironment } from '../../core/configuration/panel-environment.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { registerAuthRoutes } from './auth-routes.ts';
import { clientKey } from './client-key.ts';
import { apiError } from './errors.ts';
import { LIVE_PATH, LiveHub, type LiveClock, type LiveLimits } from './live.ts';
import { registerOperationsRoute } from './operations-route.ts';
import type { BotStatus, MemberDirectory, OAuthClient } from './ports.ts';
import { CHANGING_METHODS, createSessionAuth, type SessionAuth } from './session.ts';
import { registerStatusRoute, statusSnapshot } from './status-route.ts';

export { SESSION_COOKIE } from './session.ts';

const CSP = [
  "default-src 'self'",
  "img-src 'self' https://cdn.discordapp.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** Marker in index.html that is replaced by the per-request style nonce. */
export const STYLE_NONCE_PLACEHOLDER = '__CSP_NONCE__';

/** The CSP of the index.html response: the usual one plus a style-src that accepts this nonce. */
export function cspWithStyleNonce(nonce: string): string {
  return `${CSP}; style-src 'self' 'nonce-${nonce}'`;
}

/** Puts the nonce in every place index.html has the marker. */
export function renderIndex(html: string, nonce: string): string {
  return html.replaceAll(STYLE_NONCE_PLACEHOLDER, nonce);
}

/** Sent on every response; helmet adds the same values to routed ones, errors before routing need this. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CSP,
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

/** Thrown 4xx errors keep their status; the message is always one of these, never the error's own. */
const CLIENT_ERRORS: Readonly<Record<number, { code: string; message: string }>> = {
  403: { code: 'forbidden', message: 'Sem permissão.' },
  404: { code: 'not_found', message: 'Não encontrado.' },
  409: { code: 'conflict', message: 'Conflito.' },
};

const BODY_LIMIT = 65_536;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const RATE_MAX_CHANGES = 30;
const RATE_MAX_LOGIN = 10;
/** A refused or stalled upgrade request is dropped after this long without traffic. */
const UPGRADE_IDLE_MS = 10_000;
/** The whole request (headers and body) must arrive within this time. */
const REQUEST_TIMEOUT_MS = 15_000;

export interface DashboardDeps {
  readonly env: PanelEnvironment;
  readonly core: CoreHandle;
  readonly directory: MemberDirectory;
  readonly status: BotStatus;
  readonly oauth: OAuthClient;
  readonly logger: Logger;
  /** The directory with the compiled panel (index.html and assets). */
  readonly staticDir: string;
  readonly now?: () => number;
  /** Time and timers of the live channel; tests pass a clock they advance by hand. */
  readonly liveClock?: LiveClock;
  /** Live connection limits; tests lower them. */
  readonly liveLimits?: LiveLimits;
  /**
   * Called with the session's idHash after `POST /api/logout` deleted it, after the live
   * connections of that session were closed. Errors it throws are logged, never sent.
   */
  readonly onLogout?: (idHash: string) => void;
}

const liveHubs = new WeakMap<FastifyInstance, LiveHub>();

/** The live channel of a dashboard built by `buildDashboard`. */
export function liveHubOf(app: FastifyInstance): LiveHub {
  const hub = liveHubs.get(app);
  if (hub === undefined) throw new Error('not a dashboard instance');
  return hub;
}

export interface DashboardHandle {
  close(): Promise<void>;
}

/** The percent-decoded pathname of a request target; scheme, authority, query and fragment are dropped. */
function decodedPathname(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url, 'http://x').pathname);
  } catch {
    return undefined;
  }
}

type ServerArea = 'api' | 'auth';

function areaOf(path: string): ServerArea | undefined {
  const under = (prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);
  if (under('/api')) return 'api';
  if (under('/auth')) return 'auth';
  return undefined;
}

/**
 * Paths under /api and /auth belong to the server; everything else is the single-page app. Routing
 * has already happened, so a matched route decides; unmatched requests (and the static wildcard)
 * fall back to the decoded pathname, and an undecodable one counts as an API path.
 */
function serverArea(request: FastifyRequest): ServerArea | undefined {
  const route = request.routeOptions.url;
  if (route !== undefined && route !== '/*' && route !== '*') return areaOf(route);
  const path = decodedPathname(request.url);
  return path === undefined ? 'api' : areaOf(path);
}

function isServerRequest(request: FastifyRequest): boolean {
  return serverArea(request) !== undefined;
}

/**
 * The API limiter key: the idHash of the validated session, else the client IP. A cookie that does
 * not resolve to a session falls back to the IP, so random cookies cannot open new buckets. The
 * lookup is read-only, so a refused request never extends the session.
 */
function rateLimitKey(auth: SessionAuth, request: FastifyRequest): string {
  const record = auth.peek(request);
  return record !== null ? `s:${record.idHash}` : `i:${clientKey(request.ip)}`;
}

/**
 * Absolute-form targets (`GET http://h/api/me`) and fragments are reduced to path and query, so
 * routing, the static plugin and the limiter all see the same path.
 */
function originForm(req: { url?: string | undefined }): string {
  const url = req.url ?? '/';
  if (url.startsWith('/') && !url.includes('#')) return url;
  try {
    const parsed = new URL(url, 'http://x');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Node-level client errors (unknown method, garbage request line, oversized header). */
function clientErrorHandler(error: Error & { code?: string }, socket: Socket): void {
  if (!socket.writable) {
    socket.destroy(error);
    return;
  }
  const status =
    error.code === 'HPE_HEADER_OVERFLOW'
      ? 431
      : error.code === 'ERR_HTTP_REQUEST_TIMEOUT'
        ? 408
        : 400;
  const reason = {
    400: 'Bad Request',
    408: 'Request Timeout',
    431: 'Request Header Fields Too Large',
  }[status];
  const body = JSON.stringify({ error: { code: 'bad_request', message: 'Requisição inválida.' } });
  const lines = [
    `HTTP/1.1 ${status} ${reason}`,
    ...Object.entries(SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}`),
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ];
  // end() only half-closes; destroy once flushed so half-open clients cannot hold the connection.
  socket.end(lines.join('\r\n'), () => socket.destroy());
}

/**
 * Raw upgrade requests and the ones that became WebSockets. Any other upgrade socket is destroyed
 * as soon as its HTTP answer is sent: nothing else would ever close it, whichever hook answered.
 */
class UpgradeSockets {
  readonly #requests = new WeakSet<IncomingMessage>();
  readonly #upgraded = new WeakSet<IncomingMessage>();

  /** Prepended to the server's `upgrade` listeners, so it runs before any routing. */
  readonly onUpgrade = (request: IncomingMessage, socket: Socket): void => {
    this.#requests.add(request);
    const drop = (): void => {
      if (!this.#upgraded.has(request)) socket.destroy();
    };
    // Backstops for a peer that goes silent or half-closes; ws clears the timeout on upgrade.
    socket.setTimeout(UPGRADE_IDLE_MS, drop);
    socket.once('end', drop);
  };

  isUpgrade(request: IncomingMessage): boolean {
    return this.#requests.has(request);
  }

  markUpgraded(request: IncomingMessage): void {
    this.#upgraded.add(request);
  }

  /** Destroys the socket of an upgrade request that was answered over HTTP instead. */
  closeStray(request: IncomingMessage): void {
    if (this.#requests.has(request) && !this.#upgraded.has(request)) request.socket.destroy();
  }
}

// Malformed URLs fail before routing, so no hook runs: answer them here, uniformly. These replies are
// not rate-limited, and FST_ERR_MAX_PARAM_LENGTH / FST_ERR_ASYNC_CONSTRAINT also become 400 bad_request.
function frameworkErrorsFor(upgrades: UpgradeSockets) {
  return (_error: Error, request: FastifyRequest, reply: FastifyReply): void => {
    if (upgrades.isUpgrade(request.raw)) {
      reply.raw.once('finish', () => {
        upgrades.closeStray(request.raw);
      });
    }
    reply.headers(SECURITY_HEADERS);
    apiError(reply, 400, 'bad_request', 'Requisição inválida.');
  };
}

/** Builds the server without listening; tests use `inject`. */
export async function buildDashboard(deps: DashboardDeps): Promise<FastifyInstance> {
  const { env, logger, staticDir } = deps;
  const upgrades = new UpgradeSockets();
  const app = Fastify({
    logger: false,
    trustProxy: env.trustProxy.length > 0 ? env.trustProxy : false,
    bodyLimit: BODY_LIMIT,
    // Above the 101 characters an operation name may have, so the route answers 404 to a bad one.
    routerOptions: { maxParamLength: 256 },
    requestTimeout: REQUEST_TIMEOUT_MS,
    // Node's default of 60 s would otherwise cap the headers phase above the request timeout.
    http: { headersTimeout: REQUEST_TIMEOUT_MS },
    // close() must not wait for slow or idle clients: shutdown has a deadline.
    forceCloseConnections: true,
    frameworkErrors: frameworkErrorsFor(upgrades),
    clientErrorHandler,
    rewriteUrl: originForm,
  });
  app.server.prependListener('upgrade', upgrades.onUpgrade);
  app.addHook('onResponse', (request, _reply, done) => {
    upgrades.closeStray(request.raw);
    done();
  });

  // Only application/json bodies are accepted; Fastify answers 415 to any other type with a body.
  app.removeContentTypeParser('text/plain');

  await app.register(fastifyHelmet, {
    // Helmet joins directives without a space; the CSP is set below as the exact string.
    contentSecurityPolicy: false,
    strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true },
    xContentTypeOptions: true,
    referrerPolicy: { policy: 'same-origin' },
  });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('content-security-policy', CSP);
  });
  await app.register(fastifyCookie, { secret: env.sessionSecret.toString('base64') });

  const auth = createSessionAuth({
    core: deps.core,
    directory: deps.directory,
    sessionSecret: env.sessionSecret,
    onSessionEnded: (idHash) => {
      liveHubs.get(app)?.revokeSession(idHash);
    },
  });
  const apiKey = (request: FastifyRequest): string => rateLimitKey(auth, request);

  // /auth has its own bucket per IP. The API has two per client: every request, and the changing
  // ones on top of that.
  await app.register(fastifyRateLimit, { global: false });
  const limitLogin = app.createRateLimit({
    max: RATE_MAX_LOGIN,
    timeWindow: RATE_WINDOW_MS,
    keyGenerator: (request) => `i:${clientKey(request.ip)}`,
  });
  const limitAll = app.createRateLimit({
    max: RATE_MAX,
    timeWindow: RATE_WINDOW_MS,
    keyGenerator: apiKey,
  });
  const limitChanges = app.createRateLimit({
    max: RATE_MAX_CHANGES,
    timeWindow: RATE_WINDOW_MS,
    keyGenerator: apiKey,
  });
  app.addHook('onRequest', async (request, reply) => {
    const area = serverArea(request);
    if (area === undefined) return;
    // A counted request is only refused once `isExceeded`; `isAllowed: false` just carries counters.
    let result = area === 'auth' ? await limitLogin(request) : await limitAll(request);
    if (
      area === 'api' &&
      !(!result.isAllowed && result.isExceeded) &&
      CHANGING_METHODS.has(request.method)
    ) {
      result = await limitChanges(request);
    }
    if (!result.isAllowed && result.isExceeded) {
      reply.header('retry-after', String(result.ttlInSeconds));
      return apiError(
        reply,
        429,
        'rate_limited',
        'Muitas requisições. Tente de novo em instantes.',
      );
    }
    return undefined;
  });
  // Only /api/live upgrades; any other route answers an upgrade request with a plain 404.
  app.addHook('onRequest', async (request, reply) => {
    if (upgrades.isUpgrade(request.raw) && request.routeOptions.url !== LIVE_PATH) {
      return apiError(reply, 404, 'not_found', 'Não encontrado.');
    }
    return undefined;
  });

  app.setErrorHandler(
    (error: { name: string; code?: string; statusCode?: number }, _req, reply) => {
      if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
        return apiError(reply, 415, 'unsupported_media_type', 'Só application/json é aceito.');
      }
      if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return apiError(reply, 413, 'payload_too_large', 'Corpo grande demais.');
      }
      const status = error.statusCode;
      if (status !== undefined && status >= 400 && status < 500) {
        const known = CLIENT_ERRORS[status];
        return apiError(
          reply,
          status,
          known?.code ?? 'bad_request',
          known?.message ?? 'Requisição inválida.',
        );
      }
      logger.error({ error: error.name }, 'dashboard request failed');
      return apiError(reply, 500, 'failed', 'Erro interno.');
    },
  );

  const now = deps.now ?? Date.now;
  const live = new LiveHub({
    core: deps.core,
    auth,
    directory: deps.directory,
    publicUrl: env.publicUrl,
    statusSnapshot: () => statusSnapshot(deps.core, deps.status, now),
    logger,
    ...(deps.liveClock === undefined ? {} : { clock: deps.liveClock }),
    ...(deps.liveLimits === undefined ? {} : { limits: deps.liveLimits }),
  });
  liveHubs.set(app, live);
  await live.register(app);
  // Sessions ended through the admin service: close their live connections at once.
  const stopListeningToRevocations = deps.core.sessions.onRevoked((idHashes) => {
    for (const idHash of idHashes) live.revokeSession(idHash);
  });
  app.addHook('onClose', (_instance, done) => {
    stopListeningToRevocations();
    done();
  });
  app.websocketServer.on('connection', (_socket: unknown, request: IncomingMessage) => {
    upgrades.markUpgraded(request);
  });

  try {
    registerAuthRoutes(app, {
      env,
      core: deps.core,
      directory: deps.directory,
      oauth: deps.oauth,
      logger,
      auth,
      now,
      // Logout, or a new login replacing the session the browser held.
      onLogout: (idHash) => {
        live.revokeSession(idHash);
        deps.onLogout?.(idHash);
      },
    });
    registerStatusRoute(app, { core: deps.core, status: deps.status, auth, now });
    registerOperationsRoute(app, { core: deps.core, auth });

    // index.html only leaves through the not-found handler below, which adds the style nonce.
    await app.register(fastifyStatic, {
      root: staticDir,
      dotfiles: 'deny',
      index: false,
      allowedPath: (path) => path !== '/' && path !== '/index.html',
    });

    // Cached after the first successful read; a missing file is looked up again on the next request.
    let indexHtml: string | undefined;
    app.setNotFoundHandler(async (request, reply) => {
      if (isServerRequest(request) || (request.method !== 'GET' && request.method !== 'HEAD')) {
        return apiError(reply, 404, 'not_found', 'Não encontrado.');
      }
      try {
        indexHtml ??= await readFile(join(staticDir, 'index.html'), 'utf8');
        const nonce = randomBytes(16).toString('base64');
        return reply
          .code(200)
          .header('content-security-policy', cspWithStyleNonce(nonce))
          .header('cache-control', 'no-store')
          .type('text/html; charset=utf-8')
          .send(renderIndex(indexHtml, nonce));
      } catch {
        return reply.code(503).type('text/plain; charset=utf-8').send('Painel não compilado.');
      }
    });
  } catch (error) {
    // A failed registration leaves no server to close, so the subscription is released here.
    stopListeningToRevocations();
    throw error;
  }

  return app;
}

/** Starts the panel on the loopback interface only; a reverse proxy exposes it. */
export async function startDashboard(deps: DashboardDeps): Promise<DashboardHandle> {
  const app = await buildDashboard(deps);
  try {
    await app.listen({ host: '127.0.0.1', port: deps.env.port });
  } catch (error) {
    // Releases the live hub's subscriptions and timers before reporting the failure.
    await app.close();
    throw error;
  }
  if (deps.env.trustProxy.length === 0) {
    deps.logger.warn(
      { variable: 'PANEL_TRUST_PROXY' },
      'panel trusts no proxy: every client behind a local proxy shares one rate-limit bucket',
    );
  }
  return { close: () => app.close() };
}
