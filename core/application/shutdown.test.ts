import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../shared/contracts/logger.ts';
import { installShutdownHandlers } from './shutdown.ts';

interface Entry {
  readonly level: string;
  readonly obj: object | string;
}

type RecordingLogger = Logger & { readonly entries: Entry[] };

function createRecordingLogger(): RecordingLogger {
  const entries: Entry[] = [];
  const record =
    (level: string) =>
    (obj: object | string): void => {
      entries.push({ level, obj });
    };
  const logger: RecordingLogger = {
    entries,
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
});
