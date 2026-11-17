import { describe, expect, it } from 'vitest';

import {
  DISCORD_MESSAGE_CREATED,
  DISCORD_MESSAGE_UPDATED,
} from '../../shared/contracts/discord-events.ts';
import { createRecordingLogger } from '../../tests/helpers/recording-logger.ts';
import {
  ContentIntentMonitor,
  guardHandler,
  handleMessageCreate,
  handleMessageUpdate,
  isContentChange,
  shouldPublish,
  toMessagePayload,
  type RawMessage,
} from './messages.ts';

const guildId = '000000000000000000';

function raw(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    guildId,
    messageId: '111111111111111111',
    messageUrl: 'https://example.test/m',
    channelId: '222222222222222222',
    authorId: '333333333333333333',
    authorIsBot: false,
    isWebhook: false,
    content: 'hello',
    hasNonTextParts: false,
    authorRoleIds: ['111111111111111111'],
    authorJoinedAt: '2026-01-01T00:00:00.000Z',
    authorAccountCreatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('shouldPublish', () => {
  it('accepts a human message in the configured guild', () => {
    expect(shouldPublish(raw(), guildId)).toBe(true);
  });

  it('rejects other guilds, DMs, bots and webhooks', () => {
    expect(shouldPublish(raw({ guildId: '222222222222222222' }), guildId)).toBe(false);
    expect(shouldPublish(raw({ guildId: null }), guildId)).toBe(false);
    expect(shouldPublish(raw({ authorIsBot: true }), guildId)).toBe(false);
    expect(shouldPublish(raw({ isWebhook: true }), guildId)).toBe(false);
  });
});

describe('toMessagePayload', () => {
  it('copies the payload fields and nothing else', () => {
    const payload = toMessagePayload(raw());
    expect(payload).toEqual({
      messageId: '111111111111111111',
      messageUrl: 'https://example.test/m',
      channelId: '222222222222222222',
      authorId: '333333333333333333',
      authorRoleIds: ['111111111111111111'],
      authorJoinedAt: '2026-01-01T00:00:00.000Z',
      authorAccountCreatedAt: '2025-01-01T00:00:00.000Z',
      content: 'hello',
    });
    for (const key of ['guildId', 'authorIsBot', 'isWebhook', 'hasNonTextParts']) {
      expect(payload).not.toHaveProperty(key);
    }
  });
});

describe('isContentChange', () => {
  it('compares old and new content, treating unknown as a change', () => {
    expect(isContentChange('a', 'a')).toBe(false);
    expect(isContentChange('a', 'b')).toBe(true);
    expect(isContentChange(null, 'a')).toBe(true);
  });
});

describe('ContentIntentMonitor', () => {
  const empty = (): RawMessage => raw({ content: '' });

  it('logs the error once after a fully empty sample', () => {
    const logger = createRecordingLogger();
    const monitor = new ContentIntentMonitor(logger);
    for (let i = 0; i < 21; i += 1) monitor.observe(empty());
    const errors = logger.entries.filter((e) => e.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toBe(
      'message content is empty: enable the Message Content Intent in the Discord Developer Portal',
    );
  });

  it('does not log when any sampled message has text', () => {
    const logger = createRecordingLogger();
    const monitor = new ContentIntentMonitor(logger);
    for (let i = 0; i < 5; i += 1) monitor.observe(empty());
    monitor.observe(raw({ content: 'text' }));
    for (let i = 0; i < 30; i += 1) monitor.observe(empty());
    expect(logger.entries).toHaveLength(0);
  });

  it('does not count attachment-only messages in the sample', () => {
    const logger = createRecordingLogger();
    const monitor = new ContentIntentMonitor(logger);
    for (let i = 0; i < 30; i += 1) monitor.observe(raw({ content: '', hasNonTextParts: true }));
    expect(logger.entries).toHaveLength(0);
    for (let i = 0; i < 20; i += 1) monitor.observe(empty());
    expect(logger.entries.filter((e) => e.level === 'error')).toHaveLength(1);
  });
});

describe('handlers', () => {
  function setup() {
    const logger = createRecordingLogger();
    const published: { type: string; payload: unknown; context: unknown }[] = [];
    const deps = {
      guildId,
      monitor: new ContentIntentMonitor(logger),
      publish: (type: string, payload: unknown, context: unknown) => {
        published.push({ type, payload, context });
      },
    };
    return { deps, published };
  }

  it('publishes created messages with the author and channel as context', () => {
    const { deps, published } = setup();
    handleMessageCreate(raw(), deps);
    expect(published).toEqual([
      {
        type: DISCORD_MESSAGE_CREATED,
        payload: toMessagePayload(raw()),
        context: { userId: '333333333333333333', channelId: '222222222222222222' },
      },
    ]);
  });

  it('ignores bots and other guilds on create', () => {
    const { deps, published } = setup();
    handleMessageCreate(raw({ authorIsBot: true }), deps);
    handleMessageCreate(raw({ guildId: '222222222222222222' }), deps);
    expect(published).toHaveLength(0);
  });

  it('publishes an update only when the content changed', () => {
    const { deps, published } = setup();
    handleMessageUpdate('hello', raw(), deps);
    expect(published).toHaveLength(0);
    handleMessageUpdate('old', raw(), deps);
    handleMessageUpdate(null, raw(), deps);
    expect(published.map((p) => p.type)).toEqual([
      DISCORD_MESSAGE_UPDATED,
      DISCORD_MESSAGE_UPDATED,
    ]);
  });

  it('ignores updates from bots', () => {
    const { deps, published } = setup();
    handleMessageUpdate('old', raw({ isWebhook: true }), deps);
    expect(published).toHaveLength(0);
  });
});

describe('guardHandler', () => {
  it('logs only the error message when the handler throws', () => {
    const logger = createRecordingLogger();
    guardHandler(logger, () => {
      throw new Error('boom');
    });
    expect(logger.entries).toEqual([
      { level: 'error', obj: { error: 'boom' }, msg: 'discord message event failed' },
    ]);
  });

  it('is silent when the handler succeeds', () => {
    const logger = createRecordingLogger();
    guardHandler(logger, () => undefined);
    expect(logger.entries).toHaveLength(0);
  });
});
