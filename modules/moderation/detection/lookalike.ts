import { domainToUnicode } from 'node:url';

export const PROTECTED_BRANDS: readonly { brand: string; official: readonly string[] }[] = [
  {
    brand: 'discord',
    official: [
      'discord.com',
      'discord.gg',
      'discordapp.com',
      'discordapp.net',
      'discord.media',
      'discord.new',
      'discord.gift',
      'discordstatus.com',
    ],
  },
  {
    brand: 'steam',
    official: ['steamcommunity.com', 'steampowered.com', 'steamstatic.com'],
  },
];

export const OFFICIAL_DOMAINS: readonly string[] = PROTECTED_BRANDS.flatMap((b) => b.official);

const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ԁ: 'd',
  ѕ: 's',
  // Greek
  α: 'a',
  ο: 'o',
  ρ: 'p',
  ν: 'v',
  // Digits
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '5': 's',
};

/** Reduces a value to a Latin-lookalike form with '-' and '.' removed. */
export function skeleton(value: string): string {
  let out = '';
  for (const ch of value.toLowerCase()) {
    if (ch === '-' || ch === '.') continue;
    out += CONFUSABLES[ch] ?? ch;
  }
  return out.replaceAll('rn', 'm').replaceAll('vv', 'w');
}

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

function isOfficial(domain: string): boolean {
  return OFFICIAL_DOMAINS.some((o) => domain === o || domain.endsWith(`.${o}`));
}

function mainLabel(unicodeDomain: string): string {
  const labels = unicodeDomain.split('.');
  return labels.length >= 2 ? (labels[labels.length - 2] ?? '') : (labels[0] ?? '');
}

const MIN_LABEL_LETTERS = 4;

const DISTANCE_TARGETS: readonly string[] = [
  ...PROTECTED_BRANDS.map((b) => b.brand),
  ...OFFICIAL_DOMAINS.map((o) => mainLabel(o)),
];

/** True when the domain imitates a protected brand without being official. */
export function isLookalike(domain: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return false;
  if (isOfficial(domain)) return false;

  const unicode = domainToUnicode(domain).toLowerCase();
  const whole = skeleton(unicode);
  if (PROTECTED_BRANDS.some((b) => whole.includes(b.brand))) return true;

  const label = skeleton(mainLabel(unicode));
  if (label.length < MIN_LABEL_LETTERS) return false;
  return DISTANCE_TARGETS.some((target) => {
    const d = levenshtein(label, target);
    return d >= 1 && d <= 2;
  });
}
