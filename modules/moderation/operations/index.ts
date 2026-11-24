import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { registerActionOperations } from './actions.ts';
import { registerCaseOperations } from './cases.ts';
import type { CaseOperationDeps } from './cases.ts';
import { registerConfigOperations } from './config.ts';
import { registerDomainOperations } from './domains.ts';

export type ModerationOperationDeps = CaseOperationDeps;

/** Registers every moderation operation; call it from the module's `register()` step. */
export function registerModerationOperations(
  ctx: Pick<ModuleContext, 'config' | 'operations' | 'permissions'>,
  deps: ModerationOperationDeps,
): void {
  registerConfigOperations(ctx);
  registerDomainOperations(ctx, deps);
  registerCaseOperations(ctx, deps);
  registerActionOperations(ctx, deps);
}
