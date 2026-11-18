import { describe, expect, it } from 'vitest';

import { DEFAULT_BAIT_TERMS, DEFAULT_WEIGHTS, configSchema } from '../config.ts';

describe('moderation configSchema', () => {
  it('turns {} into the full default configuration', () => {
    expect(configSchema.parse({})).toEqual({
      timeoutMinutes: 60,
      thresholds: { confirmed: 80, suspicious: 40 },
      weights: DEFAULT_WEIGHTS,
      exemptRoleIds: [],
      newAccountDays: 7,
      newMemberHours: 24,
      multiChannel: { channels: 3, windowSeconds: 60 },
      baitTerms: DEFAULT_BAIT_TERMS,
    });
  });

  it('fills missing inner keys of nested objects', () => {
    const parsed = configSchema.parse({ thresholds: { confirmed: 90 }, weights: { bait: 5 } });
    expect(parsed.thresholds).toEqual({ confirmed: 90, suspicious: 40 });
    expect(parsed.weights).toEqual({ ...DEFAULT_WEIGHTS, bait: 5 });
  });

  it('rejects confirmed not greater than suspicious, reporting thresholds', () => {
    const result = configSchema.safeParse({ thresholds: { confirmed: 40, suspicious: 40 } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['thresholds']);
  });

  it('rejects timeoutMinutes above 40320', () => {
    expect(configSchema.safeParse({ timeoutMinutes: 40321 }).success).toBe(false);
  });

  it('rejects a malformed alertChannelId and accepts a snowflake', () => {
    expect(configSchema.safeParse({ alertChannelId: 'abc' }).success).toBe(false);
    expect(configSchema.safeParse({ alertChannelId: '222222222222222222' }).success).toBe(true);
  });

  it('rejects malformed exemptRoleIds', () => {
    expect(configSchema.safeParse({ exemptRoleIds: ['nope'] }).success).toBe(false);
  });

  it('strips unknown keys', () => {
    expect(configSchema.parse({ legacy: 1 })).not.toHaveProperty('legacy');
  });
});
