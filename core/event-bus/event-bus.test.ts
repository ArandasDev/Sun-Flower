import { describe, expect, it } from 'vitest';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { ModuleManifest } from '../../shared/contracts/module.ts';
import type { SunFlowerEvent } from '../../shared/contracts/events.ts';
import { EventBus, UndeclaredEventError } from './event-bus.ts';

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

function manifest(id: string, subscribes: string[], publishes: string[]): ModuleManifest {
  return {
    id,
    name: id,
    description: id,
    version: '1.0.0',
    apiVersion: '1.0.0',
    entrypoint: 'index.ts',
    dependencies: [],
    permissions: [],
    capabilities: [],
    enabledByDefault: true,
    events: { subscribes, publishes },
  };
}

const producer = manifest('producer', [], ['producer.item.created']);
const consumer = manifest('consumer', ['producer.item.created'], []);
const consumerB = manifest('other', ['producer.item.created'], []);

function setup(options?: { handlerTimeoutMs?: number; maxDepth?: number }) {
  const logger = createRecordingLogger();
  const bus = new EventBus(logger, { handlerTimeoutMs: 20, ...options });
  return { logger, bus };
}

describe('EventBus', () => {
  it('delivers to subscribers without blocking the publisher', async () => {
    const { bus } = setup();
    const received: SunFlowerEvent[] = [];
    bus.forModule(consumer).subscribe('producer.item.created', (e) => {
      received.push(e);
    });
    bus.forModule(producer).publish('producer.item.created', { n: 1 }, { userId: 'u1' });
    expect(received).toEqual([]);
    await bus.idle();
    expect(received).toHaveLength(1);
    const [event] = received;
    expect(event).toMatchObject({
      type: 'producer.item.created',
      version: 1,
      source: 'producer',
      context: { userId: 'u1' },
      payload: { n: 1 },
    });
    expect(event?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(event?.timestamp ?? ''))).toBe(false);
  });

  it('defaults the context to an empty object', async () => {
    const { bus } = setup();
    let context: unknown;
    bus.forModule(consumer).subscribe('producer.item.created', (e) => {
      context = e.context;
    });
    bus.forModule(producer).publish('producer.item.created', {});
    await bus.idle();
    expect(context).toEqual({});
  });

  it('isolates a failing and a hanging consumer', async () => {
    const { bus, logger } = setup();
    const received: string[] = [];
    const failing = manifest('failing', ['producer.item.created'], []);
    const hanging = manifest('hanging', ['producer.item.created'], []);
    bus.forModule(failing).subscribe('producer.item.created', () => {
      throw new Error('boom');
    });
    bus.forModule(hanging).subscribe('producer.item.created', () => new Promise<void>(() => {}));
    bus.forModule(consumer).subscribe('producer.item.created', (e) => {
      received.push(e.source);
    });
    bus.forModule(producer).publish('producer.item.created', {});
    await bus.idle();
    expect(received).toEqual(['producer']);
    const errors = logger.calls.filter((c) => c.level === 'error');
    expect(errors).toHaveLength(2);
    const byModule = new Map(errors.map((c) => [(c.obj as { module: string }).module, c.obj]));
    expect(byModule.get('failing')).toMatchObject({
      event: 'producer.item.created',
      error: 'boom',
    });
    expect(byModule.get('hanging')).toMatchObject({ event: 'producer.item.created' });
    expect((byModule.get('hanging') as { error: string }).error).toContain('timed out');
  });

  it('rejects publishing or subscribing to undeclared events', () => {
    const { bus } = setup();
    expect(() => {
      bus.forModule(producer).publish('producer.other.created', {});
    }).toThrow(UndeclaredEventError);
    expect(() => {
      bus.forModule(consumer).subscribe('x.y.z', () => {});
    }).toThrow(UndeclaredEventError);
    expect(new UndeclaredEventError('m', 'x').name).toBe('UndeclaredEventError');
  });

  it('rejects publishing a declared event without the module id prefix', () => {
    const { bus } = setup();
    const foreign = manifest('intruder', [], ['producer.item.created']);
    expect(() => {
      bus.forModule(foreign).publish('producer.item.created', {});
    }).toThrow(UndeclaredEventError);
  });

  it('publishFromCore delivers discord.* to declared subscribers with source core', async () => {
    const { bus } = setup();
    const listener = manifest('listener', ['discord.message.created'], []);
    const bystander = manifest('bystander', ['producer.item.created'], []);
    const received: SunFlowerEvent[] = [];
    const other: SunFlowerEvent[] = [];
    bus.forModule(listener).subscribe('discord.message.created', (e) => {
      received.push(e);
    });
    bus.forModule(bystander).subscribe('producer.item.created', (e) => {
      other.push(e);
    });
    bus.publishFromCore('discord.message.created', { n: 1 }, { channelId: 'c1' });
    bus.publishFromCore('discord.message.created', { n: 2 });
    expect(received).toEqual([]);
    await bus.idle();
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({
      type: 'discord.message.created',
      version: 1,
      source: 'core',
      context: { channelId: 'c1' },
      payload: { n: 1 },
    });
    expect(received[1]?.context).toEqual({});
    expect(other).toEqual([]);
  });

  it('publishFromCore rejects other prefixes', () => {
    const { bus } = setup();
    expect(() => {
      bus.publishFromCore('producer.item.created', {});
    }).toThrow(UndeclaredEventError);
    expect(() => {
      bus.publishFromCore('discordx.message.created', {});
    }).toThrow(/Module "core"/);
  });

  it('drops events beyond the maximum depth', async () => {
    const { bus, logger } = setup({ maxDepth: 3 });
    const loop = manifest('loop', ['loop.tick'], ['loop.tick']);
    const handle = bus.forModule(loop);
    let deliveries = 0;
    handle.subscribe('loop.tick', () => {
      deliveries += 1;
      handle.publish('loop.tick', {});
    });
    handle.publish('loop.tick', {});
    await bus.idle();
    expect(deliveries).toBe(3);
    const warns = logger.calls.filter((c) => c.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.obj).toMatchObject({ event: 'loop.tick' });
    expect(warns[0]?.obj).not.toHaveProperty('type');
  });

  it('stops delivering after unsubscribeAll, only for that module', async () => {
    const { bus } = setup();
    const received: string[] = [];
    const a = bus.forModule(consumer);
    const b = bus.forModule(consumerB);
    a.subscribe('producer.item.created', () => {
      received.push('consumer');
    });
    b.subscribe('producer.item.created', () => {
      received.push('other');
    });
    a.unsubscribeAll();
    bus.forModule(producer).publish('producer.item.created', {});
    await bus.idle();
    expect(received).toEqual(['other']);
  });

  it('does not deliver already scheduled events after unsubscribeAll', async () => {
    const { bus } = setup();
    const received: string[] = [];
    const a = bus.forModule(consumer);
    a.subscribe('producer.item.created', () => {
      received.push('consumer');
    });
    bus.forModule(producer).publish('producer.item.created', {});
    a.unsubscribeAll();
    await bus.idle();
    expect(received).toEqual([]);
  });

  it('idle waits for handlers scheduled by other handlers', async () => {
    const { bus } = setup();
    const chain = manifest('chain', ['chain.a', 'chain.b'], ['chain.a', 'chain.b']);
    const handle = bus.forModule(chain);
    const seen: string[] = [];
    handle.subscribe('chain.a', () => {
      seen.push('a');
      handle.publish('chain.b', {});
    });
    handle.subscribe('chain.b', () => {
      seen.push('b');
    });
    handle.publish('chain.a', {});
    await bus.idle();
    expect(seen).toEqual(['a', 'b']);
  });

  it('idle resolves even when the logger throws while reporting a handler failure', async () => {
    const throwingLogger: Logger = {
      ...createRecordingLogger(),
      error: () => {
        throw new Error('logger unavailable');
      },
    };
    const bus = new EventBus(throwingLogger, { handlerTimeoutMs: 20 });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      bus.forModule(consumer).subscribe('producer.item.created', () => {
        throw new Error('handler failed');
      });
      bus.forModule(producer).publish('producer.item.created', {});
      const outcome = await Promise.race([
        bus.idle().then(() => 'idle'),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 200)),
      ]);
      expect(outcome).toBe('idle');
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
