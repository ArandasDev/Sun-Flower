import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startCore, type CoreHandle } from '../../core/application/core.ts';
import type { Actor } from '../../shared/contracts/commands.ts';
import { createFakeGuild, type FakeGuild } from '../helpers/fake-guild.ts';
import { createRecordingLogger } from '../helpers/recording-logger.ts';

const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));
const MEMBER: Actor = { userId: '111111111111111111', roleIds: [], isOwner: false };
const OWNER: Actor = { userId: '222222222222222222', roleIds: [], isOwner: true };
const TARGET = '333333333333333333';
const TARGET_ROLE = '444444444444444444';

const FORBIDDEN = {
  ok: false,
  error: { code: 'forbidden', message: 'Você não tem permissão para isso.' },
};

let dir: string;
let core: CoreHandle;
let guild: FakeGuild;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflower-ops-'));
  guild = createFakeGuild();
  guild.memberRoles.set(TARGET, [TARGET_ROLE]);
  core = await startCore({
    dbPath: path.join(dir, 'test.db'),
    modulesDir: MODULES_DIR,
    logger: createRecordingLogger(),
    guild,
  });
});

afterEach(async () => {
  await core.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const run = (name: string, actor: Actor, input: unknown) =>
  core.operations.execute(name, actor, input, 'dashboard');

describe('moderation operations through the Core', () => {
  it('forbids a member without grants on every guarded operation and writes no case', async () => {
    const calls: [string, unknown][] = [
      ['moderation.config.view', {}],
      ['moderation.config.update', { expectedVersion: 0, changes: {} }],
      ['moderation.domains.list', { list: 'block' }],
      ['moderation.domains.block', { domain: 'golpe.example' }],
      ['moderation.domains.allow', { domain: 'golpe.example' }],
      ['moderation.domains.remove', { domain: 'golpe.example' }],
      ['moderation.cases.list', {}],
      ['moderation.cases.view', { id: 1 }],
      ['moderation.cases.revert', { id: 1 }],
      ['moderation.cases.dismiss', { id: 1 }],
      ['moderation.actions.warn', { userId: TARGET, reason: 'spam' }],
      ['moderation.actions.timeout', { userId: TARGET, minutes: 5, reason: 'spam' }],
      ['moderation.actions.kick', { userId: TARGET, reason: 'spam' }],
      ['moderation.actions.ban', { userId: TARGET, reason: 'spam' }],
    ];
    for (const [name, input] of calls) {
      expect(await run(name, MEMBER, input), name).toEqual(FORBIDDEN);
    }
    expect(guild.calls).toHaveLength(0);
    expect(await run('moderation.cases.list', OWNER, {})).toEqual({
      ok: true,
      data: { cases: [], nextCursor: null },
    });
  });

  it('lets an owner without roles time out a member but not themselves', async () => {
    const done = await run('moderation.actions.timeout', OWNER, {
      userId: TARGET,
      minutes: 10,
      reason: 'spam',
    });
    expect(done).toEqual({ ok: true, data: { caseId: 1 } });
    expect(guild.calls.some((c) => c.action === 'timeout')).toBe(true);

    const self = await run('moderation.actions.timeout', OWNER, {
      userId: OWNER.userId,
      minutes: 10,
      reason: 'spam',
    });
    expect(self).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'Não é possível agir contra você mesmo.' },
    });
    expect(guild.calls.filter((c) => c.action === 'timeout')).toHaveLength(1);
  });

  it('rejects an unknown config key without echoing it', async () => {
    const result = await run('moderation.config.update', OWNER, {
      expectedVersion: 0,
      changes: { secretKeyName: 1 },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(JSON.stringify(result)).not.toContain('secretKeyName');
  });

  it('lets a member list their own cases', async () => {
    expect(await run('moderation.cases.mine', MEMBER, {})).toEqual({
      ok: true,
      data: { cases: [] },
    });
  });
});
