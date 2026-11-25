import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { z } from 'zod';
import type {
  ModuleEntrypoint,
  ModuleFactory,
  SunFlowerModule,
} from '../../shared/contracts/module.ts';

const LIFECYCLE_METHODS = ['register', 'initialize', 'start', 'stop', 'dispose'] as const;

export class EntrypointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntrypointError';
  }
}

export interface LoadedModule {
  readonly instance: SunFlowerModule;
  /** Builds a new, checked instance; the registry calls it to enable a module again. */
  readonly factory: () => SunFlowerModule;
  readonly configSchema?: z.ZodType<unknown>;
}

/**
 * Resolves `entrypoint` against `directory`, following symlinks, and rejects any file that
 * does not live inside the module directory (defense in depth on top of manifest validation).
 */
export function resolveEntrypoint(directory: string, entrypoint: string): string {
  let directoryReal: string;
  let fileReal: string;
  try {
    directoryReal = fs.realpathSync(directory);
    fileReal = fs.realpathSync(path.resolve(directory, entrypoint));
  } catch {
    throw new EntrypointError(`entrypoint "${entrypoint}" cannot be found`);
  }
  if (!fileReal.startsWith(directoryReal + path.sep)) {
    throw new EntrypointError(`entrypoint "${entrypoint}" resolves outside the module directory`);
  }
  if (!fs.statSync(fileReal).isFile()) {
    throw new EntrypointError(`entrypoint "${entrypoint}" is not a file`);
  }
  return fileReal;
}

function isSchema(value: unknown): value is z.ZodType<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function'
  );
}

function isModule(value: unknown): value is SunFlowerModule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return LIFECYCLE_METHODS.every((method) => typeof candidate[method] === 'function');
}

/** Imports the entrypoint, checks its exports and instantiates the module. */
export async function loadModule(directory: string, entrypoint: string): Promise<LoadedModule> {
  const file = resolveEntrypoint(directory, entrypoint);
  const imported = (await import(pathToFileURL(file).href)) as Partial<
    Record<keyof ModuleEntrypoint, unknown>
  >;
  if (typeof imported.default !== 'function') {
    throw new EntrypointError('the default export must be a module factory function');
  }
  const { configSchema } = imported;
  if (configSchema !== undefined && !isSchema(configSchema)) {
    throw new EntrypointError('configSchema must be a zod schema');
  }
  const moduleFactory = imported.default as ModuleFactory;
  const factory = (): SunFlowerModule => {
    const instance: unknown = moduleFactory();
    if (!isModule(instance)) {
      throw new EntrypointError(
        `the module factory must return an object with ${LIFECYCLE_METHODS.join(', ')}`,
      );
    }
    return instance;
  };
  const instance = factory();
  return configSchema === undefined ? { instance, factory } : { instance, factory, configSchema };
}
