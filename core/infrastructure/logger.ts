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
        paths: ['token', '*.token', 'authorization', '*.authorization'],
        censor: '[REDACTED]',
      },
    },
    options.destination,
  );
}
