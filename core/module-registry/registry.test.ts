import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildActionResult, GuildActions } from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { ModuleContext } from '../../shared/contracts/module.ts';
import { ConfigVersionConflictError, ModuleConfigStore } from '../configuration/module-config.ts';
import { EventBus } from '../event-bus/event-bus.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { InvalidOperationError } from '../operations/operation-registry.ts';
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
    capabilities: [],
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

const OK: GuildActionResult = { ok: true };
const fakeGuild: GuildActions = {
  deleteMessage: () => Promise.resolve(OK),
  timeout: () => Promise.resolve(OK),
  removeTimeout: () => Promise.resolve(OK),
  kick: () => Promise.resolve(OK),
  ban: () => Promise.resolve(OK),
  unban: () => Promise.resolve(OK),
  sendMessage: () => Promise.resolve(OK),
  sendDirectMessage: () => Promise.resolve(OK),
  bulkDeleteMessages: () => Promise.resolve({ ok: true, deleted: 0, individually: 0 }),
  getMemberRoleIds: () => Promise.resolve([]),
};

function createRegistry(stepTimeoutMs = 50): ModuleRegistry {
  return new ModuleRegistry({
    modulesDir,
    logger,
    events: bus,
    permissions: new PermissionService(db),
    config,
    db,
    guild: fakeGuild,
    stepTimeoutMs,
  });
}

function writeMigration(directory: string, file: string, sql: string): void {
  fs.mkdirSync(path.join(directory, 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'migrations', file), sql);
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

interface NestedFixture {
  groups: { subcommands: { options: { name: string }[] }[] }[];
}

describe('ModuleRegistry', () => {
  it('starts modules in dependency order and stops in reverse', async () => {
    writeModule('b', { dependencies: ['a'] });
    writeModule('a');
    const registry = createRegistry(1000);
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
    const registry = createRegistry(200);
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
    const registry = createRegistry(200);
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

  it('fails a module whose import never settles and still loads the others', async () => {
    writeModule('hang', {
      rawSource: 'await new Promise(() => {});\nexport default () => ({});\n',
    });
    writeModule('b');
    const registry = createRegistry(200);
    await registry.load();
    expect(registry.status().get('hang')).toMatchObject({ state: 'FAILED', failedAt: 'import' });
    expect(registry.status().get('hang')?.error).toMatch(/import timed out/);
    await registry.start();
    expect(stateOf(registry, 'b')).toBe('RUNNING');
  });

  it('fails a module whose factory throws', async () => {
    writeModule('a', {
      rawSource: "export default () => { throw new Error('factory exploded'); };\n",
    });
    writeModule('b');
    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'import' });
    expect(registry.status().get('a')?.error).toMatch(/factory exploded/);
    await registry.start();
    expect(stateOf(registry, 'b')).toBe('RUNNING');
  });

  it('fails a module whose factory returns an object without the lifecycle methods', async () => {
    writeModule('a', {
      rawSource: 'export default () => ({ async register() {}, async start() {} });\n',
    });
    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'import' });
    expect(registry.status().get('a')?.error).toMatch(/register, initialize, start, stop, dispose/);
  });

  it('stores a frozen copy of each command, not the module object', async () => {
    const key = JSON.stringify(`${callsKey}_command`);
    writeModule('a', {
      rawSource: `export default () => ({
  async register(ctx) {
    const command = { name: 'hello', description: 'Original', handle: async () => {} };
    globalThis[${key}] = command;
    ctx.commands.register(command);
  },
  async initialize() {}, async start() {}, async stop() {}, async dispose() {},
});
`,
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    const original = (globalThis as unknown as Record<string, Record<string, unknown>>)[
      `${callsKey}_command`
    ];
    Reflect.deleteProperty(globalThis, `${callsKey}_command`);
    if (original === undefined) throw new Error('fixture did not expose its command');
    original.description = 'Mutated';
    original.name = 'renamed';
    const stored = registry.commands().get('hello');
    expect(stored?.description).toBe('Original');
    expect(stored?.name).toBe('hello');
    expect(stored).not.toBe(original);
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it('keeps options and subcommands in the frozen copy', async () => {
    const key = JSON.stringify(`${callsKey}_nested`);
    writeModule('a', {
      rawSource: `export default () => ({
  async register(ctx) {
    const command = {
      name: 'mod', description: 'Mod',
      groups: [{ name: 'domain', description: 'Domains', subcommands: [
        { name: 'add', description: 'Add', options: [{ name: 'domain', description: 'D', type: 'string', required: true }] },
      ] }],
      handle: async () => {},
    };
    globalThis[${key}] = command;
    ctx.commands.register(command);
  },
  async initialize() {}, async start() {}, async stop() {}, async dispose() {},
});
`,
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    const original = (globalThis as unknown as Record<string, NestedFixture | undefined>)[
      `${callsKey}_nested`
    ];
    Reflect.deleteProperty(globalThis, `${callsKey}_nested`);
    if (original === undefined) throw new Error('fixture did not expose its command');
    const firstOption = original.groups[0]?.subcommands[0]?.options[0];
    if (firstOption === undefined) throw new Error('fixture is missing its option');
    firstOption.name = 'mutated';
    const stored = registry.commands().get('mod');
    const storedOption = stored?.groups?.[0]?.subcommands[0]?.options?.[0];
    expect(storedOption?.name).toBe('domain');
    expect(Object.isFrozen(stored?.groups)).toBe(true);
    expect(Object.isFrozen(storedOption)).toBe(true);
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

  it('reports a failed dependency, not a missing one, for a dependent of an invalid manifest', async () => {
    writeModule('bad', { manifest: { version: 'not-a-version' } });
    writeModule('a', { dependencies: ['bad'] });
    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('bad')).toMatchObject({ state: 'FAILED', failedAt: 'validation' });
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'dependencies' });
    expect(registry.status().get('a')?.error).toBe('dependency "bad" failed');
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
    const registry = createRegistry(200);
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
      'b:unsubscribeAll',
    ]);
    const before = calls().length;
    await registry.stop();
    expect(calls().slice(before)).toEqual([
      'a:unsubscribeAll',
      'a:stop',
      'a:dispose',
      'a:unsubscribeAll',
    ]);
  });

  it('ignores a subscribe made after the module failed by timeout', async () => {
    const key = JSON.stringify(callsKey);
    writeModule('late', {
      manifest: { events: { subscribes: ['pub.thing.happened'], publishes: [] } },
      rawSource: `const calls = (globalThis[${key}] ??= []);
export default () => ({
  async register(ctx) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    ctx.events.subscribe('pub.thing.happened', () => { calls.push('late:received'); });
    calls.push('late:subscribed');
    await new Promise(() => {});
  },
  async initialize() {}, async start() {}, async stop() {}, async dispose() {},
});
`,
    });
    const registry = createRegistry(200);
    await registry.load();
    await registry.start();
    expect(registry.status().get('late')).toMatchObject({ state: 'FAILED', failedAt: 'register' });
    await vi.waitFor(() => {
      expect(calls()).toContain('late:subscribed');
    });

    const publisher = bus.forModule({
      id: 'pub',
      name: 'pub',
      description: 'pub',
      version: '1.0.0',
      apiVersion: '1.0.0',
      entrypoint: 'index.ts',
      dependencies: [],
      permissions: [],
      capabilities: [],
      enabledByDefault: true,
      events: { subscribes: [], publishes: ['pub.thing.happened'] },
    });
    publisher.publish('pub.thing.happened', {});
    await bus.idle();
    expect(calls()).not.toContain('late:received');
    expect(
      logger.calls.some(
        (call) => call.level === 'warn' && (call.obj as { module?: string }).module === 'late',
      ),
    ).toBe(true);
  });

  it('drops subscriptions a module makes during stop()', async () => {
    const key = JSON.stringify(callsKey);
    writeModule('a', {
      manifest: { events: { subscribes: ['pub.thing.happened'], publishes: [] } },
      rawSource: `const calls = (globalThis[${key}] ??= []);
export default () => {
  let context;
  return {
    async register(ctx) { context = ctx; },
    async initialize() {}, async start() {},
    async stop() {
      context.events.subscribe('pub.thing.happened', () => { calls.push('a:received'); });
      calls.push('a:subscribed');
    },
    async dispose() {},
  };
};
`,
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    await registry.stop();
    expect(calls()).toContain('a:subscribed');

    const publisher = bus.forModule({
      id: 'pub',
      name: 'pub',
      description: 'pub',
      version: '1.0.0',
      apiVersion: '1.0.0',
      entrypoint: 'index.ts',
      dependencies: [],
      permissions: [],
      capabilities: [],
      enabledByDefault: true,
      events: { subscribes: [], publishes: ['pub.thing.happened'] },
    });
    publisher.publish('pub.thing.happened', {});
    await bus.idle();
    expect(calls()).not.toContain('a:received');
  });

  it('ignores a publish made after stop()', async () => {
    const key = JSON.stringify(`${callsKey}_context`);
    writeModule('a', {
      manifest: { events: { subscribes: [], publishes: ['a.thing.happened'] } },
      rawSource: `export default () => ({
  async register(ctx) { globalThis[${key}] = ctx; },
  async initialize() {}, async start() {}, async stop() {}, async dispose() {},
});
`,
    });
    const received: unknown[] = [];
    bus
      .forModule({
        id: 'listener',
        name: 'listener',
        description: 'listener',
        version: '1.0.0',
        apiVersion: '1.0.0',
        entrypoint: 'index.ts',
        dependencies: [],
        permissions: [],
        capabilities: [],
        enabledByDefault: true,
        events: { subscribes: ['a.thing.happened'], publishes: [] },
      })
      .subscribe('a.thing.happened', (event) => {
        received.push(event);
      });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    const context = (globalThis as unknown as Record<string, ModuleContext>)[`${callsKey}_context`];
    Reflect.deleteProperty(globalThis, `${callsKey}_context`);
    context?.events.publish('a.thing.happened', {});
    await bus.idle();
    expect(received).toHaveLength(1);

    await registry.stop();
    context?.events.publish('a.thing.happened', {});
    await bus.idle();
    expect(received).toHaveLength(1);
    expect(
      logger.calls.some((call) => call.level === 'warn' && /publish/.test(call.msg ?? '')),
    ).toBe(true);
  });

  it('fails a module that swallows a duplicate command error', async () => {
    writeModule('a', { commands: ['hello'] });
    writeModule('b', {
      rawSource: `export default () => ({
  async register(ctx) {
    try {
      ctx.commands.register({ name: 'hello', description: 'Duplicate', handle: async () => {} });
    } catch {}
  },
  async initialize() {}, async start() {}, async stop() {}, async dispose() {},
});
`,
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().get('b')).toMatchObject({ state: 'FAILED', failedAt: 'register' });
    expect(registry.status().get('b')?.error).toMatch(/hello/);
  });

  it('discards earlier commands of a module that hits a duplicate and releases them', async () => {
    writeModule('a', { commands: ['hello'] });
    writeModule('b', { commands: ['bx', 'hello'] });
    writeModule('c', { commands: ['bx'] });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().get('b')).toMatchObject({ state: 'FAILED', failedAt: 'register' });
    expect(stateOf(registry, 'c')).toBe('RUNNING');
    expect([...registry.commands().keys()].sort()).toEqual(['bx', 'hello']);
    expect(registry.status().get('c')?.error).toBeUndefined();
  });

  it('returns the same in-flight promise for concurrent stop() calls', async () => {
    writeModule('a');
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    const first = registry.stop();
    const second = registry.stop();
    expect(second).toBe(first);
    await first;
    expect(calls().filter((call) => call === 'a:stop')).toHaveLength(1);
  });

  it('still shuts down started modules when start() rejects', async () => {
    writeModule('a');
    writeModule('b');
    const isEnabled = config.isEnabled.bind(config);
    vi.spyOn(config, 'isEnabled').mockImplementation((id, enabledByDefault) => {
      if (id === 'b') throw new Error('database unavailable');
      return isEnabled(id, enabledByDefault);
    });
    const registry = createRegistry();
    await registry.load();
    await expect(registry.start()).rejects.toThrow(/database unavailable/);
    await expect(registry.stop()).resolves.toBeUndefined();
    expect(stateOf(registry, 'a')).toBe('DISPOSED');
    expect(calls()).toEqual(['a:register', 'a:initialize', 'a:start', 'a:stop', 'a:dispose']);
  });
});

describe('ModuleRegistry wiring', () => {
  function recorder(): string {
    return `const calls = (globalThis[${JSON.stringify(callsKey)}] ??= []);`;
  }

  const VALID_SCHEMA = `export const configSchema = { safeParse: (value) => ({ success: true, data: { greeting: 'hi', ...value } }) };`;

  it('applies module migrations before register()', async () => {
    const directory = writeModule('a', {
      rawSource: `${recorder()}
export default () => ({
  async register(ctx) {
    ctx.storage.run('INSERT INTO a_items (label) VALUES (?)', ['first']);
    const row = ctx.storage.get('SELECT COUNT(*) AS n FROM a_items');
    calls.push('a:rows:' + row.n);
  },
  async initialize() {},
  async start() {},
  async stop() {},
  async dispose() {},
});
`,
    });
    writeMigration(
      directory,
      '0001-init.sql',
      'CREATE TABLE a_items (id INTEGER PRIMARY KEY, label TEXT NOT NULL);',
    );
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(stateOf(registry, 'a')).toBe('RUNNING');
    expect(calls()).toEqual(['a:rows:1']);
    await registry.stop();
  });

  it('fails only the module whose migration is invalid', async () => {
    const bad = writeModule('bad');
    writeMigration(bad, '0001-init.sql', 'CREATE TABLE other_items (id INTEGER PRIMARY KEY);');
    writeModule('good');
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().get('bad')).toMatchObject({ state: 'FAILED', failedAt: 'register' });
    expect(registry.status().get('bad')?.error).toMatch(/module bad migration 0001-init failed/);
    expect(calls()).not.toContain('bad:register');
    expect(stateOf(registry, 'good')).toBe('RUNNING');
    await registry.stop();
  });

  it('config.set updates config.get immediately', async () => {
    writeModule('a', {
      rawSource: `${recorder()}
${VALID_SCHEMA}
export default () => {
  let context;
  return {
    async register(ctx) { context = ctx; },
    async initialize() {
      context.config.set({ greeting: 'hello' });
      calls.push('a:config:' + JSON.stringify(context.config.get()));
    },
    async start() {},
    async stop() {},
    async dispose() {},
  };
};
`,
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(stateOf(registry, 'a')).toBe('RUNNING');
    expect(calls()).toEqual(['a:config:{"greeting":"hello"}']);
    const row = db.prepare('SELECT settings FROM module_config WHERE module_id = ?').get('a') as
      { settings: string } | undefined;
    expect(JSON.parse(row?.settings ?? 'null')).toEqual({ greeting: 'hello' });
    await registry.stop();
  });

  it('config.set publishes core.config.changed with the new version', async () => {
    writeModule('a', {
      rawSource: `${recorder()}
${VALID_SCHEMA}
export default () => {
  let context;
  return {
    async register(ctx) { context = ctx; },
    async initialize() { context.config.set({ greeting: 'hello' }); },
    async start() {},
    async stop() {},
    async dispose() {},
  };
};
`,
    });
    const received: unknown[] = [];
    bus.subscribeFromCore('core.config.changed', (event) => {
      received.push(event.payload);
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    await bus.idle();
    expect(received).toEqual([{ moduleId: 'a', version: 1 }]);
    await registry.stop();
  });

  it('publishes core.module.state.changed on every transition', async () => {
    writeModule('a');
    const states: unknown[] = [];
    bus.subscribeFromCore('core.module.state.changed', (event) => {
      states.push(event.payload);
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    await bus.idle();
    expect(states).toContainEqual({ moduleId: 'a', state: 'RUNNING' });
    await registry.stop();
    await bus.idle();
    expect(states).toContainEqual({ moduleId: 'a', state: 'STOPPED' });
  });

  it('exposes the permissions declared by the loaded manifests', async () => {
    writeModule('a', { manifest: { permissions: ['a.item.use'] } });
    writeModule('b', { manifest: { permissions: ['b.item.use', 'b.item.edit'] } });
    const registry = createRegistry();
    await registry.load();
    expect([...registry.declaredPermissions()].sort()).toEqual([
      'a.item.use',
      'b.item.edit',
      'b.item.use',
    ]);
  });

  it('config.set before initialize throws', async () => {
    writeModule('a', {
      rawSource: `${recorder()}
${VALID_SCHEMA}
export default () => ({
  async register(ctx) {
    try {
      ctx.config.set({ greeting: 'hello' });
      calls.push('a:set:ok');
    } catch (error) {
      calls.push('a:set:' + error.message);
    }
  },
  async initialize() {},
  async start() {},
  async stop() {},
  async dispose() {},
});
`,
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(calls()).toEqual(['a:set:Settings of module "a" are only available from initialize()']);
    await registry.stop();
  });

  it('guild is gated by the manifest capabilities', async () => {
    const source = (id: string): string => `${recorder()}
export default () => {
  let context;
  return {
    async register(ctx) { context = ctx; },
    async initialize() {},
    async start() {
      try {
        const result = await context.guild.kick('111111111111111111', 'test');
        calls.push(${JSON.stringify(id)} + ':kick:' + JSON.stringify(result));
      } catch (error) {
        calls.push(${JSON.stringify(id)} + ':kick:' + error.name);
      }
    },
    async stop() {},
    async dispose() {},
  };
};
`;
    writeModule('plain', { rawSource: source('plain') });
    writeModule('mod', {
      rawSource: source('mod'),
      manifest: { capabilities: ['guild.moderate'] },
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect([...calls()].sort()).toEqual(['mod:kick:{"ok":true}', 'plain:kick:CapabilityError']);
    await registry.stop();
  });

  describe('services of a module that is no longer active', () => {
    const contextKey = (): string => `${callsKey}_context`;
    const writeServicesModule = (throwInStart: boolean): void => {
      const directory = writeModule('a', {
        manifest: { capabilities: ['guild.moderate'] },
        rawSource: `${VALID_SCHEMA}
export default () => ({
  async register(ctx) { globalThis[${JSON.stringify(contextKey())}] = ctx; },
  async initialize() {},
  async start() { ${throwInStart ? "throw new Error('start failed');" : ''} },
  async stop() {},
  async dispose() {},
});
`,
      });
      writeMigration(directory, '0001-init.sql', 'CREATE TABLE a_items (id INTEGER PRIMARY KEY);');
    };
    const takeContext = (): ModuleContext => {
      const record = globalThis as unknown as Record<string, ModuleContext | undefined>;
      const context = record[contextKey()];
      Reflect.deleteProperty(globalThis, contextKey());
      if (context === undefined) throw new Error('context not captured');
      return context;
    };
    const expectRefused = async (context: ModuleContext): Promise<void> => {
      const timeout = vi.spyOn(fakeGuild, 'timeout');
      const roles = vi.spyOn(fakeGuild, 'getMemberRoleIds');
      try {
        await expect(context.guild.timeout('111111111111111111', 60_000, 'test')).resolves.toEqual({
          ok: false,
          error: 'failed',
        });
        await expect(context.guild.getMemberRoleIds('111111111111111111')).resolves.toBe(undefined);
        expect(timeout).not.toHaveBeenCalled();
        expect(roles).not.toHaveBeenCalled();
      } finally {
        timeout.mockRestore();
        roles.mockRestore();
      }
      expect(logger.calls).toContainEqual({
        level: 'warn',
        obj: { module: 'a', action: 'timeout' },
        msg: 'guild action refused: module is not active',
      });
      const inactive = 'Module "a" is not active';
      expect(() => {
        context.config.set({ greeting: 'hello' });
      }).toThrow(inactive);
      expect(() => context.storage.run('INSERT INTO a_items (id) VALUES (1)')).toThrow(inactive);
      expect(() => context.storage.transaction(() => 1)).toThrow(inactive);
      expect(context.storage.get('SELECT COUNT(*) AS n FROM a_items')).toEqual({ n: 0 });
    };

    it('refuses guild, config.set and storage writes after the module failed', async () => {
      writeServicesModule(true);
      const registry = createRegistry();
      await registry.load();
      await registry.start();
      expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'start' });
      await expectRefused(takeContext());
      await registry.stop();
    });

    it('refuses guild, config.set and storage writes after the module stopped', async () => {
      writeServicesModule(false);
      const registry = createRegistry();
      await registry.load();
      await registry.start();
      const context = takeContext();
      expect(context.storage.run('INSERT INTO a_items (id) VALUES (1)').changes).toBe(1);
      context.storage.run('DELETE FROM a_items');
      await registry.stop();
      await expectRefused(context);
    });
  });
});

describe('ModuleRegistry operations', () => {
  const OWNER = { userId: '444444444444444444', roleIds: [], isOwner: true };
  const PASS_SCHEMA = '{ safeParse: (value) => ({ success: true, data: value }) }';
  const contextKey = (id: string): string => `${callsKey}_${id}_context`;
  const takeContext = (id: string): ModuleContext => {
    const record = globalThis as unknown as Record<string, ModuleContext | undefined>;
    const context = record[contextKey(id)];
    Reflect.deleteProperty(globalThis, contextKey(id));
    if (context === undefined) throw new Error('context not captured');
    return context;
  };
  const operationModule = (
    id: string,
    options: { throwInStart?: boolean; registerBody?: string } = {},
  ): void => {
    writeModule(id, {
      manifest: { permissions: [`${id}.items.write`] },
      rawSource: `export const configSchema = { safeParse: (value) => ({ success: true, data: { greeting: 'hi', ...value } }) };
export default () => ({
  async register(ctx) {
    globalThis[${JSON.stringify(contextKey(id))}] = ctx;
    ${
      options.registerBody ??
      `ctx.operations.register({
      name: '${id}.items.mine',
      permission: null,
      input: ${PASS_SCHEMA},
      handler: async (actor, input) => ({ ok: true, data: { module: '${id}', input } }),
    });`
    }
  },
  async initialize() {},
  async start() { ${options.throwInStart === true ? "throw new Error('start failed');" : ''} },
  async stop() {},
  async dispose() {},
});
`,
    });
  };

  it('exposes the operations of a running module and drops them when it stops', async () => {
    operationModule('a');
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.operations.names()).toEqual(['a.items.mine']);
    await expect(
      registry.operations.execute('a.items.mine', OWNER, { n: 1 }, 'dashboard'),
    ).resolves.toEqual({ ok: true, data: { module: 'a', input: { n: 1 } } });
    await registry.stop();
    expect(registry.operations.names()).toEqual([]);
    await expect(
      registry.operations.execute('a.items.mine', OWNER, {}, 'dashboard'),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('drops the operations of a module that fails', async () => {
    operationModule('a', { throwInStart: true });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'start' });
    expect(registry.operations.names()).toEqual([]);
    await registry.stop();
  });

  it('lets a module execute only its own operations, with source discord', async () => {
    operationModule('a');
    operationModule('b');
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    const context = takeContext('a');
    takeContext('b');
    await expect(context.operations.execute('b.items.mine', OWNER, {})).resolves.toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Operação desconhecida.' },
    });
    await expect(context.operations.execute('a.items.mine', OWNER, {})).resolves.toMatchObject({
      ok: true,
    });
    expect(logger.calls.map((call) => call.obj)).toContainEqual({
      module: 'a',
      operation: 'a.items.mine',
      source: 'discord',
      result: 'ok',
    });
    await registry.stop();
  });

  it('fails a module that swallows an invalid operation error', async () => {
    operationModule('a', {
      registerBody: `try {
      ctx.operations.register({ name: 'other.items.mine', permission: null, input: ${PASS_SCHEMA}, handler: async () => ({ ok: true, data: null }) });
    } catch {}`,
    });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'register' });
    expect(registry.status().get('a')?.error).toMatch(/other\.items\.mine/);
    expect(registry.operations.names()).toEqual([]);
    await registry.stop();
  });

  it('refuses an operation registered after register()', async () => {
    operationModule('a', { registerBody: '' });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    const context = takeContext('a');
    expect(() => {
      context.operations.register({
        name: 'a.items.mine',
        permission: null,
        input: { safeParse: (value: unknown) => ({ success: true, data: value }) },
        handler: () => Promise.resolve({ ok: true, data: null }),
      });
    }).toThrow(InvalidOperationError);
    expect(registry.operations.names()).toEqual([]);
    await registry.stop();
  });

  it('config.set with a wrong expectedVersion throws and does not write', async () => {
    operationModule('a', { registerBody: '' });
    const registry = createRegistry();
    await registry.load();
    await registry.start();
    const context = takeContext('a');
    expect(context.config.version()).toBe(0);
    context.config.set({ greeting: 'one' }, 0);
    expect(context.config.version()).toBe(1);
    context.config.set({ greeting: 'two' });
    expect(context.config.version()).toBe(2);
    expect(() => {
      context.config.set({ greeting: 'three' }, 1);
    }).toThrow(ConfigVersionConflictError);
    expect(context.config.version()).toBe(2);
    expect(context.config.get()).toEqual({ greeting: 'two' });
    const row = db.prepare('SELECT settings FROM module_config WHERE module_id = ?').get('a') as
      { settings: string } | undefined;
    expect(JSON.parse(row?.settings ?? 'null')).toEqual({ greeting: 'two' });
    await registry.stop();
  });
});

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

  it('rejects an entrypoint reached through a linked directory that points outside', async () => {
    const outsideDir = path.join(tempDir, 'outside');
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'index.ts'), 'export default () => ({});\n');
    const directory = writeModule('a', { manifest: { entrypoint: 'sub/index.ts' } });
    // A junction needs no privileges on Windows; the type is ignored on other systems.
    fs.symlinkSync(outsideDir, path.join(directory, 'sub'), 'junction');
    expect(() => resolveEntrypoint(directory, 'sub/index.ts')).toThrow(/outside/);

    const registry = createRegistry();
    await registry.load();
    expect(registry.status().get('a')).toMatchObject({ state: 'FAILED', failedAt: 'import' });
    expect(registry.status().get('a')?.error).toMatch(/outside the module directory/);
  });
});
