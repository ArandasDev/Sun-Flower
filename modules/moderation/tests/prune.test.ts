import { describe, expect, it } from 'vitest';

import { configSchema } from '../config.ts';
import { activityMaxAgeMs } from '../index.ts';

const spamOf = (spam: Record<string, unknown>) => configSchema.parse({ spam }).spam;

describe('activityMaxAgeMs', () => {
  it('uses the longest detection window when nothing deletes further back', () => {
    const spam = spamOf({
      flood: { deleteMinutes: 0 },
      repeat: { seconds: 600, deleteMinutes: 0 },
      mentions: { deleteMinutes: 0 },
    });
    expect(activityMaxAgeMs(spam)).toBe(600_000);
  });

  it('caps a 60-minute deletion window at one hour', () => {
    expect(activityMaxAgeMs(spamOf({ mentions: { deleteMinutes: 60 } }))).toBe(3_600_000);
    expect(activityMaxAgeMs(spamOf({ flood: { deleteMinutes: 60 } }))).toBe(3_600_000);
  });

  it('uses the longest deletion window by default', () => {
    expect(activityMaxAgeMs(spamOf({}))).toBe(600_000);
  });
});
