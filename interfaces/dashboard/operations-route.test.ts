import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startCore, type CoreHandle } from '../../core/application/core.ts';
import type { PanelEnvironment } from '../../core/configuration/panel-environment.ts';
import { hashSessionToken } from '../../core/sessions/session-store.ts';
import type { OperationResult } from '../../shared/contracts/operations.ts';
import { createFakeGuild, type FakeGuild } from '../../tests/helpers/fake-guild.ts';
import { createRecordingLogger } from '../../tests/helpers/recording-logger.ts';
import type { MemberInfo } from './ports.ts';
import { buildDashboard } from './server.ts';

const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));
const SESSION_SECRET = Buffer.alloc(32, 7);
const SESSION_COOKIE = '__Host-sf_session';
const OWNER = '111111111111111111';
const MODERATOR = '222222222222222222';
const MEMBER = '333333333333333333';
const TARGET = '444444444444444444';
const MOD_ROLE = '555555555555555555';

let root: string;
let core: CoreHandle;
let guild: FakeGuild;
let members: Map<string, MemberInfo>;
let app: FastifyInstance;
/** Replaces the Core's answer when set; the real Core answers otherwise. */
let stub: OperationResult | undefined;
let calls: { name: string; actor: unknown; input: unknown; source: string }[];

function member(overrides: Partial<MemberInfo> = {}): MemberInfo {
  return { roleIds: [], isOwner: false, displayName: 'Pessoa', avatarUrl: null, ...overrides };
}

function env(): PanelEnvironment {
  return {
    publicUrl: 'https://painel.example.com',
    port: 0,
    clientId: '666666666666666666',
    clientSecret: 'fake-client-secret',
    sessionSecret: SESSION_SECRET,
    trustProxy: [],
  };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'sf-ops-'));
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'public', 'index.html'), '<!doctype html>');
  guild = createFakeGuild();
  guild.memberRoles.set(TARGET, []);
  core = await startCore({
    dbPath: join(root, 'test.db'),
    modulesDir: MODULES_DIR,
    logger: createRecordingLogger(),
    guild,
  });
  core.permissions.grant('moderation.cases.read', MOD_ROLE, core.declaredPermissions());
  members = new Map<string, MemberInfo>([
    [OWNER, member({ isOwner: true })],
    [MODERATOR, member({ roleIds: [MOD_ROLE] })],
    [MEMBER, member()],
  ]);
  stub = undefined;
  calls = [];
  // The route sees the Core through this wrapper so a test can force an answer and see the call.
  const seen = {
    ...core,
    operations: {
      names: () => core.operations.names(),
      execute: (name, actor, input, source) => {
        calls.push({ name, actor, input, source });
        return stub === undefined
          ? core.operations.execute(name, actor, input, source)
          : Promise.resolve(stub);
      },
    },
  } as CoreHandle;
  app = await buildDashboard({
    env: env(),
    core: seen,
    directory: { lookup: (userId) => Promise.resolve(members.get(userId) ?? null) },
    status: { connection: () => 'ready', startedAt: Date.now() },
    oauth: {
      authorizeUrl: () => 'https://discord.example.com/oauth2/authorize',
      exchange: () => Promise.reject(new Error('unused')),
      fetchUserId: () => Promise.reject(new Error('unused')),
    },
    logger: createRecordingLogger(),
    staticDir: join(root, 'public'),
  });
});

afterEach(async () => {
  await app.close();
  await core.stop();
  rmSync(root, { recursive: true, force: true });
});

function headersFor(userId: string, csrf = true): Record<string, string> {
  const { token } = core.sessions.create(userId);
  const headers: Record<string, string> = { cookie: `${SESSION_COOKIE}=${token}` };
  if (csrf) {
    headers['x-csrf-token'] = createHmac('sha256', SESSION_SECRET)
      .update(`csrf:${hashSessionToken(token)}`)
      .digest('base64url');
  }
  return headers;
}

function post(
  userId: string,
  name: string,
  payload?: object,
  options: { csrf?: boolean } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `/api/operations/${name}`,
    headers: headersFor(userId, options.csrf ?? true),
    ...(payload === undefined ? {} : { payload }),
  });
}

describe('POST /api/operations/:name', () => {
  it('forbids a member on a ban with 403 and writes no case (Review Focus 5)', async () => {
    const res = await post(MEMBER, 'moderation.actions.ban', { userId: TARGET, reason: 'spam' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'forbidden', message: 'Você não tem permissão para isso.' },
    });
    expect(guild.calls).toHaveLength(0);
    const list = await post(OWNER, 'moderation.cases.list', {});
    expect(list.json()).toEqual({ data: { cases: [], nextCursor: null } });
  });

  it('refuses a request without the CSRF token with 403 and runs nothing', async () => {
    const res = await post(OWNER, 'moderation.cases.list', {}, { csrf: false });
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });

  it('answers 401 without a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/operations/moderation.cases.list' });
    expect(res.statusCode).toBe(401);
    expect(calls).toEqual([]);
  });

  it('answers 404 to a malformed name without calling the Core', async () => {
    for (const name of ['Moderation.cases', 'xy', '1abc', 'a%20b.c', `a${'b'.repeat(101)}`]) {
      const res = await post(OWNER, name, {});
      expect(res.statusCode, name).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  it('answers 404 to a well-formed name nobody registered', async () => {
    const res = await post(OWNER, 'moderation.cases.nothing', {});
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Operação desconhecida.' } });
    expect(calls).toHaveLength(1);
  });

  it('answers 422 with the operation message and never echoes the input', async () => {
    const res = await post(OWNER, 'moderation.actions.ban', { userId: 'not-an-id', reason: 'x' });
    expect(res.statusCode).toBe(422);
    const { error } = res.json<{ error: { code: string; message: string } }>();
    expect(error.code).toBe('invalid');
    expect(error.message).toMatch(/^Entrada inválida: .*userId/);
    expect(res.body).not.toContain('not-an-id');
  });

  it('answers 422 to a body that is not an object, without calling the Core', async () => {
    for (const payload of ['[1]', '"text"', 'null', '5']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/operations/moderation.cases.list',
        headers: { ...headersFor(OWNER), 'content-type': 'application/json' },
        payload,
      });
      expect(res.statusCode, payload).toBe(422);
      expect(res.json()).toEqual({
        error: { code: 'invalid', message: 'Entrada inválida: (raiz).' },
      });
    }
    expect(calls).toEqual([]);
  });

  it('treats a missing body as an empty object', async () => {
    const res = await post(OWNER, 'moderation.cases.list');
    expect(res.statusCode).toBe(200);
    expect(calls[0]?.input).toEqual({});
  });

  it('answers 409 on a stale configuration version', async () => {
    const res = await post(OWNER, 'moderation.config.update', {
      expectedVersion: 99,
      changes: { timeoutMinutes: 120 },
    });
    expect(res.statusCode).toBe(409);
    const { error } = res.json<{ error: { code: string; message: string } }>();
    expect(error.code).toBe('conflict');
    expect(error.message).not.toBe('');
  });

  it('answers 503 for a module that is not running and 500 for a failure', async () => {
    stub = { ok: false, error: { code: 'unavailable', message: 'Módulo indisponível.' } };
    const down = await post(OWNER, 'moderation.cases.list', {});
    expect(down.statusCode).toBe(503);
    expect(down.json()).toEqual({
      error: { code: 'unavailable', message: 'Módulo indisponível.' },
    });
    stub = { ok: false, error: { code: 'failed', message: 'Erro interno.' } };
    const failed = await post(OWNER, 'moderation.cases.list', {});
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ error: { code: 'failed', message: 'Erro interno.' } });
  });

  it('lets a moderator with moderation.cases.read list cases', async () => {
    const res = await post(MODERATOR, 'moderation.cases.list', {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { cases: [], nextCursor: null } });
  });

  it('lets the owner without a role update the configuration', async () => {
    const res = await post(OWNER, 'moderation.config.update', { expectedVersion: 0, changes: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('data');
  });

  it('runs as the session actor with source dashboard, ignoring an actor in the body', async () => {
    await post(MEMBER, 'moderation.cases.mine', { actor: { userId: OWNER, isOwner: true } });
    expect(calls[0]).toMatchObject({
      name: 'moderation.cases.mine',
      actor: { userId: MEMBER, isOwner: false },
      source: 'dashboard',
    });
  });
});
