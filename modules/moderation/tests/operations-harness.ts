import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { fail } from '../../../shared/contracts/operations.ts';
import type { OperationDefinition } from '../../../shared/contracts/operations.ts';
import type { GuildActions } from '../../../shared/contracts/guild.ts';
import type { CaseStore } from '../cases.ts';
import type { DomainStore } from '../domains.ts';
import { registerModerationOperations } from '../operations/index.ts';

interface Parser {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false };
}

/**
 * Runs the moderation operations in-process, as the Core would after its checks: zod input
 * validation and the handler, without permission or module-state checks.
 */
export function createLocalOperations(deps: {
  readonly config: ModuleContext['config'];
  readonly permissions: ModuleContext['permissions'];
  readonly domains: DomainStore;
  readonly cases: CaseStore;
  readonly guild: GuildActions;
  readonly publish: (type: string, payload: unknown) => void;
  readonly now?: () => Date;
}): Pick<ModuleContext['operations'], 'execute'> {
  const definitions = new Map<string, OperationDefinition>();
  registerModerationOperations(
    {
      config: deps.config,
      permissions: deps.permissions,
      operations: {
        register: <I, O>(definition: OperationDefinition<I, O>) => {
          definitions.set(definition.name, definition);
        },
        execute: () => Promise.reject(new Error('not used')),
      },
    },
    {
      domains: () => deps.domains,
      cases: () => deps.cases,
      guild: deps.guild,
      publish: deps.publish,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    },
  );
  return {
    execute: (name, actor, input) => {
      const definition = definitions.get(name);
      if (definition === undefined) {
        return Promise.resolve(fail('not_found', 'Operação desconhecida.'));
      }
      const parsed = (definition.input as Parser).safeParse(input);
      if (!parsed.success) return Promise.resolve(fail('invalid', 'Entrada inválida.'));
      return definition.handler(actor, parsed.data);
    },
  };
}
