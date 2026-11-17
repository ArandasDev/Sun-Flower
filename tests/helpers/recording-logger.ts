import type { Logger } from '../../shared/contracts/logger.ts';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  readonly level: LogLevel;
  readonly obj: object | string;
  readonly msg: string | undefined;
}

export interface RecordingLogger extends Logger {
  readonly entries: LogEntry[];
}

/** Test double that records every log call instead of writing output. */
export function createRecordingLogger(): RecordingLogger {
  const entries: LogEntry[] = [];
  const record =
    (level: LogLevel) =>
    (obj: object | string, msg?: string): void => {
      entries.push({ level, obj, msg });
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
