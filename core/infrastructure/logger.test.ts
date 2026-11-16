import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.ts';

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

  it('redacts tokens in child bindings', () => {
    const entry = logOnce((l) => {
      l.child({ token: 'fake' }).info('x');
    });
    expect(entry).toMatchObject({ token: '[REDACTED]' });
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
