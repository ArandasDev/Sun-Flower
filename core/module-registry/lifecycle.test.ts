import { describe, expect, it } from 'vitest';
import { canTransition, type ModuleState } from './lifecycle.ts';

const ALL: ModuleState[] = [
  'DISCOVERED',
  'VALIDATED',
  'REGISTERED',
  'INITIALIZED',
  'RUNNING',
  'STOPPED',
  'DISPOSED',
  'FAILED',
];

describe('canTransition', () => {
  it.each([
    ['DISCOVERED', 'VALIDATED'],
    ['VALIDATED', 'REGISTERED'],
    ['REGISTERED', 'INITIALIZED'],
    ['INITIALIZED', 'RUNNING'],
    ['RUNNING', 'STOPPED'],
    ['STOPPED', 'DISPOSED'],
    ['RUNNING', 'FAILED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('rejects skipping steps', () => {
    expect(canTransition('VALIDATED', 'RUNNING')).toBe(false);
    expect(canTransition('DISCOVERED', 'REGISTERED')).toBe(false);
    expect(canTransition('RUNNING', 'DISPOSED')).toBe(false);
  });

  it.each(['FAILED', 'DISPOSED'] as const)('treats %s as terminal', (from) => {
    for (const to of ALL) expect(canTransition(from, to)).toBe(false);
  });
});
