import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DiscordMessagePayload } from '../../../shared/contracts/discord-events.ts';
import { createFakeGuild } from '../../../tests/helpers/fake-guild.ts';
import type { FakeGuild } from '../../../tests/helpers/fake-guild.ts';
import { createTestModuleStorage } from '../../../tests/helpers/module-storage.ts';
import { createRecordingLogger } from '../../../tests/helpers/recording-logger.ts';
import type { RecordingLogger } from '../../../tests/helpers/recording-logger.ts';
import { CaseStore } from '../cases.ts';
import { configSchema } from '../config.ts';
import type { ModerationConfig } from '../config.ts';
import { MultiChannelTracker } from '../detection/multi-channel.ts';
import { DomainStore } from '../domains.ts';
import { Responder } from '../responder.ts';

const MODULE_DIR = fileURLToPath(new URL('..', import.meta.url));
const NOW = new Date('2026-11-17T12:00:00.000Z');
const ALERT_CHANNEL = '444444444444444444';
const AUTHOR = '111111111111111111';
const CHANNEL = '222222222222222222';
const MESSAGE = '333333333333333333';
const EXEMPT_ROLE = '555555555555555555';
const DEVELOPER = '666666666666666666';

const BLOCKED_CONTENT = 'olha isso https://golpe.com/premio';
const SUSPICIOUS_CONTENT = 'olha isso https://dlscord-promo.com/x';
const CONFIRMED_EDIT = 'nitro grátis em https://dlscord-promo.com/x';

function payload(
  content: string,
  over: Partial<DiscordMessagePayload> = {},
): DiscordMessagePayload {
  return {
    messageId: MESSAGE,
    messageUrl: `https://discord.com/channels/000000000000000000/${CHANNEL}/${MESSAGE}`,
    channelId: CHANNEL,
    authorId: AUTHOR,
    authorRoleIds: [],
    authorJoinedAt: '2020-01-01T00:00:00.000Z',
    authorAccountCreatedAt: '2020-01-01T00:00:00.000Z',
    content,
    ...over,
  };
}

describe('Responder', () => {
  let ctx: ReturnType<typeof createTestModuleStorage>;
  let cases: CaseStore;
  let lists: DomainStore;
  let logger: RecordingLogger;
  let published: { type: string; payload: unknown }[];
  let config: ModerationConfig;

  beforeEach(() => {
    ctx = createTestModuleStorage(MODULE_DIR);
    cases = new CaseStore(ctx.storage);
    lists = new DomainStore(ctx.storage);
    lists.seedOfficial(NOW.toISOString());
    lists.set('golpe.com', 'block', null, NOW.toISOString());
    logger = createRecordingLogger();
    published = [];
    config = configSchema.parse({ alertChannelId: ALERT_CHANNEL, exemptRoleIds: [EXEMPT_ROLE] });
  });
  afterEach(() => {
    ctx.close();
  });

  function responder(guild: FakeGuild): Responder {
    return new Responder({
      guild,
      cases,
      lists,
      tracker: new MultiChannelTracker({ maxAuthors: 1000, maxEntries: 50 }),
      config: () => config,
      isDeveloper: (userId) => userId === DEVELOPER,
      publish: (type, p) => published.push({ type, payload: p }),
      logger,
      now: () => NOW,
    });
  }

  const actions = (guild: FakeGuild) => guild.calls.map((c) => c.action);

  it('deletes, times out, records, publishes and alerts on a confirmed scam', async () => {
    const guild = createFakeGuild();
    await responder(guild).handle(payload(BLOCKED_CONTENT));

    expect(guild.calls).toContainEqual({ action: 'deleteMessage', args: [CHANNEL, MESSAGE] });
    expect(guild.calls).toContainEqual({
      action: 'timeout',
      args: [AUTHOR, 3_600_000, 'phishing: blocked'],
    });
    const record = cases.findLatestByMessage(MESSAGE);
    expect(record).toMatchObject({
      kind: 'automatic',
      level: 'confirmed',
      action: 'delete_timeout',
      status: 'actioned',
      outcome: { delete: 'ok', timeout: 'ok' },
      targetUserId: AUTHOR,
      channelId: CHANNEL,
      domains: ['golpe.com'],
      score: 100,
      reason: 'phishing: blocked',
      timeoutUntil: '2026-11-17T13:00:00.000Z',
      createdAt: NOW.toISOString(),
    });
    expect(published).toEqual([
      {
        type: 'moderation.case.created',
        payload: {
          caseId: record?.id,
          kind: 'automatic',
          level: 'confirmed',
          action: 'delete_timeout',
        },
      },
    ]);
    const alert = guild.calls.find((c) => c.action === 'sendMessage');
    expect(alert?.args[0]).toBe(ALERT_CHANNEL);
    expect(alert?.args[1]).toContain(`🚨 Caso #${String(record?.id)} — violação confirmada`);
  });

  it('still times out when deleteMessage fails', async () => {
    const guild = createFakeGuild({ deleteMessage: { ok: false, error: 'not_found' } });
    await responder(guild).handle(payload(BLOCKED_CONTENT));

    expect(actions(guild)).toContain('timeout');
    expect(cases.findLatestByMessage(MESSAGE)?.outcome).toEqual({
      delete: 'not_found',
      timeout: 'ok',
    });
  });

  it('records a failure when a guild action rejects', async () => {
    const guild = createFakeGuild();
    guild.timeout = () => Promise.reject(new Error('boom'));
    await expect(responder(guild).handle(payload(BLOCKED_CONTENT))).resolves.toBeUndefined();
    expect(cases.findLatestByMessage(MESSAGE)?.outcome).toEqual({
      delete: 'ok',
      timeout: 'failed',
    });
  });

  it('records a failure when a guild action throws synchronously', async () => {
    const guild = createFakeGuild();
    guild.deleteMessage = () => {
      throw new Error('boom');
    };
    await responder(guild).handle(payload(BLOCKED_CONTENT));
    expect(cases.findLatestByMessage(MESSAGE)?.outcome).toEqual({
      delete: 'failed',
      timeout: 'ok',
    });
  });

  it('only alerts on a suspicious message', async () => {
    const guild = createFakeGuild();
    await responder(guild).handle(payload(SUSPICIOUS_CONTENT));

    expect(actions(guild)).toEqual(['sendMessage']);
    const record = cases.findLatestByMessage(MESSAGE);
    expect(record).toMatchObject({
      level: 'suspicious',
      action: 'none',
      status: 'open',
      outcome: {},
      timeoutUntil: null,
    });
    expect(guild.calls[0]?.args[1]).toContain(`/mod case dismiss ${String(record?.id)}`);
    expect(published).toHaveLength(1);
  });

  it('does nothing for a clean message', async () => {
    const guild = createFakeGuild();
    await responder(guild).handle(payload('bom dia https://discord.com/x'));
    expect(guild.calls).toEqual([]);
    expect(cases.findLatestByMessage(MESSAGE)).toBeUndefined();
  });

  it('ignores authors with an exempt role', async () => {
    const guild = createFakeGuild();
    await responder(guild).handle(payload(BLOCKED_CONTENT, { authorRoleIds: [EXEMPT_ROLE] }));
    expect(guild.calls).toEqual([]);
    expect(cases.findLatestByMessage(MESSAGE)).toBeUndefined();
    expect(published).toEqual([]);
  });

  it('ignores bot developers', async () => {
    const guild = createFakeGuild();
    await responder(guild).handle(payload(BLOCKED_CONTENT, { authorId: DEVELOPER }));
    expect(guild.calls).toEqual([]);
    expect(cases.findLatestByMessage(MESSAGE)).toBeUndefined();
  });

  it('warns once per instance when no alert channel is configured', async () => {
    config = configSchema.parse({});
    const guild = createFakeGuild();
    const r = responder(guild);
    await r.handle(payload(BLOCKED_CONTENT));
    await r.handle(payload(BLOCKED_CONTENT, { messageId: '777777777777777777' }));

    expect(actions(guild)).not.toContain('sendMessage');
    const warnings = logger.entries.filter(
      (e) => e.level === 'warn' && e.msg === 'moderation alert channel not configured',
    );
    expect(warnings).toHaveLength(1);
    expect(cases.findLatestByMessage('777777777777777777')).toBeDefined();
  });

  it('warns and keeps the case when the alert cannot be sent', async () => {
    const guild = createFakeGuild({ sendMessage: { ok: false, error: 'forbidden' } });
    await expect(responder(guild).handle(payload(BLOCKED_CONTENT))).resolves.toBeUndefined();

    const record = cases.findLatestByMessage(MESSAGE);
    expect(record).toBeDefined();
    expect(logger.entries).toContainEqual({
      level: 'warn',
      obj: { module: 'moderation', caseId: record?.id, error: 'forbidden' },
      msg: 'moderation alert failed',
    });
  });

  it('ignores an edit at the same level as the existing case', async () => {
    const guild = createFakeGuild();
    const r = responder(guild);
    await r.handle(payload(SUSPICIOUS_CONTENT));
    const first = cases.findLatestByMessage(MESSAGE);
    guild.calls.length = 0;
    published.length = 0;

    await r.handle(payload(`${SUSPICIOUS_CONTENT} editado`));
    expect(guild.calls).toEqual([]);
    expect(published).toEqual([]);
    expect(cases.findLatestByMessage(MESSAGE)?.id).toBe(first?.id);
  });

  it('ignores a lower-level edit of a confirmed case', async () => {
    const guild = createFakeGuild();
    const r = responder(guild);
    await r.handle(payload(BLOCKED_CONTENT));
    guild.calls.length = 0;

    await r.handle(payload(SUSPICIOUS_CONTENT));
    expect(guild.calls).toEqual([]);
  });

  it('opens a new case and acts when an edit raises the level', async () => {
    const guild = createFakeGuild();
    const r = responder(guild);
    await r.handle(payload(SUSPICIOUS_CONTENT));
    const first = cases.findLatestByMessage(MESSAGE);
    guild.calls.length = 0;

    await r.handle(payload(CONFIRMED_EDIT));
    const second = cases.findLatestByMessage(MESSAGE);
    expect(second?.id).not.toBe(first?.id);
    expect(second).toMatchObject({ level: 'confirmed', status: 'actioned' });
    expect(actions(guild)).toEqual(
      expect.arrayContaining(['deleteMessage', 'timeout', 'sendMessage']),
    );
  });

  it('logs an error and resolves when analysis throws', async () => {
    const guild = createFakeGuild();
    const r = new Responder({
      guild,
      cases,
      lists,
      tracker: new MultiChannelTracker(),
      config: () => {
        throw new Error('settings unavailable');
      },
      isDeveloper: () => false,
      publish: () => {},
      logger,
      now: () => NOW,
    });
    await expect(r.handle(payload(BLOCKED_CONTENT))).resolves.toBeUndefined();
    expect(logger.entries).toContainEqual({
      level: 'error',
      obj: { error: 'settings unavailable' },
      msg: 'moderation analysis failed',
    });
  });

  it('never logs message content or user, channel or message IDs', async () => {
    const guild = createFakeGuild({ sendMessage: { ok: false, error: 'failed' } });
    const r = responder(guild);
    await r.handle(payload(BLOCKED_CONTENT));
    await r.handle(payload(SUSPICIOUS_CONTENT, { messageId: '777777777777777777' }));

    const logged = JSON.stringify(logger.entries);
    for (const secret of [BLOCKED_CONTENT, 'golpe.com', AUTHOR, CHANNEL, MESSAGE]) {
      expect(logged).not.toContain(secret);
    }
  });
});
