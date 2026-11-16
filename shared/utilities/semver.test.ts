import { describe, expect, it } from 'vitest';
import { isApiCompatible, parseSemver } from './semver.ts';

describe('semver', () => {
  it.each([
    ['1.3.0', '1.2.0', true],
    ['1.3.0', '1.2.5', true],
    ['1.3.0', '1.3.0', true],
    ['1.3.0', '1.4.0', false],
    ['1.3.0', '1.3.1', false],
    ['1.3.0', '2.0.0', false],
    ['2.0.0', '1.3.0', false],
  ])('core %s, module %s → %s', (core, mod, expected) => {
    expect(isApiCompatible(core, mod)).toBe(expected);
  });

  it('parses a valid version', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('rejects malformed versions', () => {
    expect(parseSemver('1')).toBeNull();
    expect(parseSemver('01.0.0')).toBeNull();
    expect(parseSemver('1.0.0-beta')).toBeNull();
    expect(isApiCompatible('1.0.0', 'x')).toBe(false);
  });
});
