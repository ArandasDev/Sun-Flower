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
  // With `recent` the logger must let info through even if the configured level is higher;
  // each stream filters on its own level, so the destination keeps `options.level`.
  const loggerLevel =
    recent !== undefined && pino.levels.values[options.level]! > pino.levels.values.info!
      ? 'info'
      : options.level;
  const destination =
    recent === undefined
      ? options.destination
      : pino.multistream([
          { level: options.level, stream: options.destination ?? pino.destination(1) },
          { level: 'info', stream: { write: (line: string) => recent.write(line) } },
        ]);
  return pino(
    {
      level: loggerLevel,
      base: { service: 'sun-flower' },
      redact: {
        // pino has no recursive wildcard: only these fixed depths are covered.
        // token, content and the other secret keys: depth 0-2; authorization: depth 0-1, plus headers.authorization
        // at depth 1-2.
        paths: [
          'content',
          '*.content',
          '*.*.content',
          'token',
          '*.token',
          '*.*.token',
          'accesstoken',
          '*.accesstoken',
          '*.*.accesstoken',
          'accessToken',
          '*.accessToken',
          '*.*.accessToken',
          'refreshtoken',
          '*.refreshtoken',
          '*.*.refreshtoken',
          'refreshToken',
          '*.refreshToken',
          '*.*.refreshToken',
          'clientsecret',
          '*.clientsecret',
          '*.*.clientsecret',
          'clientSecret',
          '*.clientSecret',
          '*.*.clientSecret',
          'access_token',
          '*.access_token',
          '*.*.access_token',
          'refresh_token',
          '*.refresh_token',
          '*.*.refresh_token',
          'client_secret',
          '*.client_secret',
          '*.*.client_secret',
          'id_token',
          '*.id_token',
          '*.*.id_token',
          'cookie',
          '*.cookie',
          '*.*.cookie',
          'csrftoken',
          '*.csrftoken',
          '*.*.csrftoken',
          'csrfToken',
          '*.csrfToken',
          '*.*.csrfToken',
          'secret',
          '*.secret',
          '*.*.secret',
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
