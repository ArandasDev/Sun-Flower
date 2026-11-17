import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRecordingLogger,
  type RecordingLogger,
} from '../../tests/helpers/recording-logger.ts';
import { installShutdownHandlers } from './shutdown.ts';

class FakeProcess extends EventEmitter {
  readonly exitCodes: number[] = [];

  exit(code: number): void {
    this.exitCodes.push(code);
  }
}

const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

let proc: FakeProcess;
let logger: RecordingLogger;

beforeEach(() => {
  proc = new FakeProcess();
  logger = createRecordingLogger();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('installShutdownHandlers', () => {
  it('runs shutdown once and exits 0 on signals', async () => {
    const shutdown = vi.fn(async () => {});
    installShutdownHandlers(proc, shutdown, logger);

    proc.emit('SIGINT');
    proc.emit('SIGINT');
    proc.emit('SIGTERM');
    await settle();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(proc.exitCodes).toEqual([0]);
  });

  it('exits only after the shutdown promise settles', async () => {
    let finish: () => void = () => {};
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    installShutdownHandlers(proc, shutdown, logger);

    proc.emit('SIGTERM');
    await settle();
    expect(proc.exitCodes).toEqual([]);

    finish();
    await settle();
    expect(proc.exitCodes).toEqual([0]);
  });

  it.each(['uncaughtException', 'unhandledRejection'])(
    'logs fatal and exits 1 on %s',
    async (event) => {
      const shutdown = vi.fn(async () => {});
      installShutdownHandlers(proc, shutdown, logger);

      proc.emit(event, new Error('boom'));
      await settle();

      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(proc.exitCodes).toEqual([1]);
      const fatal = logger.entries.filter((e) => e.level === 'fatal');
      expect(fatal).toHaveLength(1);
      expect(fatal[0]?.obj).toMatchObject({ error: 'boom' });
    },
  );

  it('ignores a signal that arrives after a fatal error', async () => {
    const shutdown = vi.fn(async () => {});
    installShutdownHandlers(proc, shutdown, logger);

    proc.emit('unhandledRejection', 'not an error');
    proc.emit('SIGINT');
    await settle();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(proc.exitCodes).toEqual([1]);
    expect(logger.entries.find((e) => e.level === 'fatal')?.obj).toMatchObject({
      error: 'not an error',
    });
  });

  it('logs a failing shutdown and still exits with 1', async () => {
    const shutdown = vi.fn(async () => {
      await Promise.resolve();
      throw new Error('stop failed');
    });
    installShutdownHandlers(proc, shutdown, logger);

    proc.emit('SIGINT');
    await settle();

    expect(proc.exitCodes).toEqual([1]);
    const errors = logger.entries.filter((e) => e.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toMatchObject({ error: 'stop failed' });
  });

  it('logs a second fatal error at error level without running shutdown again', async () => {
    let finish: () => void = () => {};
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    installShutdownHandlers(proc, shutdown, logger);

    proc.emit('SIGTERM');
    proc.emit('uncaughtException', new Error('late'));
    proc.emit('unhandledRejection', 'later');
    finish();
    await settle();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(proc.exitCodes).toEqual([0]);
    expect(logger.entries.filter((e) => e.level === 'fatal')).toEqual([]);
    const errors = logger.entries.filter((e) => e.level === 'error');
    expect(errors.map((e) => e.obj)).toEqual([
      expect.objectContaining({ event: 'uncaughtException', error: 'late' }),
      expect.objectContaining({ event: 'unhandledRejection', error: 'later' }),
    ]);
  });

  it('starts the same once-only path through trigger with the given exit code', async () => {
    const shutdown = vi.fn(async () => {});
    const handle = installShutdownHandlers(proc, shutdown, logger);

    handle.trigger(1);
    proc.emit('SIGINT');
    handle.trigger(0);
    await settle();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(proc.exitCodes).toEqual([1]);
  });

  it('exits 1 after the deadline when shutdown never settles', async () => {
    vi.useFakeTimers();
    const shutdown = vi.fn(() => new Promise<void>(() => {}));
    installShutdownHandlers(proc, shutdown, logger);

    proc.emit('SIGINT');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(proc.exitCodes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(proc.exitCodes).toEqual([1]);
    expect(logger.entries.filter((e) => e.level === 'error').map((e) => e.msg)).toEqual([
      'shutdown timed out',
    ]);
    proc.emit('SIGTERM');
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('uses an injected deadline', async () => {
    vi.useFakeTimers();
    const shutdown = vi.fn(() => new Promise<void>(() => {}));
    installShutdownHandlers(proc, shutdown, logger, { timeoutMs: 100 });

    proc.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);
    expect(proc.exitCodes).toEqual([1]);
  });

  it('clears the deadline when shutdown settles normally', async () => {
    vi.useFakeTimers();
    const shutdown = vi.fn(async () => {});
    installShutdownHandlers(proc, shutdown, logger);

    proc.emit('SIGINT');
    await vi.advanceTimersByTimeAsync(0);
    expect(proc.exitCodes).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(proc.exitCodes).toEqual([0]);
    expect(logger.entries.filter((e) => e.level === 'error')).toEqual([]);
  });
});
