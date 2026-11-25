import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startCore, type CoreHandle } from '../../core/application/core.ts';
import type { Actor } from '../../shared/contracts/commands.ts';
import { createFakeGuild } from '../helpers/fake-guild.ts';
import { createRecordingLogger } from '../helpers/recording-logger.ts';

const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));
const MEMBER: Actor = { userId: '111111111111111111', roleIds: [], isOwner: false };
const OWNER: Actor = { userId: '222222222222222222', roleIds: [], isOwner: true };
const DEVELOPER: Actor = { userId: '333333333333333333', roleIds: [], isOwner: false };
const OTHER_USER = '444444444444444444';
const ROLE = '555555555555555555';

const FORBIDDEN = {
  ok: false,
  error: { code: 'forbidden', message: 'Você não tem permissão para isso.' },
};

const ALL_OPERATIONS: [string, unknown][] = [
  ['administration.grants.list', {}],
  ['administration.grants.grant', { permission: 'moderation.cases.read', roleId: ROLE }],
  ['administration.grants.revoke', { permission: 'moderation.cases.read', roleId: ROLE }],
  ['administration.developers.list', {}],
  ['administration.developers.add', { userId: OTHER_USER }],
  ['administration.developers.remove', { userId: OTHER_USER }],
  ['administration.modules.list', {}],
  ['administration.modules.set-enabled', { moduleId: 'ping', enabled: false }],
  ['administration.logs.recent', {}],
  ['administration.sessions.list', {}],
  ['administration.sessions.revoke', { ref: '0123456789abcdef' }],
  ['administration.sessions.revoke-all', { userId: OTHER_USER }],
];

let dir: string;
let core: CoreHandle;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflower-admin-'));
  core = await startCore({
    dbPath: path.join(dir, 'test.db'),
    modulesDir: MODULES_DIR,
    logger: createRecordingLogger(),
    guild: createFakeGuild(),
  });
  core.permissions.addDeveloper(DEVELOPER.userId);
});

afterEach(async () => {
  await core.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const run = (name: string, actor: Actor, input: unknown) =>
  core.operations.execute(name, actor, input, 'dashboard');

describe('administration operations through the Core', () => {
  it('forbids a member on all 12 operations', async () => {
    expect(ALL_OPERATIONS).toHaveLength(12);
    for (const [name, input] of ALL_OPERATIONS) {
      expect(await run(name, MEMBER, input), name).toEqual(FORBIDDEN);
    }
  });

  it('gives an owner who is not a developer only the grants operations', async () => {
    for (const name of [
      'administration.developers.list',
      'administration.modules.list',
      'administration.logs.recent',
      'administration.sessions.list',
    ]) {
      expect(await run(name, OWNER, {}), name).toEqual(FORBIDDEN);
    }
    expect(
      await run('administration.grants.grant', OWNER, {
        permission: 'moderation.cases.read',
        roleId: ROLE,
      }),
    ).toEqual({ ok: true, data: { granted: true } });
    expect(await run('administration.grants.list', OWNER, {})).toMatchObject({
      ok: true,
      data: { grants: [{ permission: 'moderation.cases.read', roleId: ROLE }] },
    });
  });

  it('refuses an owner associating administration.grants.manage with a role', async () => {
    expect(
      await run('administration.grants.grant', OWNER, {
        permission: 'administration.grants.manage',
        roleId: ROLE,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'Esta permissão não pode ser associada a cargos.' },
    });
  });

  it('lets a developer list modules, developers, sessions and logs', async () => {
    const modules = await run('administration.modules.list', DEVELOPER, {});
    expect(modules).toMatchObject({ ok: true });
    const ids = (modules as { data: { modules: { id: string }[] } }).data.modules.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['administration', 'moderation', 'ping']));
    expect(await run('administration.developers.list', DEVELOPER, {})).toMatchObject({
      ok: true,
      data: { developers: [{ userId: DEVELOPER.userId }] },
    });
    expect(await run('administration.sessions.list', DEVELOPER, {})).toEqual({
      ok: true,
      data: { sessions: [] },
    });
    expect(await run('administration.logs.recent', DEVELOPER, { limit: 10 })).toMatchObject({
      ok: true,
      data: { entries: expect.any(Array) as unknown },
    });
  });

  it('lets a developer disable and re-enable moderation, taking /mod away and back', async () => {
    expect(core.commands().has('mod')).toBe(true);

    const off = await run('administration.modules.set-enabled', DEVELOPER, {
      moduleId: 'moderation',
      enabled: false,
    });
    expect(off).toMatchObject({ ok: true, data: { changed: true } });
    expect(core.commands().has('mod')).toBe(false);
    expect(await run('moderation.cases.list', DEVELOPER, {})).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Operação desconhecida.' },
    });

    const on = await run('administration.modules.set-enabled', DEVELOPER, {
      moduleId: 'moderation',
      enabled: true,
    });
    expect(on).toMatchObject({ ok: true, data: { changed: true } });
    expect(core.commands().has('mod')).toBe(true);
    expect(await run('moderation.cases.list', DEVELOPER, {})).toMatchObject({ ok: true });
  });

  it('refuses to disable the administration module', async () => {
    expect(
      await run('administration.modules.set-enabled', DEVELOPER, {
        moduleId: 'administration',
        enabled: false,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'Este módulo não pode ser desligado.' },
    });
    expect(await run('administration.modules.list', DEVELOPER, {})).toMatchObject({ ok: true });
  });
});

describe('the core.admin capability in the repository', () => {
  it('is declared only by the administration module', () => {
    const holders = fs
      .readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => {
        const file = path.join(MODULES_DIR, entry.name, 'manifest.json');
        if (!fs.existsSync(file)) return false;
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { capabilities?: string[] };
        return manifest.capabilities?.includes('core.admin') === true;
      })
      .map((entry) => entry.name);
    expect(holders).toEqual(['administration']);
  });
});
