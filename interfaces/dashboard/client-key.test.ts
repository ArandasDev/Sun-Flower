import { describe, expect, it } from 'vitest';

import { clientKey } from './client-key.ts';

describe('clientKey', () => {
  it('returns an IPv4 address unchanged', () => {
    expect(clientKey('192.0.2.1')).toBe('192.0.2.1');
  });

  it('groups IPv6 addresses of the same /64', () => {
    expect(clientKey('2001:db8:1:2:3:4:5:6')).toBe(clientKey('2001:db8:1:2:ffff::1'));
    expect(clientKey('2001:db8:1:2:3:4:5:6')).not.toBe(clientKey('2001:db8:1:3:3:4:5:6'));
  });

  it('normalizes the compressed and the padded forms to one key', () => {
    expect(clientKey('2001:db8::1')).toBe(clientKey('2001:0db8:0000:0000::9'));
    expect(clientKey('2001:DB8::1')).toBe('2001:db8:0:0');
  });

  it('counts an IPv4-mapped IPv6 address as the IPv4', () => {
    expect(clientKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
  });

  it('expands a leading and a trailing ::', () => {
    expect(clientKey('::1')).toBe('0:0:0:0');
    expect(clientKey('2001:db8:1:2::')).toBe('2001:db8:1:2');
  });

  it('drops a zone id and returns a non-IP string unchanged', () => {
    expect(clientKey('2001:db8::1%eth0')).toBe('2001:db8:0:0');
    expect(clientKey('not-an-ip')).toBe('not-an-ip');
    expect(clientKey('')).toBe('');
  });
});
