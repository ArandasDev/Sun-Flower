import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoreHandle } from '../../core/application/core.ts';
import type { PanelEnvironment } from '../../core/configuration/panel-environment.ts';
import { openDatabase } from '../../core/infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../core/infrastructure/migrations.ts';
import { PermissionService } from '../../core/permissions/permission-service.ts';
import { SessionStore, hashSessionToken } from '../../core/sessions/session-store.ts';
import {
  createRecordingLogger,
  type RecordingLogger,
} from '../../tests/helpers/recording-logger.ts';
import type { MemberInfo, OAuthClient } from './ports.ts';
import { buildDashboard, type DashboardDeps } from './server.ts';

const PUBLIC_URL = 'https://painel.example.com';
const CLIENT_SECRET = 'fake-client-secret-value';
const SESSION_SECRET = Buffer.alloc(32, 7);
const ACCESS_TOKEN = 'fake-access-token-abcdef';
const CODE = 'fake-authorization-code';
const USER = '111111111111111111';
const STAFF_ROLE = '333333333333333333';
const DECLARED = new Set(['mod.thing.view', 'mod.thing.edit', 'core.panel.debug']);

const SESSION_COOKIE = '__Host-sf_session';
const OAUTH_COOKIE = '__Host-sf_oauth';

let root: string;
let db: DatabaseSync;
let clock: number;
let logger: RecordingLogger;
let permissions: PermissionService;
let sessions: SessionStore;
let members: Map<string, MemberInfo | null | undefined>;
let oauth: FakeOAuth;
let loggedOut: string[];
let app: FastifyInstance | undefined;

interface FakeOAuth extends OAuthClient {
  readonly calls: { state: string; challenge: string; verifier?: string }[];
  exchangeError: Error | undefined;
  userId: string;
}

function fakeOAuth(): FakeOAuth {
  const fake: FakeOAuth = {
    calls: [],
    exchangeError: undefined,
    userId: USER,
    authorizeUrl(state, challenge) {
      fake.calls.push({ state, challenge });
      const params = new URLSearchParams({
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return `https://discord.example.com/oauth2/authorize?${params.toString()}`;
    },
    exchange(code, verifier) {
      const last = fake.calls.at(-1);
      if (last !== undefined) last.verifier = verifier;
      if (fake.exchangeError !== undefined) return Promise.reject(fake.exchangeError);
      if (code !== CODE) return Promise.reject(new Error('bad code'));
      return Promise.resolve(ACCESS_TOKEN);
    },
    fetchUserId(accessToken) {
      if (accessToken !== ACCESS_TOKEN) return Promise.reject(new Error('bad token'));
      return Promise.resolve(fake.userId);
    },
  };
  return fake;
}

function member(overrides: Partial<MemberInfo> = {}): MemberInfo {
  return {
    roleIds: [],
    isOwner: false,
    displayName: 'Pessoa Teste',
    avatarUrl: null,
    ...overrides,
  };
}

function env(): PanelEnvironment {
  return {
    publicUrl: PUBLIC_URL,
    port: 3000,
    clientId: '444444444444444444',
    clientSecret: CLIENT_SECRET,
    sessionSecret: SESSION_SECRET,
    trustProxy: [],
  };
}

async function build(overrides: Partial<DashboardDeps> = {}): Promise<FastifyInstance> {
  const core = {
    permissions,
    sessions,
    declaredPermissions: () => DECLARED,
  } as unknown as CoreHandle;
  const staticDir = join(root, 'public');
  app = await buildDashboard({
    env: env(),
    core,
    directory: {
      lookup: (userId) => Promise.resolve(members.has(userId) ? members.get(userId) : null),
    },
    status: { connection: () => 'ready', startedAt: 0 },
    oauth,
    logger,
    staticDir,
    now: () => clock,
    onLogout: (idHash) => loggedOut.push(idHash),
    ...overrides,
  });
  return app;
}

function sessionCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM panel_sessions').get() as { n: number }).n;
}

function cookie(res: LightMyRequestResponse, name: string) {
  return res.cookies.find((c) => c.name === name);
}

function query(location: string): URLSearchParams {
  return new URL(location).searchParams;
}

/** Starts a login and returns the signed oauth cookie and the state sent to Discord. */
async function startLogin(
  server: FastifyInstance,
): Promise<{ oauthCookie: string; state: string }> {
  const res = await server.inject({ method: 'GET', url: '/auth/login' });
  expect(res.statusCode).toBe(302);
  const state = query(String(res.headers.location)).get('state') ?? '';
  return { oauthCookie: cookie(res, OAUTH_COOKIE)?.value ?? '', state };
}

function callback(
  server: FastifyInstance,
  params: Record<string, string>,
  oauthCookie?: string,
): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'GET',
    url: `/auth/callback?${new URLSearchParams(params).toString()}`,
    ...(oauthCookie === undefined ? {} : { cookies: { [OAUTH_COOKIE]: oauthCookie } }),
  });
}

/** A full successful login; returns the session token. */
async function login(server: FastifyInstance): Promise<string> {
  const { oauthCookie, state } = await startLogin(server);
  const res = await callback(server, { code: CODE, state }, oauthCookie);
  expect(res.headers.location).toBe(`${PUBLIC_URL}/`);
  const token = cookie(res, SESSION_COOKIE)?.value;
  expect(token).toBeTypeOf('string');
  return token as string;
}

function me(server: FastifyInstance, token?: string): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'GET',
    url: '/api/me',
    ...(token === undefined ? {} : { cookies: { [SESSION_COOKIE]: token } }),
  });
}

function expectedCsrf(token: string): string {
  return createHmac('sha256', SESSION_SECRET)
    .update(`csrf:${hashSessionToken(token)}`)
    .digest('base64url');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sf-auth-'));
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'public', 'index.html'), '<!doctype html>');
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  clock = Date.UTC(2026, 0, 1);
  logger = createRecordingLogger();
  permissions = new PermissionService(db);
  sessions = new SessionStore(db, () => clock);
  members = new Map([[USER, member()]]);
  oauth = fakeOAuth();
  loggedOut = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = undefined;
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('GET /auth/login', () => {
  it('sets the signed oauth cookie and redirects with PKCE S256', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/auth/login' });
    expect(res.statusCode).toBe(302);
    const location = String(res.headers.location);
    expect(query(location).get('code_challenge_method')).toBe('S256');
    const set = cookie(res, OAUTH_COOKIE);
    expect(set).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(set?.maxAge).toBe(600);
    const [call] = oauth.calls;
    expect(call?.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(call?.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The cookie is signed: its value does not unsign with another secret, and holds no plain verifier.
    expect(set?.value).toContain('.');
  });

  it('derives the challenge from the verifier sent at exchange', async () => {
    const server = await build();
    await login(server);
    const [call] = oauth.calls;
    expect(call?.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const challenge = createHash('sha256')
      .update(call?.verifier ?? '')
      .digest('base64url');
    expect(call?.challenge).toBe(challenge);
  });

  it('answers 429 to the 11th attempt in a minute, separately from the API', async () => {
    const server = await build();
    for (let i = 0; i < 10; i++) {
      expect((await server.inject({ method: 'GET', url: '/auth/login' })).statusCode).toBe(302);
    }
    const res = await server.inject({ method: 'GET', url: '/auth/login' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect((await me(server)).statusCode).toBe(401);
  });
});

describe('GET /auth/callback', () => {
  it('fails without the oauth cookie', async () => {
    const server = await build();
    const { state } = await startLogin(server);
    const res = await callback(server, { code: CODE, state });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
    expect(sessionCount()).toBe(0);
  });

  it('fails with a different state', async () => {
    const server = await build();
    const { oauthCookie, state } = await startLogin(server);
    const other = randomBytes(32).toString('base64url');
    expect(other).not.toBe(state);
    const res = await callback(server, { code: CODE, state: other }, oauthCookie);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
    expect(sessionCount()).toBe(0);
  });

  it('fails with a state of another length', async () => {
    const server = await build();
    const { oauthCookie } = await startLogin(server);
    const res = await callback(server, { code: CODE, state: 'x' }, oauthCookie);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
  });

  it('fails with a tampered oauth cookie', async () => {
    const server = await build();
    const { oauthCookie, state } = await startLogin(server);
    const tampered = `${oauthCookie.slice(0, -2)}AA`;
    const res = await callback(server, { code: CODE, state }, tampered);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
    expect(sessionCount()).toBe(0);
  });

  it('fails with an expired oauth cookie', async () => {
    const server = await build();
    const { oauthCookie, state } = await startLogin(server);
    clock += 600_001;
    const res = await callback(server, { code: CODE, state }, oauthCookie);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
    expect(sessionCount()).toBe(0);
  });

  it('fails when the code exchange throws', async () => {
    const server = await build();
    oauth.exchangeError = new Error(`discord said no ${ACCESS_TOKEN}`);
    const { oauthCookie, state } = await startLogin(server);
    const res = await callback(server, { code: CODE, state }, oauthCookie);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
    expect(sessionCount()).toBe(0);
  });

  it('fails when Discord sends an error instead of a code', async () => {
    const server = await build();
    const { oauthCookie, state } = await startLogin(server);
    const res = await callback(server, { error: 'access_denied', state }, oauthCookie);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
  });

  it('clears the oauth cookie so it cannot be replayed', async () => {
    const server = await build();
    const { oauthCookie, state } = await startLogin(server);
    const res = await callback(server, { code: CODE, state }, oauthCookie);
    expect(cookie(res, OAUTH_COOKIE)).toMatchObject({ value: '', maxAge: 0, path: '/' });
  });

  it('sends a non-member to not_member', async () => {
    members.set(USER, null);
    const server = await build();
    const { oauthCookie, state } = await startLogin(server);
    const res = await callback(server, { code: CODE, state }, oauthCookie);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=not_member`);
    expect(sessionCount()).toBe(0);
  });

  it('sends a developer who is not a member to dev_not_member', async () => {
    members.set(USER, null);
    permissions.addDeveloper(USER);
    const server = await build();
    const { oauthCookie, state } = await startLogin(server);
    const res = await callback(server, { code: CODE, state }, oauthCookie);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=dev_not_member`);
    expect(sessionCount()).toBe(0);
  });

  it('sends to retry when the directory cannot answer', async () => {
    members.set(USER, undefined);
    const server = await build({
      directory: { lookup: () => Promise.resolve(undefined) },
    });
    const { oauthCookie, state } = await startLogin(server);
    const res = await callback(server, { code: CODE, state }, oauthCookie);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=retry`);
    expect(sessionCount()).toBe(0);
  });

  it('creates a session with a strict cookie on success', async () => {
    const server = await build();
    const { oauthCookie, state } = await startLogin(server);
    const res = await callback(server, { code: CODE, state }, oauthCookie);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/`);
    const set = cookie(res, SESSION_COOKIE);
    expect(set).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(set?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionCount()).toBe(1);
    const row = db.prepare('SELECT id_hash FROM panel_sessions').get() as { id_hash: string };
    expect(row.id_hash).toBe(hashSessionToken(set?.value ?? ''));
  });

  it('issues a different token on every login', async () => {
    const server = await build();
    const first = await login(server);
    const second = await login(server);
    expect(first).not.toBe(second);
  });

  it('sends to failed and keeps the previous session when creating the session throws', async () => {
    const server = await build();
    const previous = await login(server);
    const create = vi.spyOn(sessions, 'create').mockImplementation(() => {
      throw new Error('database is locked');
    });
    const { oauthCookie, state } = await startLogin(server);
    const res = await server.inject({
      method: 'GET',
      url: `/auth/callback?${new URLSearchParams({ code: CODE, state }).toString()}`,
      cookies: { [OAUTH_COOKIE]: oauthCookie, [SESSION_COOKIE]: previous },
    });
    expect(create).toHaveBeenCalled();
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
    expect(cookie(res, SESSION_COOKIE)).toBeUndefined();
    expect(sessions.resolve(previous)).not.toBeNull();
  });

  it('replaces the session the browser held after creating the new one', async () => {
    const server = await build();
    const previous = await login(server);
    const { oauthCookie, state } = await startLogin(server);
    const res = await server.inject({
      method: 'GET',
      url: `/auth/callback?${new URLSearchParams({ code: CODE, state }).toString()}`,
      cookies: { [OAUTH_COOKIE]: oauthCookie, [SESSION_COOKIE]: previous },
    });
    expect(res.headers.location).toBe(`${PUBLIC_URL}/`);
    expect(sessions.resolve(previous)).toBeNull();
    expect(sessionCount()).toBe(1);
  });

  it('sends to failed when deleting the previous session throws', async () => {
    const server = await build();
    const previous = await login(server);
    vi.spyOn(sessions, 'deleteByHash').mockImplementation(() => {
      throw new Error('database is locked');
    });
    const { oauthCookie, state } = await startLogin(server);
    const res = await server.inject({
      method: 'GET',
      url: `/auth/callback?${new URLSearchParams({ code: CODE, state }).toString()}`,
      cookies: { [OAUTH_COOKIE]: oauthCookie, [SESSION_COOKIE]: previous },
    });
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
  });

  it('sends to failed when the developer check throws', async () => {
    members.set(USER, null);
    vi.spyOn(permissions, 'isDeveloper').mockImplementation(() => {
      throw new Error('database is locked');
    });
    const server = await build();
    const { oauthCookie, state } = await startLogin(server);
    const res = await callback(server, { code: CODE, state }, oauthCookie);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
  });

  it('ignores the Host header when building redirects', async () => {
    const server = await build();
    const res = await server.inject({
      method: 'GET',
      url: '/auth/callback',
      headers: { host: 'evil.example.net', 'x-forwarded-host': 'evil.example.net' },
    });
    expect(res.headers.location).toBe(`${PUBLIC_URL}/login?error=failed`);
  });
});

describe('GET /api/me', () => {
  it('answers 401 without a cookie', async () => {
    const server = await build();
    const res = await me(server);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('answers 401 to an unknown cookie', async () => {
    const server = await build();
    expect((await me(server, randomBytes(32).toString('base64url'))).statusCode).toBe(401);
  });

  it('returns identity, level, permissions and the CSRF token', async () => {
    members.set(
      USER,
      member({ displayName: 'Nome', avatarUrl: 'https://cdn.discordapp.com/a.png' }),
    );
    const server = await build();
    const token = await login(server);
    const res = await me(server, token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: USER,
      name: 'Nome',
      avatarUrl: 'https://cdn.discordapp.com/a.png',
      level: 'member',
      permissions: [],
      csrfToken: expectedCsrf(token),
    });
  });

  it('recomputes the level after the roles are removed (Review Focus 1)', async () => {
    permissions.grant('mod.thing.view', STAFF_ROLE, DECLARED);
    members.set(USER, member({ roleIds: [STAFF_ROLE] }));
    const server = await build();
    const token = await login(server);
    expect((await me(server, token)).json()).toMatchObject({
      level: 'staff',
      permissions: ['mod.thing.view'],
    });
    members.set(USER, member({ roleIds: [] }));
    expect((await me(server, token)).json()).toMatchObject({ level: 'member', permissions: [] });
  });

  it('drops module permissions once isOwner turns false (Review Focus 2)', async () => {
    members.set(USER, member({ isOwner: true }));
    const server = await build();
    const token = await login(server);
    expect((await me(server, token)).json()).toMatchObject({
      level: 'owner',
      permissions: ['mod.thing.edit', 'mod.thing.view'],
    });
    members.set(USER, member({ isOwner: false }));
    expect((await me(server, token)).json()).toMatchObject({ level: 'member', permissions: [] });
  });

  it('answers 401 and deletes the session of a member who left', async () => {
    const server = await build();
    const token = await login(server);
    members.set(USER, null);
    expect((await me(server, token)).statusCode).toBe(401);
    expect(sessionCount()).toBe(0);
    members.set(USER, member());
    expect((await me(server, token)).statusCode).toBe(401);
  });

  it('answers 503 but keeps the session when the directory cannot answer', async () => {
    const server = await build();
    const token = await login(server);
    members.set(USER, undefined);
    const res = await me(server, token);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'unavailable',
        message: 'Não foi possível confirmar seu acesso agora. Tente de novo em instantes.',
      },
    });
    expect(sessionCount()).toBe(1);
    members.set(USER, member());
    expect((await me(server, token)).statusCode).toBe(200);
  });

  it('treats a throwing directory like an unanswered lookup', async () => {
    let fail = false;
    const server = await build({
      directory: {
        lookup: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve(member())),
      },
    });
    const token = await login(server);
    fail = true;
    expect((await me(server, token)).statusCode).toBe(503);
    expect(sessionCount()).toBe(1);
  });

  it('answers 401 once the session expired', async () => {
    const server = await build();
    const token = await login(server);
    clock += 43_200_001;
    expect((await me(server, token)).statusCode).toBe(401);
  });
});

describe('POST /api/logout', () => {
  const logout = (server: FastifyInstance, token: string, csrf?: string) =>
    server.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { [SESSION_COOKIE]: token },
      ...(csrf === undefined ? {} : { headers: { 'x-csrf-token': csrf } }),
    });

  it('answers 403 without the CSRF token', async () => {
    const server = await build();
    const token = await login(server);
    const res = await logout(server, token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'forbidden', message: 'Sem permissão.' } });
    expect(sessionCount()).toBe(1);
  });

  it("answers 403 with another session's CSRF token", async () => {
    const server = await build();
    const mine = await login(server);
    const theirs = await login(server);
    expect((await logout(server, mine, expectedCsrf(theirs))).statusCode).toBe(403);
    expect((await logout(server, mine, 'x')).statusCode).toBe(403);
    expect(sessionCount()).toBe(2);
  });

  it('answers 401 without a session', async () => {
    const server = await build();
    const res = await server.inject({ method: 'POST', url: '/api/logout' });
    expect(res.statusCode).toBe(401);
  });

  it('answers 204, deletes the session and clears the cookie with the right token', async () => {
    const server = await build();
    const token = await login(server);
    const res = await logout(server, token, expectedCsrf(token));
    expect(res.statusCode).toBe(204);
    expect(cookie(res, SESSION_COOKIE)).toMatchObject({
      value: '',
      maxAge: 0,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    });
    expect(sessionCount()).toBe(0);
    expect(loggedOut).toEqual([hashSessionToken(token)]);
    expect((await me(server, token)).statusCode).toBe(401);
  });

  it('logs out even when the directory cannot answer', async () => {
    const server = await build();
    const token = await login(server);
    members.set(USER, undefined);
    expect((await logout(server, token, expectedCsrf(token))).statusCode).toBe(204);
    expect(sessionCount()).toBe(0);
  });
});

describe('API rate limit key', () => {
  it('puts requests with random cookies from one IP in one bucket', async () => {
    const server = await build();
    const statuses: number[] = [];
    for (let i = 0; i < 130; i++) {
      statuses.push((await me(server, randomBytes(32).toString('base64url'))).statusCode);
    }
    expect(statuses.slice(0, 120).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(120).every((s) => s === 429)).toBe(true);
  });

  it('does not advance last_seen_at for a request refused with 429', async () => {
    const server = await build();
    const token = await login(server);
    const lastSeen = (): string =>
      (db.prepare('SELECT last_seen_at FROM panel_sessions').get() as { last_seen_at: string })
        .last_seen_at;
    for (let i = 0; i < 120; i++) await me(server, token);
    const before = lastSeen();
    clock += 120_000;
    const res = await me(server, token);
    expect(res.statusCode).toBe(429);
    expect(lastSeen()).toBe(before);
  });

  it('gives a valid session its own bucket', async () => {
    const server = await build();
    const token = await login(server);
    for (let i = 0; i < 121; i++) await me(server);
    expect((await me(server)).statusCode).toBe(429);
    expect((await me(server, token)).statusCode).toBe(200);
  });
});

describe('logs', () => {
  it('never contain the secrets of a login', async () => {
    const server = await build();
    const token = await login(server);
    await me(server, token);
    await server.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { [SESSION_COOKIE]: token },
      headers: { 'x-csrf-token': expectedCsrf(token) },
    });
    oauth.exchangeError = new Error(`leak ${ACCESS_TOKEN} ${CLIENT_SECRET}`);
    const { oauthCookie, state } = await startLogin(server);
    await callback(server, { code: CODE, state }, oauthCookie);
    members.set(USER, null);
    oauth.exchangeError = undefined;
    const again = await startLogin(server);
    await callback(server, { code: CODE, state: again.state }, again.oauthCookie);

    const logged = JSON.stringify(logger.entries);
    const secrets = [
      ACCESS_TOKEN,
      CODE,
      CLIENT_SECRET,
      token,
      hashSessionToken(token),
      USER,
      SESSION_SECRET.toString('base64'),
      ...oauth.calls.flatMap((c) => [c.state, c.challenge, c.verifier ?? 'none-recorded']),
    ];
    for (const secret of secrets) expect(logged).not.toContain(secret);
  });
});
