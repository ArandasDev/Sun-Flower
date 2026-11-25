import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { ApiError, apiFetch } from './api.ts';
import { useLeaveSession } from './session.tsx';

export const BACKOFF_START_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
/** The server accepts one message per second; stay clear of it. */
export const PRESENCE_MIN_INTERVAL_MS = 1_100;
/** The server ended the session; do not reconnect. */
export const CLOSE_SESSION_ENDED = 4401;
/** A connection counts as healthy after this long open; only then is the backoff reset. */
export const STABLE_AFTER_MS = 5_000;
/**
 * A live event refetches each query at most once per this window. Every read is a POST and
 * spends the session's change budget, so a raid of new cases must not use it up.
 */
export const REFETCH_MIN_INTERVAL_MS = 5_000;

const OPEN = 1;

/** Time and timers; tests replace them with a clock they advance by hand. */
export interface LiveClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: LiveClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle as number);
  },
};

export interface PresenceUser {
  userId: string;
  screen: string;
  name: string;
  avatarUrl: string | null;
}

export interface Live {
  /** True while the connection is closed and being retried. */
  reconnecting: boolean;
  presence: PresenceUser[];
}

export const LiveContext = createContext<Live>({ reconnecting: false, presence: [] });

export function useLive(): Live {
  return useContext(LiveContext);
}

/** The screen id the server knows for a route. */
export function screenFor(pathname: string): string {
  if (pathname.startsWith('/visao-geral')) return 'overview';
  if (pathname.startsWith('/casos')) return 'cases';
  if (pathname.startsWith('/acoes')) return 'actions';
  if (pathname.startsWith('/dominios')) return 'domains';
  if (pathname.startsWith('/moderacao')) return 'moderation-config';
  return 'profile';
}

export interface Coalescer {
  /** Runs `run` now, or once when the window of `key` ends; a later call replaces `run`. */
  request(key: string, run: () => void): void;
  /** Drops what is waiting. */
  stop(): void;
}

/** Runs each key at most once per `windowMs`, and always runs the last request (trailing). */
export function makeCoalescer(clock: LiveClock, windowMs = REFETCH_MIN_INTERVAL_MS): Coalescer {
  const lastRun = new Map<string, number>();
  const waiting = new Map<string, { timer: unknown; run: () => void }>();
  const runNow = (key: string, run: () => void): void => {
    lastRun.set(key, clock.now());
    run();
  };
  return {
    request(key, run) {
      const pending = waiting.get(key);
      if (pending !== undefined) {
        pending.run = run;
        return;
      }
      const wait = (lastRun.get(key) ?? Number.NEGATIVE_INFINITY) + windowMs - clock.now();
      if (wait <= 0) {
        runNow(key, run);
        return;
      }
      const entry = { timer: undefined as unknown, run };
      entry.timer = clock.setTimeout(() => {
        waiting.delete(key);
        runNow(key, entry.run);
      }, wait);
      waiting.set(key, entry);
    },
    stop() {
      for (const entry of waiting.values()) clock.clearTimeout(entry.timer);
      waiting.clear();
    },
  };
}

/** Keeps only the first page of every cached cases list, so a refetch asks for one page. */
function keepFirstCasesPage(client: QueryClient): void {
  client.setQueriesData({ queryKey: ['cases'] }, (data: unknown): unknown => {
    if (!isRecord(data)) return data;
    const pages: unknown = data['pages'];
    const pageParams: unknown = data['pageParams'];
    if (!Array.isArray(pages) || !Array.isArray(pageParams) || pages.length <= 1) return data;
    return {
      pages: (pages as unknown[]).slice(0, 1),
      pageParams: (pageParams as unknown[]).slice(0, 1),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePresence(data: unknown): PresenceUser[] | null {
  if (!isRecord(data) || !Array.isArray(data['users'])) return null;
  const users: PresenceUser[] = [];
  for (const entry of data['users'] as unknown[]) {
    if (
      isRecord(entry) &&
      typeof entry['userId'] === 'string' &&
      typeof entry['screen'] === 'string' &&
      typeof entry['name'] === 'string'
    ) {
      const avatar = entry['avatarUrl'];
      users.push({
        userId: entry['userId'],
        screen: entry['screen'],
        name: entry['name'],
        avatarUrl: typeof avatar === 'string' ? avatar : null,
      });
    }
  }
  return users;
}

function isStatus(data: unknown): boolean {
  return (
    isRecord(data) &&
    typeof data['connection'] === 'string' &&
    typeof data['uptimeMs'] === 'number' &&
    Array.isArray(data['modules']) &&
    (data['modules'] as unknown[]).every(
      (entry) =>
        isRecord(entry) && typeof entry['id'] === 'string' && typeof entry['state'] === 'string',
    )
  );
}

function liveUrl(): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`;
}

/**
 * Keeps the live channel open while mounted (below `RequireSession`, so only once `/api/me`
 * succeeded): applies what the server announces, reconnects with a growing wait, and reports
 * the current screen.
 */
export function useLiveConnection(clock: LiveClock = realClock): Live {
  const client = useQueryClient();
  const leave = useLeaveSession();
  const { pathname } = useLocation();
  const screen = screenFor(pathname);
  const [reconnecting, setReconnecting] = useState(false);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const screenRef = useRef(screen);
  const leaveRef = useRef(leave);
  const reportRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    leaveRef.current = leave;
  }, [leave]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let lost = false;
    let delay = BACKOFF_START_MS;
    let retryTimer: unknown;
    let sendTimer: unknown;
    let stableTimer: unknown;
    let lastSentAt = Number.NEGATIVE_INFINITY;
    let lastSentScreen: string | null = null;
    const coalescer = makeCoalescer(clock);
    // Set by case.created: the next cases refetch first drops the pages after the first one.
    let newCase = false;
    const refreshCases = (): void => {
      if (newCase) keepFirstCasesPage(client);
      newCase = false;
      void client.invalidateQueries({ queryKey: ['cases'] });
    };

    // Sends the latest screen, never more than once per PRESENCE_MIN_INTERVAL_MS.
    const flush = (): void => {
      sendTimer = undefined;
      if (socket === null || socket.readyState !== OPEN) return;
      const current = screenRef.current;
      if (current === lastSentScreen) return;
      const wait = lastSentAt + PRESENCE_MIN_INTERVAL_MS - clock.now();
      if (wait > 0) {
        sendTimer = clock.setTimeout(flush, wait);
        return;
      }
      socket.send(JSON.stringify({ type: 'presence', screen: current }));
      lastSentAt = clock.now();
      lastSentScreen = current;
    };
    reportRef.current = () => {
      if (sendTimer === undefined) flush();
    };

    const stopStableTimer = (): void => {
      if (stableTimer !== undefined) clock.clearTimeout(stableTimer);
      stableTimer = undefined;
    };

    const stopSending = (): void => {
      if (sendTimer !== undefined) clock.clearTimeout(sendTimer);
      sendTimer = undefined;
    };

    const detach = (ws: WebSocket): void => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
    };

    const endSession = (ws: WebSocket): void => {
      stopped = true;
      coalescer.stop();
      stopSending();
      stopStableTimer();
      detach(ws);
      ws.close();
      leaveRef.current();
    };

    const onMessage = (ws: WebSocket, raw: unknown): void => {
      let message: unknown;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!isRecord(message) || typeof message['type'] !== 'string') return;
      const data = message['data'];
      switch (message['type']) {
        case 'status':
          if (isStatus(data)) client.setQueryData(['status'], data);
          break;
        case 'config.changed':
          if (isRecord(data) && typeof data['moduleId'] === 'string') {
            void client.invalidateQueries({ queryKey: ['config', data['moduleId']] });
          }
          break;
        case 'case.created':
          if (isRecord(data) && typeof data['caseId'] === 'number') {
            newCase = true;
            coalescer.request('cases', refreshCases);
          }
          break;
        case 'case.updated':
          if (isRecord(data) && typeof data['caseId'] === 'number') {
            const caseId = data['caseId'];
            coalescer.request('cases', refreshCases);
            coalescer.request(`case:${String(caseId)}`, () => {
              void client.invalidateQueries({ queryKey: ['case', caseId] });
            });
          }
          break;
        case 'presence': {
          const users = parsePresence(data);
          if (users !== null) setPresence(users);
          break;
        }
        case 'session.ended':
          endSession(ws);
          break;
        default:
          break;
      }
    };

    const connect = (): void => {
      retryTimer = undefined;
      const ws = new WebSocket(liveUrl());
      socket = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        lastSentAt = Number.NEGATIVE_INFINITY;
        lastSentScreen = null;
        flush();
        // A server may accept and then close at once (too many tabs); only a connection that
        // stays open proves the link is healthy, so only then reset the wait and refetch.
        stableTimer = clock.setTimeout(() => {
          stableTimer = undefined;
          setReconnecting(false);
          delay = BACKOFF_START_MS;
          // Events may have been missed while it was down.
          if (lost) void client.invalidateQueries();
          lost = false;
        }, STABLE_AFTER_MS);
      };
      ws.onmessage = (event) => {
        onMessage(ws, event.data);
      };
      ws.onclose = (event) => {
        if (stopped || socket !== ws) return;
        socket = null;
        stopSending();
        stopStableTimer();
        // Never opened: the upgrade may have been refused because the session ended. Probe
        // outside the query cache, so a failing probe never turns the shell into an error screen.
        if (!opened) {
          apiFetch('/api/me').catch((error: unknown) => {
            if (!stopped && error instanceof ApiError && error.status === 401) {
              stopped = true;
              stopSending();
              if (retryTimer !== undefined) clock.clearTimeout(retryTimer);
              leaveRef.current();
            }
          });
        }
        if (event.code === CLOSE_SESSION_ENDED) {
          endSession(ws);
          return;
        }
        lost = true;
        setReconnecting(true);
        retryTimer = clock.setTimeout(connect, delay);
        delay = Math.min(delay * 2, BACKOFF_MAX_MS);
      };
    };

    connect();

    return () => {
      stopped = true;
      reportRef.current = () => undefined;
      coalescer.stop();
      stopSending();
      stopStableTimer();
      if (retryTimer !== undefined) clock.clearTimeout(retryTimer);
      if (socket !== null) {
        detach(socket);
        socket.close();
      }
    };
  }, [client, clock]);

  useEffect(() => {
    screenRef.current = screen;
    reportRef.current();
  }, [screen]);

  return { reconnecting, presence };
}
