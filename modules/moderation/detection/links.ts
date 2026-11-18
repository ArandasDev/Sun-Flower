import { domainToASCII } from 'node:url';

export interface ExtractedLink {
  domain: string;
  maskedTextDomain?: string;
}

const MAX_SCAN_CHARS = 4000;
const MAX_LINKS = 20;

const MARKDOWN_LINK =
  /\[([^\]]{1,256})\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gi;
const SCHEME_URL = /https?:\/\/[^\s<>)\]"']+/gi;
const BARE_DOMAIN =
  /(?<![@\p{L}\p{N}_.-])((?:[\p{L}\p{N}-]{1,63}\.)+[\p{L}\p{N}-]{2,63})(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}])/giu;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{1,59})$/;

/** Normalizes a bare domain or URL; undefined if it is not a plausible domain. */
export function normalizeDomain(input: string): string | undefined {
  let host = input.trim().toLowerCase();
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//.exec(host);
  const hasScheme = schemeMatch !== null;
  if (schemeMatch) host = host.slice(schemeMatch[0].length);
  host = host.split(/[/?#\\]/)[0] ?? '';
  host = host.slice(host.lastIndexOf('@') + 1);
  host = /^[\p{L}\p{N}.-]+/u.exec(host)?.[0] ?? '';
  host = host.replace(/\.+$/, '').replace(/^www\./, '');
  if (host === '') return undefined;
  if (hasScheme && IPV4.test(host) && host.split('.').every((o) => Number(o) <= 255)) {
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
    if (domain !== undefined) found.push({ index: match.index, domain });
    rest = blank(rest, match.index, match[0].length);
  }
  for (const match of rest.matchAll(BARE_DOMAIN)) {
    const domain = normalizeDomain(match[1] ?? '');
    if (domain !== undefined) found.push({ index: match.index, domain });
  }
  return found.sort((a, b) => a.index - b.index);
}

interface Candidate extends Found {
  maskedTextDomain?: string;
}

export function extractLinks(content: string): ExtractedLink[] {
  let text = content.slice(0, MAX_SCAN_CHARS);
  const candidates: Candidate[] = [];

  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const domain = normalizeDomain(match[2] ?? '');
    if (domain === undefined) continue;
    const textDomain = scanDomains(match[1] ?? '')[0]?.domain;
    candidates.push({
      index: match.index,
      domain,
      ...(textDomain !== undefined && textDomain !== domain
        ? { maskedTextDomain: textDomain }
        : {}),
    });
  }
  for (const match of [...text.matchAll(MARKDOWN_LINK)].reverse()) {
    text = blank(text, match.index, match[0].length);
  }
  candidates.push(...scanDomains(text));
  candidates.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const links: ExtractedLink[] = [];
  for (const candidate of candidates) {
    if (candidate.maskedTextDomain === undefined) {
      if (seen.has(candidate.domain)) continue;
      seen.add(candidate.domain);
      links.push({ domain: candidate.domain });
    } else {
      links.push({ domain: candidate.domain, maskedTextDomain: candidate.maskedTextDomain });
    }
    if (links.length === MAX_LINKS) break;
  }
  return links;
}
