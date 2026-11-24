import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { startCore } from '../../core/application/core.ts';
import { validateManifest } from '../../core/module-registry/manifest.ts';
import { dispatchCommand, type RawInteraction } from '../../interfaces/discord/commands.ts';
import { createRecordingLogger } from '../helpers/recording-logger.ts';
import { CORE_API_VERSION } from '../../shared/contracts/module.ts';

const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL('../../modules/ping/manifest.json', import.meta.url));

interface Reply {
  readonly content: string;
  readonly ephemeral: boolean;
}

function fakeInteraction(fields: {
  commandName: string;
  guildId: string;
}): RawInteraction & { replies: Reply[] } {
  const replies: Reply[] = [];
  return {
    ...fields,
    replies,
    userId: '111111111111111111',
    roleIds: [],
    isOwner: false,
    channelId: '222222222222222222',
    subcommandGroup: undefined,
    subcommand: undefined,
    options: {
      getString: () => undefined,
      getInteger: () => undefined,
      getBoolean: () => undefined,
      getUser: () => undefined,
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
}

describe('ping module', () => {
  it('has a manifest accepted by the core', () => {
    const manifestJson: unknown = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    expect(validateManifest(manifestJson, 'ping', CORE_API_VERSION).ok).toBe(true);
  });

  it('answers /ping end to end through the real modules directory', async () => {
    const logger = createRecordingLogger();
    const core = await startCore({ dbPath: ':memory:', modulesDir: MODULES_DIR, logger });
    try {
      expect(core.status().get('ping')?.state).toBe('RUNNING');
      const raw = fakeInteraction({ commandName: 'ping', guildId: '000000000000000000' });
      await dispatchCommand(raw, core.commands(), logger);
      expect(raw.replies).toEqual([{ content: 'Pong!', ephemeral: false }]);
    } finally {
      await core.stop();
    }
  });
});
