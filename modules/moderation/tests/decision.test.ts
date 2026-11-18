import { describe, expect, it } from 'vitest';
import { configSchema } from '../config.ts';
import type { ModerationConfig } from '../config.ts';
import { decide } from '../decision.ts';
import type { Analysis } from '../detection/score.ts';
import type { SpamHit } from '../spam/rules.ts';

const MSG = '111111111111111111';

function cfg(overrides: Record<string, unknown> = {}): ModerationConfig {
  return configSchema.parse(overrides);
}

function analysis(level: Analysis['level'], names: string[] = []): Analysis {
  return {
    score: level === 'confirmed' ? 100 : level === 'suspicious' ? 50 : 0,
    level,
    signals: names.map((name) => ({ name, points: 10 })) as Analysis['signals'],
    domains: [],
  };
}

function hit(rule: SpamHit['rule'], messageIds: string[] = [MSG]): SpamHit {
  return { rule, count: 7, messageIds };
}

const none = analysis(undefined);

describe('decide', () => {
  it('reproduces stage 1 for confirmed phishing alone', () => {
    const d = decide({
      analysis: analysis('confirmed', ['blocked', 'bait']),
      spamHits: [],
      config: cfg(),
      priorActionedSpam: 0,
      messageId: MSG,
    });
    expect(d).toEqual({
      level: 'confirmed',
      punishment: { kind: 'timeout', minutes: 60 },
      deleteMinutes: 0,
      deleteMessageIds: [MSG],
      spamHits: [],
      escalationStep: undefined,
      reason: 'phishing: blocked, bait',
    });
  });

  it('reproduces stage 1 for suspicious phishing alone', () => {
    const d = decide({
      analysis: analysis('suspicious', ['bait']),
      spamHits: [],
      config: cfg(),
      priorActionedSpam: 0,
      messageId: MSG,
    });
    expect(d.level).toBe('suspicious');
    expect(d.punishment).toEqual({ kind: 'none' });
    expect(d.deleteMessageIds).toEqual([]);
    expect(d.reason).toBe('phishing: bait');
  });

  it('escalates flood by prior actioned cases', () => {
    const run = (prior: number) =>
      decide({
        analysis: none,
        spamHits: [hit('flood')],
        config: cfg(),
        priorActionedSpam: prior,
        messageId: MSG,
      });
    expect(run(0)).toMatchObject({
      level: 'confirmed',
      punishment: { kind: 'timeout', minutes: 10 },
      escalationStep: 1,
      reason: 'spam: flood',
      deleteMinutes: 2,
    });
    expect(run(1)).toMatchObject({
      punishment: { kind: 'timeout', minutes: 60 },
      escalationStep: 2,
    });
    expect(run(2)).toMatchObject({ punishment: { kind: 'ban' }, escalationStep: 3 });
    expect(run(9)).toMatchObject({ punishment: { kind: 'ban' }, escalationStep: 3 });
  });

  it('keeps a none rule as suspicious without escalation', () => {
    const d = decide({
      analysis: none,
      spamHits: [hit('flood')],
      config: cfg({ spam: { flood: { punishment: 'none' } } }),
      priorActionedSpam: 5,
      messageId: MSG,
    });
    expect(d.level).toBe('suspicious');
    expect(d.punishment).toEqual({ kind: 'none' });
    expect(d.escalationStep).toBeUndefined();
  });

  it('uses only the rule punishment when escalation is disabled', () => {
    const d = decide({
      analysis: none,
      spamHits: [hit('flood')],
      config: cfg({ spam: { escalation: { enabled: false } } }),
      priorActionedSpam: 5,
      messageId: MSG,
    });
    expect(d.punishment).toEqual({ kind: 'timeout', minutes: 10 });
    expect(d.escalationStep).toBeUndefined();
  });

  it('maps kick and ban rule punishments', () => {
    const base = {
      analysis: none,
      spamHits: [hit('mentions')],
      priorActionedSpam: 0,
      messageId: MSG,
    };
    const off = { escalation: { enabled: false } };
    expect(
      decide({ ...base, config: cfg({ spam: { ...off, mentions: { punishment: 'kick' } } }) })
        .punishment,
    ).toEqual({ kind: 'kick' });
    expect(
      decide({ ...base, config: cfg({ spam: { ...off, mentions: { punishment: 'ban' } } }) })
        .punishment,
    ).toEqual({ kind: 'ban' });
  });

  it('merges confirmed phishing and flood into one decision', () => {
    const d = decide({
      analysis: analysis('confirmed', ['lookalike', 'bait']),
      spamHits: [hit('flood')],
      config: cfg({ timeoutMinutes: 120 }),
      priorActionedSpam: 0,
      messageId: MSG,
    });
    expect(d.level).toBe('confirmed');
    expect(d.reason).toBe('spam: flood; phishing: lookalike, bait');
    expect(d.punishment).toEqual({ kind: 'timeout', minutes: 120 });
  });

  it('is suspicious for suspicious phishing plus a none rule', () => {
    const d = decide({
      analysis: analysis('suspicious', ['bait']),
      spamHits: [hit('flood')],
      config: cfg({ spam: { flood: { punishment: 'none' } } }),
      priorActionedSpam: 0,
      messageId: MSG,
    });
    expect(d.level).toBe('suspicious');
    expect(d.punishment).toEqual({ kind: 'none' });
  });

  it('takes the largest deleteMinutes and de-duplicates ids in order', () => {
    const d = decide({
      analysis: none,
      spamHits: [hit('flood', ['a', 'b', MSG]), hit('repeat', ['b', 'c', MSG])],
      config: cfg(),
      priorActionedSpam: 0,
      messageId: MSG,
    });
    expect(d.deleteMinutes).toBe(10);
    expect(d.deleteMessageIds).toEqual(['a', 'b', MSG, 'c']);
    expect(d.reason).toBe('spam: flood, repeat');
  });

  it('always includes the current message id', () => {
    const d = decide({
      analysis: none,
      spamHits: [hit('flood', ['a'])],
      config: cfg(),
      priorActionedSpam: 0,
      messageId: MSG,
    });
    expect(d.deleteMessageIds).toEqual(['a', MSG]);
  });

  describe('ban fallback', () => {
    it('falls back to the rule timeout when escalation reaches a ban', () => {
      const d = decide({
        analysis: none,
        spamHits: [hit('flood')],
        config: cfg(),
        priorActionedSpam: 2,
        messageId: MSG,
      });
      expect(d.punishment).toEqual({ kind: 'ban' });
      expect(d.fallback).toEqual({ kind: 'timeout', minutes: 10 });
    });

    it('takes the most severe non-ban rule punishment', () => {
      const d = decide({
        analysis: none,
        spamHits: [hit('flood'), hit('repeat'), hit('mentions')],
        config: cfg({
          spam: {
            flood: { punishment: 'ban' },
            repeat: { punishment: 'kick' },
            mentions: { timeoutMinutes: 30 },
          },
        }),
        priorActionedSpam: 0,
        messageId: MSG,
      });
      expect(d.punishment).toEqual({ kind: 'ban' });
      expect(d.fallback).toEqual({ kind: 'kick' });
    });

    it('has no fallback when every rule punishment is a ban', () => {
      const d = decide({
        analysis: none,
        spamHits: [hit('flood')],
        config: cfg({ spam: { flood: { punishment: 'ban' } } }),
        priorActionedSpam: 0,
        messageId: MSG,
      });
      expect(d.punishment).toEqual({ kind: 'ban' });
      expect(d.fallback).toBeUndefined();
    });

    it('keeps the phishing timeout as a fallback for confirmed phishing', () => {
      const d = decide({
        analysis: analysis('confirmed', ['blocked']),
        spamHits: [hit('flood')],
        config: cfg({ spam: { flood: { punishment: 'ban' } } }),
        priorActionedSpam: 0,
        messageId: MSG,
      });
      expect(d.fallback).toEqual({ kind: 'timeout', minutes: 60 });
    });

    it('has no fallback when the punishment is not a ban', () => {
      const d = decide({
        analysis: none,
        spamHits: [hit('flood')],
        config: cfg(),
        priorActionedSpam: 0,
        messageId: MSG,
      });
      expect(d.fallback).toBeUndefined();
    });
  });
});
