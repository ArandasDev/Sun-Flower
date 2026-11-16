import type { CommandDefinition } from '../../shared/contracts/commands.ts';

const COMMAND_NAME = /^[a-z0-9_-]{1,32}$/;
const MAX_DESCRIPTION = 100;

export type ModuleState =
  | 'DISCOVERED'
  | 'VALIDATED'
  | 'REGISTERED'
  | 'INITIALIZED'
  | 'RUNNING'
  | 'STOPPED'
  | 'DISPOSED'
  | 'FAILED';

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
  DISPOSED: [],
  FAILED: [],
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
}
