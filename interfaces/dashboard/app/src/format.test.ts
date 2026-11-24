import { expect, it } from 'vitest';
import { formatUptime } from './format.ts';

it('formats uptime in Portuguese', () => {
  expect(formatUptime(0)).toBe('menos de 1 min');
  expect(formatUptime(45_000)).toBe('menos de 1 min');
  expect(formatUptime(5 * 60_000)).toBe('5 min');
  expect(formatUptime(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 5 min');
  expect(formatUptime(3 * 86_400_000 + 4 * 3_600_000)).toBe('3 d 4 h');
});
