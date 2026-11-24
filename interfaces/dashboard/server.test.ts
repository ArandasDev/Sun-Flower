import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoreHandle } from '../../core/application/core.ts';
import type { PanelEnvironment } from '../../core/configuration/panel-environment.ts';
import {
  createRecordingLogger,
  type RecordingLogger,
} from '../../tests/helpers/recording-logger.ts';
import type { OAuthClient } from './ports.ts';
import { buildDashboard, type DashboardDeps } from './server.ts';

const anyString = expect.any(String) as string;
const CSP =
  "default-src 'self'; img-src 'self' https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

let root: string;
let staticDir: string;
let logger: RecordingLogger;
let app: FastifyInstance | undefined;

function makeEnv(trustProxy: string[] = []): PanelEnvironment {
  return {
    publicUrl: 'https://painel.example.com',
    port: 3000,
    clientId: '111111111111111111',
    clientSecret: 'fake-client-secret',
    sessionSecret: Buffer.alloc(32, 7),
    trustProxy,
  };
}

function makeDeps(overrides: Partial<DashboardDeps> = {}): DashboardDeps {
  return {
    env: makeEnv(),
    core: {} as CoreHandle,
    directory: { lookup: () => Promise.resolve(undefined) },
    status: { connection: () => 'ready', startedAt: 0 },
    oauth: {} as OAuthClient,
    logger,
    staticDir,
    ...overrides,
  };
}

/** Routes are added by the test after this returns; inject() makes the server ready. */
async function build(overrides: Partial<DashboardDeps> = {}): Promise<FastifyInstance> {
  app = await buildDashboard(makeDeps(overrides));
  return app;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sf-dashboard-'));
  staticDir = join(root, 'public');
  mkdirSync(staticDir);
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Painel</title>');
  writeFileSync(join(staticDir, 'app.js'), 'console.log(1);');
  writeFileSync(join(root, 'secret.txt'), 'TOP-SECRET-OUTSIDE');
  logger = createRecordingLogger();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe('security headers', () => {
  it.each(['/', '/api/me'])('sets the exact CSP and companions on %s', async (url) => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url });
    expect(res.headers['content-security-policy']).toBe(CSP);
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('same-origin');
  });
});

describe('request validation', () => {
  it('answers 415 to a body that is not JSON', async () => {
    const server = await build();
    server.post('/api/logout', () => ({ ok: true }));
    const res = await server.inject({
      method: 'POST',
      url: '/api/logout',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({
      error: { code: 'unsupported_media_type', message: anyString },
    });
  });

  it('does not require a content type on a bodiless POST', async () => {
    const server = await build();
    server.post('/api/logout', () => ({ ok: true }));
    const res = await server.inject({ method: 'POST', url: '/api/logout' });
    expect(res.statusCode).toBe(200);
  });

  it('answers 413 to a body over 65536 bytes', async () => {
    const server = await build();
    server.post('/api/echo', () => ({ ok: true }));
    const res = await server.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: 'x'.repeat(70_000) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({
      error: { code: 'payload_too_large', message: anyString },
    });
  });

  it('answers 404 in the error format to an unknown API route', async () => {
    const server = await build();
    for (const url of ['/api/nope', '/auth/nope']) {
      const res = await server.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'not_found', message: anyString } });
    }
  });

  it('answers 400 to malformed JSON', async () => {
    const server = await build();
    server.post('/api/echo', () => ({ ok: true }));
    const res = await server.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'bad_request', message: anyString } });
  });
});

describe('rate limits', () => {
  it('answers 429 in the error format on the 121st request in a minute', async () => {
    const server = await build();
    for (let i = 0; i < 120; i++) {
      const res = await server.inject({ method: 'GET', url: '/api/me' });
      expect(res.statusCode).toBe(404);
    }
    const res = await server.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: { code: 'rate_limited', message: anyString } });
  });

  it('allows only 30 changing requests in a minute', async () => {
    const server = await build();
    server.post('/api/thing', () => ({ ok: true }));
    const post = () =>
      server.inject({
        method: 'POST',
        url: '/api/thing',
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      });
    for (let i = 0; i < 30; i++) expect((await post()).statusCode).toBe(200);
    expect((await post()).statusCode).toBe(429);
    expect((await server.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(404);
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    const server = await build();
    for (let i = 0; i < 120; i++) {
      await server.inject({
        method: 'GET',
        url: '/api/me',
        headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
      });
    }
    const res = await server.inject({
      method: 'GET',
      url: '/api/me',
      headers: { 'x-forwarded-for': '203.0.113.250' },
    });
    expect(res.statusCode).toBe(429);
  });

  it('uses X-Forwarded-For from a trusted proxy', async () => {
    const server = await build({ env: makeEnv(['127.0.0.1']) });
    for (let i = 0; i < 121; i++) {
      const res = await server.inject({
        method: 'GET',
        url: '/api/me',
        headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('static files', () => {
  it('serves files from staticDir', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1);');
  });

  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt'])(
    'does not leave staticDir through %s',
    async (url) => {
      const server = await build();
      const res = await server.inject({ method: 'GET', url });
      expect(res.body).not.toContain('TOP-SECRET-OUTSIDE');
    },
  );

  it('falls back to index.html for any other path', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/qualquer/rota' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe('<!doctype html><title>Painel</title>');
  });

  it('answers 503 when the panel was not built', async () => {
    const server = await build({ staticDir: join(root, 'missing') });
    const res = await server.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('Painel não compilado.');
    const other = await server.inject({ method: 'GET', url: '/qualquer' });
    expect(other.statusCode).toBe(503);
  });
});

describe('error handling', () => {
  it('answers 500 without a stack and logs only the error name', async () => {
    const server = await build();
    server.get('/api/boom', () => {
      throw new TypeError('secret detail at C:\\internal\\path');
    });
    const res = await server.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'failed', message: 'Erro interno.' } });
    expect(res.body).not.toMatch(/stack|internal|at /);
    const logged = JSON.stringify(logger.entries);
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain('secret detail');
  });
});
