import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { CoreHandle } from '../../core/application/core.ts';
import type { PanelEnvironment } from '../../core/configuration/panel-environment.ts';
import { hashSessionToken } from '../../core/sessions/session-store.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { apiError } from './errors.ts';
import type { BotStatus, MemberDirectory, OAuthClient } from './ports.ts';

export const SESSION_COOKIE = '__Host-sf_session';

const CSP = [
  "default-src 'self'",
  "img-src 'self' https://cdn.discordapp.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

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
const CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
}

export interface DashboardHandle {
  close(): Promise<void>;
}

/**
 * Paths under these prefixes belong to the server; everything else is the single-page app. The
 * path is percent-decoded first, because the router decodes it too (`/%61pi` reaches `/api`); an
 * undecodable path counts as a server path.
 */
function isServerPath(url: string): boolean {
  let path = url.split('?')[0] ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    return true;
  }
  return ['/api', '/auth'].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The limiter key: the hash of the session cookie when present (never the raw value), else the
 * client IP. The cookie is not validated here, so it only picks a bucket.
 */
function rateLimitKey(request: FastifyRequest): string {
  const cookie = request.cookies[SESSION_COOKIE];
  return cookie !== undefined && cookie !== ''
    ? `s:${hashSessionToken(cookie)}`
    : `i:${request.ip}`;
}

// Malformed URLs fail before routing, so no hook runs: answer them here, uniformly.
function frameworkErrors(_error: Error, _request: unknown, reply: FastifyReply): void {
  reply.headers(SECURITY_HEADERS);
  apiError(reply, 400, 'bad_request', 'Requisição inválida.');
}

/** Builds the server without listening; tests use `inject`. */
export async function buildDashboard(deps: DashboardDeps): Promise<FastifyInstance> {
  const { env, logger, staticDir } = deps;
  const app = Fastify({
    logger: false,
    trustProxy: env.trustProxy.length > 0 ? env.trustProxy : false,
    bodyLimit: BODY_LIMIT,
    frameworkErrors,
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

  // Two buckets per client: every API request, and the changing ones on top of that.
  await app.register(fastifyRateLimit, { global: false });
  const limitAll = app.createRateLimit({
    max: RATE_MAX,
    timeWindow: RATE_WINDOW_MS,
    keyGenerator: rateLimitKey,
  });
  const limitChanges = app.createRateLimit({
    max: RATE_MAX_CHANGES,
    timeWindow: RATE_WINDOW_MS,
    keyGenerator: rateLimitKey,
  });
  app.addHook('onRequest', async (request, reply) => {
    if (!isServerPath(request.url)) return;
    // A counted request is only refused once `isExceeded`; `isAllowed: false` just carries counters.
    let result = await limitAll(request);
    if (!(!result.isAllowed && result.isExceeded) && CHANGING_METHODS.has(request.method)) {
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

  await app.register(fastifyStatic, { root: staticDir, dotfiles: 'deny' });

  // Cached after the first successful read; a missing file is looked up again on the next request.
  let indexHtml: Buffer | undefined;
  app.setNotFoundHandler(async (request, reply) => {
    if (isServerPath(request.url) || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return apiError(reply, 404, 'not_found', 'Não encontrado.');
    }
    try {
      indexHtml ??= await readFile(join(staticDir, 'index.html'));
      const html = indexHtml;
      return reply.code(200).type('text/html; charset=utf-8').send(html);
    } catch {
      return reply.code(503).type('text/plain; charset=utf-8').send('Painel não compilado.');
    }
  });

  return app;
}

/** Starts the panel on the loopback interface only; a reverse proxy exposes it. */
export async function startDashboard(deps: DashboardDeps): Promise<DashboardHandle> {
  const app = await buildDashboard(deps);
  await app.listen({ host: '127.0.0.1', port: deps.env.port });
  return { close: () => app.close() };
}
