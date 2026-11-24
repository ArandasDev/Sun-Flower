import { z } from 'zod';

import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { fail, ok } from '../../../shared/contracts/operations.ts';
import type { OperationResult } from '../../../shared/contracts/operations.ts';
import { configSchema } from '../config.ts';
import type { ModerationConfig } from '../config.ts';
import { CONFIG_CONFLICT, CONFIG_INVALID } from '../commands/replies.ts';

const CONFIG_PERMISSION = 'moderation.config.manage';

export interface ConfigSnapshot {
  readonly version: number;
  readonly config: ModerationConfig;
}

export const viewInput = z.object({});

/** Only top-level keys of the module schema; the issue path never carries the received key. */
export const updateInput = z.object({
  expectedVersion: z.number().int().min(0),
  changes: z.record(z.string(), z.unknown()).superRefine((changes, context) => {
    const known = Object.keys(changes).every((key) => Object.hasOwn(configSchema.shape, key));
    if (!known) context.addIssue({ code: 'custom', message: 'unknown setting', path: [] });
  }),
});

function invalidFields(error: Error): string {
  const marker = ' at: ';
  const index = error.message.indexOf(marker);
  return index === -1 ? error.message : error.message.slice(index + marker.length);
}

export function registerConfigOperations(ctx: Pick<ModuleContext, 'config' | 'operations'>): void {
  const snapshot = (): ConfigSnapshot => ({
    version: ctx.config.version(),
    config: ctx.config.get<ModerationConfig>(),
  });

  ctx.operations.register({
    name: 'moderation.config.view',
    permission: CONFIG_PERMISSION,
    input: viewInput,
    handler: (): Promise<OperationResult<ConfigSnapshot>> => Promise.resolve(ok(snapshot())),
  });

  ctx.operations.register({
    name: 'moderation.config.update',
    permission: CONFIG_PERMISSION,
    input: updateInput,
    handler: (_actor, input: z.output<typeof updateInput>) => {
      try {
        ctx.config.set(input.changes, input.expectedVersion);
      } catch (error) {
        if (error instanceof Error && error.name === 'ConfigVersionConflictError') {
          return Promise.resolve(fail('conflict', CONFIG_CONFLICT));
        }
        if (error instanceof Error && error.name === 'InvalidModuleConfigError') {
          return Promise.resolve(fail('invalid', CONFIG_INVALID(invalidFields(error))));
        }
        throw error;
      }
      return Promise.resolve(ok(snapshot()));
    },
  });
}
