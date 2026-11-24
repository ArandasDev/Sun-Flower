import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connect, type AddressInfo } from 'node:net';
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
  writeFileSync(join(staticDir, '.env'), 'DOTFILE-SECRET');
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

  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%5csecret.txt',
    '/%2e%2e%5csecret.txt',
  ])('does not leave staticDir through %s', async (url) => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url });
    expect(res.body).not.toContain('TOP-SECRET-OUTSIDE');
  });

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

const HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

function expectSecurityHeaders(headers: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(HEADERS)) expect(headers[name]).toBe(value);
  expect(headers['strict-transport-security']).toMatch(/max-age=\d+/);
}

describe('review fixes', () => {
  it('rate-limits a percent-encoded /api prefix', async () => {
    const server = await build();
    for (let i = 0; i < 120; i++) {
      expect((await server.inject({ method: 'GET', url: '/%61pi/me' })).statusCode).toBe(404);
    }
    const res = await server.inject({ method: 'GET', url: '/%61pi/me' });
    expect(res.statusCode).toBe(429);
  });

  it('answers a JSON 404 to a percent-encoded /api or /auth prefix', async () => {
    const server = await build();
    for (const url of ['/%61pi/nope', '/%61uth/nope', '/api%2Fnope']) {
      const res = await server.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'not_found', message: anyString } });
    }
  });

  it.each(['/%zz', '/api/%zz'])(
    'answers a malformed URL %s uniformly with headers',
    async (url) => {
      const server = await build();
      const res = await server.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: { code: 'bad_request', message: 'Requisição inválida.' },
      });
      expect(res.body).not.toContain('%zz');
      expectSecurityHeaders(res.headers);
    },
  );

  it('does not serve dotfiles', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/.env' });
    expect(res.body).not.toContain('DOTFILE-SECRET');
  });

  it('keeps the status of a thrown 4xx without leaking its message', async () => {
    const server = await build();
    const fail = (status: number) => () => {
      throw Object.assign(new Error('leaky message'), { statusCode: status });
    };
    server.get('/api/t403', fail(403));
    server.get('/api/t404', fail(404));
    server.get('/api/t409', fail(409));
    server.get('/api/t422', fail(422));
    const expected: [string, number, string][] = [
      ['/api/t403', 403, 'forbidden'],
      ['/api/t404', 404, 'not_found'],
      ['/api/t409', 409, 'conflict'],
      ['/api/t422', 422, 'bad_request'],
    ];
    for (const [url, status, code] of expected) {
      const res = await server.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error: { code, message: anyString } });
      expect(res.body).not.toContain('leaky');
    }
  });

  it('sets the security headers on every kind of response', async () => {
    const server = await build({ staticDir: join(root, 'missing') });
    server.get('/api/boom', () => {
      throw new Error('x');
    });
    server.post('/api/echo', () => ({ ok: true }));
    const post = (headers: Record<string, string>, payload: string) =>
      server.inject({ method: 'POST', url: '/api/echo', headers, payload });
    const responses = [
      await server.inject({ method: 'GET', url: '/api/nope' }),
      await post({ 'content-type': 'application/json' }, JSON.stringify({ d: 'x'.repeat(70_000) })),
      await post({ 'content-type': 'text/plain' }, 'hi'),
      await server.inject({ method: 'GET', url: '/api/boom' }),
      await server.inject({ method: 'GET', url: '/spa/route' }),
    ];
    expect(responses.map((r) => r.statusCode)).toEqual([404, 413, 415, 500, 503]);
    for (const res of responses) expectSecurityHeaders(res.headers);
  });

  it('sets the security headers on 429 and on the SPA fallback', async () => {
    const server = await build();
    const spa = await server.inject({ method: 'GET', url: '/spa/route' });
    expect(spa.statusCode).toBe(200);
    expectSecurityHeaders(spa.headers);
    for (let i = 0; i < 120; i++) await server.inject({ method: 'GET', url: '/api/me' });
    const limited = await server.inject({ method: 'GET', url: '/api/me' });
    expect(limited.statusCode).toBe(429);
    expectSecurityHeaders(limited.headers);
  });

  it('caches index.html but re-checks while it is missing', async () => {
    const server = await build();
    expect((await server.inject({ method: 'GET', url: '/a' })).body).toContain('Painel');
    writeFileSync(join(staticDir, 'index.html'), 'changed');
    expect((await server.inject({ method: 'GET', url: '/b' })).body).toContain('Painel');

    rmSync(join(staticDir, 'index.html'));
    const late = await build({ staticDir: join(root, 'late') });
    expect((await late.inject({ method: 'GET', url: '/a' })).statusCode).toBe(503);
    mkdirSync(join(root, 'late'));
    writeFileSync(join(root, 'late', 'index.html'), 'now here');
    const res = await late.inject({ method: 'GET', url: '/a' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('now here');
  });
});

interface RawResponse {
  readonly status: number;
  readonly head: string;
  readonly body: string;
}

/** Sends the raw bytes over a real socket (inject cannot send absolute-form targets). */
function rawRequest(port: number, bytes: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (data += chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      const [head = '', ...rest] = data.split('\r\n\r\n');
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1]);
      resolve({ status, head, body: rest.join('\r\n\r\n') });
    });
    socket.write(bytes);
  });
}

const get = (target: string, host = 'h'): string =>
  `GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

async function listen(): Promise<number> {
  const server = await build();
  server.get('/api', () => ({ ok: true }));
  await server.listen({ host: '127.0.0.1', port: 0 });
  return (server.server.address() as AddressInfo).port;
}

describe('every request form', () => {
  it.each(['http://h/api/me', 'HTTP://h/api/me', 'http://h:1@x/api/me', 'https://evil/%61pi/me'])(
    'rate-limits the absolute-form target %s',
    async (target) => {
      const port = await listen();
      for (let i = 0; i < 120; i++) {
        expect((await rawRequest(port, get(target))).status).toBe(404);
      }
      expect((await rawRequest(port, get(target))).status).toBe(429);
    },
  );

  it('answers a JSON 404 to an absolute-form API target', async () => {
    const port = await listen();
    const res = await rawRequest(port, get('http://h/api/nope'));
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: { code: 'not_found', message: anyString } });
  });

  it('rate-limits an exact route reached with a fragment', async () => {
    const port = await listen();
    for (let i = 0; i < 120; i++) {
      expect((await rawRequest(port, get('/api#x'))).status).toBe(200);
    }
    expect((await rawRequest(port, get('/api#x'))).status).toBe(429);
  });

  it.each([
    ['an unknown method', 'FOO /api/me HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n', 400],
    ['a garbage request line', 'garbage\r\n\r\n', 400],
    [
      'an oversized header',
      `GET / HTTP/1.1\r\nHost: h\r\nX-Big: ${'a'.repeat(100_000)}\r\n\r\n`,
      431,
    ],
  ] as const)('answers %s with the uniform error and headers', async (_name, bytes, status) => {
    const port = await listen();
    const res = await rawRequest(port, bytes);
    expect(res.status).toBe(status);
    expect(JSON.parse(res.body)).toEqual({
      error: { code: 'bad_request', message: 'Requisição inválida.' },
    });
    const lower = res.head.toLowerCase();
    expect(lower).toContain(`content-security-policy: ${CSP}`.toLowerCase());
    expect(lower).toContain('strict-transport-security: max-age=');
    expect(lower).toContain('x-content-type-options: nosniff');
    expect(lower).toContain('referrer-policy: same-origin');
    expect(lower).toContain('content-type: application/json');
    expect(lower).toContain('connection: close');
  });

  it('closes the server side of a half-open client after a client error', async () => {
    const port = await listen();
    const server = app!.server;
    const socket = connect({ host: '127.0.0.1', port, allowHalfOpen: true });
    socket.on('error', () => undefined);
    const answered = new Promise<void>((resolve) => socket.once('data', () => resolve()));
    socket.write('garbage\r\n\r\n');
    await answered;
    const open = (): Promise<number> =>
      new Promise((resolve) => server.getConnections((_e, n) => resolve(n)));
    let count = await open();
    for (let i = 0; i < 40 && count > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      count = await open();
    }
    socket.destroy();
    expect(count).toBe(0);
  });
});
