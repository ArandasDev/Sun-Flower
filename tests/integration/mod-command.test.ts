import { describe, expect, it, vi } from 'vitest';

import { assertValidCommand } from '../../core/module-registry/lifecycle.ts';
import { buildModCommand } from '../../modules/moderation/commands/mod-command.ts';
import type { ModCommandDeps } from '../../modules/moderation/commands/mod-command.ts';

describe('/mod command definition', () => {
  it('passes the Core command validator', () => {
    const command = buildModCommand({
      permissions: { check: () => true, isDeveloper: () => false, hasAnyGrant: () => false },
      config: { get: <T>() => ({}) as T, set: vi.fn(), version: () => 0 },
      publish: vi.fn(),
    } as unknown as ModCommandDeps);
    expect(() => {
      assertValidCommand(command);
    }).not.toThrow();
  });
});
