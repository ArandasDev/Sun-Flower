import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect as netConnect, createServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import type { CoreHandle } from '../../core/application/core.ts';
import type { PanelEnvironment } from '../../core/configuration/panel-environment.ts';
import { openDatabase } from '../../core/infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../core/infrastructure/migrations.ts';
import type { ModuleStatus } from '../../core/module-registry/registry.ts';
import { PermissionService } from '../../core/permissions/permission-service.ts';
import { SessionStore } from '../../core/sessions/session-store.ts';
import type { EventHandler } from '../../shared/contracts/events.ts';
import { createRecordingLogger } from '../../tests/helpers/recording-logger.ts';
import type { LiveClock, LiveHub } from './live.ts';
import type { MemberInfo } from './ports.ts';
import { buildDashboard, liveHubOf, startDashboard, type DashboardDeps } from './server.ts';

const PUBLIC_URL = 'https://painel.example.com';
const SESSION_SECRET = Buffer.alloc(32, 7);
const SESSION_COOKIE = '__Host-sf_session';
const OWNER = '111111111111111111';
const DEV = '222222222222222222';
const STAFF = '333333333333333333';
const MEMBER = '555555555555555555';
const STAFF_ROLE = '444444444444444444';
const READER = '777777777777777777';
const READER_ROLE = '888888888888888888';
const DOMAINS = '999999999999999999';
const DOMAINS_ROLE = '121212121212121212';
const DECLARED = new Set([
  'moderation.config.manage',
  'moderation.cases.read',
  'moderation.domains.manage',
]);
/** Real-time bound for anything a socket must do; operations take milliseconds. */
const WAIT_MS = 5_000;

interface LiveMessage {
  readonly type: string;
  readonly data: unknown;
}

/** Timers that only fire when the test advances the clock. */
class FakeClock implements LiveClock {
  time = Date.UTC(2026, 0, 1);
  #nextId = 1;
  readonly #timers = new Map<number, { at: number; fn: () => void; every?: number }>();

  now = (): number => this.time;

  setTimeout = (fn: () => void, ms: number): unknown => this.#add(fn, ms);

  setInterval = (fn: () => void, ms: number): unknown => this.#add(fn, ms, ms);

  clearTimeout = (handle: unknown): void => {
    this.#timers.delete(handle as number);
  };

  clearInterval = (handle: unknown): void => {
    this.#timers.delete(handle as number);
  };

  /** Timers and intervals still scheduled. */
  pending(): number {
    return this.#timers.size;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void; every?: number }] | undefined;
      for (const entry of this.#timers) {
        if (entry[1].at <= target && (due === undefined || entry[1].at < due[1].at)) due = entry;
      }
      if (due === undefined) break;
      const [id, timer] = due;
      this.time = timer.at;
      if (timer.every === undefined) this.#timers.delete(id);
      else timer.at += timer.every;
      timer.fn();
    }
    this.time = target;
  }

  #add(fn: () => void, ms: number, every?: number): number {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.time + ms, fn, ...(every === undefined ? {} : { every }) });
    return id;
  }
}

interface Client {
  readonly ws: WebSocket;
  readonly messages: LiveMessage[];
  readonly closed: Promise<{ code: number; messages: LiveMessage[] }>;
}

let root: string;
let db: DatabaseSync;
let clock: FakeClock;
let permissions: PermissionService;
let sessions: SessionStore;
let members: Map<string, MemberInfo | null | undefined>;
let modules: Map<string, ModuleStatus>;
let handlers: Map<string, EventHandler[]>;
let app: FastifyInstance;
let hub: LiveHub;
let url: string;
let clients: WebSocket[];
let rawClients: Socket[];
let serverSockets: Socket[];
let deps: DashboardDeps;
let closed: boolean;

function member(overrides: Partial<MemberInfo> = {}): MemberInfo {
  return { roleIds: [], isOwner: false, displayName: 'Pessoa', avatarUrl: null, ...overrides };
}

function env(): PanelEnvironment {
  return {
    publicUrl: PUBLIC_URL,
    port: 0,
    clientId: '666666666666666666',
    clientSecret: 'fake-client-secret',
    sessionSecret: SESSION_SECRET,
    trustProxy: [],
  };
}

function emit(type: string, payload: unknown): void {
  for (const handler of handlers.get(type) ?? []) {
    void handler({
      id: 'event',
      type,
      version: 1,
      source: 'core',
      timestamp: new Date(clock.time).toISOString(),
      context: {},
      payload,
    });
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'sf-live-'));
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'public', 'index.html'), '<!doctype html>');
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  clock = new FakeClock();
  permissions = new PermissionService(db);
  sessions = new SessionStore(db, clock.now);
  permissions.addDeveloper(DEV);
  permissions.grant('moderation.config.manage', STAFF_ROLE, DECLARED);
  permissions.grant('moderation.cases.read', READER_ROLE, DECLARED);
  permissions.grant('moderation.domains.manage', DOMAINS_ROLE, DECLARED);
  members = new Map<string, MemberInfo | null | undefined>([
    [OWNER, member({ isOwner: true })],
    [DEV, member()],
    [STAFF, member({ roleIds: [STAFF_ROLE] })],
    [MEMBER, member()],
    [READER, member({ roleIds: [READER_ROLE] })],
    [DOMAINS, member({ roleIds: [DOMAINS_ROLE] })],
  ]);
  modules = new Map<string, ModuleStatus>([
    ['moderation', { state: 'RUNNING' }],
    ['administration', { state: 'RUNNING' }],
  ]);
  handlers = new Map();
  clients = [];
  rawClients = [];
  serverSockets = [];
  closed = false;
  const core = {
    permissions,
    sessions,
    declaredPermissions: () => DECLARED,
    status: () => modules,
    subscribe: (type: string, handler: EventHandler) => {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        handlers.set(
          type,
          (handlers.get(type) ?? []).filter((h) => h !== handler),
        );
      };
    },
  } as unknown as CoreHandle;
  deps = {
    env: env(),
    core,
    directory: {
      lookup: (userId) => Promise.resolve(members.has(userId) ? members.get(userId) : null),
    },
    status: { connection: () => 'ready', startedAt: clock.time - 5_000 },
    oauth: {
      authorizeUrl: () => 'https://discord.example.com/oauth2/authorize',
      exchange: () => Promise.reject(new Error('unused')),
      fetchUserId: () => Promise.reject(new Error('unused')),
    },
    logger: createRecordingLogger(),
    staticDir: join(root, 'public'),
    now: clock.now,
    liveClock: clock,
  };
  app = await buildDashboard(deps);
  app.server.on('connection', (socket: Socket) => serverSockets.push(socket));
  await app.listen({ host: '127.0.0.1', port: 0 });
  hub = liveHubOf(app);
  url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/live`;
});

afterEach(async () => {
  for (const ws of clients) ws.terminate();
  for (const raw of rawClients) raw.destroy();
  if (!closed) await app.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/** `origin: null` sends no Origin header at all. */
function socket(
  token: string | undefined,
  origin: string | null = PUBLIC_URL,
  autoPong = true,
): WebSocket {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers['cookie'] = `${SESSION_COOKIE}=${token}`;
  if (origin !== null) headers['origin'] = origin;
  const ws = new WebSocket(url, { headers, autoPong });
  clients.push(ws);
  return ws;
}

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

/** Opens a live connection and resolves once it is open. */
async function connect(token: string, autoPong = true): Promise<Client> {
  const ws = socket(token, PUBLIC_URL, autoPong);
  const messages: LiveMessage[] = [];
  ws.on('message', (data) => {
    messages.push(JSON.parse((data as Buffer).toString('utf8')) as LiveMessage);
  });
  const closed = new Promise<{ code: number; messages: LiveMessage[] }>((resolve) => {
    ws.on('close', (code) => {
      resolve({ code, messages });
    });
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
  return { ws, messages, closed };
}

/** The HTTP status that refused the upgrade. */
function refusal(token: string | undefined, origin?: string | null): Promise<number> {
  const ws = socket(token, origin === undefined ? PUBLIC_URL : origin);
  return withTimeout(
    new Promise<number>((resolve, reject) => {
      ws.once('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
      ws.once('open', () => {
        reject(new Error('the upgrade was accepted'));
      });
      ws.on('error', () => undefined);
    }),
    'refusal',
  );
}

/**
 * Resolves once the server answered a ping sent now. Frames on one socket are ordered, so any
 * message the server wrote before handling this ping has arrived by then.
 */
function barrier(client: Client): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve) => {
      client.ws.once('pong', () => {
        resolve();
      });
      client.ws.ping();
    }),
    'pong',
  );
}

/** Resolves with the first message (already received or not) that matches. */
function waitFor(
  client: Client,
  predicate: (message: LiveMessage) => boolean,
  from = 0,
): Promise<LiveMessage> {
  return withTimeout(
    new Promise<LiveMessage>((resolve) => {
      const check = (): boolean => {
        const found = client.messages.slice(from).find(predicate);
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

async function until(condition: () => boolean, what: string): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > WAIT_MS) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Resolves when the server's next heartbeat ping reaches this client (its pong is already sent). */
function pinged(client: Client): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve) => {
      client.ws.once('ping', () => {
        resolve();
      });
    }),
    'ping',
  );
}

/** A raw upgrade request; resolves with the status once the response head arrived. */
function rawUpgrade(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; socket: Socket }> {
  const port = (app.server.address() as AddressInfo).port;
  return withTimeout(
    new Promise<{ status: number; socket: Socket }>((resolve) => {
      const raw = netConnect(port, '127.0.0.1');
      rawClients.push(raw);
      let head = '';
      raw.on('error', () => undefined);
      raw.on('data', (chunk: Buffer) => {
        head += chunk.toString('latin1');
        const match = /^HTTP\/1\.1 (\d{3})/.exec(head);
        if (match !== null && head.includes('\r\n\r\n')) {
          resolve({ status: Number(match[1]), socket: raw });
        }
      });
      raw.on('connect', () => {
        raw.write(
          [
            `GET ${path} HTTP/1.1`,
            'Host: 127.0.0.1',
            'Connection: Upgrade',
            'Upgrade: websocket',
            'Sec-WebSocket-Version: 13',
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
            ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
            '',
            '',
          ].join('\r\n'),
        );
      });
    }),
    'the upgrade response',
  );
}

/** Resolves once the server closed this raw client's connection; the client never ends it. */
function closedByServer(raw: Socket): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve) => {
      if (raw.destroyed) resolve();
      else
        raw.once('close', () => {
          resolve();
        });
    }),
    'the server to close the socket',
  );
}

async function expectNoServerSockets(): Promise<void> {
  await until(() => serverSockets.every((s) => s.destroyed), 'server-side sockets to close');
  closed = true;
  await withTimeout(app.close(), 'app.close()');
}

interface PresenceUserShape {
  userId: string;
  screen: string;
  name: string;
  avatarUrl: string | null;
}

function presenceOf(message: LiveMessage): PresenceUserShape[] {
  return (message.data as { users: PresenceUserShape[] }).users;
}

/** What `member()` gives everyone by default. */
const WHO = { name: 'Pessoa', avatarUrl: null };

function sendPresence(client: Client, screen: string): void {
  client.ws.send(JSON.stringify({ type: 'presence', screen }));
}

function csrfFor(idHash: string): string {
  return createHmac('sha256', SESSION_SECRET).update(`csrf:${idHash}`).digest('base64url');
}

describe('upgrade', () => {
  it('answers 401 without a session cookie', async () => {
    expect(await refusal(undefined)).toBe(401);
  });

  it('answers 401 with an unknown session', async () => {
    expect(await refusal('x'.repeat(43))).toBe(401);
  });

  it('answers 403 when the Origin is another site', async () => {
    const { token } = sessions.create(OWNER);
    expect(await refusal(token, 'https://outro.example.com')).toBe(403);
  });

  it('answers 403 without an Origin header', async () => {
    const { token } = sessions.create(OWNER);
    expect(await refusal(token, null)).toBe(403);
  });

  it('answers 403 when the Origin only shares a prefix with the public URL', async () => {
    const { token } = sessions.create(OWNER);
    expect(await refusal(token, `${PUBLIC_URL}.evil.example.net`)).toBe(403);
  });

  it('answers 503 and keeps the session when the membership cannot be confirmed', async () => {
    const { token } = sessions.create(OWNER);
    members.set(OWNER, undefined);
    expect(await refusal(token)).toBe(503);
    expect(sessions.peek(token)).not.toBeNull();
  });

  it('refuses the 6th connection of one session', async () => {
    const { token } = sessions.create(STAFF);
    for (let i = 0; i < 5; i++) await connect(token);
    expect(await refusal(token)).toBe(403);
    const other = sessions.create(STAFF);
    await connect(other.token);
  });

  it('refuses the 11th connection of one person across sessions and closes none (Review Focus 2)', async () => {
    const clients: Client[] = [];
    for (let i = 0; i < 2; i++) {
      const { token } = sessions.create(STAFF);
      for (let j = 0; j < 5; j++) clients.push(await connect(token));
    }
    expect(hub.connectionCount(STAFF)).toBe(10);
    expect(await refusal(sessions.create(STAFF).token)).toBe(403);
    expect(hub.connectionCount(STAFF)).toBe(10);
    for (const client of clients) expect(client.ws.readyState).toBe(WebSocket.OPEN);
    await connect(sessions.create(DEV).token);
  });

  it('refuses a connection beyond the total limit', async () => {
    const small = await buildDashboard({ ...deps, liveLimits: { total: 2 } });
    try {
      await small.listen({ host: '127.0.0.1', port: 0 });
      url = `ws://127.0.0.1:${(small.server.address() as AddressInfo).port}/api/live`;
      await connect(sessions.create(STAFF).token);
      await connect(sessions.create(DEV).token);
      expect(await refusal(sessions.create(OWNER).token)).toBe(403);
    } finally {
      for (const ws of clients) ws.terminate();
      await small.close();
    }
  });
});

describe('status', () => {
  it('reaches the owner and a developer but not a member', async () => {
    const owner = await connect(sessions.create(OWNER).token);
    const dev = await connect(sessions.create(DEV).token);
    const plain = await connect(sessions.create(MEMBER).token);
    emit('core.discord.connection.changed', { state: 'disconnected' });
    const message = await waitFor(owner, (m) => m.type === 'status');
    expect(message.data).toEqual({
      connection: 'ready',
      uptimeMs: 5_000,
      modules: [
        { id: 'administration', state: 'RUNNING' },
        { id: 'moderation', state: 'RUNNING' },
      ],
    });
    await waitFor(dev, (m) => m.type === 'status');
    emit('core.module.state.changed', { moduleId: 'moderation', state: 'FAILED' });
    await waitFor(owner, (m) => m.type === 'status', 1);
    await barrier(plain);
    expect(plain.messages).toEqual([]);
  });

  it('recomputes the actor on every delivery', async () => {
    const owner = await connect(sessions.create(OWNER).token);
    members.set(OWNER, member({ isOwner: false }));
    emit('core.module.state.changed', { moduleId: 'moderation', state: 'FAILED' });
    const dev = await connect(sessions.create(DEV).token);
    emit('core.module.state.changed', { moduleId: 'moderation', state: 'RUNNING' });
    await waitFor(dev, (m) => m.type === 'status');
    await barrier(owner);
    expect(owner.messages.filter((m) => m.type === 'status')).toEqual([]);
  });
});

describe('config.changed', () => {
  it('reaches whoever holds a permission of that module and not a member', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    const plain = await connect(sessions.create(MEMBER).token);
    emit('core.config.changed', { moduleId: 'moderation', version: 3 });
    const message = await waitFor(staff, (m) => m.type === 'config.changed');
    expect(message.data).toEqual({ moduleId: 'moderation', version: 3 });
    await barrier(plain);
    expect(plain.messages).toEqual([]);
  });

  it('does not reach staff of another module', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    const owner = await connect(sessions.create(OWNER).token);
    emit('core.config.changed', { moduleId: 'administration', version: 1 });
    emit('core.config.changed', { moduleId: 'mod', version: 1 });
    emit('core.config.changed', { moduleId: 'moderation', version: 2 });
    await waitFor(staff, (m) => m.type === 'config.changed');
    await waitFor(owner, (m) => m.type === 'config.changed');
    expect(staff.messages.map((m) => m.data)).toEqual([{ moduleId: 'moderation', version: 2 }]);
  });

  it('ignores a malformed payload', async () => {
    const owner = await connect(sessions.create(OWNER).token);
    emit('core.config.changed', { moduleId: 5, version: 'x' });
    emit('core.config.changed', null);
    await barrier(owner);
    expect(owner.messages).toEqual([]);
  });
});

describe('case events', () => {
  it('reaches whoever may read cases and not a moderator without that permission (Review Focus 3)', async () => {
    const reader = await connect(sessions.create(READER).token);
    const domains = await connect(sessions.create(DOMAINS).token);
    const plain = await connect(sessions.create(MEMBER).token);
    emit('moderation.case.created', { caseId: 7, kind: 'spam', level: 1, action: 'timeout' });
    const message = await waitFor(reader, (m) => m.type === 'case.created');
    expect(message.data).toEqual({ caseId: 7 });
    await barrier(domains);
    await barrier(plain);
    expect(domains.messages).toEqual([]);
    expect(plain.messages).toEqual([]);
  });

  it('sends case.updated for a reverted or dismissed case', async () => {
    const reader = await connect(sessions.create(READER).token);
    emit('moderation.case.dismissed', { caseId: 8 });
    emit('moderation.case.reverted', { caseId: 9 });
    await waitFor(
      reader,
      (m) => m.type === 'case.updated' && (m.data as { caseId: number }).caseId === 9,
    );
    expect(reader.messages).toEqual([
      { type: 'case.updated', data: { caseId: 8 } },
      { type: 'case.updated', data: { caseId: 9 } },
    ]);
  });

  it('checks the permission when the event is sent, not when the socket opened', async () => {
    const reader = await connect(sessions.create(READER).token);
    members.set(READER, member());
    emit('moderation.case.created', { caseId: 1 });
    await barrier(reader);
    expect(reader.messages).toEqual([]);
  });

  it('ignores a malformed payload', async () => {
    const reader = await connect(sessions.create(READER).token);
    emit('moderation.case.created', { caseId: 'x' });
    emit('moderation.case.dismissed', null);
    await barrier(reader);
    expect(reader.messages).toEqual([]);
  });

  it('releases the subscriptions when the server closes', async () => {
    const count = (): number =>
      ['moderation.case.created', 'moderation.case.reverted', 'moderation.case.dismissed'].reduce(
        (total, type) => total + (handlers.get(type)?.length ?? 0),
        0,
      );
    expect(count()).toBe(3);
    await app.close();
    closed = true;
    expect(count()).toBe(0);
  });
});

describe('presence', () => {
  it('is not sent to or about a member', async () => {
    const owner = await connect(sessions.create(OWNER).token);
    const plain = await connect(sessions.create(MEMBER).token);
    sendPresence(plain, 'profile');
    await barrier(plain);
    sendPresence(owner, 'overview');
    const message = await waitFor(owner, (m) => m.type === 'presence');
    expect(presenceOf(message)).toEqual([{ userId: OWNER, screen: 'overview', ...WHO }]);
    await barrier(plain);
    expect(plain.messages).toEqual([]);
  });

  it('lists a person with two connections once, with the last screen (Review Focus 3)', async () => {
    const dev = await connect(sessions.create(DEV).token);
    const first = await connect(sessions.create(STAFF).token);
    const second = await connect(sessions.create(STAFF).token);
    sendPresence(first, 'moderation.config');
    await waitFor(dev, (m) => m.type === 'presence' && presenceOf(m).length > 0);
    clock.advance(1_000);
    sendPresence(second, 'overview');
    const message = await waitFor(
      dev,
      (m) => m.type === 'presence' && presenceOf(m).some((u) => u.screen === 'overview'),
    );
    expect(presenceOf(message)).toEqual([{ userId: STAFF, screen: 'overview', ...WHO }]);

    second.ws.close();
    await until(() => hub.connectionCount(STAFF) === 1, 'one connection left');
    clock.advance(60_000);
    expect(hub.presentUsers()).toEqual([STAFF]);
    sendPresence(dev, 'overview');
    const after = await waitFor(
      dev,
      (m) => m.type === 'presence' && presenceOf(m).some((u) => u.userId === DEV),
    );
    expect(presenceOf(after)).toEqual([
      { userId: DEV, screen: 'overview', ...WHO },
      { userId: STAFF, screen: 'overview', ...WHO },
    ]);
  });

  it('carries the display name and avatar of each person', async () => {
    members.set(
      STAFF,
      member({
        roleIds: [STAFF_ROLE],
        displayName: 'Girassol',
        avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
      }),
    );
    const staff = await connect(sessions.create(STAFF).token);
    const owner = await connect(sessions.create(OWNER).token);
    sendPresence(staff, 'profile');
    const message = await waitFor(
      owner,
      (m) => m.type === 'presence' && presenceOf(m).length === 1,
    );
    expect(presenceOf(message)).toEqual([
      {
        userId: STAFF,
        screen: 'profile',
        name: 'Girassol',
        avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
      },
    ]);
  });

  it('removes a person 30 s after the last connection closes', async () => {
    const dev = await connect(sessions.create(DEV).token);
    const first = await connect(sessions.create(STAFF).token);
    const second = await connect(sessions.create(STAFF).token);
    sendPresence(first, 'overview');
    await waitFor(dev, (m) => m.type === 'presence' && presenceOf(m).length === 1);
    first.ws.close();
    second.ws.close();
    await until(() => hub.connectionCount(STAFF) === 0, 'both connections closed');
    const seen = dev.messages.length;
    clock.advance(29_999);
    expect(hub.presentUsers()).toEqual([STAFF]);
    clock.advance(1);
    const message = await waitFor(dev, (m) => m.type === 'presence', seen);
    expect(presenceOf(message)).toEqual([]);
    expect(hub.presentUsers()).toEqual([]);
  });

  it('keeps a person who reconnects within 30 s', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    sendPresence(staff, 'overview');
    await until(() => hub.presentUsers().length === 1, 'presence recorded');
    staff.ws.close();
    await until(() => hub.connectionCount(STAFF) === 0, 'connection closed');
    clock.advance(10_000);
    await connect(sessions.create(STAFF).token);
    clock.advance(60_000);
    expect(hub.presentUsers()).toEqual([STAFF]);
  });

  it('sends the current presence to a new connection with a named permission', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    sendPresence(staff, 'overview');
    await until(() => hub.presentUsers().length === 1, 'presence recorded');
    const owner = await connect(sessions.create(OWNER).token);
    const message = await waitFor(owner, (m) => m.type === 'presence');
    expect(presenceOf(message)).toEqual([{ userId: STAFF, screen: 'overview', ...WHO }]);
  });
});

describe('browser messages', () => {
  it('closes with 4408 at the 10th violation of one message per second', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    for (let i = 0; i < 10; i++) sendPresence(staff, 'overview');
    await barrier(staff);
    expect(staff.ws.readyState).toBe(WebSocket.OPEN);
    sendPresence(staff, 'overview');
    expect((await withTimeout(staff.closed, 'close')).code).toBe(4408);
  });

  it('accepts one message per second', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    for (let i = 0; i < 15; i++) {
      sendPresence(staff, `screen-${String(i)}`);
      await barrier(staff);
      clock.advance(1_000);
    }
    expect(staff.ws.readyState).toBe(WebSocket.OPEN);
    expect(hub.presence()).toEqual([{ userId: STAFF, screen: 'screen-14' }]);
  });

  it('closes with 4400 on an unknown type', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    staff.ws.send(JSON.stringify({ type: 'x' }));
    expect((await withTimeout(staff.closed, 'close')).code).toBe(4400);
  });

  it('closes with 4400 on a message that is not JSON', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    staff.ws.send('not json');
    expect((await withTimeout(staff.closed, 'close')).code).toBe(4400);
  });

  it('refuses a message of 300 bytes', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    const message = JSON.stringify({ type: 'presence', screen: 'overview' });
    staff.ws.send(message + ' '.repeat(300 - message.length));
    await barrier(staff);
    expect(hub.presence()).toEqual([]);
    clock.advance(1_000);
    staff.ws.send(message + ' '.repeat(256 - message.length));
    await barrier(staff);
    expect(hub.presence()).toEqual([{ userId: STAFF, screen: 'overview' }]);
  });

  it('refuses a screen outside ^[a-z0-9.-]{1,40}$', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    for (const screen of ['../a', '', 'A', 'a'.repeat(41), 'a b']) {
      sendPresence(staff, screen);
      await barrier(staff);
      clock.advance(1_000);
    }
    staff.ws.send(JSON.stringify({ type: 'presence', screen: 'ok', extra: 1 }));
    await barrier(staff);
    expect(hub.presence()).toEqual([]);
    expect(staff.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('session end', { timeout: 20_000 }, () => {
  it('logout sends session.ended and closes every connection of the session', async () => {
    const { token, record } = sessions.create(STAFF);
    const staff = await connect(token);
    const other = await connect(sessions.create(STAFF).token);
    const res = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { [SESSION_COOKIE]: token },
      headers: { 'x-csrf-token': csrfFor(record.idHash) },
    });
    expect(res.statusCode).toBe(204);
    const closed = await withTimeout(staff.closed, 'close');
    expect(closed.code).toBe(4401);
    expect(closed.messages.at(-1)).toEqual({ type: 'session.ended', data: null });
    await barrier(other);
    expect(other.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('revalidation every 60 s closes the connection of someone who left the server', async () => {
    const { token } = sessions.create(STAFF);
    const staff = await connect(token);
    members.set(STAFF, null);
    clock.advance(59_999);
    await barrier(staff);
    expect(staff.ws.readyState).toBe(WebSocket.OPEN);
    clock.advance(1);
    const closed = await withTimeout(staff.closed, 'close');
    expect(closed.code).toBe(4401);
    expect(closed.messages.at(-1)).toEqual({ type: 'session.ended', data: null });
    expect(sessions.peek(token)).toBeNull();
  });

  it('revalidation closes a connection whose session was deleted', async () => {
    const { token, record } = sessions.create(STAFF);
    const staff = await connect(token);
    sessions.deleteByHash(record.idHash);
    clock.advance(60_000);
    expect((await withTimeout(staff.closed, 'close')).code).toBe(4401);
  });

  it('revalidation keeps the connection while the directory cannot answer', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    members.set(STAFF, undefined);
    for (let tick = 0; tick < 2; tick++) {
      const ping = pinged(staff);
      clock.advance(60_000);
      await ping;
      await barrier(staff);
    }
    expect(staff.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('ends a connection whose member left when an event is delivered', async () => {
    const owner = await connect(sessions.create(OWNER).token);
    members.set(OWNER, null);
    emit('core.module.state.changed', { moduleId: 'moderation', state: 'FAILED' });
    const closed = await withTimeout(owner.closed, 'close');
    expect(closed.code).toBe(4401);
    expect(closed.messages).toEqual([{ type: 'session.ended', data: null }]);
  });
});

describe('sessions revoked through the admin service', { timeout: 20_000 }, () => {
  it('closes the live connection of a revoked session and leaves the others open', async () => {
    const a = sessions.create(STAFF);
    const b = sessions.create(STAFF);
    const clientA = await connect(a.token);
    const clientB = await connect(b.token);
    expect(sessions.revokeByRef(sessions.refOf(a.record.idHash))).toBe(true);
    const closed = await withTimeout(clientA.closed, 'close');
    expect(closed.code).toBe(4401);
    expect(closed.messages.at(-1)).toEqual({ type: 'session.ended', data: null });
    await barrier(clientB);
    expect(clientB.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('closes every connection of a user whose sessions were all revoked', async () => {
    const clientA = await connect(sessions.create(STAFF).token);
    const clientB = await connect(sessions.create(DEV).token);
    expect(sessions.revokeForUser(STAFF)).toBe(1);
    expect((await withTimeout(clientA.closed, 'close')).code).toBe(4401);
    await barrier(clientB);
    expect(clientB.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('stops listening once the dashboard is closed', async () => {
    const { record } = sessions.create(STAFF);
    const spy = vi.spyOn(hub, 'revokeSession');
    await app.close();
    closed = true;
    expect(sessions.revokeByRef(sessions.refOf(record.idHash))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('session limit per person', { timeout: 20_000 }, () => {
  it('the 6th session ends the live connection of the first and keeps the other five (Review Focus 1)', async () => {
    const created = [];
    for (let i = 0; i < 5; i++) {
      created.push(sessions.create(STAFF));
      clock.advance(1_000);
    }
    const open: Client[] = [];
    for (const session of created) open.push(await connect(session.token));
    const sixth = sessions.create(STAFF);
    const first = open[0];
    if (first === undefined) throw new Error('no client');
    const result = await withTimeout(first.closed, 'close');
    expect(result.code).toBe(4401);
    expect(result.messages.at(-1)).toEqual({ type: 'session.ended', data: null });
    for (const client of open.slice(1)) {
      await barrier(client);
      expect(client.ws.readyState).toBe(WebSocket.OPEN);
    }
    expect(sessions.peek(sixth.token)).not.toBeNull();
    expect(sessions.list().filter((record) => record.userId === STAFF)).toHaveLength(5);
  });
});

describe('member left, found over HTTP', () => {
  it('ends the live connections of the deleted session at once', async () => {
    const { token } = sessions.create(STAFF);
    const staff = await connect(token);
    members.set(STAFF, null);
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(res.statusCode).toBe(401);
    const closed = await withTimeout(staff.closed, 'close');
    expect(closed.code).toBe(4401);
    expect(closed.messages.at(-1)).toEqual({ type: 'session.ended', data: null });
  });
});

describe('GET /api/status', () => {
  const status = (token: string) =>
    app.inject({ method: 'GET', url: '/api/status', cookies: { [SESSION_COOKIE]: token } });

  it('answers 403 to staff and to a member', async () => {
    for (const userId of [STAFF, MEMBER]) {
      const res = await status(sessions.create(userId).token);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: { code: 'forbidden', message: 'Sem permissão.' } });
    }
  });

  it('answers 200 with the status to the owner and a developer', async () => {
    for (const userId of [OWNER, DEV]) {
      const res = await status(sessions.create(userId).token);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toEqual({
        connection: 'ready',
        uptimeMs: 5_000,
        modules: [
          { id: 'administration', state: 'RUNNING' },
          { id: 'moderation', state: 'RUNNING' },
        ],
      });
    }
  });

  it('answers 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(401);
  });
});

describe('stray upgrade sockets', { timeout: 20_000 }, () => {
  it('closes the socket of an upgrade with a malformed URL (400); app.close() resolves', async () => {
    const { status, socket: raw } = await rawUpgrade('/api/%zz');
    expect(status).toBe(400);
    await closedByServer(raw);
    await expectNoServerSockets();
  });

  it('closes the socket of a rate-limited upgrade (429); app.close() resolves', async () => {
    for (let i = 0; i < 120; i++) await app.inject({ method: 'GET', url: '/api/me' });
    const { status, socket: raw } = await rawUpgrade('/api/live', { Origin: PUBLIC_URL });
    expect(status).toBe(429);
    await closedByServer(raw);
    await expectNoServerSockets();
  });

  it('closes the socket of a refused upgrade (401)', async () => {
    const { status, socket: raw } = await rawUpgrade('/api/live', { Origin: PUBLIC_URL });
    expect(status).toBe(401);
    await closedByServer(raw);
    await expectNoServerSockets();
  });

  it('refuses an upgrade to any route but /api/live with a 404', async () => {
    const { token } = sessions.create(OWNER);
    for (const path of ['/api/me', '/api/status', '/', '/x/y']) {
      const { status, socket: raw } = await rawUpgrade(path, {
        Origin: PUBLIC_URL,
        Cookie: `${SESSION_COOKIE}=${token}`,
      });
      expect(status).toBe(404);
      await closedByServer(raw);
    }
    await expectNoServerSockets();
  });
});

describe('live hub cleanup', { timeout: 20_000 }, () => {
  it('does not run a queued task after close', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    await barrier(staff);
    const directory = deps.directory as { lookup: (userId: string) => Promise<unknown> };
    let lookups = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    directory.lookup = async () => {
      lookups += 1;
      await gate;
      return member({ roleIds: [STAFF_ROLE] });
    };
    // The first delivery is held in its lookup, the second one waits in the queue.
    emit('core.module.state.changed', { moduleId: 'moderation', state: 'FAILED' });
    emit('core.module.state.changed', { moduleId: 'moderation', state: 'RUNNING' });
    await until(() => lookups === 1, 'the first delivery to start');
    hub.close();
    release();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(lookups).toBe(1);
    const logger = deps.logger as unknown as { entries: { level: string }[] };
    expect(logger.entries.filter((entry) => entry.level === 'error')).toEqual([]);
  });

  it('does not drop a healthy client when revalidation ticks run back to back', async () => {
    const alive = await connect(sessions.create(STAFF).token);
    const first = pinged(alive);
    clock.advance(120_000);
    await first;
    await barrier(alive);
    expect(alive.ws.readyState).toBe(WebSocket.OPEN);
    expect(hub.connectionCount(STAFF)).toBe(1);
  });

  it('closes the hub when listen fails', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as AddressInfo).port;
    const subscriptions = (): number =>
      [...handlers.values()].reduce((sum, list) => sum + list.length, 0);
    const before = subscriptions();
    const timers = new FakeClock();
    try {
      await expect(
        startDashboard({ ...deps, env: { ...env(), port }, liveClock: timers }),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
    expect(subscriptions()).toBe(before);
    expect(timers.pending()).toBe(0);
  });

  it('terminates a connection that did not answer the previous heartbeat', async () => {
    const alive = await connect(sessions.create(STAFF).token);
    const silent = await connect(sessions.create(STAFF).token, false);
    const first = Promise.all([pinged(alive), pinged(silent)]);
    clock.advance(60_000);
    await first;
    await barrier(alive);
    expect(silent.ws.readyState).toBe(WebSocket.OPEN);
    const second = pinged(alive);
    clock.advance(60_000);
    expect((await withTimeout(silent.closed, 'close')).code).toBe(1006);
    await second;
    await barrier(alive);
    expect(alive.ws.readyState).toBe(WebSocket.OPEN);
    await until(() => hub.connectionCount(STAFF) === 1, 'the silent connection to be dropped');
  });

  it('clears the leave timer of a presence entry dropped for a member who left', async () => {
    const dev = await connect(sessions.create(DEV).token);
    const staff = await connect(sessions.create(STAFF).token);
    sendPresence(staff, 'overview');
    await until(() => hub.presentUsers().includes(STAFF), 'presence recorded');
    staff.ws.close();
    await until(() => hub.connectionCount(STAFF) === 0, 'connection closed');
    // The first leave timer is due at +30 s; STAFF leaves the server and the entry is dropped.
    members.set(STAFF, null);
    sendPresence(dev, 'overview');
    await until(() => !hub.presentUsers().includes(STAFF), 'entry dropped');
    clock.advance(10_000);
    members.set(STAFF, member({ roleIds: [STAFF_ROLE] }));
    const again = await connect(sessions.create(STAFF).token);
    sendPresence(again, 'profile');
    await until(() => hub.presentUsers().includes(STAFF), 'presence recorded again');
    again.ws.close();
    await until(() => hub.connectionCount(STAFF) === 0, 'connection closed again');
    clock.advance(20_000);
    expect(hub.presentUsers()).toContain(STAFF);
    clock.advance(10_000);
    expect(hub.presentUsers()).not.toContain(STAFF);
  });

  it('closes with 4400 on a binary frame even inside the rate window', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    sendPresence(staff, 'overview');
    staff.ws.send(Buffer.from([1, 2, 3]));
    expect((await withTimeout(staff.closed, 'close')).code).toBe(4400);
  });

  it('closes with 4400 on an unknown type even inside the rate window', async () => {
    const staff = await connect(sessions.create(STAFF).token);
    sendPresence(staff, 'overview');
    staff.ws.send(JSON.stringify({ type: 'x' }));
    expect((await withTimeout(staff.closed, 'close')).code).toBe(4400);
  });
});
