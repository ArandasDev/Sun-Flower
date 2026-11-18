import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { startCore, type CoreHandle } from '../../core/application/core.ts';
import { dispatchCommand, type RawInteraction } from '../../interfaces/discord/commands.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { createFakeGuild } from '../helpers/fake-guild.ts';
import { createRecordingLogger } from '../helpers/recording-logger.ts';

const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));
const MODERATOR = '111111111111111111';
const MODERATOR_ROLE = '222222222222222222';
const TARGET = '333333333333333333';
const TARGET_ROLE = '444444444444444444';

describe('moderation module', () => {
  it('reaches RUNNING with ping and creates its tables', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflower-mod-'));
    const dbPath = path.join(dir, 'test.db');
    try {
      const core = await startCore({
        dbPath,
        modulesDir: MODULES_DIR,
        logger: createRecordingLogger(),
        guild: createFakeGuild(),
      });
      try {
        expect(core.status().get('moderation')?.state).toBe('RUNNING');
        expect(core.status().get('ping')?.state).toBe('RUNNING');
      } finally {
        await core.stop();
      }
      const db = new DatabaseSync(dbPath);
      try {
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row['name']);
        expect(tables).toContain('moderation_cases');
        expect(tables).toContain('moderation_domains');
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deletes, times out and alerts on a message with a blocked domain', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflower-mod-'));
    const dbPath = path.join(dir, 'test.db');
    const alertChannelId = '444444444444444444';
    try {
      // The first start creates the Core and module tables; then seed config and the block list.
      const first = await startCore({
        dbPath,
        modulesDir: MODULES_DIR,
        logger: createRecordingLogger(),
        guild: createFakeGuild(),
      });
      await first.stop();
      const db = new DatabaseSync(dbPath);
      try {
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO module_config (module_id, settings, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(module_id) DO UPDATE SET settings = excluded.settings`,
        ).run('moderation', JSON.stringify({ alertChannelId }), now);
        db.prepare(
          `INSERT INTO moderation_domains (domain, list, added_by, added_at)
           VALUES (?, 'block', NULL, ?)`,
        ).run('golpe.com', now);
      } finally {
        db.close();
      }

      const guild = createFakeGuild();
      const core = await startCore({
        dbPath,
        modulesDir: MODULES_DIR,
        logger: createRecordingLogger(),
        guild,
      });
      try {
        expect(core.status().get('moderation')?.state).toBe('RUNNING');
        core.publishCoreEvent('discord.message.created', {
          messageId: '333333333333333333',
          messageUrl:
            'https://discord.com/channels/000000000000000000/222222222222222222/333333333333333333',
          channelId: '222222222222222222',
          authorId: '111111111111111111',
          authorRoleIds: [],
          authorJoinedAt: '2020-01-01T00:00:00.000Z',
          authorAccountCreatedAt: '2020-01-01T00:00:00.000Z',
          content: 'veja https://golpe.com/premio',
        });
        await vi.waitFor(() => {
          expect(guild.calls.map((c) => c.action)).toEqual(
            expect.arrayContaining(['deleteMessage', 'timeout', 'sendMessage']),
          );
        });
        expect(guild.calls.find((c) => c.action === 'sendMessage')?.args[0]).toBe(alertChannelId);
      } finally {
        await core.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function dispatchTimeout(core: CoreHandle, logger: Logger) {
    const strings: Record<string, string> = { user: TARGET, reason: 'spam' };
    const integers: Record<string, number> = { minutes: 30 };
    const replies: { content: string; ephemeral: boolean }[] = [];
    const raw: RawInteraction = {
      commandName: 'mod',
      userId: MODERATOR,
      roleIds: [MODERATOR_ROLE],
      guildId: '000000000000000000',
      channelId: '555555555555555555',
      subcommandGroup: undefined,
      subcommand: 'timeout',
      options: {
        getString: (name) => strings[name],
        getInteger: (name) => integers[name],
        getBoolean: () => undefined,
        getUser: (name) => strings[name],
        getChannel: () => undefined,
        getRole: () => undefined,
      },
      reply: async (content, ephemeral) => {
        await Promise.resolve();
        replies.push({ content, ephemeral });
      },
      deferReply: async () => {},
      editReply: async () => {},
    };
    await dispatchCommand(raw, core.commands(), logger);
    return replies;
  }

  it('applies /mod timeout dispatched by a moderator with the timeout grant', async () => {
    const logger = createRecordingLogger();
    const guild = createFakeGuild();
    guild.memberRoles.set(TARGET, [TARGET_ROLE]);
    const core = await startCore({ dbPath: ':memory:', modulesDir: MODULES_DIR, logger, guild });
    try {
      core.permissions.grant('moderation.actions.timeout', MODERATOR_ROLE);
      expect(await dispatchTimeout(core, logger)).toEqual([
        { content: 'Timeout aplicado (caso #1).', ephemeral: true },
      ]);
      expect(guild.calls.find((c) => c.action === 'timeout')?.args).toEqual([
        TARGET,
        1_800_000,
        'spam',
      ]);
    } finally {
      await core.stop();
    }
  });

  it('refuses /mod timeout against a member whose role has a moderation.* grant', async () => {
    const logger = createRecordingLogger();
    const guild = createFakeGuild();
    guild.memberRoles.set(TARGET, [TARGET_ROLE]);
    const core = await startCore({ dbPath: ':memory:', modulesDir: MODULES_DIR, logger, guild });
    try {
      core.permissions.grant('moderation.actions.timeout', MODERATOR_ROLE);
      core.permissions.grant('moderation.cases.read', TARGET_ROLE);
      expect(await dispatchTimeout(core, logger)).toEqual([
        { content: 'Não é possível agir contra este membro.', ephemeral: true },
      ]);
      expect(guild.calls.some((c) => c.action === 'timeout')).toBe(false);
    } finally {
      await core.stop();
    }
  });
});
