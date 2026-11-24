import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { fail } from '../../../shared/contracts/operations.ts';
import type { OperationDefinition } from '../../../shared/contracts/operations.ts';
import type { DomainStore } from '../domains.ts';
import { registerModerationOperations } from '../operations/index.ts';

interface Parser {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false };
}

/**
 * Runs the moderation operations in-process, as the Core would after its checks: zod input
 * validation and the handler, without permission or module-state checks.
 */
export function createLocalOperations(
  config: ModuleContext['config'],
  domains: DomainStore,
  now?: () => Date,
): Pick<ModuleContext['operations'], 'execute'> {
  const definitions = new Map<string, OperationDefinition>();
  registerModerationOperations(
    {
      config,
      operations: {
        register: <I, O>(definition: OperationDefinition<I, O>) => {
          definitions.set(definition.name, definition);
        },
        execute: () => Promise.reject(new Error('not used')),
      },
    },
    { domains: () => domains, ...(now === undefined ? {} : { now }) },
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
