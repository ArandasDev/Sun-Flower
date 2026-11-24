import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { registerConfigOperations } from './config.ts';
import { registerDomainOperations } from './domains.ts';
import type { DomainOperationDeps } from './domains.ts';

/** Registers every moderation operation; call it from the module's `register()` step. */
export function registerModerationOperations(
  ctx: Pick<ModuleContext, 'config' | 'operations'>,
  deps: DomainOperationDeps,
): void {
  registerConfigOperations(ctx);
  registerDomainOperations(ctx, deps);
}
