import { pino } from 'pino';

import type { LogLevel } from '../configuration/environment.ts';
import type { Logger } from '../../shared/contracts/logger.ts';

export interface CreateLoggerOptions {
  readonly level: LogLevel;
  readonly destination?: NodeJS.WritableStream;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: { service: 'sun-flower' },
      redact: {
        // pino has no recursive wildcard: only these fixed depths are covered.
        // token: depth 0-2; authorization: depth 0-1, plus headers.authorization at depth 1-2.
        paths: [
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
    options.destination,
  );
}
