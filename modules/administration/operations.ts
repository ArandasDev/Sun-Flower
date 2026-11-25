import { z } from 'zod';

import type { LogLevelName } from '../../shared/contracts/admin.ts';
import type { ModuleContext } from '../../shared/contracts/module.ts';
import { ok } from '../../shared/contracts/operations.ts';

const GRANTS = 'administration.grants.manage';
const DEVELOPERS = 'core.developers.manage';
const MODULES = 'core.modules.manage';
const LOGS = 'core.logs.read';
const SESSIONS = 'core.sessions.manage';

const SNOWFLAKE_MAX = 18446744073709551615n;

/** A canonical Discord ID: no leading zeros, 17 to 20 digits and at most 2^64 - 1. */
const snowflake = z
  .string()
  .regex(/^[1-9]\d{16,19}$/)
  .refine((id) => /^\d+$/.test(id) && BigInt(id) <= SNOWFLAKE_MAX);

const LOG_LEVELS = ['info', 'warn', 'error', 'fatal'] as const satisfies readonly LogLevelName[];

export const emptyInput = z.strictObject({});
export const grantInput = z.strictObject({
  permission: z.string().min(1).max(100),
  roleId: snowflake,
});
export const developerInput = z.strictObject({ userId: snowflake });
export const setEnabledInput = z.strictObject({
  moduleId: z.string().min(1).max(64),
  enabled: z.boolean(),
});
export const recentLogsInput = z.strictObject({
  limit: z.number().int().min(1).max(500).default(200),
  minLevel: z.enum(LOG_LEVELS).default('info'),
});
export const revokeSessionInput = z.strictObject({ ref: z.string().regex(/^[0-9a-f]{16}$/) });
export const revokeAllInput = z.strictObject({ userId: snowflake });

/** Registers one operation per function of the Core's `admin` service. */
export function registerAdministrationOperations(
  ctx: Pick<ModuleContext, 'operations' | 'admin'>,
): void {
  const { admin, operations } = ctx;

  operations.register({
    name: 'administration.grants.list',
    permission: GRANTS,
    input: emptyInput,
    handler: () => Promise.resolve(ok(admin.grants.list())),
  });
  operations.register({
    name: 'administration.grants.grant',
    permission: GRANTS,
    input: grantInput,
    handler: (actor, input: z.output<typeof grantInput>) =>
      Promise.resolve(admin.grants.grant(actor, input.permission, input.roleId)),
  });
  operations.register({
    name: 'administration.grants.revoke',
    permission: GRANTS,
    input: grantInput,
    handler: (actor, input: z.output<typeof grantInput>) =>
      Promise.resolve(admin.grants.revoke(actor, input.permission, input.roleId)),
  });

  operations.register({
    name: 'administration.developers.list',
    permission: DEVELOPERS,
    input: emptyInput,
    handler: () => Promise.resolve(ok({ developers: admin.developers.list() })),
  });
  operations.register({
    name: 'administration.developers.add',
    permission: DEVELOPERS,
    input: developerInput,
    handler: (actor, input: z.output<typeof developerInput>) =>
      Promise.resolve(admin.developers.add(actor, input.userId)),
  });
  operations.register({
    name: 'administration.developers.remove',
    permission: DEVELOPERS,
    input: developerInput,
    handler: (actor, input: z.output<typeof developerInput>) =>
      Promise.resolve(admin.developers.remove(actor, input.userId)),
  });

  operations.register({
    name: 'administration.modules.list',
    permission: MODULES,
    input: emptyInput,
    handler: () => Promise.resolve(ok({ modules: admin.modules.list() })),
  });
  operations.register({
    name: 'administration.modules.set-enabled',
    permission: MODULES,
    input: setEnabledInput,
    handler: (actor, input: z.output<typeof setEnabledInput>) =>
      admin.modules.setEnabled(actor, input.moduleId, input.enabled),
  });

  operations.register({
    name: 'administration.logs.recent',
    permission: LOGS,
    input: recentLogsInput,
    handler: (_actor, input: z.output<typeof recentLogsInput>) =>
      Promise.resolve(
        ok({ entries: admin.logs.recent({ limit: input.limit, minLevel: input.minLevel }) }),
      ),
  });

  operations.register({
    name: 'administration.sessions.list',
    permission: SESSIONS,
    input: emptyInput,
    handler: () => Promise.resolve(ok({ sessions: admin.sessions.list() })),
  });
  operations.register({
    name: 'administration.sessions.revoke',
    permission: SESSIONS,
    input: revokeSessionInput,
    handler: (actor, input: z.output<typeof revokeSessionInput>) =>
      Promise.resolve(admin.sessions.revoke(actor, input.ref)),
  });
  operations.register({
    name: 'administration.sessions.revoke-all',
    permission: SESSIONS,
    input: revokeAllInput,
    handler: (actor, input: z.output<typeof revokeAllInput>) =>
      Promise.resolve(admin.sessions.revokeAll(actor, input.userId)),
  });
}
