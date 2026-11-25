import type { CommandDefinition } from '../../shared/contracts/commands.ts';
import type { ModuleState } from '../../shared/contracts/module.ts';

const COMMAND_NAME = /^[a-z0-9_-]{1,32}$/;
const MAX_DESCRIPTION = 100;

export type { ModuleState };

export interface ModuleStatus {
  readonly state: ModuleState;
  readonly failedAt?: string;
  readonly error?: string;
}

const TRANSITIONS: Record<ModuleState, readonly ModuleState[]> = {
  DISCOVERED: ['VALIDATED', 'FAILED'],
  VALIDATED: ['REGISTERED', 'FAILED'],
  REGISTERED: ['INITIALIZED', 'FAILED'],
  INITIALIZED: ['RUNNING', 'FAILED'],
  RUNNING: ['STOPPED', 'FAILED'],
  STOPPED: ['DISPOSED', 'FAILED'],
  // Only ModuleRegistry.setEnabled() takes a module back to VALIDATED, to start a new instance.
  DISPOSED: ['VALIDATED'],
  FAILED: ['VALIDATED'],
};

export function canTransition(from: ModuleState, to: ModuleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class CommandRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandRegistrationError';
  }
}

/** Checks a command's shape at runtime: modules are plain code and may ignore the types. */
export function assertValidCommand(command: CommandDefinition): void {
  const { name, description } = command;
  if (typeof name !== 'string' || !COMMAND_NAME.test(name)) {
    throw new CommandRegistrationError(
      `Invalid command name "${String(name)}": expected 1 to 32 characters of a-z, 0-9, _ or -`,
    );
  }
  if (
    typeof description !== 'string' ||
    description.length < 1 ||
    description.length > MAX_DESCRIPTION
  ) {
    throw new CommandRegistrationError(
      `Invalid description for command "${name}": expected 1 to ${MAX_DESCRIPTION} characters`,
    );
  }
  if (typeof command.handle !== 'function') {
    throw new CommandRegistrationError(`Command "${name}" must have a handle function`);
  }
  assertCommandOptions(command);
}

const MAX_PER_LEVEL = 25;
const MAX_STRING_LENGTH = 6000;
const OPTION_TYPES: ReadonlySet<string> = new Set([
  'string',
  'integer',
  'boolean',
  'user',
  'channel',
  'role',
]);

function fail(path: string, problem: string): never {
  throw new CommandRegistrationError(`Invalid ${path}: ${problem}`);
}

function assertNamed(item: unknown, path: string): asserts item is Record<string, unknown> {
  if (typeof item !== 'object' || item === null) fail(path, 'expected an object');
  const { name, description } = item as Record<string, unknown>;
  if (typeof name !== 'string' || !COMMAND_NAME.test(name)) {
    fail(path, `name "${String(name)}" must be 1 to 32 characters of a-z, 0-9, _ or -`);
  }
  if (
    typeof description !== 'string' ||
    description.length < 1 ||
    description.length > MAX_DESCRIPTION
  ) {
    fail(path, `description must be 1 to ${String(MAX_DESCRIPTION)} characters`);
  }
}

function assertList(value: unknown, path: string, what: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, `${what} must be an array`);
  if (value.length > MAX_PER_LEVEL) {
    fail(path, `at most ${String(MAX_PER_LEVEL)} ${what} are allowed`);
  }
  return value as readonly unknown[];
}

function assertUniqueNames(items: readonly unknown[], path: string, what: string): void {
  const seen = new Set<unknown>();
  for (const item of items) {
    const { name } = item as { name: unknown };
    if (seen.has(name)) fail(path, `duplicate ${what} name "${String(name)}"`);
    seen.add(name);
  }
}

function assertNumberBound(option: Record<string, unknown>, key: string, path: string): void {
  const value = option[key];
  if (value === undefined) return;
  if (option.type !== 'integer') fail(path, `${key} is only allowed on integer options`);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail(path, `${key} must be an integer`);
  }
}

function assertOption(option: unknown, path: string): asserts option is Record<string, unknown> {
  assertNamed(option, path);
  if (typeof option.type !== 'string' || !OPTION_TYPES.has(option.type)) {
    fail(path, `unknown option type "${String(option.type)}"`);
  }
  if (option.required !== undefined && typeof option.required !== 'boolean') {
    fail(path, 'required must be a boolean');
  }
  assertNumberBound(option, 'minValue', path);
  assertNumberBound(option, 'maxValue', path);
  if (
    typeof option.minValue === 'number' &&
    typeof option.maxValue === 'number' &&
    option.minValue > option.maxValue
  ) {
    fail(path, 'minValue must not be greater than maxValue');
  }
  if (option.maxLength !== undefined) {
    if (option.type !== 'string') fail(path, 'maxLength is only allowed on string options');
    const { maxLength } = option;
    if (
      typeof maxLength !== 'number' ||
      !Number.isInteger(maxLength) ||
      maxLength < 1 ||
      maxLength > MAX_STRING_LENGTH
    ) {
      fail(path, `maxLength must be an integer from 1 to ${String(MAX_STRING_LENGTH)}`);
    }
  }
  if (option.choices !== undefined) {
    if (option.type !== 'string') fail(path, 'choices are only allowed on string options');
    const choices = assertList(option.choices, path, 'choices');
    if (choices.length === 0) fail(path, 'choices must not be empty');
    for (const choice of choices) {
      if (typeof choice !== 'string' || choice.length < 1 || choice.length > MAX_DESCRIPTION) {
        fail(path, `each choice must be 1 to ${String(MAX_DESCRIPTION)} characters`);
      }
    }
  }
}

function assertOptions(options: unknown, path: string): void {
  const list = assertList(options, path, 'options');
  let optionalSeen = false;
  list.forEach((option, index) => {
    const optionPath = `${path} option ${String(index + 1)}`;
    assertOption(option, optionPath);
    if (option.required === true) {
      if (optionalSeen) fail(optionPath, 'a required option cannot follow an optional one');
    } else {
      optionalSeen = true;
    }
  });
  assertUniqueNames(list, path, 'option');
}

function assertSubcommand(subcommand: unknown, path: string): void {
  assertNamed(subcommand, path);
  if (subcommand.options !== undefined) assertOptions(subcommand.options, path);
}

function assertSubcommands(subcommands: unknown, path: string): readonly unknown[] {
  const list = assertList(subcommands, path, 'subcommands');
  for (const subcommand of list) {
    const name = (subcommand as { name?: unknown } | null)?.name;
    assertSubcommand(subcommand, `${path} subcommand "${String(name)}"`);
  }
  assertUniqueNames(list, path, 'subcommand');
  return list;
}

function assertCommandOptions(command: CommandDefinition): void {
  const { name } = command;
  const { options, subcommands, groups } = command;
  if (options !== undefined && (subcommands !== undefined || groups !== undefined)) {
    fail(`command "${name}"`, 'options cannot be combined with subcommands or groups');
  }
  if (options !== undefined) assertOptions(options, `command "${name}"`);
  const loose =
    subcommands === undefined ? [] : assertSubcommands(subcommands, `command "${name}"`);
  const groupList = groups === undefined ? [] : assertList(groups, `command "${name}"`, 'groups');
  if (subcommands === undefined && groups === undefined) return;
  // Discord counts loose subcommands and groups together at the top level.
  const topLevel = loose.length + groupList.length;
  if (topLevel === 0) fail(`command "${name}"`, 'subcommands and groups must not both be empty');
  if (topLevel > MAX_PER_LEVEL) {
    fail(
      `command "${name}"`,
      `at most ${String(MAX_PER_LEVEL)} subcommands and groups are allowed`,
    );
  }
  for (const group of groupList) {
    const groupName = (group as { name?: unknown } | null)?.name;
    const groupPath = `command "${name}" group "${String(groupName)}"`;
    assertNamed(group, groupPath);
    const groupSubcommands = assertSubcommands(group.subcommands, groupPath);
    if (groupSubcommands.length === 0) fail(groupPath, 'a group needs at least one subcommand');
  }
  assertUniqueNames([...loose, ...groupList], `command "${name}"`, 'group or subcommand');
}
