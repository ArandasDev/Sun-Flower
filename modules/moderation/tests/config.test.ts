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
      spam: configSchema.parse({}).spam,
    });
  });

  it('ships the spec §4.4 bait terms, without the inert brand name steam', () => {
    expect(DEFAULT_BAIT_TERMS).toEqual([
      'nitro',
      'free',
      'grátis',
      'gratis',
      'gift',
      'presente',
      'airdrop',
      'giveaway',
      'sorteio',
      'claim',
      'resgate',
    ]);
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

describe('moderation configSchema spam block', () => {
  const spam = (value: unknown) => configSchema.safeParse({ spam: value });

  it('defaults to the spec §4.4 values', () => {
    expect(configSchema.parse({}).spam).toEqual({
      ignoredChannelIds: [],
      flood: {
        enabled: true,
        limit: 7,
        seconds: 5,
        deleteMinutes: 2,
        punishment: 'timeout',
        timeoutMinutes: 10,
      },
      repeat: {
        enabled: true,
        limit: 4,
        seconds: 60,
        deleteMinutes: 10,
        punishment: 'timeout',
        timeoutMinutes: 10,
      },
      mentions: {
        enabled: true,
        limit: 6,
        deleteMinutes: 0,
        punishment: 'timeout',
        timeoutMinutes: 10,
      },
      escalation: {
        enabled: true,
        windowHours: 24,
        steps: [
          { kind: 'timeout', minutes: 10 },
          { kind: 'timeout', minutes: 60 },
          { kind: 'ban' },
        ],
      },
    });
  });

  it('rejects out-of-range limits and delete windows', () => {
    expect(spam({ flood: { limit: 1 } }).success).toBe(false);
    expect(spam({ flood: { limit: 51 } }).success).toBe(false);
    expect(spam({ flood: { limit: 50 } }).success).toBe(true);
    expect(spam({ repeat: { deleteMinutes: 61 } }).success).toBe(false);
    expect(spam({ mentions: { deleteMinutes: 60 } }).success).toBe(true);
    expect(spam({ flood: { seconds: 1 } }).success).toBe(false);
    expect(spam({ flood: { seconds: 601 } }).success).toBe(false);
    expect(spam({ flood: { punishment: 'mute' } }).success).toBe(false);
  });

  it('rejects empty or oversized escalation steps', () => {
    expect(spam({ escalation: { steps: [] } }).success).toBe(false);
    const six = Array.from({ length: 6 }, () => ({ kind: 'kick' }));
    expect(spam({ escalation: { steps: six } }).success).toBe(false);
    expect(spam({ escalation: { steps: six.slice(0, 5) } }).success).toBe(true);
    expect(spam({ escalation: { steps: [{ kind: 'none' }] } }).success).toBe(false);
    expect(spam({ escalation: { steps: [{ kind: 'timeout', minutes: 0 }] } }).success).toBe(false);
  });

  it('limits ignoredChannelIds to 25 snowflakes', () => {
    const ids = (n: number) => Array.from({ length: n }, () => '000000000000000000');
    expect(spam({ ignoredChannelIds: ids(25) }).success).toBe(true);
    expect(spam({ ignoredChannelIds: ids(26) }).success).toBe(false);
    expect(spam({ ignoredChannelIds: ['abc'] }).success).toBe(false);
  });
});
