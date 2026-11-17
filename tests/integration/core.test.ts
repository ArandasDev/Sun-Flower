import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCore } from '../../core/application/core.ts';
import { dispatchCommand, type RawInteraction } from '../../interfaces/discord/commands.ts';
import { createRecordingLogger } from '../helpers/recording-logger.ts';

const GOOD_SOURCE = `
export default () => ({
  async register(ctx) {
    ctx.commands.register({ name: 'good', description: 'Good command', handle: async () => {} });
  },
  async initialize() {},
  async start() {},
  async stop() {},
  async dispose() {},
});
`;

const FAILS_ON_START_SOURCE = `
export default () => ({
  async register(ctx) {
    ctx.commands.register({ name: 'flaky', description: 'Flaky command', handle: async (i) => {
      await i.reply('should not run');
    } });
  },
  async initialize() {},
  async start() {
    throw new Error('start failed');
  },
  async stop() {},
  async dispose() {},
});
`;

function manifest(id: string, dependencies: string[] = []): Record<string, unknown> {
  return {
    id,
    name: id,
    description: `Test module ${id}`,
    version: '1.0.0',
    apiVersion: '1.0.0',
    entrypoint: 'index.ts',
    dependencies,
    permissions: [],
    enabledByDefault: true,
    events: { subscribes: [], publishes: [] },
  };
}

let tempDir: string;
let modulesDir: string;
const logger = createRecordingLogger();

function writeModule(id: string, content: Record<string, unknown>, source = GOOD_SOURCE): void {
  const directory = path.join(modulesDir, id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(content));
  fs.writeFileSync(path.join(directory, 'index.ts'), source);
}

function closedDatabases(spy: { mock: { contexts: unknown[] } }): DatabaseSync[] {
  return spy.mock.contexts as DatabaseSync[];
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-core-'));
  modulesDir = path.join(tempDir, 'modules');
  fs.mkdirSync(modulesDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('startCore', () => {
  it('boots the core, isolates broken modules and shuts down cleanly', async () => {
    writeModule('good', manifest('good'));
    // Invalid manifest: the version is not SemVer.
    writeModule('broken', { ...manifest('broken'), version: 'not-a-version' });
    writeModule('needs-broken', manifest('needs-broken', ['broken']));
    const close = vi.spyOn(DatabaseSync.prototype, 'close');

    const core = await startCore({ dbPath: ':memory:', modulesDir, logger, stepTimeoutMs: 1000 });
    expect(core.status().get('good')?.state).toBe('RUNNING');
    expect(core.status().get('broken')?.state).toBe('FAILED');
    expect(core.status().get('needs-broken')?.state).toBe('FAILED');
    expect(core.status().get('needs-broken')?.error).toContain('dependency "broken" failed');
    expect([...core.commands().keys()]).toEqual(['good']);
    expect(core.permissions.listDevelopers()).toEqual([]);

    const first = core.stop();
    const second = core.stop();
    expect(second).toBe(first);
    await first;
    await core.stop(); // idempotente
    expect(core.status().get('good')?.state).toBe('DISPOSED');
    expect(close).toHaveBeenCalledTimes(1);
    expect(closedDatabases(close)[0]?.isOpen).toBe(false);
  });

  it('closes the database and rethrows when a migration fails', async () => {
    const migrationsDir = path.join(tempDir, 'migrations');
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(path.join(migrationsDir, '0001-broken.sql'), 'THIS IS NOT SQL;');
    const close = vi.spyOn(DatabaseSync.prototype, 'close');

    await expect(
      startCore({ dbPath: ':memory:', modulesDir, logger, migrationsDir }),
    ).rejects.toThrow('migration 0001-broken failed');
    expect(close).toHaveBeenCalledTimes(1);
    expect(closedDatabases(close)[0]?.isOpen).toBe(false);
  });

  it('closes the database and rethrows when loading the modules fails', async () => {
    const notADirectory = path.join(tempDir, 'modules-file');
    fs.writeFileSync(notADirectory, '');
    const close = vi.spyOn(DatabaseSync.prototype, 'close');

    await expect(
      startCore({ dbPath: ':memory:', modulesDir: notADirectory, logger }),
    ).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
    expect(closedDatabases(close)[0]?.isOpen).toBe(false);
  });

  it('answers a command of a module that failed in start() as unavailable', async () => {
    writeModule('flaky', manifest('flaky'), FAILS_ON_START_SOURCE);
    const core = await startCore({ dbPath: ':memory:', modulesDir, logger, stepTimeoutMs: 1000 });
    try {
      expect(core.status().get('flaky')?.state).toBe('FAILED');
      const replies: { content: string; ephemeral: boolean }[] = [];
      const raw: RawInteraction = {
        commandName: 'flaky',
        userId: '111111111111111111',
        roleIds: [],
        guildId: '000000000000000000',
        reply: async (content, ephemeral) => {
          await Promise.resolve();
          replies.push({ content, ephemeral });
        },
        deferReply: async () => {},
        editReply: async () => {},
      };
      await dispatchCommand(raw, core.commands(), logger);
      expect(replies).toEqual([{ content: 'Comando indisponível.', ephemeral: true }]);
    } finally {
      await core.stop();
    }
  });
});
