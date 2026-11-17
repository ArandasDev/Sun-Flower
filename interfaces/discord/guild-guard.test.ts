import { describe, expect, it } from 'vitest';

import { isAllowedInteraction, leaveUnauthorizedGuilds } from './guild-guard.ts';
import { createRecordingLogger } from '../../tests/helpers/recording-logger.ts';

const allowed = '000000000000000000';
const other = '111111111111111111';

function fakeGuilds(ids: readonly string[], left: string[], failing: readonly string[] = []) {
  return ids.map((id) => ({
    id,
    leave: async (): Promise<void> => {
      await Promise.resolve();
      if (failing.includes(id)) {
        throw new Error('leave failed');
      }
      left.push(id);
    },
  }));
}

describe('leaveUnauthorizedGuilds', () => {
  it('leaves every guild except the allowed one', async () => {
    const logger = createRecordingLogger();
    const left: string[] = [];
    const guilds = fakeGuilds([allowed, other], left);

    expect(await leaveUnauthorizedGuilds(guilds, allowed, logger)).toBe(true);
    expect(left).toEqual([other]);
    expect(logger.entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('returns false when the allowed guild is absent', async () => {
    const logger = createRecordingLogger();
    const left: string[] = [];

    expect(await leaveUnauthorizedGuilds(fakeGuilds([other], left), allowed, logger)).toBe(false);
    expect(left).toEqual([other]);
  });

  it('logs a leave failure and continues with the remaining guilds', async () => {
    const logger = createRecordingLogger();
    const left: string[] = [];
    const third = '222222222222222222';
    const guilds = fakeGuilds([other, allowed, third], left, [other]);

    expect(await leaveUnauthorizedGuilds(guilds, allowed, logger)).toBe(true);
    expect(left).toEqual([third]);
    expect(logger.entries.some((e) => e.level === 'error')).toBe(true);
  });

  it('never logs guild IDs', async () => {
    const logger = createRecordingLogger();
    const guilds = fakeGuilds([other, allowed], [], [other]).concat(
      fakeGuilds(['222222222222222222'], []),
    );

    await leaveUnauthorizedGuilds(guilds, allowed, logger);
    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toContain(other);
    expect(logged).not.toContain('222222222222222222');
    expect(logged).not.toContain(allowed);
  });
});

describe('isAllowedInteraction', () => {
  it('accepts interactions from the allowed guild', () => {
    expect(isAllowedInteraction({ guildId: allowed }, allowed)).toBe(true);
  });

  it('ignores interactions from other guilds and DMs', () => {
    expect(isAllowedInteraction({ guildId: null }, allowed)).toBe(false);
    expect(isAllowedInteraction({ guildId: other }, allowed)).toBe(false);
  });
});
