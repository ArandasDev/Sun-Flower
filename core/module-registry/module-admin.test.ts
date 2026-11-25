import { describe, expect, it } from 'vitest';
import type { AdminService } from '../../shared/contracts/admin.ts';
import type { ModuleManifest } from '../../shared/contracts/module.ts';
import { createModuleAdmin } from './module-admin.ts';

function manifest(capabilities: ModuleManifest['capabilities']): ModuleManifest {
  return {
    id: 'plain',
    name: 'Plain',
    description: 'Test',
    version: '1.0.0',
    apiVersion: '1.4.0',
    entrypoint: 'index.ts',
    dependencies: [],
    permissions: [],
    capabilities,
    enabledByDefault: true,
    events: { subscribes: [], publishes: [] },
  };
}

const ACTOR = { userId: '111111111111111111', roleIds: [], isOwner: false };

describe('createModuleAdmin', () => {
  it('throws synchronously without the capability', () => {
    const admin = createModuleAdmin({ manifest: manifest([]), service: undefined });
    expect(() => admin.developers.list()).toThrow('Module "plain" lacks capability core.admin');
    expect(() => admin.logs.recent({ limit: 1, minLevel: 'info' })).toThrow(
      'Module "plain" lacks capability core.admin',
    );
  });

  it('rejects modules.setEnabled without the capability instead of throwing', async () => {
    const admin = createModuleAdmin({ manifest: manifest([]), service: undefined });
    let promise: Promise<unknown> | undefined;
    expect(() => {
      promise = admin.modules.setEnabled(ACTOR, 'ping', false);
    }).not.toThrow();
    await expect(promise).rejects.toThrow('Module "plain" lacks capability core.admin');
  });

  it('rejects modules.setEnabled while the service is missing', async () => {
    const admin = createModuleAdmin({ manifest: manifest(['core.admin']), service: undefined });
    await expect(admin.modules.setEnabled(ACTOR, 'ping', false)).rejects.toThrow(
      'Admin service is not available',
    );
  });

  it('refuses every call while the module is not active', async () => {
    let active = false;
    const service = {
      developers: { list: () => [] },
      modules: { setEnabled: () => Promise.resolve({ ok: true, data: 'x' }) },
    } as unknown as AdminService;
    const admin = createModuleAdmin({
      manifest: manifest(['core.admin']),
      service,
      isActive: () => active,
    });
    expect(() => admin.developers.list()).toThrow('Module "plain" is not active');
    await expect(admin.modules.setEnabled(ACTOR, 'ping', true)).rejects.toThrow(
      'Module "plain" is not active',
    );
    active = true;
    expect(admin.developers.list()).toEqual([]);
  });

  it('delegates to the service with the capability', async () => {
    const service = {
      developers: { list: () => [] },
      modules: { setEnabled: () => Promise.resolve({ ok: true, data: 'x' }) },
    } as unknown as AdminService;
    const admin = createModuleAdmin({ manifest: manifest(['core.admin']), service });
    expect(admin.developers.list()).toEqual([]);
    await expect(admin.modules.setEnabled(ACTOR, 'ping', true)).resolves.toEqual({
      ok: true,
      data: 'x',
    });
  });
});
