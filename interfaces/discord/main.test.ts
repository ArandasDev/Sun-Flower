import { EventEmitter } from 'node:events';
import { createServer, type AddressInfo, type Server } from 'node:net';
import type { Client } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { CoreHandle } from '../../core/application/core.ts';
import { createRecordingLogger } from '../../tests/helpers/recording-logger.ts';
import { DASHBOARD_STATIC_DIR, startPanel } from './main.ts';

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
