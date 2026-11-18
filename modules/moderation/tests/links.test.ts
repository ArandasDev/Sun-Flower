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

  it('deduplicates unmasked links but keeps masked ones, clickable first', () => {
    expect(extractLinks('b.com a.com b.com')).toEqual([{ domain: 'b.com' }, { domain: 'a.com' }]);
    expect(extractLinks('a.com [x.com](https://a.com) [y.com](https://a.com)')).toEqual([
      { domain: 'a.com', maskedTextDomain: 'x.com' },
      { domain: 'a.com', maskedTextDomain: 'y.com' },
      { domain: 'a.com' },
    ]);
  });

  it('scans only the first 4000 characters', () => {
    expect(extractLinks('a'.repeat(4001) + ' https://golpe.com')).toEqual([]);
    expect(extractLinks('https://golpe.com ' + 'a'.repeat(5000))).toEqual([
      { domain: 'golpe.com' },
    ]);
  });

  it('survives trailing punctuation and markdown decoration', () => {
    for (const text of [
      '**https://golpe.gift**',
      '||https://golpe.gift||',
      '__https://golpe.gift__',
      'acesse https://golpe.gift, rapido',
      'acesse https://golpe.gift!',
      'https://golpe.gift\u2026',
      '**golpe.gift**',
      '||golpe.gift||',
      'golpe.gift, clique',
      'golpe.gift!',
    ]) {
      expect(extractLinks(text), text).toEqual([{ domain: 'golpe.gift' }]);
    }
  });

  it('keeps maskedTextDomain through decoration, case and titles', () => {
    for (const text of [
      '[**discord.com**](https://golpe.gift)',
      '[discord.com!](https://golpe.gift)',
      '[discord.com](HTTPS://golpe.gift)',
      '[discord.com](https://golpe.gift "t")',
    ]) {
      expect(extractLinks(text), text).toEqual([
        { domain: 'golpe.gift', maskedTextDomain: 'discord.com' },
      ]);
    }
  });

  it('treats the host after userinfo as the domain', () => {
    expect(extractLinks('https://discord.com@golpe.gift')).toEqual([{ domain: 'golpe.gift' }]);
  });

  it('treats IPv4 hosts with a scheme as links, bare ones not', () => {
    expect(extractLinks('https://1.2.3.4/nitro')).toEqual([{ domain: '1.2.3.4' }]);
    expect(extractLinks('[discord.com](https://1.2.3.4/nitro)')).toEqual([
      { domain: '1.2.3.4', maskedTextDomain: 'discord.com' },
    ]);
    expect(extractLinks('1.2.3.4 e v1.2.3')).toEqual([]);
    expect(parentDomains('1.2.3.4')).toEqual(['1.2.3.4']);
  });

  it('canonicalizes hosts like a browser', () => {
    for (const text of [
      'https://golpe\u3002gift',
      'https://golpe\uFF0Egift',
      'https://golpe\uFF61gift',
      'https://golpe%2Egift',
      'https://gol\u00ADpe.gift',
      'golpe\u3002gift',
      'gol\u00ADpe.gift',
    ]) {
      expect(extractLinks(text), text).toEqual([{ domain: 'golpe.gift' }]);
    }
    expect(extractLinks('https://16843009/')).toEqual([{ domain: '1.1.1.1' }]);
    expect(extractLinks('https://0x7f.0.0.1/')).toEqual([{ domain: '127.0.0.1' }]);
    expect(extractLinks('https://01.2.3.4/')).toEqual([{ domain: '1.2.3.4' }]);
  });
});

describe('extractLinks bare TLD rule', () => {
  it('accepts bare tokens with a ccTLD or a common gTLD', () => {
    for (const domain of ['golpe.gift', 'dlscord.ru', 'exemplo.com.br', 'site.xyz', 'a.gg']) {
      expect(extractLinks(`veja ${domain}`), domain).toEqual([{ domain }]);
    }
  });

  it('rejects bare tokens with other or Unicode TLDs', () => {
    expect(extractLinks('ganhei de presente o disco.amei demais')).toEqual([]);
    expect(extractLinks('o resgate do disco.tá aqui')).toEqual([]);
    expect(extractLinks('abre arquivo.txt')).toEqual([]);
    expect(extractLinks('golpe.xn--p1ai')).toEqual([]);
  });

  it('keeps any valid TLD for scheme and markdown URLs', () => {
    expect(extractLinks('https://disco.amei/x')).toEqual([{ domain: 'disco.amei' }]);
    expect(extractLinks('[aqui](https://arquivo.txt)')).toEqual([{ domain: 'arquivo.txt' }]);
  });
});

describe('extractLinks order and cap', () => {
  it('returns clickable links before bare tokens', () => {
    expect(extractLinks('a.com https://b.com [c.com](https://d.com) e.com')).toEqual([
      { domain: 'b.com' },
      { domain: 'd.com', maskedTextDomain: 'c.com' },
      { domain: 'a.com' },
      { domain: 'e.com' },
    ]);
  });

  it('has no candidate cap', () => {
    const content = Array.from({ length: 60 }, (_, i) => `site${String(i)}.com`).join(' ');
    const links = extractLinks(content);
    expect(links).toHaveLength(60);
    expect(links[0]).toEqual({ domain: 'site0.com' });
  });

  it('deduplicates masked links by domain and text domain', () => {
    const same = Array.from({ length: 50 }, () => '[a.com](https://discord.com)').join(' ');
    expect(extractLinks(`${same} [b.com](https://discord.com)`)).toEqual([
      { domain: 'discord.com', maskedTextDomain: 'a.com' },
      { domain: 'discord.com', maskedTextDomain: 'b.com' },
    ]);
  });
});
