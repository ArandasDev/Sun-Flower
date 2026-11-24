import { beforeEach, describe, expect, it } from 'vitest';

import type { Actor } from '../../../shared/contracts/commands.ts';
import type { ModuleContext } from '../../../shared/contracts/module.ts';
import type { OperationDefinition } from '../../../shared/contracts/operations.ts';
import { configSchema } from '../config.ts';
import type { ModerationConfig } from '../config.ts';
import { registerConfigOperations } from './config.ts';

const ACTOR: Actor = { userId: '111111111111111111', roleIds: [], isOwner: false };
const CONFLICT = 'Outra pessoa alterou esta configuração. Recarregue para ver a versão atual.';

let operations: Map<string, OperationDefinition>;
let stored: Record<string, unknown>;
let version: number;

/** Mirrors the Core store: a version counter, a stale-version check, schema validation. */
function config(): ModuleContext['config'] {
  return {
    get: <T>() => configSchema.parse(stored) as T,
    set: (partial, expectedVersion) => {
      if (expectedVersion !== undefined && expectedVersion !== version) {
        const error = new Error('stale');
        error.name = 'ConfigVersionConflictError';
        throw error;
      }
      const merged = { ...stored, ...partial };
      const result = configSchema.safeParse(merged);
      if (!result.success) {
        const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
        const error = new Error(`Invalid settings for module "moderation" at: ${paths.join(', ')}`);
        error.name = 'InvalidModuleConfigError';
        throw error;
      }
      stored = merged;
      version += 1;
    },
    version: () => version,
  };
}

function run(name: string, input: unknown) {
  const definition = operations.get(name);
  if (definition === undefined) throw new Error(`missing ${name}`);
  const parsed = (
    definition.input as { safeParse(v: unknown): { success: boolean; data?: unknown } }
  ).safeParse(input);
  if (!parsed.success) return Promise.resolve({ ok: false, error: { code: 'invalid' } });
  return definition.handler(ACTOR, parsed.data);
}

beforeEach(() => {
  stored = {};
  version = 0;
  operations = new Map();
  registerConfigOperations({
    config: config(),
    operations: {
      register: <I, O>(definition: OperationDefinition<I, O>) => {
        operations.set(definition.name, definition);
      },
      execute: () => Promise.reject(new Error('not used')),
    },
  });
});

describe('moderation.config.view', () => {
  it('returns the version and the parsed configuration', async () => {
    const result = await run('moderation.config.view', {});
    expect(result).toEqual({
      ok: true,
      data: { version: 0, config: configSchema.parse({}) },
    });
  });
});

describe('moderation.config.update', () => {
  it('applies the changes and returns the new version and configuration', async () => {
    const result = await run('moderation.config.update', {
      expectedVersion: 0,
      changes: { timeoutMinutes: 120 },
    });
    expect(result).toMatchObject({ ok: true, data: { version: 1 } });
    expect(config().get<ModerationConfig>().timeoutMinutes).toBe(120);
  });

  it('rejects an unknown top-level key', async () => {
    const result = await run('moderation.config.update', {
      expectedVersion: 0,
      changes: { secretKey: 1 },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(config().version()).toBe(0);
  });

  it('rejects a change that fails the module schema, with the paths', async () => {
    const result = await run('moderation.config.update', {
      expectedVersion: 0,
      changes: { timeoutMinutes: 0 },
    });
    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'Configuração inválida: timeoutMinutes.' },
    });
    expect(config().version()).toBe(0);
  });

  it('rejects a negative or fractional expectedVersion', async () => {
    for (const expectedVersion of [-1, 1.5]) {
      const result = await run('moderation.config.update', { expectedVersion, changes: {} });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid' } });
    }
  });

  it('answers conflict for a stale version', async () => {
    await run('moderation.config.update', { expectedVersion: 0, changes: { timeoutMinutes: 10 } });
    const result = await run('moderation.config.update', {
      expectedVersion: 0,
      changes: { timeoutMinutes: 20 },
    });
    expect(result).toEqual({ ok: false, error: { code: 'conflict', message: CONFLICT } });
  });

  it('with the same expectedVersion twice, the second conflicts and the first stays', async () => {
    const first = await run('moderation.config.update', {
      expectedVersion: 0,
      changes: { timeoutMinutes: 10 },
    });
    const second = await run('moderation.config.update', {
      expectedVersion: 0,
      changes: { timeoutMinutes: 20 },
    });
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(config().get<ModerationConfig>().timeoutMinutes).toBe(10);
    expect(config().version()).toBe(1);
  });
});
