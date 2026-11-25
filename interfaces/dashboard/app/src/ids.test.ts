import { describe, expect, it } from 'vitest';
import { isSnowflake } from './ids.ts';

describe('isSnowflake', () => {
  it.each(['11111111111111111', '18446744073709551615', '222222222222222222'])(
    'accepts %s',
    (id) => {
      expect(isSnowflake(id)).toBe(true);
    },
  );
  it.each([
    '1234',
    '0111111111111111111',
    '18446744073709551616',
    '99999999999999999999',
    '1111111111111111a',
    '',
  ])('rejects %s', (id) => {
    expect(isSnowflake(id)).toBe(false);
  });
});
