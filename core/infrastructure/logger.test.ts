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

  it('respects the level', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', destination: sink(lines) });
    logger.info('ignored');
    expect(lines).toHaveLength(0);
    logger.warn('kept');
    expect(lines).toHaveLength(1);
  });
});
