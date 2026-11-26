import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.ts';
import { RecentLogs } from './recent-logs.ts';

function sink(lines: string[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      callback();
    },
  });
}

describe('createLogger', () => {
  it('redacts sensitive fields and keeps module bindings', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'info', destination: sink(lines) });
    logger
      .child({ module: 'ping' })
      .info({ token: 'abc', nested: { authorization: 'xyz' } }, 'hello');
    const entry = JSON.parse(lines[0]!) as unknown;
    expect(entry).toMatchObject({
      service: 'sun-flower',
      module: 'ping',
      msg: 'hello',
      token: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
    });
  });

  function logOnce(fn: (logger: ReturnType<typeof createLogger>) => void): Record<string, unknown> {
    const lines: string[] = [];
    fn(createLogger({ level: 'info', destination: sink(lines) }));
    return JSON.parse(lines[0]!) as Record<string, unknown>;
  }

  it('redacts authorization at depth 2', () => {
    const entry = logOnce((l) => {
      l.info({ err: { headers: { authorization: 'Bearer fake' } } }, 'x');
    });
    expect(entry).toMatchObject({ err: { headers: { authorization: '[REDACTED]' } } });
  });

  it('redacts capitalised Authorization headers', () => {
    const entry = logOnce((l) => {
      l.info({ config: { headers: { Authorization: 'Bearer fake' } } }, 'x');
    });
    expect(entry).toMatchObject({ config: { headers: { Authorization: '[REDACTED]' } } });
  });

  it('redacts a top-level Authorization field', () => {
    const entry = logOnce((l) => {
      l.info({ Authorization: 'Bearer fake' }, 'x');
    });
    expect(entry).toMatchObject({ Authorization: '[REDACTED]' });
  });

  it('redacts tokens two levels deep', () => {
    const entry = logOnce((l) => {
      l.info({ a: { b: { token: 'fake' } } }, 'x');
    });
    expect(entry).toMatchObject({ a: { b: { token: '[REDACTED]' } } });
  });

  it('redacts content at depth 0 to 2', () => {
    const entry = logOnce((l) => {
      l.info({ content: 'zero', a: { content: 'one' }, b: { c: { content: 'two' } } }, 'x');
    });
    expect(entry).toMatchObject({
      content: '[REDACTED]',
      a: { content: '[REDACTED]' },
      b: { c: { content: '[REDACTED]' } },
    });
    expect(JSON.stringify(entry)).not.toMatch(/zero|one|two/);
  });

  it('redacts more secret key names at depth 0 to 2 and keeps code', () => {
    const keys = [
      'accessToken',
      'refreshToken',
      'clientSecret',
      'access_token',
      'refresh_token',
      'client_secret',
      'id_token',
      'cookie',
      'csrfToken',
      'secret',
    ];
    for (const key of keys) {
      const entry = logOnce((l) => {
        l.info({ [key]: 'zero', a: { [key]: 'one' }, b: { c: { [key]: 'two' } } }, 'x');
      });
      expect(entry).toMatchObject({
        [key]: '[REDACTED]',
        a: { [key]: '[REDACTED]' },
        b: { c: { [key]: '[REDACTED]' } },
      });
      expect(JSON.stringify(entry)).not.toMatch(/zero|one|two/);
    }
    const entry = logOnce((l) => {
      l.info({ code: 'E_FAKE', a: { code: 'E_NESTED' } }, 'x');
    });
    expect(entry).toMatchObject({ code: 'E_FAKE', a: { code: 'E_NESTED' } });
  });

  it('redacts tokens in child bindings', () => {
    const entry = logOnce((l) => {
      l.child({ token: 'fake' }).info('x');
    });
    expect(entry).toMatchObject({ token: '[REDACTED]' });
  });

  it('feeds recent at info while the destination keeps its own level', () => {
    const lines: string[] = [];
    const recent = new RecentLogs();
    const logger = createLogger({ level: 'error', destination: sink(lines), recent });
    logger.info('only recent');
    logger.error('both');
    expect(lines).toHaveLength(1);
    expect(recent.recent({ limit: 10, minLevel: 'info' }).map((e) => e.message)).toEqual([
      'both',
      'only recent',
    ]);
  });

  it('keeps debug on the destination but out of recent when the level is debug', () => {
    const lines: string[] = [];
    const recent = new RecentLogs();
    const logger = createLogger({ level: 'debug', destination: sink(lines), recent });
    logger.debug('dbg');
    logger.info('inf');
    expect(lines).toHaveLength(2);
    expect(recent.recent({ limit: 10, minLevel: 'info' }).map((e) => e.message)).toEqual(['inf']);
  });

  it('feeds info to recent but not to the destination when the level is warn', () => {
    const lines: string[] = [];
    const recent = new RecentLogs();
    const logger = createLogger({ level: 'warn', destination: sink(lines), recent });
    logger.info('inf');
    expect(lines).toHaveLength(0);
    expect(recent.recent({ limit: 10, minLevel: 'info' })).toHaveLength(1);
  });

  it('respects the level', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', destination: sink(lines) });
    logger.info('ignored');
    expect(lines).toHaveLength(0);
    logger.warn('kept');
    expect(lines).toHaveLength(1);
  });
});
