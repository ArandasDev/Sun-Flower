import { describe, expect, it } from 'vitest';
import type { CommandDefinition } from '../../shared/contracts/commands.ts';
import {
  assertValidCommand,
  CommandRegistrationError,
  canTransition,
  type ModuleState,
} from './lifecycle.ts';

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

describe('assertValidCommand with options', () => {
  const handle = async (): Promise<void> => {};
  const opt = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    description: 'Option',
    type: 'string' as const,
    ...extra,
  });
  const sub = (name: string, options?: unknown[]) => ({ name, description: 'Sub', options });
  const make = (extra: Record<string, unknown>): CommandDefinition => ({
    name: 'cmd',
    description: 'Command',
    handle,
    ...extra,
  });
  const rejects = (extra: Record<string, unknown>): void => {
    expect(() => {
      assertValidCommand(make(extra));
    }).toThrow(CommandRegistrationError);
  };
  const many = (count: number, build: (index: number) => unknown): unknown[] =>
    Array.from({ length: count }, (_, index) => build(index));

  it('rejects options together with subcommands', () => {
    rejects({ options: [opt('a')], subcommands: [sub('s')] });
  });
  it('rejects options together with groups', () => {
    rejects({
      options: [opt('a')],
      groups: [{ name: 'g', description: 'G', subcommands: [sub('s')] }],
    });
  });
  it('rejects an option name with uppercase', () => {
    rejects({ options: [opt('Domain')] });
  });
  it('rejects more than 25 options', () => {
    rejects({ options: many(26, (i) => opt(`o${String(i)}`)) });
  });
  it('rejects more than 25 subcommands in a group', () => {
    rejects({
      groups: [{ name: 'g', description: 'G', subcommands: many(26, (i) => sub(`s${String(i)}`)) }],
    });
  });
  it('rejects more than 25 loose subcommands and groups together', () => {
    const group = (name: string) => ({ name, description: 'G', subcommands: [sub('s')] });
    rejects({
      subcommands: many(13, (i) => sub(`s${String(i)}`)),
      groups: many(13, (i) => group(`g${String(i)}`)),
    });
    expect(() => {
      assertValidCommand(
        make({
          subcommands: many(12, (i) => sub(`s${String(i)}`)),
          groups: many(13, (i) => group(`g${String(i)}`)),
        }),
      );
    }).not.toThrow();
  });
  it('rejects a group without subcommands', () => {
    rejects({ groups: [{ name: 'g', description: 'G', subcommands: [] }] });
  });
  it('rejects present but empty subcommands and groups', () => {
    rejects({ subcommands: [] });
    rejects({ groups: [] });
    rejects({ subcommands: [], groups: [] });
  });
  it('rejects maxLength outside 1..6000', () => {
    rejects({ options: [opt('a', { maxLength: 0 })] });
    rejects({ options: [opt('a', { maxLength: 6001 })] });
    rejects({ options: [opt('a', { maxLength: 1.5 })] });
    expect(() => {
      assertValidCommand(make({ options: [opt('a', { maxLength: 6000 })] }));
    }).not.toThrow();
  });
  it('rejects integer bounds that are not safe integers', () => {
    rejects({ options: [opt('a', { type: 'integer', minValue: 2 ** 53 })] });
    rejects({ options: [opt('a', { type: 'integer', maxValue: -(2 ** 53) })] });
    rejects({ options: [opt('a', { type: 'integer', maxValue: 1.5 })] });
  });
  it('rejects a required option after an optional one', () => {
    rejects({ options: [opt('a'), opt('b', { required: true })] });
  });
  it('rejects choices on a non-string option', () => {
    rejects({ options: [opt('a', { type: 'integer', choices: ['x'] })] });
  });
  it('rejects more than 25 choices', () => {
    rejects({ options: [opt('a', { choices: many(26, (i) => `c${String(i)}`) })] });
  });
  it('rejects a choice longer than 100 characters', () => {
    rejects({ options: [opt('a', { choices: ['x'.repeat(101)] })] });
  });
  it('rejects minValue on a string option', () => {
    rejects({ options: [opt('a', { minValue: 1 })] });
  });
  it('rejects maxLength on an integer option', () => {
    rejects({ options: [opt('a', { type: 'integer', maxLength: 5 })] });
  });
  it('rejects minValue greater than maxValue', () => {
    rejects({ options: [opt('a', { type: 'integer', minValue: 5, maxValue: 1 })] });
  });
  it('rejects duplicate subcommand names inside the same level', () => {
    rejects({ subcommands: [sub('s'), sub('s')] });
  });
  it('rejects a group and a loose subcommand sharing a name', () => {
    rejects({
      subcommands: [sub('x')],
      groups: [{ name: 'x', description: 'G', subcommands: [sub('s')] }],
    });
  });
  it('rejects duplicate option names', () => {
    rejects({ options: [opt('a'), opt('a')] });
  });
  it('accepts a command with groups and loose subcommands', () => {
    expect(() => {
      assertValidCommand(
        make({
          groups: [
            {
              name: 'domain',
              description: 'Domains',
              subcommands: [
                sub('add', [opt('domain', { required: true, maxLength: 100 }), opt('note')]),
                sub('remove', [opt('domain', { required: true, choices: ['a', 'b'] })]),
              ],
            },
          ],
          subcommands: [
            sub('ban', [
              { name: 'days', description: 'Days', type: 'integer', minValue: 0, maxValue: 7 },
            ]),
          ],
        }),
      );
    }).not.toThrow();
  });
});
