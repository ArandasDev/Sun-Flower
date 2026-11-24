import type { Actor } from '../../shared/contracts/commands.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { ModuleManifest } from '../../shared/contracts/module.ts';
import {
  fail,
  type OperationDefinition,
  type OperationErrorCode,
  type OperationResult,
  type OperationSource,
} from '../../shared/contracts/operations.ts';

const SEGMENT = '[a-z][a-z0-9-]*';
const MINE_SUFFIX = '.mine';
const ROOT_PATH = '(raiz)';
/** A path segment that is not a plain key (a record key, say) is masked: it may echo input. */
const PLAIN_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

const NOT_FOUND = fail('not_found', 'Operação desconhecida.');
const UNAVAILABLE = fail('unavailable', 'Módulo indisponível.');
const FORBIDDEN = fail('forbidden', 'Você não tem permissão para isso.');
const FAILED = fail('failed', 'Erro interno.');
const ERROR_CODES: ReadonlySet<string> = new Set<OperationErrorCode>([
  'forbidden',
  'invalid',
  'not_found',
  'conflict',
  'unavailable',
  'failed',
]);

export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOperationError';
  }
}

interface SafeParseSchema {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[] }[] } };
}

interface RegisteredOperation {
  readonly moduleId: string;
  readonly name: string;
  readonly permission: string | null;
  readonly input: SafeParseSchema;
  readonly handler: (actor: Actor, input: unknown) => Promise<OperationResult>;
}

export interface OperationRegistryDeps {
  readonly permissions: { check(actor: Actor, permission: string): boolean };
  readonly logger: Logger;
  /** Whether the module may run operations now (it is RUNNING). */
  readonly isActive: (moduleId: string) => boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasSafeParse(schema: unknown): schema is SafeParseSchema {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    typeof (schema as { safeParse?: unknown }).safeParse === 'function'
  );
}

function isResult(value: unknown): value is OperationResult {
  if (typeof value !== 'object' || value === null) return false;
  const { ok, error } = value as { ok?: unknown; error?: unknown };
  if (ok === true) return 'data' in value;
  if (ok !== false || typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && ERROR_CODES.has(code) && typeof message === 'string';
}

function describeSegment(segment: PropertyKey): string {
  const text = typeof segment === 'symbol' ? '' : String(segment);
  return PLAIN_SEGMENT.test(text) ? text : '*';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * The operations registered by the modules. Before any handler runs, the Core checks, in this
 * order: the operation exists, its module is active, the actor has the permission and the input
 * matches the schema. Every call is logged without the input, the actor or any text.
 */
export class OperationRegistry {
  readonly #deps: OperationRegistryDeps;
  readonly #operations = new Map<string, RegisteredOperation>();

  constructor(deps: OperationRegistryDeps) {
    this.#deps = deps;
  }

  register(manifest: ModuleManifest, definition: OperationDefinition): void {
    const { id } = manifest;
    if (typeof definition !== 'object' || definition === null) {
      throw new InvalidOperationError(
        `Module "${id}" registered an operation that is not an object`,
      );
    }
    const { name, permission, input } = definition;
    const pattern = new RegExp(`^${escapeRegExp(id)}\\.${SEGMENT}(\\.${SEGMENT})+$`);
    if (typeof name !== 'string' || !pattern.test(name)) {
      throw new InvalidOperationError(
        `Operation name "${String(name)}" of module "${id}" must match ${id}.<resource>.<action>`,
      );
    }
    if (this.#operations.has(name)) {
      throw new InvalidOperationError(`Operation "${name}" is already registered`);
    }
    if (permission === null) {
      if (!name.endsWith(MINE_SUFFIX)) {
        throw new InvalidOperationError(
          `Operation "${name}" needs a permission: only ".mine" operations may use null`,
        );
      }
    } else if (typeof permission !== 'string' || !manifest.permissions.includes(permission)) {
      throw new InvalidOperationError(
        `Operation "${name}" requires permission "${String(permission)}", which the manifest of "${id}" does not declare`,
      );
    }
    if (!hasSafeParse(input)) {
      throw new InvalidOperationError(`Operation "${name}" needs an input schema with safeParse`);
    }
    if (typeof definition.handler !== 'function') {
      throw new InvalidOperationError(`Operation "${name}" needs a handler function`);
    }
    // A frozen copy: later changes to the module's own object never reach the registry.
    // Bound so a handler written as a method keeps its `this`.
    this.#operations.set(
      name,
      Object.freeze({
        moduleId: id,
        name,
        permission,
        input,
        handler: definition.handler.bind(definition),
      }),
    );
  }

  dropModule(moduleId: string): void {
    for (const [name, operation] of this.#operations) {
      if (operation.moduleId === moduleId) this.#operations.delete(name);
    }
  }

  names(): string[] {
    return [...this.#operations.keys()].sort();
  }

  execute(
    name: string,
    actor: Actor,
    input: unknown,
    source: OperationSource,
  ): Promise<OperationResult> {
    return this.#run(undefined, name, actor, input, source);
  }

  /** A module's own call: only its operations exist for it, and the source is `discord`. */
  executeOwn(
    moduleId: string,
    name: string,
    actor: Actor,
    input: unknown,
  ): Promise<OperationResult> {
    return this.#run(moduleId, name, actor, input, 'discord');
  }

  async #run(
    caller: string | undefined,
    name: string,
    actor: Actor,
    input: unknown,
    source: OperationSource,
  ): Promise<OperationResult> {
    const operation = typeof name === 'string' ? this.#operations.get(name) : undefined;
    if (operation === undefined || (caller !== undefined && operation.moduleId !== caller)) {
      // The name comes from outside and may be anything, so it is not logged.
      this.#log({ module: null, operation: null, source, result: 'not_found' });
      return NOT_FOUND;
    }
    const entry = { module: operation.moduleId, operation: operation.name, source };
    let result: OperationResult;
    try {
      result = await this.#guardedRun(operation, actor, input);
    } catch (error) {
      this.#deps.logger.error(
        { ...entry, result: 'failed', error: errorName(error) },
        'operation failed',
      );
      return FAILED;
    }
    this.#log({ ...entry, result: result.ok ? 'ok' : result.error.code });
    return result;
  }

  async #guardedRun(
    operation: RegisteredOperation,
    actor: Actor,
    input: unknown,
  ): Promise<OperationResult> {
    if (!this.#deps.isActive(operation.moduleId)) return UNAVAILABLE;
    if (
      operation.permission !== null &&
      !this.#deps.permissions.check(actor, operation.permission)
    ) {
      return FORBIDDEN;
    }
    const parsed = operation.input.safeParse(input);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? issue.path.map(describeSegment).join('.') : ROOT_PATH,
      );
      return fail('invalid', `Entrada inválida: ${[...new Set(paths)].join(', ')}.`);
    }
    const result: unknown = await operation.handler(actor, parsed.data);
    if (!isResult(result)) {
      const error = new Error('handler returned something other than an OperationResult');
      error.name = 'InvalidOperationResult';
      throw error;
    }
    return result;
  }

  #log(entry: {
    module: string | null;
    operation: string | null;
    source: OperationSource;
    result: string;
  }): void {
    this.#deps.logger.info(entry, 'operation executed');
  }
}
