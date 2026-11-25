import { EventEmitter } from 'node:events';
import { createServer, type AddressInfo, type Server } from 'node:net';
import type { Client } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoreHandle } from '../../core/application/core.ts';
import { createRecordingLogger } from '../../tests/helpers/recording-logger.ts';
import type { EventHandler, SunFlowerEvent } from '../../shared/contracts/events.ts';
import {
  createCoalescedSync,
  DASHBOARD_STATIC_DIR,
  resyncOnModuleChanges,
  startPanel,
} from './main.ts';

const GUILD = '999999999999999999';
const CLIENT_SECRET = 'fake-client-secret-value';
const SESSION_SECRET = Buffer.alloc(32, 7).toString('base64');

const core = { subscribe: () => () => undefined } as unknown as CoreHandle;
let blocker: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (blocker === undefined) resolve();
    else blocker.close(() => resolve());
  });
  blocker = undefined;
});

function source(port: number): Record<string, string> {
  return {
    PANEL_PUBLIC_URL: 'https://painel.example.com',
    PANEL_PORT: String(port),
    DISCORD_CLIENT_ID: '444444444444444444',
    DISCORD_CLIENT_SECRET: CLIENT_SECRET,
    SESSION_SECRET,
  };
}

/** A port on 127.0.0.1 that something else is listening on. */
async function busyPort(): Promise<number> {
  const server = createServer();
  blocker = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function start(env: Record<string, string>) {
  const logger = createRecordingLogger();
  const client = new EventEmitter() as unknown as Client;
  const pending = startPanel({ source: env, client, guildId: GUILD, core, logger });
  return { logger, pending };
}

describe('startPanel', () => {
  it('serves the compiled panel from interfaces/dashboard/app/dist', () => {
    expect(DASHBOARD_STATIC_DIR.replaceAll('\\', '/')).toMatch(
      /\/interfaces\/dashboard\/app\/dist\/?$/,
    );
  });

  it('stays off without PANEL_PUBLIC_URL, without logging an error', async () => {
    const { logger, pending } = start({});
    expect(await pending).toBeNull();
    expect(logger.entries.filter((e) => e.level === 'error')).toEqual([]);
  });

  it('logs only the names of invalid variables', async () => {
    const { logger, pending } = start({ ...source(3000), SESSION_SECRET: 'short' });
    expect(await pending).toBeNull();
    const errors = logger.entries.filter((e) => e.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toEqual({ variables: ['SESSION_SECRET'] });
    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toContain(CLIENT_SECRET);
    expect(logged).not.toContain('short');
  });

  it('logs only the error name when the panel cannot start', async () => {
    const port = await busyPort();
    const { logger, pending } = start(source(port));
    expect(await pending).toBeNull();
    const errors = logger.entries.filter((e) => e.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toEqual({ error: 'Error' });
    expect(JSON.stringify(logger.entries)).not.toContain(CLIENT_SECRET);
  });

  it('starts the panel and returns a handle that closes it', async () => {
    const port = await busyPort();
    await new Promise<void>((resolve) => blocker?.close(() => resolve()));
    blocker = undefined;
    const { logger, pending } = start(source(port));
    const handle = await pending;
    expect(handle).not.toBeNull();
    await handle?.close();
    expect(logger.entries.filter((e) => e.level === 'error')).toEqual([]);
  });
});

describe('createCoalescedSync', () => {
  it('keeps at most one sync queued behind the running one', async () => {
    const handlers: EventHandler[] = [];
    const fakeCore = {
      subscribe: (_type: string, handler: EventHandler) => {
        handlers.push(handler);
        return () => undefined;
      },
    };
    let runs = 0;
    let release = (): void => undefined;
    const sync = createCoalescedSync(
      async () => {
        runs += 1;
        if (runs === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      },
      () => undefined,
    );
    resyncOnModuleChanges(fakeCore, () => {
      sync.request();
    });
    const emit = (state: string): void => {
      for (const handler of handlers) {
        void handler({
          type: 'core.module.state.changed',
          payload: { moduleId: 'a', state },
        } as SunFlowerEvent);
      }
    };

    emit('RUNNING');
    await vi.waitFor(() => {
      expect(runs).toBe(1);
    });
    for (let index = 0; index < 5; index += 1) emit(index % 2 === 0 ? 'DISPOSED' : 'RUNNING');
    release();
    await sync.idle();
    expect(runs).toBe(2);
  });

  it('reports a failed sync and keeps serving later requests', async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const sync = createCoalescedSync(
      () => {
        runs += 1;
        return runs === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
      },
      (error) => errors.push(error),
    );
    sync.request();
    await sync.idle();
    sync.request();
    await sync.idle();
    expect(runs).toBe(2);
    expect(errors).toHaveLength(1);
  });
});

describe('resyncOnModuleChanges', () => {
  it('resyncs when a module becomes RUNNING, DISPOSED or FAILED, and unsubscribes', () => {
    const handlers = new Map<string, EventHandler>();
    let unsubscribed = 0;
    const fakeCore = {
      subscribe: (type: string, handler: EventHandler) => {
        handlers.set(type, handler);
        return () => {
          unsubscribed += 1;
        };
      },
    };
    let resyncs = 0;
    const unsubscribe = resyncOnModuleChanges(fakeCore, () => {
      resyncs += 1;
    });
    const handler = handlers.get('core.module.state.changed');
    expect(handler).toBeDefined();
    const emit = (payload: unknown): void => {
      void handler?.({ type: 'core.module.state.changed', payload } as SunFlowerEvent);
    };
    for (const state of ['VALIDATED', 'REGISTERED', 'INITIALIZED', 'STOPPED']) {
      emit({ moduleId: 'a', state });
    }
    emit(null);
    emit('RUNNING');
    expect(resyncs).toBe(0);
    for (const state of ['RUNNING', 'DISPOSED', 'FAILED']) emit({ moduleId: 'a', state });
    expect(resyncs).toBe(3);
    unsubscribe();
    expect(unsubscribed).toBe(1);
  });
});
