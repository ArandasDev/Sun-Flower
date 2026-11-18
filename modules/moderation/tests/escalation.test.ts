import { describe, expect, it } from 'vitest';
import type { Punishment } from '../config.ts';
import {
  escalationStep,
  formatSteps,
  mostSevere,
  parseSteps,
  severity,
} from '../spam/escalation.ts';

const t = (minutes: number): Punishment => ({ kind: 'timeout', minutes });
const kick: Punishment = { kind: 'kick' };
const ban: Punishment = { kind: 'ban' };
const none: Punishment = { kind: 'none' };

describe('severity and mostSevere', () => {
  it('orders none < timeout < kick < ban', () => {
    expect(mostSevere(kick, ban)).toEqual(ban);
    expect(mostSevere(t(40320), kick)).toEqual(kick);
    expect(mostSevere(t(10), t(60))).toEqual(t(60));
    expect(mostSevere(none, t(1))).toEqual(t(1));
    expect(severity(none)).toBe(0);
  });

  it('returns none with no arguments and keeps the first on ties', () => {
    expect(mostSevere()).toEqual(none);
    const a = t(10);
    const b = t(10);
    expect(mostSevere(a, b)).toBe(a);
  });
});

describe('escalationStep', () => {
  const steps = [t(10), t(60), ban];

  it('picks the step by prior count, capped at the last', () => {
    expect(escalationStep(steps, 0)).toEqual({ step: 1, punishment: t(10) });
    expect(escalationStep(steps, 1)).toEqual({ step: 2, punishment: t(60) });
    expect(escalationStep(steps, 2)).toEqual({ step: 3, punishment: ban });
    expect(escalationStep(steps, 5)).toEqual({ step: 3, punishment: ban });
  });
});

describe('parseSteps', () => {
  it('parses minutes, hours, kick and ban', () => {
    expect(parseSteps('10m,1h,ban')).toEqual([t(10), t(60), ban]);
    expect(parseSteps('kick')).toEqual([kick]);
    expect(parseSteps('05m')).toEqual([t(5)]);
  });

  it('ignores spaces and case', () => {
    expect(parseSteps('10M, 1H , BAN')).toEqual(parseSteps('10m,1h,ban'));
  });

  it('rejects invalid input', () => {
    for (const bad of [
      '',
      '10x',
      '0m',
      '40321m',
      '0h',
      '673h',
      '10m,,ban',
      'none',
      '1.5h',
      '-1m',
    ]) {
      expect(parseSteps(bad)).toBeUndefined();
    }
    expect(parseSteps('1m,1m,1m,1m,1m,1m')).toBeUndefined();
    expect(parseSteps('1m,1m,1m,1m,1m')).toHaveLength(5);
    expect(parseSteps('672h')).toEqual([t(40320)]);
  });
});

describe('formatSteps', () => {
  it('formats hours only when divisible by 60', () => {
    expect(formatSteps(parseSteps('90m,ban') ?? [])).toBe('90m,ban');
    expect(formatSteps([t(60), t(10), kick, ban])).toBe('1h,10m,kick,ban');
  });
});
