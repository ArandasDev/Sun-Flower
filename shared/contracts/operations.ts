import type { Actor } from './commands.ts';

export type OperationErrorCode =
  'forbidden' | 'invalid' | 'not_found' | 'conflict' | 'unavailable' | 'failed';

export interface OperationError {
  readonly code: OperationErrorCode;
  /** Text for the person, in Portuguese, without internal details or received values. */
  readonly message: string;
}

export type OperationResult<O = unknown> =
  { readonly ok: true; readonly data: O } | { readonly ok: false; readonly error: OperationError };

/** The interface that called an operation. */
export type OperationSource = 'discord' | 'dashboard';

export interface OperationDefinition<I = unknown, O = unknown> {
  /** In the module prefix, for example `moderation.cases.list`. */
  readonly name: string;
  /** Declared in the manifest; `null` only for operations on the actor's own data (`.mine`). */
  readonly permission: string | null;
  /**
   * A zod schema for the input. It is typed as `unknown` to keep `shared/` free of a zod
   * dependency; the Core checks it has `safeParse` at registration and validates every call.
   */
  readonly input: unknown;
  handler(actor: Actor, input: I): Promise<OperationResult<O>>;
}

export function ok<O>(data: O): OperationResult<O> {
  return { ok: true, data };
}

export function fail(code: OperationErrorCode, message: string): OperationResult<never> {
  return { ok: false, error: { code, message } };
}
