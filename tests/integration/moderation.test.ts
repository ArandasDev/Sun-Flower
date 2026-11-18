import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { startCore } from '../../core/application/core.ts';
import { createFakeGuild } from '../helpers/fake-guild.ts';
import { createRecordingLogger } from '../helpers/recording-logger.ts';

const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));

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
});
