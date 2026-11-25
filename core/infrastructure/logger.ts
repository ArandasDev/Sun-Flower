import { pino } from 'pino';

import type { LogLevel } from '../configuration/environment.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { RecentLogs } from './recent-logs.ts';

export interface CreateLoggerOptions {
  readonly level: LogLevel;
  readonly destination?: NodeJS.WritableStream;
  /** Also keeps the latest entries (info and above) in memory. */
  readonly recent?: RecentLogs;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { recent } = options;
  // With `recent`, the logger itself must let info through; each stream filters on its own level.
  const loggerLevel = recent === undefined ? options.level : 'info';
  const destination =
    recent === undefined
      ? options.destination
      : pino.multistream([
          { level: options.level, stream: options.destination ?? process.stdout },
          { level: 'info', stream: { write: (line: string) => recent.write(line) } },
        ]);
  return pino(
    {
      level: loggerLevel,
      base: { service: 'sun-flower' },
      redact: {
        // pino has no recursive wildcard: only these fixed depths are covered.
        // token and content: depth 0-2; authorization: depth 0-1, plus headers.authorization
        // at depth 1-2.
        paths: [
          'content',
          '*.content',
          '*.*.content',
          'token',
          '*.token',
          '*.*.token',
          'authorization',
          'Authorization',
          '*.authorization',
          '*.Authorization',
          '*.headers.authorization',
          '*.headers.Authorization',
          '*.*.headers.authorization',
          '*.*.headers.Authorization',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}
