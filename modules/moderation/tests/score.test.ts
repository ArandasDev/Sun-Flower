import { describe, expect, it } from 'vitest';

import { configSchema } from '../config.ts';
import type { ModerationConfig } from '../config.ts';
import { parentDomains } from '../detection/links.ts';
import { OFFICIAL_DOMAINS } from '../detection/lookalike.ts';
import { MultiChannelTracker } from '../detection/multi-channel.ts';
import { analyzeMessage } from '../detection/score.ts';
import type { AnalysisInput, DomainLists } from '../detection/score.ts';
import { KNOWN_SAFE_DOMAINS } from '../known-safe.ts';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const OLD_ACCOUNT = '2020-01-01T00:00:00.000Z';
const NEW_ACCOUNT = '2026-06-12T12:00:00.000Z';

const lists: DomainLists = {
  isBlocked: (d) => d === 'golpe.gift' || d.endsWith('.golpe.gift'),
  isAllowed: (d) => ['discord.com', 'github.com'].some((a) => d === a || d.endsWith(`.${a}`)),
};

function baseInput(content: string, over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    content,
    authorId: '111111111111111111',
    channelId: '222222222222222222',
    authorAccountCreatedAt: OLD_ACCOUNT,
    authorJoinedAt: null,
    now: NOW,
    ...over,
  };
}

function run(
  content: string,
  over: Partial<AnalysisInput> = {},
  config: ModerationConfig = configSchema.parse({}),
  tracker = new MultiChannelTracker(),
) {
  return analyzeMessage(baseInput(content, over), { lists, config, tracker });
}

const names = (content: string, over: Partial<AnalysisInput> = {}) =>
  run(content, over).signals.map((s) => s.name);

describe('analyzeMessage', () => {
  it('confirms a blocked subdomain', () => {
    const r = run('olha https://x.golpe.gift/a');
    expect(r.score).toBe(100);
    expect(r.level).toBe('confirmed');
    expect(r.domains).toEqual(['x.golpe.gift']);
  });

  it('blocked wins when the domain is also allowed', () => {
    const both: DomainLists = { isBlocked: () => true, isAllowed: () => true };
    const r = analyzeMessage(baseInput('https://a.com'), {
      lists: both,
      config: configSchema.parse({}),
      tracker: new MultiChannelTracker(),
    });
    expect(r.score).toBe(100);
    expect(r.domains).toEqual(['a.com']);
  });

  it('lookalike plus bait confirms', () => {
    const r = run('dlscord.gift nitro');
    expect(r.score).toBe(90);
    expect(r.level).toBe('confirmed');
  });

  it('lookalike alone is suspicious', () => {
    const r = run('dlscord.gift');
    expect(r.score).toBe(60);
    expect(r.level).toBe('suspicious');
  });

  it('flags masked links', () => {
    const r = run('[discord.com](https://golpe2.gift)');
    expect(r.signals).toEqual([{ name: 'masked', points: 40 }]);
  });

  it('flags mass mention with a non-allowed link only', () => {
    expect(names('@everyone https://exemplo.org')).toContain('massMention');
    expect(names('@here https://exemplo.org')).toContain('massMention');
    expect(names('@everyone https://discord.com/x')).toEqual([]);
    expect(names('@everyone')).toEqual([]);
  });

  it('flags new accounts and recent joiners', () => {
    expect(names('https://exemplo.org', { authorAccountCreatedAt: NEW_ACCOUNT })).toContain(
      'newAccount',
    );
    expect(names('https://exemplo.org', { authorJoinedAt: '2026-06-15T06:00:00.000Z' })).toContain(
      'newAccount',
    );
    expect(names('https://exemplo.org', { authorJoinedAt: null })).not.toContain('newAccount');
    expect(names('https://exemplo.org', { authorJoinedAt: '2026-06-01T00:00:00.000Z' })).toEqual(
      [],
    );
  });

  it('scores zero without a non-allowed link', () => {
    const r = run('ganhei nitro grátis');
    expect(r.score).toBe(0);
    expect(r.level).toBeUndefined();
    expect(run('nitro https://discord.com/x').score).toBe(0);
    expect(run('https://github.com/x', { authorAccountCreatedAt: NEW_ACCOUNT }).score).toBe(0);
  });

  it('new account with a plain link is 15 and has no level', () => {
    const r = run('exemplo.org', { authorAccountCreatedAt: NEW_ACCOUNT });
    expect(r.score).toBe(15);
    expect(r.level).toBeUndefined();
  });

  it('counts each signal once with several triggering links', () => {
    const r = run(
      'dlscord.gift dlscord.com [discord.com](https://a1.org) [discord.com](https://b1.org)',
    );
    expect(r.signals.filter((s) => s.name === 'lookalike')).toHaveLength(1);
    expect(r.signals.filter((s) => s.name === 'masked')).toHaveLength(1);
    expect(r.domains).toEqual(['a1.org', 'b1.org', 'dlscord.gift', 'dlscord.com']);
  });

  it('uses weights and thresholds from config', () => {
    const config = configSchema.parse({
      weights: { lookalike: 10 },
      thresholds: { confirmed: 20, suspicious: 5 },
    });
    const r = run('dlscord.gift', {}, config);
    expect(r.score).toBe(10);
    expect(r.level).toBe('suspicious');
    const r2 = run('dlscord.gift nitro', {}, config);
    expect(r2.score).toBe(40);
    expect(r2.level).toBe('confirmed');
  });

  it('matches bait terms ignoring case and accents, whole words only', () => {
    expect(names('exemplo.org GRÁTIS')).toContain('bait');
    expect(names('exemplo.org gratis')).toContain('bait');
    expect(names('exemplo.org nitros')).not.toContain('bait');
    expect(names('exemplo.org gratisx')).not.toContain('bait');
  });

  it('fires multiChannel across channels', () => {
    const tracker = new MultiChannelTracker();
    const config = configSchema.parse({});
    run('https://exemplo.org', { channelId: 'c1' }, config, tracker);
    run('https://exemplo.org', { channelId: 'c2' }, config, tracker);
    const r = run('https://exemplo.org', { channelId: 'c3' }, config, tracker);
    expect(r.signals.map((s) => s.name)).toContain('multiChannel');
    expect(r.score).toBe(50);
  });

  it('scores an empty message as zero', () => {
    expect(run('')).toEqual({ score: 0, level: undefined, signals: [], domains: [] });
  });

  it('analyzes at most 20 links without throwing', () => {
    const links = Array.from({ length: 30 }, (_, i) => `https://site${String(i)}.org`).join(' ');
    const content = `${links} ${'x'.repeat(5000)}`.slice(0, 5000);
    expect(content).toHaveLength(5000);
    const r = run(content);
    expect(r.domains).toHaveLength(20);
  });
});

describe('analyzeMessage hardening', () => {
  it('ignores text after the scan limit', () => {
    const pad = ' '.repeat(4000);
    const r = run(`https://exemplo.org${pad}@everyone nitro`);
    const found = r.signals.map((s) => s.name);
    expect(found).not.toContain('massMention');
    expect(found).not.toContain('bait');
  });

  it('handles 100000 dot-less characters quickly', () => {
    const start = performance.now();
    const r = run('a'.repeat(100_000));
    expect(performance.now() - start).toBeLessThan(200);
    expect(r.score).toBe(0);
  });

  it('folds accents on either side', () => {
    const lax = (terms: string[]) => configSchema.parse({ baitTerms: terms });
    expect(
      run('GRATIS https://exemplo.org', {}, lax(['grátis'])).signals.map((s) => s.name),
    ).toContain('bait');
    expect(
      run('grátis https://exemplo.org', {}, lax(['gratis'])).signals.map((s) => s.name),
    ).toContain('bait');
  });

  it('ignores invisible characters inside bait terms', () => {
    expect(names('ni\u200Btro https://exemplo.org')).toContain('bait');
    expect(names('ni\u00ADtro https://exemplo.org')).toContain('bait');
  });

  it('gives no signal to a masked link pointing to an allowed domain', () => {
    const r = run('[golpe.gift](https://discord.com)');
    expect(r.score).toBe(0);
    expect(r.signals).toEqual([]);
  });
});

describe('analyzeMessage with the seeded lists', () => {
  const seeded = new Set<string>([...OFFICIAL_DOMAINS, ...KNOWN_SAFE_DOMAINS]);
  const seededLists: DomainLists = {
    isBlocked: () => false,
    isAllowed: (d) => parentDomains(d).some((p) => seeded.has(p)),
  };
  const score = (content: string) =>
    analyzeMessage(baseInput(content), {
      lists: seededLists,
      config: configSchema.parse({}),
      tracker: new MultiChannelTracker(),
    }).score;

  it.each([
    'steam: https://s.team/a/123',
    'promoção na steam, olha no steamdb.info',
    'veja steamcharts.com e a steam',
    'dá uma olhada no https://steamdb.info/sales e compra na steam',
    'free fire hoje? link: https://discord.js.org/docs',
    'ganhei de presente o disco.amei demais',
    'o resgate do disco.tá aqui',
  ])('does not confirm the ordinary message %s', (content) => {
    expect(score(content)).toBeLessThan(80);
  });

  it('still confirms real phishing', () => {
    expect(score('free nitro https://dlscord-gift.com/x')).toBeGreaterThanOrEqual(80);
    expect(score('steam gift https://steamcomunity.com/trade')).toBeGreaterThanOrEqual(80);
  });
});

describe('analyzeMessage brand names as bait', () => {
  it('does not count a protected brand name as bait', () => {
    expect(names('steam https://steamcomunity.com/trade')).not.toContain('bait');
    expect(names('discord dlscord.gift')).not.toContain('bait');
    expect(names('steam gift https://steamcomunity.com/trade')).toContain('bait');
    expect(names('steam dlscord.gift')).not.toContain('bait');
  });
});

describe('analyzeMessage link budget', () => {
  it('analyzes the clickable link even after 20 bare fillers', () => {
    const fillers = Array.from({ length: 20 }, (_, i) => `a${String(i + 1)}.discord.com`).join(' ');
    const r = run(`${fillers} free nitro https://dlscord-gift.com/x`);
    expect(r.level).toBe('confirmed');
    expect(r.domains).toEqual(['dlscord-gift.com']);
  });

  it('analyzes at most 20 distinct non-allowed domains', () => {
    const links = Array.from({ length: 30 }, (_, i) => `https://site${String(i)}.org`).join(' ');
    const r = run(links);
    expect(r.domains).toHaveLength(20);
    expect(r.domains[0]).toBe('site0.org');
  });

  it('skips allowed domains before applying the cap', () => {
    const allowed = Array.from({ length: 25 }, (_, i) => `https://x${String(i)}.discord.com`);
    const r = run(`${allowed.join(' ')} https://golpe.gift`);
    expect(r.domains).toEqual(['golpe.gift']);
  });
});
