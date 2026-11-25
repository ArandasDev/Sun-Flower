import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModuleConfigStore } from '../../core/configuration/module-config.ts';
import { EventBus } from '../../core/event-bus/event-bus.ts';
import { openDatabase } from '../../core/infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../core/infrastructure/migrations.ts';
import { ModuleRegistry } from '../../core/module-registry/registry.ts';
import { PermissionService } from '../../core/permissions/permission-service.ts';
import { createFakeGuild } from '../helpers/fake-guild.ts';
import { createRecordingLogger } from '../helpers/recording-logger.ts';

const REAL_MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));

let tempDir: string;
let modulesDir: string;
let db: DatabaseSync;
let failKey: string;
let counter = 0;
const flags = globalThis as unknown as Record<string, boolean | undefined>;

/** A module that depends on `moderation`; its start() throws while the flag is set. */
function writeDependent(id: string): void {
  const directory = path.join(modulesDir, id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      description: `Test module ${id}`,
      version: '1.0.0',
      apiVersion: '1.0.0',
      entrypoint: 'index.ts',
      dependencies: ['moderation'],
      permissions: [],
      capabilities: [],
      enabledByDefault: true,
    }),
  );
  fs.writeFileSync(
    path.join(directory, 'index.ts'),
    `
export default () => ({
  async register() {},
  async initialize() {},
  async start() {
    if (globalThis[${JSON.stringify(failKey)}] === true) throw new Error('start failed');
  },
  async stop() {},
  async dispose() {},
});
`,
  );
}

/** Mirrors a real module: its manifest and migrations, and an entrypoint that re-exports it. */
function mirrorRealModule(id: string): void {
  const source = path.join(REAL_MODULES_DIR, id);
  const directory = path.join(modulesDir, id);
  fs.mkdirSync(directory);
  fs.copyFileSync(path.join(source, 'manifest.json'), path.join(directory, 'manifest.json'));
  if (fs.existsSync(path.join(source, 'migrations'))) {
    fs.cpSync(path.join(source, 'migrations'), path.join(directory, 'migrations'), {
      recursive: true,
    });
  }
  const entry = JSON.stringify(pathToFileURL(path.join(source, 'index.ts')).href);
  fs.writeFileSync(
    path.join(directory, 'index.ts'),
    `export { default } from ${entry};\nexport * from ${entry};\n`,
  );
}

async function startRegistry(): Promise<ModuleRegistry> {
  const logger = createRecordingLogger();
  const registry = new ModuleRegistry({
    modulesDir,
    logger,
    events: new EventBus(logger),
    permissions: new PermissionService(db),
    config: new ModuleConfigStore(db),
    db,
    guild: createFakeGuild(),
  });
  await registry.load();
  await registry.start();
  return registry;
}

const stateOf = (registry: ModuleRegistry, id: string): string | undefined =>
  registry.status().get(id)?.state;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-toggle-'));
  modulesDir = path.join(tempDir, 'modules');
  fs.mkdirSync(modulesDir);
  counter += 1;
  failKey = `__sunFlowerToggleFail_${process.pid}_${counter}`;
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  mirrorRealModule('moderation');
  mirrorRealModule('ping');
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, failKey);
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('enabling and disabling modules at runtime', () => {
  it('refuses to disable moderation while a running module depends on it', async () => {
    writeDependent('watcher');
    const registry = await startRegistry();
    expect(stateOf(registry, 'watcher')).toBe('RUNNING');
    const operations = registry.operations.names();

    await expect(registry.setEnabled('moderation', false)).resolves.toEqual({
      kind: 'dependents',
      ids: ['watcher'],
    });

    expect(stateOf(registry, 'moderation')).toBe('RUNNING');
    expect(stateOf(registry, 'watcher')).toBe('RUNNING');
    expect(registry.commands().has('mod')).toBe(true);
    expect(registry.operations.names()).toEqual(operations);

    await registry.setEnabled('watcher', false);
    await expect(registry.setEnabled('moderation', false)).resolves.toMatchObject({
      kind: 'changed',
      entry: { id: 'moderation', state: 'DISPOSED', enabled: false, dependents: ['watcher'] },
    });
    expect(registry.commands().has('mod')).toBe(false);
    expect(registry.operations.names().some((name) => name.startsWith('moderation.'))).toBe(false);
    expect(stateOf(registry, 'ping')).toBe('RUNNING');

    await expect(registry.setEnabled('moderation', true)).resolves.toMatchObject({
      kind: 'changed',
      entry: { state: 'RUNNING' },
    });
    expect(registry.commands().has('mod')).toBe(true);
    expect(registry.operations.names()).toEqual(operations);
    await registry.stop();
  });

  it('leaves a module whose start() throws FAILED, and enables it once fixed', async () => {
    writeDependent('flaky');
    flags[failKey] = true;
    const registry = await startRegistry();
    expect(stateOf(registry, 'flaky')).toBe('FAILED');

    await expect(registry.setEnabled('flaky', true)).resolves.toMatchObject({
      kind: 'failed',
      entry: { id: 'flaky', state: 'FAILED', failedAt: 'start' },
    });
    expect(stateOf(registry, 'moderation')).toBe('RUNNING');
    expect(stateOf(registry, 'ping')).toBe('RUNNING');

    Reflect.deleteProperty(globalThis, failKey);
    await expect(registry.setEnabled('flaky', true)).resolves.toMatchObject({
      kind: 'changed',
      entry: { id: 'flaky', state: 'RUNNING', enabled: true },
    });
    await registry.stop();
    expect(stateOf(registry, 'flaky')).toBe('DISPOSED');
  });
});
