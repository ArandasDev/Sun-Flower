import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { startCore, type CoreHandle } from '../../core/application/core.ts';
import { hashSessionToken } from '../../core/sessions/session-store.ts';
import type { MemberInfo } from '../../interfaces/dashboard/ports.ts';
import { buildDashboard } from '../../interfaces/dashboard/server.ts';
import { createFakeGuild, type FakeGuild } from '../helpers/fake-guild.ts';
import { createRecordingLogger } from '../helpers/recording-logger.ts';

const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));
const PUBLIC_URL = 'https://painel.example.com';
const SESSION_SECRET = Buffer.alloc(32, 7);
const SESSION_COOKIE = '__Host-sf_session';
const OWNER = '111111111111111111';
const READER = '222222222222222222';
const TARGET = '333333333333333333';
const READER_ROLE = '444444444444444444';
/** Real-time bound for a message to arrive; an operation and its event take milliseconds. */
const WAIT_MS = 5_000;

interface LiveMessage {
  readonly type: string;
  readonly data: unknown;
}

let root: string;
let core: CoreHandle;
let guild: FakeGuild;
let app: FastifyInstance;
let url: string;
let sockets: WebSocket[];

function member(overrides: Partial<MemberInfo> = {}): MemberInfo {
  return { roleIds: [], isOwner: false, displayName: 'Pessoa', avatarUrl: null, ...overrides };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'sf-dashboard-live-'));
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
  core.permissions.grant('moderation.cases.read', READER_ROLE, core.declaredPermissions());
  const members = new Map<string, MemberInfo>([
    [OWNER, member({ isOwner: true })],
    [READER, member({ roleIds: [READER_ROLE] })],
  ]);
  sockets = [];
  app = await buildDashboard({
    env: {
      publicUrl: PUBLIC_URL,
      port: 0,
      clientId: '666666666666666666',
      clientSecret: 'fake-client-secret',
      sessionSecret: SESSION_SECRET,
      trustProxy: [],
    },
    core,
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
  await app.listen({ host: '127.0.0.1', port: 0 });
  url = `ws://127.0.0.1:${String((app.server.address() as AddressInfo).port)}/api/live`;
});

afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  await app.close();
  await core.stop();
  rmSync(root, { recursive: true, force: true });
});

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${what}`));
    }, WAIT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Opens a live connection for `userId`; resolves with the list its messages land in. */
async function connect(userId: string): Promise<{ ws: WebSocket; messages: LiveMessage[] }> {
  const { token } = core.sessions.create(userId);
  const ws = new WebSocket(url, {
    headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: PUBLIC_URL },
  });
  sockets.push(ws);
  const messages: LiveMessage[] = [];
  ws.on('message', (data) => {
    messages.push(JSON.parse((data as Buffer).toString('utf8')) as LiveMessage);
  });
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        resolve();
      });
      ws.once('unexpected-response', (_req, res) => {
        reject(new Error(`refused with ${String(res.statusCode)}`));
      });
    }),
    'open',
  );
  return { ws, messages };
}

function nextMessage(
  client: { ws: WebSocket; messages: LiveMessage[] },
  predicate: (message: LiveMessage) => boolean,
): Promise<LiveMessage> {
  return withTimeout(
    new Promise<LiveMessage>((resolve) => {
      const check = (): boolean => {
        const found = client.messages.find(predicate);
        if (found === undefined) return false;
        resolve(found);
        return true;
      };
      if (check()) return;
      const onMessage = (): void => {
        if (check()) client.ws.off('message', onMessage);
      };
      client.ws.on('message', onMessage);
    }),
    'a message',
  );
}

function post(userId: string, name: string, payload: object) {
  const { token } = core.sessions.create(userId);
  const csrf = createHmac('sha256', SESSION_SECRET)
    .update(`csrf:${hashSessionToken(token)}`)
    .digest('base64url');
  return app.inject({
    method: 'POST',
    url: `/api/operations/${name}`,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-csrf-token': csrf },
    payload,
  });
}

describe('live case events from a real operation', () => {
  it('sends case.created and then case.updated to a socket holding moderation.cases.read', async () => {
    const reader = await connect(READER);

    const created = await post(OWNER, 'moderation.actions.timeout', {
      userId: TARGET,
      minutes: 10,
      reason: 'spam',
    });
    expect(created.statusCode).toBe(200);
    const { caseId } = created.json<{ data: { caseId: number } }>().data;
    const isCase = (type: string) => (message: LiveMessage) =>
      message.type === type && (message.data as { caseId?: unknown }).caseId === caseId;
    expect(await nextMessage(reader, isCase('case.created'))).toEqual({
      type: 'case.created',
      data: { caseId },
    });

    const reverted = await post(OWNER, 'moderation.cases.revert', { id: caseId });
    expect(reverted.statusCode).toBe(200);
    expect(await nextMessage(reader, isCase('case.updated'))).toEqual({
      type: 'case.updated',
      data: { caseId },
    });
  });
});
