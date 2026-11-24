import fastifyWebsocket, { type WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { CoreHandle } from '../../core/application/core.ts';
import type { Actor } from '../../shared/contracts/commands.ts';
import type { SunFlowerEvent } from '../../shared/contracts/events.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { MemberDirectory } from './ports.ts';
import {
  actorFor,
  forbidden,
  lookupMember,
  unauthorized,
  unavailable,
  type Authenticated,
  type SessionAuth,
} from './session.ts';
import { canSeeStatus, type StatusSnapshot } from './status-route.ts';

export const LIVE_PATH = '/api/live';
export const MAX_CONNECTIONS_PER_SESSION = 5;
export const MAX_MESSAGE_BYTES = 256;
export const MESSAGE_INTERVAL_MS = 1_000;
export const MAX_VIOLATIONS = 10;
export const PRESENCE_GRACE_MS = 30_000;
export const REVALIDATE_INTERVAL_MS = 60_000;

/** A message that is not a presence message (unknown type, not JSON, binary). */
export const CLOSE_INVALID = 4400;
/** The session ended: logout, expiry or loss of access. Always preceded by `session.ended`. */
export const CLOSE_SESSION_ENDED = 4401;
/** Too many violations of the message limits. */
export const CLOSE_LIMITS = 4408;

/** ws drops anything larger outright; up to this, oversize messages only count as violations. */
const WS_MAX_PAYLOAD = 4_096;
const OPEN = 1;

const presenceMessage = z.strictObject({
  type: z.literal('presence'),
  screen: z.string().regex(/^[a-z0-9.-]{1,40}$/),
});

const configChanged = z.object({
  moduleId: z.string().min(1),
  version: z.number().int().nonnegative(),
});

/** Time and timers; tests replace them with a clock they advance by hand. */
export interface LiveClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Real timers, unref'd so they never keep the process alive on their own. */
export const systemClock: LiveClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms).unref(),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
  setInterval: (callback, ms) => setInterval(callback, ms).unref(),
  clearInterval: (handle) => {
    clearInterval(handle as NodeJS.Timeout);
  },
};

export interface LiveHubDeps {
  readonly core: CoreHandle;
  readonly auth: SessionAuth;
  readonly directory: MemberDirectory;
  /** The only accepted `Origin`, compared exactly. */
  readonly publicUrl: string;
  readonly statusSnapshot: () => StatusSnapshot;
  readonly logger: Logger;
  readonly clock?: LiveClock;
}

export interface PresenceEntry {
  readonly userId: string;
  readonly screen: string;
}

interface Connection {
  readonly socket: WebSocket;
  readonly idHash: string;
  readonly userId: string;
  windowStart: number;
  windowCount: number;
  violations: number;
  ended: boolean;
  /** Whether a pong arrived since the last heartbeat ping. */
  alive: boolean;
  /** When the last heartbeat ping went out. */
  pingedAt: number;
}

interface PresenceState {
  screen: string;
  leaveTimer?: unknown;
}

/** Actors looked up for one delivery; `undefined` when the directory could not answer. */
type Actors = ReadonlyMap<string, Actor | undefined>;

function toBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? Buffer.from(data) : data;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * The live channel at `/api/live`. It only tells browsers that something changed: every delivery
 * looks the person up again and checks their permissions, and browsers can only report presence.
 */
export class LiveHub {
  readonly #core: CoreHandle;
  readonly #auth: SessionAuth;
  readonly #directory: MemberDirectory;
  readonly #publicUrl: string;
  readonly #statusSnapshot: () => StatusSnapshot;
  readonly #logger: Logger;
  readonly #clock: LiveClock;
  readonly #connections = new Set<Connection>();
  readonly #presence = new Map<string, PresenceState>();
  readonly #admitted = new WeakMap<FastifyRequest, Authenticated>();
  readonly #unsubscribe: (() => void)[] = [];
  #revalidateTimer: unknown;
  #queue: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(deps: LiveHubDeps) {
    this.#core = deps.core;
    this.#auth = deps.auth;
    this.#directory = deps.directory;
    this.#publicUrl = deps.publicUrl;
    this.#statusSnapshot = deps.statusSnapshot;
    this.#logger = deps.logger;
    this.#clock = deps.clock ?? systemClock;

    const onStatus = (): void => {
      this.#enqueue(() =>
        this.#deliver('status', this.#statusSnapshot(), (actor) => canSeeStatus(this.#core, actor)),
      );
    };
    this.#unsubscribe.push(
      this.#core.subscribe('core.discord.connection.changed', onStatus),
      this.#core.subscribe('core.module.state.changed', onStatus),
      this.#core.subscribe('core.config.changed', (event) => {
        this.#onConfigChanged(event);
      }),
    );
    this.#revalidateTimer = this.#clock.setInterval(() => {
      this.#enqueue(() => this.#revalidate());
    }, REVALIDATE_INTERVAL_MS);
  }

  /** Registers the WebSocket plugin and the `/api/live` route; call before the other routes. */
  async register(app: FastifyInstance): Promise<void> {
    await app.register(fastifyWebsocket, {
      options: { maxPayload: WS_MAX_PAYLOAD },
      errorHandler: (_error, socket) => {
        socket.terminate();
      },
    });
    app.addHook('onClose', (_instance, done) => {
      this.close();
      done();
    });
    app.get(
      LIVE_PATH,
      { websocket: true, preHandler: (request, reply) => this.#admit(request, reply) },
      (socket, request) => {
        this.#accept(socket, request);
      },
    );
  }

  /** Ends every live connection of a session: `session.ended`, then close 4401. */
  revokeSession(idHash: string): void {
    for (const connection of this.#connections) {
      if (connection.idHash === idHash) this.#end(connection);
    }
  }

  /** Open connections, of one person or of everyone. */
  connectionCount(userId?: string): number {
    let count = 0;
    for (const connection of this.#connections) {
      if (userId === undefined || connection.userId === userId) count += 1;
    }
    return count;
  }

  /** The people currently in the presence list, before any permission filter. */
  presentUsers(): string[] {
    return [...this.#presence.keys()].sort();
  }

  /** The presence list before any permission filter. */
  presence(): PresenceEntry[] {
    return this.presentUsers().map((userId) => ({
      userId,
      screen: this.#presence.get(userId)?.screen ?? '',
    }));
  }

  /** Stops the timers and the subscriptions; the WebSocket plugin closes the sockets. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#clock.clearInterval(this.#revalidateTimer);
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    for (const state of this.#presence.values()) {
      if (state.leaveTimer !== undefined) this.#clock.clearTimeout(state.leaveTimer);
    }
    this.#presence.clear();
  }

  /** preHandler of the upgrade: refuses with a plain HTTP answer before any WebSocket opens. */
  async #admit(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    // Exact match against the configured origin; the Host header is never trusted.
    if (request.headers.origin !== this.#publicUrl) return forbidden(reply);
    const outcome = await this.#auth.authenticate(request);
    if (outcome === 'unauthorized') return unauthorized(reply);
    if (outcome === 'unavailable') return unavailable(reply);
    if (this.#sessionConnections(outcome.record.idHash) >= MAX_CONNECTIONS_PER_SESSION) {
      return forbidden(reply);
    }
    this.#admitted.set(request, outcome);
    return undefined;
  }

  #sessionConnections(idHash: string): number {
    let count = 0;
    for (const connection of this.#connections) {
      if (connection.idHash === idHash) count += 1;
    }
    return count;
  }

  #accept(socket: WebSocket, request: FastifyRequest): void {
    const admitted = this.#admitted.get(request);
    if (admitted === undefined || this.#closed) {
      socket.close(CLOSE_SESSION_ENDED);
      return;
    }
    const { record } = admitted;
    // Upgrades admitted concurrently are counted again once open.
    if (this.#sessionConnections(record.idHash) >= MAX_CONNECTIONS_PER_SESSION) {
      socket.close(CLOSE_LIMITS);
      return;
    }
    const connection: Connection = {
      socket,
      idHash: record.idHash,
      userId: record.userId,
      windowStart: this.#clock.now(),
      windowCount: 0,
      violations: 0,
      ended: false,
      alive: true,
      pingedAt: this.#clock.now(),
    };
    this.#connections.add(connection);
    socket.on('pong', () => {
      connection.alive = true;
    });
    const state = this.#presence.get(record.userId);
    if (state?.leaveTimer !== undefined) {
      this.#clock.clearTimeout(state.leaveTimer);
      delete state.leaveTimer;
    }
    socket.on('message', (data, isBinary) => {
      this.#onMessage(connection, data, isBinary);
    });
    socket.on('close', () => {
      this.#onClose(connection);
    });
    if (this.#presence.size > 0) this.#enqueue(() => this.#sendPresence([connection]));
  }

  #onMessage(
    connection: Connection,
    data: Buffer | ArrayBuffer | Buffer[],
    isBinary: boolean,
  ): void {
    if (connection.ended) return;
    // Protocol errors close at once, whatever the rate; oversize text is dropped unparsed.
    if (isBinary) {
      this.#closeWith(connection, CLOSE_INVALID);
      return;
    }
    const bytes = toBuffer(data);
    if (bytes.length > MAX_MESSAGE_BYTES) {
      this.#violation(connection);
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      this.#closeWith(connection, CLOSE_INVALID);
      return;
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as { type?: unknown }).type !== 'presence'
    ) {
      this.#closeWith(connection, CLOSE_INVALID);
      return;
    }
    const now = this.#clock.now();
    if (now - connection.windowStart >= MESSAGE_INTERVAL_MS) {
      connection.windowStart = now;
      connection.windowCount = 0;
    }
    connection.windowCount += 1;
    if (connection.windowCount > 1) {
      this.#violation(connection);
      return;
    }
    const parsed = presenceMessage.safeParse(value);
    if (!parsed.success) {
      this.#violation(connection);
      return;
    }
    const state = this.#presence.get(connection.userId);
    if (state === undefined) {
      this.#presence.set(connection.userId, { screen: parsed.data.screen });
    } else {
      state.screen = parsed.data.screen;
    }
    this.#enqueue(() => this.#broadcastPresence(connection.userId));
  }

  #violation(connection: Connection): void {
    connection.violations += 1;
    if (connection.violations >= MAX_VIOLATIONS) this.#closeWith(connection, CLOSE_LIMITS);
  }

  /** Closes without `session.ended`; frames still arriving on the socket are ignored. */
  #closeWith(connection: Connection, code: number): void {
    connection.ended = true;
    connection.socket.close(code);
  }

  #onClose(connection: Connection): void {
    connection.ended = true;
    this.#connections.delete(connection);
    const { userId } = connection;
    const state = this.#presence.get(userId);
    if (state === undefined || this.connectionCount(userId) > 0 || this.#closed) return;
    if (state.leaveTimer !== undefined) this.#clock.clearTimeout(state.leaveTimer);
    const timer = this.#clock.setTimeout(() => {
      // Only the entry this timer was set for, and only if nobody came back.
      if (this.#presence.get(userId) !== state || state.leaveTimer !== timer) return;
      if (this.connectionCount(userId) > 0) return;
      this.#presence.delete(userId);
      this.#enqueue(() => this.#broadcastPresence(userId));
    }, PRESENCE_GRACE_MS);
    state.leaveTimer = timer;
  }

  #onConfigChanged(event: SunFlowerEvent): void {
    const parsed = configChanged.safeParse(event.payload);
    if (!parsed.success) return;
    const { moduleId, version } = parsed.data;
    const prefix = `${moduleId}.`;
    this.#enqueue(() =>
      this.#deliver('config.changed', { moduleId, version }, (actor) =>
        this.#core.permissions
          .effective(actor, this.#core.declaredPermissions())
          .some((permission) => permission.startsWith(prefix)),
      ),
    );
  }

  /** Deliveries run one at a time, in the order the events arrived. */
  #enqueue(task: () => Promise<void>): void {
    this.#queue = this.#queue
      .then(() => (this.#closed ? undefined : task()))
      .catch((error: unknown) => {
        this.#logger.error({ error: errorName(error) }, 'live delivery failed');
      });
  }

  /**
   * Looks every person up once. A person who is no longer a member loses their sessions and
   * connections; one the directory cannot answer for is skipped this time.
   */
  async #actors(userIds: Iterable<string>): Promise<Actors> {
    const actors = new Map<string, Actor | undefined>();
    for (const userId of new Set(userIds)) {
      const member = await lookupMember(this.#directory, userId);
      if (member === null) {
        this.#endUser(userId);
        this.#dropPresence(userId);
        actors.set(userId, undefined);
      } else {
        actors.set(userId, member === undefined ? undefined : actorFor(userId, member));
      }
    }
    return actors;
  }

  async #deliver(type: string, data: unknown, entitled: (actor: Actor) => boolean): Promise<void> {
    const connections = [...this.#connections];
    const actors = await this.#actors(connections.map((connection) => connection.userId));
    if (this.#closed) return;
    for (const connection of connections) {
      const actor = actors.get(connection.userId);
      if (actor !== undefined && entitled(actor)) this.#send(connection, type, data);
    }
  }

  /** Whether the person holds any named permission (or is a developer or the owner). */
  #hasNamedPermission(actor: Actor): boolean {
    return (
      canSeeStatus(this.#core, actor) ||
      this.#core.permissions.effective(actor, this.#core.declaredPermissions()).length > 0
    );
  }

  /**
   * Sends the presence list to everyone entitled after `changed` reported a screen or left. A
   * change by someone who is not listed is not announced at all, not even as an unchanged list.
   */
  async #broadcastPresence(changed: string): Promise<void> {
    const member = await lookupMember(this.#directory, changed);
    if (member !== null && member !== undefined) {
      if (!this.#hasNamedPermission(actorFor(changed, member))) return;
    }
    await this.#sendPresence([...this.#connections]);
  }

  /** Sends the presence list to these connections; both sides are filtered by named permission. */
  async #sendPresence(connections: readonly Connection[]): Promise<void> {
    const actors = await this.#actors([
      ...this.#presence.keys(),
      ...connections.map((connection) => connection.userId),
    ]);
    if (this.#closed) return;
    const users = this.presence().filter((entry) => {
      const actor = actors.get(entry.userId);
      return actor !== undefined && this.#hasNamedPermission(actor);
    });
    for (const connection of connections) {
      const actor = actors.get(connection.userId);
      if (actor !== undefined && this.#hasNamedPermission(actor)) {
        this.#send(connection, 'presence', { users });
      }
    }
  }

  /** Checks every connection's session and membership again, closing the invalid ones. */
  async #revalidate(): Promise<void> {
    this.#heartbeat();
    for (const connection of [...this.#connections]) {
      let valid: boolean;
      try {
        valid = this.#core.sessions.peekByHash(connection.idHash) !== null;
      } catch {
        continue;
      }
      if (!valid) this.#end(connection);
    }
    await this.#actors([...this.#connections].map((connection) => connection.userId));
  }

  /**
   * A connection that did not answer a ping sent at least half a tick ago is dropped (a silent,
   * half-open peer would otherwise hold a session slot and its presence forever); the others are
   * pinged again. Ticks that run back to back never drop a client that had no time to answer.
   */
  #heartbeat(): void {
    const now = this.#clock.now();
    for (const connection of [...this.#connections]) {
      if (!connection.alive) {
        if (now - connection.pingedAt >= REVALIDATE_INTERVAL_MS / 2) {
          connection.ended = true;
          connection.socket.terminate();
        }
        continue;
      }
      connection.alive = false;
      connection.pingedAt = now;
      try {
        connection.socket.ping();
      } catch (error) {
        this.#logger.error({ error: errorName(error) }, 'live ping failed');
      }
    }
  }

  /** Removes a person from the presence list, with any pending leave timer. */
  #dropPresence(userId: string): void {
    const state = this.#presence.get(userId);
    if (state?.leaveTimer !== undefined) this.#clock.clearTimeout(state.leaveTimer);
    this.#presence.delete(userId);
  }

  /** Every session of a person who left the server is deleted and its connections end. */
  #endUser(userId: string): void {
    for (const connection of [...this.#connections]) {
      if (connection.userId !== userId) continue;
      try {
        this.#core.sessions.deleteByHash(connection.idHash);
      } catch (error) {
        this.#logger.error({ error: errorName(error) }, 'live session cleanup failed');
      }
      this.#end(connection);
    }
  }

  #end(connection: Connection): void {
    if (connection.ended) return;
    this.#send(connection, 'session.ended', null);
    connection.ended = true;
    connection.socket.close(CLOSE_SESSION_ENDED);
  }

  #send(connection: Connection, type: string, data: unknown): void {
    if (connection.ended || connection.socket.readyState !== OPEN) return;
    try {
      connection.socket.send(JSON.stringify({ type, data }));
    } catch (error) {
      this.#logger.error({ error: errorName(error) }, 'live send failed');
    }
  }
}
