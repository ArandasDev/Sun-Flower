import { z } from 'zod';

import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { fail, ok } from '../../../shared/contracts/operations.ts';
import type { OperationResult } from '../../../shared/contracts/operations.ts';
import { mergeSettings } from '../../../shared/utilities/merge-settings.ts';
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
      // Validate against the schema first: it drops unknown nested keys before they are stored.
      const parsed = configSchema.safeParse(
        mergeSettings(ctx.config.get<ModerationConfig>(), input.changes),
      );
      if (!parsed.success) {
        const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
        return Promise.resolve(fail('invalid', CONFIG_INVALID(paths.join(', '))));
      }
      const clean: Record<string, unknown> = {};
      for (const key of Object.keys(input.changes)) {
        if (Object.hasOwn(parsed.data, key))
          clean[key] = (parsed.data as Record<string, unknown>)[key];
      }
      if (Object.keys(clean).length === 0) return Promise.resolve(ok(snapshot()));
      try {
        ctx.config.set(clean, input.expectedVersion);
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
