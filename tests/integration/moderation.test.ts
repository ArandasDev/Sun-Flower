import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
});
