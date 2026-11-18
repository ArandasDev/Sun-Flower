import { domainToASCII } from 'node:url';

export interface ExtractedLink {
  domain: string;
  maskedTextDomain?: string;
}

export const MAX_SCANNED_CHARS = 4000;

const MARKDOWN_LINK =
  /\[([^\]]{1,256})\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gi;
const SCHEME_URL = /https?:\/\/[^\s<>)\]"']+/gi;
const BARE_DOMAIN =
  /(?<![@\p{L}\p{N}_.-])((?:[\p{L}\p{N}-]{1,63}\.)+[\p{L}\p{N}-]{2,63})(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}])/giu;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{1,59})$/;

/** Without a scheme, ordinary words like `disco.amei` would read as links: only these TLDs count. */
const BARE_GTLDS: ReadonlySet<string> = new Set(
  (
    'com net org info biz io gg app dev xyz gift link click site online top shop store live tv ' +
    'me co club fun win bet vip pro icu cc ws ru su tk ml ga cf gq buzz monster rest cyou sbs lol pw'
  ).split(' '),
);

function isBareLinkTld(domain: string): boolean {
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return /^[a-z]{2}$/.test(tld) || BARE_GTLDS.has(tld);
}

const DOT_VARIANTS = /[\u3002\uFF0E\uFF61]/g;
const SOFT_HYPHEN = /\u00AD/g;
const TRAILING_DECORATION = /[.,:;!?*_|~\u2026]+$/;

/** Maps dot lookalikes to "." and drops soft hyphens, as a browser would. */
function foldHostChars(text: string): string {
  return text.replace(SOFT_HYPHEN, '').replace(DOT_VARIANTS, '.');
}

function validateHost(rawHost: string, allowIp: boolean): string | undefined {
  const host = rawHost.replace(/\.+$/, '').replace(/^www\./, '');
  if (host === '') return undefined;
  if (allowIp && IPV4.test(host) && host.split('.').every((o) => Number(o) <= 255)) {
    return host;
  }

  const ascii = domainToASCII(host).replace(/^www\./, '');
  if (ascii === '' || ascii.length > 253) return undefined;

  const labels = ascii.split('.');
  if (labels.length < 2) return undefined;
  if (!labels.every((label) => LABEL.test(label))) return undefined;
  if (!TLD.test(labels[labels.length - 1] ?? '')) return undefined;
  return ascii;
}

/** Normalizes a bare domain or URL; undefined if it is not a plausible domain. */
export function normalizeDomain(input: string): string | undefined {
  const text = foldHostChars(input.trim().toLowerCase());
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//.exec(text);
  if (schemeMatch === null) {
    const host = text.split(/[/?#\\]/)[0] ?? '';
    return validateHost(host.slice(host.lastIndexOf('@') + 1).replace(/:\d*$/, ''), false);
  }

  // Scheme URL: let the WHATWG parser canonicalize the host (IDNA mapping,
  // percent-decoding, IPv4 forms, userinfo, port); fall back to a manual cut.
  try {
    const hostname = new URL(text.replace(TRAILING_DECORATION, '')).hostname;
    const viaUrl = validateHost(hostname, true);
    if (viaUrl !== undefined) return viaUrl;
  } catch {
    // fall through to the manual cut
  }
  let host = text.slice(schemeMatch[0].length).split(/[/?#\\]/)[0] ?? '';
  host = host.slice(host.lastIndexOf('@') + 1);
  host = /^[\p{L}\p{N}.-]+/u.exec(host)?.[0] ?? '';
  return validateHost(host, true);
}

/** `a.b.golpe.com` -> `a.b.golpe.com`, `b.golpe.com`, `golpe.com`. */
export function parentDomains(domain: string): string[] {
  if (IPV4.test(domain)) return [domain];
  const labels = domain.split('.');
  const result: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) {
    result.push(labels.slice(i).join('.'));
  }
  return result;
}

interface Found {
  index: number;
  domain: string;
  /** Markdown or scheme URL, as opposed to a bare token. */
  clickable: boolean;
}

function blank(text: string, start: number, length: number): string {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
}

/** Finds scheme URLs and bare domains in `text`, in order of appearance. */
function scanDomains(text: string): Found[] {
  const found: Found[] = [];
  let rest = text;

  for (const match of text.matchAll(SCHEME_URL)) {
    const domain = normalizeDomain(match[0]);
    if (domain !== undefined) found.push({ index: match.index, domain, clickable: true });
    rest = blank(rest, match.index, match[0].length);
  }
  for (const match of rest.matchAll(BARE_DOMAIN)) {
    const domain = normalizeDomain(match[1] ?? '');
    if (domain !== undefined && isBareLinkTld(domain)) {
      found.push({ index: match.index, domain, clickable: false });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

interface Candidate extends Found {
  maskedTextDomain?: string;
}

export function extractLinks(content: string): ExtractedLink[] {
  let text = foldHostChars(content.slice(0, MAX_SCANNED_CHARS));
  const candidates: Candidate[] = [];

  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const domain = normalizeDomain(match[2] ?? '');
    if (domain === undefined) continue;
    const textDomain = scanDomains(match[1] ?? '')[0]?.domain;
    candidates.push({
      index: match.index,
      domain,
      clickable: true,
      ...(textDomain !== undefined && textDomain !== domain
        ? { maskedTextDomain: textDomain }
        : {}),
    });
  }
  for (const match of [...text.matchAll(MARKDOWN_LINK)].reverse()) {
    text = blank(text, match.index, match[0].length);
  }
  candidates.push(...scanDomains(text));
  // Clickable links first, so bare fillers cannot use up the cap before the real link.
  candidates.sort((a, b) => Number(b.clickable) - Number(a.clickable) || a.index - b.index);

  // No cap: the 4000-character cut bounds the work, and a cap would let fillers hide the real link.
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];
  for (const candidate of candidates) {
    const masked = candidate.maskedTextDomain;
    const key = masked === undefined ? candidate.domain : `${candidate.domain} ${masked}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(
      masked === undefined
        ? { domain: candidate.domain }
        : { domain: candidate.domain, maskedTextDomain: masked },
    );
  }
  return links;
}
