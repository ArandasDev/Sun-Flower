import type { Actor } from '../../shared/contracts/commands.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { ModuleManifest } from '../../shared/contracts/module.ts';
import {
  fail,
  ok,
  type OperationDefinition,
  type OperationErrorCode,
  type OperationResult,
  type OperationSource,
} from '../../shared/contracts/operations.ts';

const SEGMENT = '[a-z][a-z0-9-]*';
const MINE_SUFFIX = '.mine';
const ROOT_PATH = '(raiz)';
const MAX_INVALID_PATHS = 10;
const MAX_ERROR_NAME_LENGTH = 64;
const MAX_UNWRAP_DEPTH = 32;
/** zod 4 wrappers whose `innerType` shapes the input at the same path. */
const WRAPPER_TYPES: ReadonlySet<string> = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
  'success',
]);

const NOT_FOUND = fail('not_found', 'Operação desconhecida.');
/** The result of an operation whose module is not running. */
export const UNAVAILABLE = fail('unavailable', 'Módulo indisponível.');
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
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[]; code?: unknown }[] };
      };
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

/**
 * Rebuilds a handler's return value as a fresh `OperationResult`, dropping any extra field.
 * Returns `undefined` when the value is not a valid result.
 */
function rebuildResult(value: unknown): OperationResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { ok: success, data, error } = value as { ok?: unknown; data?: unknown; error?: unknown };
  if (success === true) return 'data' in value ? ok(data) : undefined;
  if (success !== false || typeof error !== 'object' || error === null) return undefined;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || !ERROR_CODES.has(code) || typeof message !== 'string') {
    return undefined;
  }
  return fail(code as OperationErrorCode, message);
}

/** Reads a thrown value's name without trusting it: only a string, capped, else `Error`. */
function errorName(error: unknown): string {
  try {
    const name: unknown = error instanceof Error ? error.name : undefined;
    return typeof name === 'string' && name.length > 0
      ? name.slice(0, MAX_ERROR_NAME_LENGTH)
      : 'Error';
  } catch {
    return 'Error';
  }
}

type SchemaDef = Readonly<Record<string, unknown>>;

/** The zod 4 definition of a schema, or `undefined` when it is not a zod schema. */
function defOf(schema: unknown): SchemaDef | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const internals = (schema as { _zod?: { def?: unknown } })._zod;
  const def = internals?.def;
  return typeof def === 'object' && def !== null ? (def as SchemaDef) : undefined;
}

/** Strips wrappers (optional, default, pipe, lazy…) down to the schema that shapes the input. */
function unwrap(schema: unknown): SchemaDef | undefined {
  let current = schema;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    const def = defOf(current);
    if (def === undefined) return undefined;
    const type = def.type;
    if (typeof type === 'string' && WRAPPER_TYPES.has(type)) current = def.innerType;
    else if (type === 'pipe') current = def.in;
    else if (type === 'lazy')
      current = typeof def.getter === 'function' ? (def.getter as () => unknown)() : undefined;
    else return def;
  }
  return undefined;
}

/**
 * Whether `segment` under `schema` is a name the module wrote (an object key or an array or
 * tuple index), and the schema below it. Record and map keys come from the input, so they are
 * not visible; a segment the walk cannot resolve is not visible either, nor anything below it.
 */
function step(schema: unknown, segment: PropertyKey): { visible: boolean; next: unknown } {
  const hidden = { visible: false, next: undefined };
  const def = unwrap(schema);
  switch (def?.type) {
    case 'object': {
      const shape = def.shape;
      if (typeof segment !== 'string' || typeof shape !== 'object' || shape === null) return hidden;
      return Object.hasOwn(shape, segment)
        ? { visible: true, next: (shape as Record<string, unknown>)[segment] }
        : hidden;
    }
    case 'array':
      return typeof segment === 'number' ? { visible: true, next: def.element } : hidden;
    case 'tuple': {
      if (typeof segment !== 'number' || !Array.isArray(def.items)) return hidden;
      return { visible: true, next: (def.items as unknown[])[segment] ?? def.rest };
    }
    case 'record':
    case 'map':
      return { visible: false, next: def.valueType };
    default:
      return hidden;
  }
}

/** The issue path with every segment that may echo input masked as `*`. */
function describePath(
  schema: unknown,
  issue: { readonly path: readonly PropertyKey[]; readonly code?: unknown },
): string {
  if (issue.path.length === 0) return ROOT_PATH;
  const parts: string[] = [];
  let current: unknown = schema;
  issue.path.forEach((segment, index) => {
    let visible = false;
    try {
      const result = step(current, segment);
      visible = result.visible;
      current = result.next;
    } catch {
      current = undefined;
    }
    const rejectedKey = issue.code === 'invalid_key' && index === issue.path.length - 1;
    parts.push(visible && !rejectedKey ? String(segment) : '*');
  });
  return parts.join('.');
}

function invalidMessage(
  schema: unknown,
  issues: readonly { readonly path: readonly PropertyKey[]; readonly code?: unknown }[],
): string {
  const paths = new Set<string>();
  let truncated = false;
  for (const issue of issues) {
    const path = describePath(schema, issue);
    if (paths.has(path)) continue;
    if (paths.size === MAX_INVALID_PATHS) {
      truncated = true;
      break;
    }
    paths.add(path);
  }
  const shown = [...paths];
  if (truncated) shown.push('…');
  return `Entrada inválida: ${shown.join(', ')}.`;
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
    if (!parsed.success)
      return fail('invalid', invalidMessage(operation.input, parsed.error.issues));
    const result = rebuildResult(await operation.handler(actor, parsed.data));
    if (result === undefined) {
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
