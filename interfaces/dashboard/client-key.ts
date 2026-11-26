import { isIPv4, isIPv6 } from 'node:net';

const MAPPED_PREFIX = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Expands `::` and returns the 8 groups of an IPv6 address as numbers. */
function groupsOf(address: string): number[] {
  // An embedded IPv4 tail (`::1.2.3.4`) takes the place of the last two groups.
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  let text = address;
  if (tail !== null) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${address.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest, ...extra] = text.split('::');
  if (extra.length > 0) return [];
  const front = head === '' ? [] : head.split(':');
  const back = rest === undefined || rest === '' ? [] : rest.split(':');
  const missing = rest === undefined ? 0 : 8 - front.length - back.length;
  const all = [...front, ...Array<string>(Math.max(missing, 0)).fill('0'), ...back];
  return all.map((group) => Number.parseInt(group, 16));
}

/**
 * The rate limiter key of a client address. An IPv4 address counts alone; an IPv6 address counts
 * by its /64 block (the first 4 groups), written in canonical form; an IPv4-mapped IPv6 address
 * counts as the IPv4. Anything that is not an IP is returned unchanged.
 */
export function clientKey(ip: string): string {
  if (isIPv4(ip)) return ip;
  const mapped = MAPPED_PREFIX.exec(ip);
  if (mapped?.[1] !== undefined && isIPv4(mapped[1])) return mapped[1];
  const bare = ip.split('%')[0] ?? ip;
  if (!isIPv6(bare)) return ip;
  const groups = groupsOf(bare);
  if (groups.length !== 8 || groups.some((group) => Number.isNaN(group))) return ip;
  return groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':');
}
