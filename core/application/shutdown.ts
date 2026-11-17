import type { Logger } from '../../shared/contracts/logger.ts';

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

export interface ShutdownProcess {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): void;
}

export interface ShutdownOptions {
  /** Time `shutdown` has to settle before the process exits with code 1. */
  readonly timeoutMs?: number;
}

export interface ShutdownHandle {
  /** Starts the once-only shutdown path with `code`; ignored if shutdown already started. */
  trigger(code: number): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `shutdown` once on the first `SIGINT`/`SIGTERM` (exit 0), the first
 * `uncaughtException`/`unhandledRejection` (logged as `fatal`, exit 1) or the first
 * `trigger(code)`. Later signals are ignored; later fatal errors are logged at `error` level
 * but do not run `shutdown` again. `exit` is called only after `shutdown` settles; if it
 * rejects, the failure is logged and the exit code is 1. If it does not settle within
 * `timeoutMs`, the timeout is logged and the process exits with code 1.
 */
export function installShutdownHandlers(
  proc: ShutdownProcess,
  shutdown: () => Promise<void>,
  logger: Logger,
  options: ShutdownOptions = {},
): ShutdownHandle {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  let started = false;
  let exited = false;

  const exit = (code: number): void => {
    if (exited) return;
    exited = true;
    proc.exit(code);
  };

  const run = (code: number): void => {
    if (started) return;
    started = true;
    let exitCode = code;
    const deadline = setTimeout(() => {
      logger.error({ timeoutMs }, 'shutdown timed out');
      exit(1);
    }, timeoutMs);
    deadline.unref();
    shutdown()
      .catch((error: unknown) => {
        logger.error({ error: errorMessage(error) }, 'shutdown failed');
        exitCode = 1;
      })
      .finally(() => {
        clearTimeout(deadline);
        exit(exitCode);
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
      if (started) {
        logger.error({ event, error: errorMessage(error) }, 'fatal error during shutdown');
        return;
      }
      logger.fatal({ event, error: errorMessage(error) }, 'fatal error, shutting down');
      run(1);
    });
  }

  return { trigger: run };
}
