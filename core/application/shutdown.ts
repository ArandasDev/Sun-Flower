import type { Logger } from '../../shared/contracts/logger.ts';

export interface ShutdownProcess {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `shutdown` once on the first `SIGINT`/`SIGTERM` (exit 0) or the first
 * `uncaughtException`/`unhandledRejection` (logged as `fatal`, exit 1). Later events are
 * ignored. `exit` is called only after `shutdown` settles; if it rejects, the failure is
 * logged and the exit code is 1.
 */
export function installShutdownHandlers(
  proc: ShutdownProcess,
  shutdown: () => Promise<void>,
  logger: Logger,
): void {
  let started = false;

  const run = (code: number): void => {
    if (started) return;
    started = true;
    let exitCode = code;
    shutdown()
      .catch((error: unknown) => {
        logger.error({ error: errorMessage(error) }, 'shutdown failed');
        exitCode = 1;
      })
      .finally(() => {
        proc.exit(exitCode);
      });
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    proc.on(signal, () => {
      if (!started) logger.info({ signal }, 'shutdown requested');
      run(0);
    });
  }
  for (const event of ['uncaughtException', 'unhandledRejection']) {
    proc.on(event, (error: unknown) => {
      if (started) return;
      logger.fatal({ event, error: errorMessage(error) }, 'fatal error, shutting down');
      run(1);
    });
  }
}
