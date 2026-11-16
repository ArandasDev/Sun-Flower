import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../shared/contracts/logger.ts';
import { ModuleConfigStore } from '../configuration/module-config.ts';
import { EventBus } from '../event-bus/event-bus.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { PermissionService } from '../permissions/permission-service.ts';
import { EntrypointError, resolveEntrypoint } from './entrypoint.ts';
import { ModuleRegistry, RegistryStateError } from './registry.ts';

interface LogCall {
  readonly level: string;
  readonly obj: object | string;
  readonly msg: string | undefined;
}

function createRecordingLogger(): Logger & { readonly calls: LogCall[] } {
  const calls: LogCall[] = [];
  const record =
    (level: string) =>
    (obj: object | string, msg?: string): void => {
      calls.push({ level, obj, msg });
    };
  const logger: Logger & { readonly calls: LogCall[] } = {
    calls,
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    child: () => logger,
  };
  return logger;
}

type Step = 'register' | 'initialize' | 'start' | 'stop' | 'dispose';

interface FixtureOptions {
  readonly dependencies?: string[];
  readonly enabledByDefault?: boolean;
  readonly throwIn?: Step[];
  readonly hangIn?: Step[];
  readonly commands?: string[];
  /** 'valid' exports a schema whose defaults are { greeting: 'hi' }; 'invalid' always fails. */
  readonly configSchema?: 'valid' | 'invalid';
  /** Replaces the generated index.ts entirely. */
  readonly rawSource?: string;
  readonly manifest?: Record<string, unknown>;
}

let tempDir: string;
let modulesDir: string;
let callsKey: string;
let db: DatabaseSync;
let logger: ReturnType<typeof createRecordingLogger>;
let bus: EventBus;
let config: ModuleConfigStore;
let keyCounter = 0;

const globalRecord = globalThis as unknown as Record<string, string[] | undefined>;

function calls(): string[] {
  return globalRecord[callsKey] ?? [];
}

function fixtureSource(id: string, options: FixtureOptions): string {
  const throwIn = JSON.stringify(options.throwIn ?? []);
  const hangIn = JSON.stringify(options.hangIn ?? []);
  const commands = JSON.stringify(options.commands ?? []);
  const schema =
    options.configSchema === 'valid'
      ? `export const configSchema = { safeParse: (value) => ({ success: true, data: { greeting: 'hi', ...value } }) };`
      : options.configSchema === 'invalid'
        ? `export const configSchema = { safeParse: () => ({ success: false, error: { issues: [{ path: ['greeting'] }] } }) };`
        : '';
  return `
const calls = (globalThis[${JSON.stringify(callsKey)}] ??= []);
const throwIn = ${throwIn};
const hangIn = ${hangIn};
${schema}
export default () => {
  let context;
  const step = async (name) => {
    calls.push(${JSON.stringify(id)} + ':' + name);
    if (throwIn.includes(name)) throw new Error(${JSON.stringify(id)} + ' ' + name + ' failed');
    if (hangIn.includes(name)) await new Promise(() => {});
  };
  return {
    async register(ctx) {
      context = ctx;
      for (const name of ${commands}) {
        ctx.commands.register({ name, description: 'Test command', handle: async () => {} });
      }
      await step('register');
    },
    async initialize() {
      await step('initialize');
      ${options.configSchema === 'valid' ? `calls.push(${JSON.stringify(id)} + ':config:' + JSON.stringify(context.config.get()));` : ''}
    },
    async start() { await step('start'); },
    async stop() { await step('stop'); },
    async dispose() { await step('dispose'); },
  };
};
`;
}

function writeModule(id: string, options: FixtureOptions = {}): string {
  const directory = path.join(modulesDir, id);
  fs.mkdirSync(directory, { recursive: true });
  const manifest = {
    id,
    name: id,
    description: `Test module ${id}`,
    version: '1.0.0',
    apiVersion: '1.0.0',
    entrypoint: 'index.ts',
    dependencies: options.dependencies ?? [],
    permissions: [],
    enabledByDefault: options.enabledByDefault ?? true,
    ...options.manifest,
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(directory, 'index.ts'),
    options.rawSource ?? fixtureSource(id, options),
  );
  return directory;
}

function createRegistry(stepTimeoutMs = 50): ModuleRegistry {
  return new ModuleRegistry({
    modulesDir,
    logger,
    events: bus,
    permissions: new PermissionService(db),
    config,
    stepTimeoutMs,
  });
}

function stateOf(registry: ModuleRegistry, id: string): string | undefined {
  return registry.status().get(id)?.state;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-registry-'));
  modulesDir = path.join(tempDir, 'modules');
  fs.mkdirSync(modulesDir);
  keyCounter += 1;
  callsKey = `__sunFlowerRegistryCalls_${process.pid}_${keyCounter}`;
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  logger = createRecordingLogger();
  bus = new EventBus(logger, { handlerTimeoutMs: 50 });
  config = new ModuleConfigStore(db);
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, callsKey);
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('ModuleRegistry', () => {
  it('starts modules in dependency order and stops in reverse', async () => {
    writeModule('b', { dependencies: ['a'] });
    writeModule('a');
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(calls()).toEqual([
      'a:register',
      'a:initialize',
      'a:start',
      'b:register',
      'b:initialize',
      'b:start',
    ]);
    expect(stateOf(registry, 'a')).toBe('RUNNING');
    expect(stateOf(registry, 'b')).toBe('RUNNING');
    await registry.stop();
    expect(calls().slice(6)).toEqual(['b:stop', 'b:dispose', 'a:stop', 'a:dispose']);
    expect(stateOf(registry, 'a')).toBe('DISPOSED');
    expect(stateOf(registry, 'b')).toBe('DISPOSED');
  });

  it.each(['register', 'initialize', 'start'] as const)(
    'marks FAILED, disposes and skips dependents when %s throws',
    async (step) => {
      writeModule('a', { throwIn: [step] });
      writeModule('b', { dependencies: ['a'] });
      writeModule('c');
      const registry = createRegistry();
      await registry.load();
      await registry.start();

      expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: step });
      expect(registry.status().get('a')?.error).toMatch(/a .* failed/);
      expect(calls()).toContain('a:dispose');
      expect(calls().filter((call) => call.startsWith('b:'))).toEqual([]);
      expect(registry.status().get('b')).toMatchObject({ state: 'FAILED' });
      expect(registry.status().get('b')?.error).toMatch(/"a"/);
      expect(stateOf(registry, 'c')).toBe('RUNNING');
      expect(logger.calls.some((call) => call.level === 'error')).toBe(true);
      await registry.stop();
      expect(stateOf(registry, 'c')).toBe('DISPOSED');
      expect(stateOf(registry, 'a')).toBe('FAILED');
    },
  );

  it('treats a step that exceeds the timeout as a failure', async () => {
    writeModule('a', { hangIn: ['initialize'] });
    const registry = createRegistry(20);
    await registry.load();
    await registry.start();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'initialize' });
    expect(registry.status().get('a')?.error).toMatch(/timed out/);
    expect(calls()).toEqual(['a:register', 'a:initialize', 'a:dispose']);
  });

  it('survives dispose throwing after a failure', async () => {
    writeModule('a', { throwIn: ['start', 'dispose'] });
    writeModule('b');
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'start' });
    expect(stateOf(registry, 'b')).toBe('RUNNING');
    expect(
      logger.calls.some((call) => call.level === 'error' && /dispose/.test(call.msg ?? '')),
    ).toBe(true);
  });

  it('survives dispose hanging after a failure', async () => {
    writeModule('a', { throwIn: ['register'], hangIn: ['dispose'] });
    const registry = createRegistry(20);
    await registry.load();
    await registry.start();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'register' });
  });

  it('does not start disabled modules or their dependents', async () => {
    writeModule('a', { enabledByDefault: false });
    writeModule('b', { dependencies: ['a'] });
    writeModule('c', { enabledByDefault: false });
    writeModule('d');
    config.setEnabled('c', true);
    config.setEnabled('d', false);
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(calls().filter((call) => call.startsWith('a:') || call.startsWith('b:'))).toEqual([]);
    expect(stateOf(registry, 'a')).toBe('VALIDATED');
    expect(registry.status().get('b')).toMatchObject({ state: 'FAILED', failedAt: 'dependencies' });
    expect(registry.status().get('b')?.error).toMatch(/"a".*disabled/);
    expect(stateOf(registry, 'c')).toBe('RUNNING');
    expect(stateOf(registry, 'd')).toBe('VALIDATED');
  });

  it('fails a module whose config is invalid', async () => {
    writeModule('a', { configSchema: 'invalid' });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'initialize' });
    expect(registry.status().get('a')?.error).toMatch(/greeting/);
    expect(calls()).toEqual(['a:register', 'a:dispose']);
  });

  it('gives initialize the settings loaded with the schema defaults', async () => {
    writeModule('a', { configSchema: 'valid' });
    config.setSettings('a', { extra: 1 });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(calls()).toContain('a:config:{"greeting":"hi","extra":1}');
    expect(stateOf(registry, 'a')).toBe('RUNNING');
  });

  it('fails a module that exports a configSchema without safeParse', async () => {
    writeModule('a', {
      rawSource: 'export const configSchema = {};\nexport default () => ({});\n',
    });
    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'import' });
  });

  it('fails the second module registering the same command name', async () => {
    writeModule('a', { commands: ['hello'] });
    writeModule('b', { commands: ['hello'] });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(stateOf(registry, 'a')).toBe('RUNNING');
    expect(registry.status().get('b')).toMatchObject({ state: 'FAILED', failedAt: 'register' });
    expect(registry.status().get('b')?.error).toMatch(/hello/);
    expect([...registry.commands().keys()]).toEqual(['hello']);
  });

  it.each([
    ['uppercase name', 'Hello'],
    ['empty name', ''],
    ['name longer than 32', 'a'.repeat(33)],
  ])('rejects a command with an invalid name (%s)', async (_label, name) => {
    writeModule('a', { commands: [name] });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'register' });
  });

  it('rejects a command with an invalid description', async () => {
    writeModule('a', {
      rawSource: `export default () => ({
  async register(ctx) { ctx.commands.register({ name: 'ok', description: '${'x'.repeat(101)}', handle: async () => {} }); },
  async initialize() {}, async start() {}, async stop() {}, async dispose() {},
});
`,
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'register' });
  });

  it('starts with zero modules when the directory is empty', async () => {
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().size).toBe(0);
    expect(registry.commands().size).toBe(0);
    expect(logger.calls.some((call) => call.level === 'warn')).toBe(true);
    expect(logger.calls.some((call) => call.level === 'error')).toBe(false);
    await registry.stop();
  });

  it('starts with zero modules when the directory does not exist', async () => {
    fs.rmSync(modulesDir, { recursive: true });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().size).toBe(0);
    expect(logger.calls.some((call) => call.level === 'warn')).toBe(true);
  });

  it('rejects start before load and a second start', async () => {
    const registry = createRegistry();
    await expect(registry.start()).rejects.toBeInstanceOf(RegistryStateError);
    await registry.load();
    await expect(registry.load()).rejects.toBeInstanceOf(RegistryStateError);
    await registry.start();
    await expect(registry.start()).rejects.toBeInstanceOf(RegistryStateError);
  });

  it('exposes commands of running modules only', async () => {
    writeModule('a', { commands: ['alpha'] });
    writeModule('b', { commands: ['beta'], throwIn: ['start'] });
    const registry = createRegistry();
    await registry.load();
    expect(registry.commands().size).toBe(0);
    await registry.start();
    expect([...registry.commands().keys()]).toEqual(['alpha']);
    await registry.stop();
    expect(registry.commands().size).toBe(0);
  });

  it('marks invalid manifests FAILED at validation, keyed by directory name', async () => {
    writeModule('bad', { manifest: { id: 'Bad_Id' } });
    writeModule('good');
    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('bad')).toMatchObject({ state: 'FAILED', failedAt: 'validation' });
    expect(stateOf(registry, 'good')).toBe('VALIDATED');
  });

  it('marks modules with a missing dependency FAILED', async () => {
    writeModule('a', { dependencies: ['ghost'] });
    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'dependencies' });
    expect(registry.status().get('a')?.error).toMatch(/ghost/);
    await registry.start();
    expect(calls()).toEqual([]);
  });

  it('fails a module whose default export is not a function', async () => {
    writeModule('a', { rawSource: 'export default 42;\n' });
    writeModule('b', { dependencies: ['a'] });
    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'import' });
    await registry.start();
    expect(registry.status().get('b')).toMatchObject({ state: 'FAILED', failedAt: 'dependencies' });
  });

  it('fails a module whose entrypoint does not exist', async () => {
    writeModule('a', { manifest: { entrypoint: 'missing.ts' } });
    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'import' });
  });

  it('keeps stopping other modules when stop or dispose throws or hangs', async () => {
    writeModule('a');
    writeModule('b', { throwIn: ['stop'] });
    writeModule('c', { hangIn: ['dispose'] });
    const registry = createRegistry(20);
    await registry.load();
    await registry.start();
    await registry.stop();
    expect(calls().slice(9)).toEqual([
      'c:stop',
      'c:dispose',
      'b:stop',
      'b:dispose',
      'a:stop',
      'a:dispose',
    ]);
    expect(registry.status().get('b')).toMatchObject({ state: 'FAILED', failedAt: 'stop' });
    expect(registry.status().get('c')).toMatchObject({ state: 'FAILED', failedAt: 'dispose' });
    expect(stateOf(registry, 'a')).toBe('DISPOSED');
  });

  it('removes event subscriptions before calling stop and after a failure', async () => {
    writeModule('a');
    writeModule('b', { throwIn: ['start'] });
    const original = bus.forModule.bind(bus);
    const forModule = vi.spyOn(bus, 'forModule').mockImplementation((manifest) => {
      const handle = original(manifest);
      return {
        ...handle,
        unsubscribeAll: () => {
          (globalRecord[callsKey] ??= []).push(`${manifest.id}:unsubscribeAll`);
          handle.unsubscribeAll();
        },
      };
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(forModule).toHaveBeenCalledTimes(2);
    expect(calls().filter((call) => call.startsWith('b:'))).toEqual([
      'b:register',
      'b:initialize',
      'b:start',
      'b:unsubscribeAll',
      'b:dispose',
    ]);
    const before = calls().length;
    await registry.stop();
    expect(calls().slice(before)).toEqual(['a:unsubscribeAll', 'a:stop', 'a:dispose']);
  });
});

function canSymlink(): boolean {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-symlink-probe-'));
  try {
    fs.writeFileSync(path.join(probe, 'target.ts'), '');
    fs.symlinkSync(path.join(probe, 'target.ts'), path.join(probe, 'link.ts'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

describe('resolveEntrypoint', () => {
  it('returns the real path of an entrypoint inside the module directory', () => {
    const directory = writeModule('a');
    expect(resolveEntrypoint(directory, 'index.ts')).toBe(
      fs.realpathSync(path.join(directory, 'index.ts')),
    );
  });

  it('rejects a crafted path that escapes the module directory', () => {
    const directory = writeModule('a');
    fs.writeFileSync(path.join(modulesDir, 'outside.ts'), 'export default () => ({});\n');
    expect(() => resolveEntrypoint(directory, '../outside.ts')).toThrow(EntrypointError);
  });

  it('rejects a sibling directory sharing the module directory prefix', () => {
    const directory = writeModule('a');
    fs.mkdirSync(path.join(modulesDir, 'a-evil'));
    fs.writeFileSync(path.join(modulesDir, 'a-evil', 'index.ts'), '');
    expect(() => resolveEntrypoint(directory, '../a-evil/index.ts')).toThrow(EntrypointError);
  });

  it.skipIf(!canSymlink())('rejects a symlinked entrypoint that points outside', async () => {
    const directory = writeModule('a');
    const outside = path.join(tempDir, 'outside.ts');
    fs.writeFileSync(outside, 'export default () => ({});\n');
    fs.symlinkSync(outside, path.join(directory, 'link.ts'), 'file');
    expect(() => resolveEntrypoint(directory, 'link.ts')).toThrow(EntrypointError);

    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, entrypoint: 'link.ts' }));
    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'import' });
  });
});
