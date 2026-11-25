import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.ts';
import { RecentLogs } from './recent-logs.ts';

function line(level: number, msg: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ level, time: 1_700_000_000_000, msg, ...extra });
}

function silentSink(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function realLogger(): { logger: ReturnType<typeof createLogger>; recent: RecentLogs } {
  const recent = new RecentLogs();
  const logger = createLogger({ level: 'info', destination: silentSink(), recent });
  return { logger, recent };
}

describe('RecentLogs', () => {
  it('keeps at most 500 entries and drops the oldest', () => {
    const recent = new RecentLogs();
    for (let i = 0; i < 510; i += 1) recent.write(line(30, `m${String(i)}`));
    const all = recent.recent({ limit: 1000, minLevel: 'info' });
    expect(all).toHaveLength(500);
    expect(all[0]?.message).toBe('m509');
    expect(all[499]?.message).toBe('m10');
  });

  it('ignores debug and unknown levels', () => {
    const recent = new RecentLogs();
    recent.write(line(20, 'debug'));
    recent.write(line(10, 'trace'));
    recent.write(line(35, 'odd'));
    expect(recent.recent({ limit: 10, minLevel: 'info' })).toHaveLength(0);
  });

  it('maps pino levels to names and combines minLevel with limit', () => {
    const recent = new RecentLogs();
    recent.write(line(30, 'a'));
    recent.write(line(40, 'b'));
    recent.write(line(50, 'c'));
    recent.write(line(60, 'd'));
    expect(recent.recent({ limit: 10, minLevel: 'warn' }).map((e) => e.level)).toEqual([
      'fatal',
      'error',
      'warn',
    ]);
    expect(recent.recent({ limit: 2, minLevel: 'warn' }).map((e) => e.message)).toEqual(['d', 'c']);
    expect(recent.recent({ limit: 0, minLevel: 'info' })).toHaveLength(1);
  });

  it('ignores invalid lines without throwing', () => {
    const recent = new RecentLogs();
    expect(() => {
      recent.write('not json');
      recent.write('[1,2]');
      recent.write('null');
      recent.write('');
    }).not.toThrow();
    expect(recent.recent({ limit: 10, minLevel: 'info' })).toHaveLength(0);
  });

  it('splits multi-line writes', () => {
    const recent = new RecentLogs();
    recent.write(`${line(30, 'one')}\n${line(30, 'two')}\n`);
    expect(recent.recent({ limit: 10, minLevel: 'info' }).map((e) => e.message)).toEqual([
      'two',
      'one',
    ]);
  });

  it('sanitises through the real logger', () => {
    const { logger, recent } = realLogger();
    logger.info(
      {
        userId: '123456789012345678',
        token: 'abc',
        content: 'oi',
        long: 'x'.repeat(400),
        nested: { a: 1 },
        list: [1],
      },
      'x',
    );
    const [entry] = recent.recent({ limit: 1, minLevel: 'info' });
    expect(entry?.fields).toMatchObject({
      userId: '[id]',
      token: '[REDACTED]',
      content: '[REDACTED]',
      nested: '[objeto]',
      list: '[objeto]',
    });
    expect((entry?.fields.long as string).length).toBe(300);
    for (const key of ['pid', 'hostname', 'service', 'level', 'time', 'msg', 'module']) {
      expect(entry?.fields).not.toHaveProperty(key);
    }
    expect(new Date(entry?.time ?? '').toISOString()).toBe(entry?.time);
  });

  it('cuts the message and masks ids in it', () => {
    const recent = new RecentLogs();
    recent.write(line(30, `user 123456789012345678 ${'y'.repeat(400)}`));
    const [entry] = recent.recent({ limit: 1, minLevel: 'info' });
    expect(entry?.message.startsWith('user [id] ')).toBe(true);
    expect(entry?.message).toHaveLength(300);
  });

  it('takes module from the top-level field', () => {
    const { logger, recent } = realLogger();
    logger.child({ module: 'ping' }).warn('hi');
    const [entry] = recent.recent({ limit: 1, minLevel: 'info' });
    expect(entry).toMatchObject({ module: 'ping', level: 'warn', message: 'hi' });
  });
});
