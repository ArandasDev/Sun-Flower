import { domainToASCII } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_DOMAINS,
  PROTECTED_BRANDS,
  isLookalike,
  levenshtein,
  skeleton,
} from '../detection/lookalike.ts';

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
});

describe('skeleton', () => {
  it('maps confusables and strips separators', () => {
    expect(skeleton('\u0501iscord')).toBe('discord');
    expect(skeleton('d1scord-n1tro.com')).toBe('dlscordnltrocom');
    expect(skeleton('rnicrosoft')).toBe('microsoft');
    expect(skeleton('vvorld')).toBe('world');
    expect(skeleton('st3am5')).toBe('steams');
  });
});

describe('official data', () => {
  it('flattens official domains', () => {
    expect(PROTECTED_BRANDS.map((b) => b.brand)).toEqual(['discord', 'steam']);
    expect(OFFICIAL_DOMAINS).toContain('discord.gift');
    expect(OFFICIAL_DOMAINS).toContain('steamstatic.com');
  });
});

describe('isLookalike', () => {
  it.each([
    'dlscord.gift',
    'discord-nitro.com',
    'discordapp.co',
    'steamcomunity.com',
    'stearncommunity.com',
    domainToASCII('\u0501iscord.com'),
    'discord.com.golpe.ru',
    'disco.com', // accepted false positive (distance 2)
  ])('flags %s', (domain) => {
    expect(isLookalike(domain)).toBe(true);
  });

  it.each([
    'discord.com',
    'cdn.discordapp.com',
    'media.discordapp.net',
    'steamcommunity.com',
    'github.com',
    'record.com',
    'dis.com',
    '192.168.0.1',
  ])('does not flag %s', (domain) => {
    expect(isLookalike(domain)).toBe(false);
  });
});
