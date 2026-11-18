import { domainToASCII } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractLinks, normalizeDomain, parentDomains } from '../detection/links.ts';

describe('normalizeDomain', () => {
  it('lowercases and strips scheme, path, www and trailing dot', () => {
    expect(normalizeDomain('https://Golpe.COM/abc')).toBe('golpe.com');
    expect(normalizeDomain('www.discord.com.')).toBe('discord.com');
  });

  it('converts Unicode domains to the xn-- form', () => {
    const domain = normalizeDomain('\u0501iscord.com');
    expect(domain).toBe(domainToASCII('\u0501iscord.com'));
    expect(domain).toMatch(/^xn--/);
  });

  it('rejects invalid input and bad TLDs', () => {
    expect(normalizeDomain('a.b')).toBeUndefined();
    expect(normalizeDomain('1.5')).toBeUndefined();
    expect(normalizeDomain('v1.2.3')).toBeUndefined();
    expect(normalizeDomain('localhost')).toBeUndefined();
    expect(normalizeDomain('')).toBeUndefined();
    expect(normalizeDomain('a.' + 'x'.repeat(25))).toBeUndefined();
    expect(normalizeDomain('a.' + 'x'.repeat(24))).toBe('a.' + 'x'.repeat(24));
  });
});

describe('parentDomains', () => {
  it('lists the domain and its parents down to two labels', () => {
    expect(parentDomains('a.b.golpe.com')).toEqual(['a.b.golpe.com', 'b.golpe.com', 'golpe.com']);
    expect(parentDomains('golpe.com')).toEqual(['golpe.com']);
  });
});

describe('extractLinks', () => {
  it('extracts scheme URLs, scheme-less domains and angle-bracket links', () => {
    expect(extractLinks('olha https://Golpe.COM/abc')).toEqual([{ domain: 'golpe.com' }]);
    expect(extractLinks('entra em discord-gift.com/abc agora')).toEqual([
      { domain: 'discord-gift.com' },
    ]);
    expect(extractLinks('<https://x.gift>')).toEqual([{ domain: 'x.gift' }]);
    expect(extractLinks('veja www.discord.com.')).toEqual([{ domain: 'discord.com' }]);
  });

  it('extracts Unicode domains in xn-- form', () => {
    const links = extractLinks('acesse \u0501iscord.com/nitro');
    expect(links).toEqual([{ domain: domainToASCII('\u0501iscord.com') }]);
    expect(links[0]?.domain).toMatch(/^xn--/);
  });

  it('detects masked markdown links', () => {
    expect(extractLinks('[discord.com/nitro](https://golpe.gift)')).toEqual([
      { domain: 'golpe.gift', maskedTextDomain: 'discord.com' },
    ]);
    expect(extractLinks('[clique aqui](https://golpe.gift)')).toEqual([{ domain: 'golpe.gift' }]);
    expect(extractLinks('[golpe.gift](https://golpe.gift/x)')).toEqual([{ domain: 'golpe.gift' }]);
  });

  it('does not treat versions, decimals, short TLDs or emails as links', () => {
    expect(extractLinks('v1.2.3 e 1.5 e a.b')).toEqual([]);
    expect(extractLinks('fale com email@exemplo.com')).toEqual([]);
    expect(extractLinks('fale com joao.silva@exemplo.com.br')).toEqual([]);
  });

  it('extracts file-like names (scoring decides later)', () => {
    expect(extractLinks('abre arquivo.txt')).toEqual([{ domain: 'arquivo.txt' }]);
  });

  it('deduplicates unmasked links but keeps masked ones, in order', () => {
    expect(extractLinks('b.com a.com b.com')).toEqual([{ domain: 'b.com' }, { domain: 'a.com' }]);
    expect(extractLinks('a.com [x.com](https://a.com) [y.com](https://a.com)')).toEqual([
      { domain: 'a.com' },
      { domain: 'a.com', maskedTextDomain: 'x.com' },
      { domain: 'a.com', maskedTextDomain: 'y.com' },
    ]);
  });

  it('caps at 20 links', () => {
    const content = Array.from({ length: 25 }, (_, i) => `site${String(i)}.com`).join(' ');
    const links = extractLinks(content);
    expect(links).toHaveLength(20);
    expect(links[0]).toEqual({ domain: 'site0.com' });
  });

  it('scans only the first 4000 characters', () => {
    expect(extractLinks('a'.repeat(4001) + ' https://golpe.com')).toEqual([]);
    expect(extractLinks('https://golpe.com ' + 'a'.repeat(5000))).toEqual([
      { domain: 'golpe.com' },
    ]);
  });
});
