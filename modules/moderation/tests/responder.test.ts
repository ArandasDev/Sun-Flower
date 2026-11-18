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
import { ActivityLog } from '../spam/activity.ts';
import { SpamCooldown } from '../spam/rules.ts';

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
      activity: new ActivityLog(),
      cooldown: new SpamCooldown(),
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

  it.each(['forbidden', 'not_found'] as const)(
    'leaves timeoutUntil empty when the timeout is refused (%s)',
    async (error) => {
      const guild = createFakeGuild({ timeout: { ok: false, error } });
      await responder(guild).handle(payload(BLOCKED_CONTENT));
      expect(cases.findLatestByMessage(MESSAGE)).toMatchObject({
        outcome: { delete: 'ok', timeout: error },
        timeoutUntil: null,
      });
    },
  );

  it('keeps timeoutUntil when the timeout failed without a refusal', async () => {
    const guild = createFakeGuild({ timeout: { ok: false, error: 'failed' } });
    await responder(guild).handle(payload(BLOCKED_CONTENT));
    expect(cases.findLatestByMessage(MESSAGE)?.timeoutUntil).toBe('2026-11-17T13:00:00.000Z');
  });

  it('acts once when the same message is handled concurrently', async () => {
    const guild = createFakeGuild();
    const r = responder(guild);
    await Promise.all([r.handle(payload(BLOCKED_CONTENT)), r.handle(payload(BLOCKED_CONTENT))]);

    const count = (action: string) => guild.calls.filter((c) => c.action === action).length;
    expect(count('deleteMessage')).toBe(1);
    expect(count('timeout')).toBe(1);
    expect(count('sendMessage')).toBe(1);
    expect(cases.listRecent(10)).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  it('acts once for a confirmed edit racing a suspicious analysis', async () => {
    const guild = createFakeGuild();
    const r = responder(guild);
    await Promise.all([
      r.handle(payload(SUSPICIOUS_CONTENT)),
      r.handle(payload(CONFIRMED_EDIT)),
      r.handle(payload(CONFIRMED_EDIT)),
    ]);

    const count = (action: string) => guild.calls.filter((c) => c.action === action).length;
    expect(count('deleteMessage')).toBe(1);
    expect(count('timeout')).toBe(1);
    const levels = cases.listRecent(10).map((c) => c.level);
    expect(levels.filter((l) => l === 'confirmed')).toHaveLength(1);
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
      activity: new ActivityLog(),
      cooldown: new SpamCooldown(),
      config: () => {
        throw new RangeError('settings unavailable');
      },
      isDeveloper: () => false,
      publish: () => {},
      logger,
      now: () => NOW,
    });
    await expect(r.handle(payload(BLOCKED_CONTENT))).resolves.toBeUndefined();
    expect(logger.entries).toContainEqual({
      level: 'error',
      obj: { error: 'RangeError' },
      msg: 'moderation analysis failed',
    });
    expect(JSON.stringify(logger.entries)).not.toContain('settings unavailable');
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

describe('Responder spam handling', () => {
  const OTHER_AUTHOR = '777777777777777777';
  const OTHER_CHANNEL = '888888888888888888';
  const MENTIONS = Array.from({ length: 6 }, (_, i) => `<@10000000000000000${String(i)}>`).join(
    ' ',
  );

  let ctx: ReturnType<typeof createTestModuleStorage>;
  let cases: CaseStore;
  let logger: RecordingLogger;
  let published: { type: string; payload: unknown }[];
  let config: ModerationConfig;
  let clock: number;
  let guild: FakeGuild;
  let r: Responder;

  const id = (i: number) => String(900000000000000000n + BigInt(i));

  function build(g: FakeGuild = createFakeGuild()): void {
    guild = g;
    const lists = new DomainStore(ctx.storage);
    lists.seedOfficial(NOW.toISOString());
    r = new Responder({
      guild,
      cases,
      lists,
      tracker: new MultiChannelTracker({ maxAuthors: 1000, maxEntries: 50 }),
      activity: new ActivityLog({ maxAuthors: 2000, maxEntries: 200 }),
      cooldown: new SpamCooldown(),
      config: () => config,
      isDeveloper: (userId) => userId === DEVELOPER,
      publish: (type, p) => published.push({ type, payload: p }),
      logger,
      now: () => new Date(clock),
    });
  }

  function setSpam(spam: Record<string, unknown>): void {
    config = configSchema.parse({
      alertChannelId: ALERT_CHANNEL,
      exemptRoleIds: [EXEMPT_ROLE],
      spam,
    });
  }

  function message(i: number, over: Partial<DiscordMessagePayload> = {}): DiscordMessagePayload {
    const channelId = over.channelId ?? CHANNEL;
    return payload(`mensagem ${String(i)}`, {
      messageId: id(i),
      messageUrl: `https://discord.com/channels/000000000000000000/${channelId}/${id(i)}`,
      ...over,
    });
  }

  /** Sends `count` messages starting at index `from`, `stepMs` apart. */
  async function surge(
    from: number,
    count: number,
    stepMs = 500,
    over: (i: number) => Partial<DiscordMessagePayload> = () => ({}),
  ): Promise<void> {
    for (let i = from; i < from + count; i++) {
      await r.handle(message(i, over(i)));
      clock += stepMs;
    }
  }

  const callsOf = (action: string) => guild.calls.filter((c) => c.action === action);
  const ids = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => id(from + i));

  beforeEach(() => {
    ctx = createTestModuleStorage(MODULE_DIR);
    cases = new CaseStore(ctx.storage);
    logger = createRecordingLogger();
    published = [];
    clock = NOW.getTime();
    setSpam({ flood: { limit: 8 } });
    build();
  });
  afterEach(() => {
    ctx.close();
  });

  it('bulk-deletes a flood surge and times the author out', async () => {
    await surge(0, 8);

    expect(callsOf('bulkDeleteMessages')).toEqual([
      { action: 'bulkDeleteMessages', args: [CHANNEL, ids(0, 8)] },
    ]);
    expect(callsOf('timeout')).toEqual([
      { action: 'timeout', args: [AUTHOR, 600_000, 'spam: flood'] },
    ]);
    const all = cases.listRecent(10);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'automatic',
      level: 'confirmed',
      action: 'delete_timeout',
      status: 'actioned',
      messageId: id(7),
      rules: [{ rule: 'flood', count: 8, seconds: 5 }],
      reason: 'spam: flood',
      outcome: { deleted: '8', individually: '0', bulk: 'ok', timeout: 'ok' },
      timeoutUntil: new Date(NOW.getTime() + 3500 + 600_000).toISOString(),
    });
    expect(published).toHaveLength(1);
    const alert = callsOf('sendMessage')[0]?.args[1] as string;
    expect(alert).toContain('Regras: flood (8 mensagens em 5 s)');
    expect(alert).toContain('Ação: 8 mensagens apagadas, timeout de 10 min');
    expect(alert).not.toContain('reincidência');
  });

  it('groups deletions by channel', async () => {
    await surge(0, 8, 500, (i) => ({ channelId: i % 2 === 0 ? CHANNEL : OTHER_CHANNEL }));

    const bulk = callsOf('bulkDeleteMessages');
    expect(bulk).toHaveLength(2);
    expect(bulk).toEqual(
      expect.arrayContaining([
        { action: 'bulkDeleteMessages', args: [CHANNEL, [id(0), id(2), id(4), id(6)]] },
        { action: 'bulkDeleteMessages', args: [OTHER_CHANNEL, [id(1), id(3), id(5), id(7)]] },
      ]),
    );
    expect(cases.listRecent(1)[0]?.outcome['deleted']).toBe('8');
  });

  it('slices 150 messages of one channel into batches of 100 and 50', async () => {
    setSpam({ mentions: { deleteMinutes: 10 } });
    await surge(0, 149, 1000);
    expect(cases.listRecent(10)).toEqual([]);
    await r.handle(message(149, { content: MENTIONS }));

    const bulk = callsOf('bulkDeleteMessages');
    expect(bulk.map((c) => (c.args[1] as string[]).length)).toEqual([100, 50]);
    expect(bulk.flatMap((c) => c.args[1] as string[])).toEqual(ids(0, 150));
    expect(cases.listRecent(1)[0]).toMatchObject({
      rules: [{ rule: 'mentions', count: 6 }],
      outcome: { deleted: '150', individually: '0', bulk: 'ok' },
    });
  });

  it('lets the ban delete the messages when deleteMinutes is above 0', async () => {
    setSpam({ flood: { limit: 8, punishment: 'ban', deleteMinutes: 2 } });
    await surge(0, 8);

    expect(callsOf('bulkDeleteMessages')).toEqual([]);
    expect(callsOf('ban')).toEqual([{ action: 'ban', args: [AUTHOR, 'spam: flood', 120] }]);
    expect(callsOf('timeout')).toEqual([]);
    expect(cases.listRecent(1)[0]).toMatchObject({
      action: 'ban',
      status: 'actioned',
      outcome: { ban: 'ok' },
      timeoutUntil: null,
    });
  });

  it('bans and bulk-deletes the triggering messages when deleteMinutes is 0', async () => {
    setSpam({ flood: { limit: 8, punishment: 'ban', deleteMinutes: 0 } });
    await surge(0, 8);

    expect(callsOf('ban')).toEqual([{ action: 'ban', args: [AUTHOR, 'spam: flood', 0] }]);
    expect(callsOf('bulkDeleteMessages')).toEqual([
      { action: 'bulkDeleteMessages', args: [CHANNEL, ids(0, 8)] },
    ]);
    expect(cases.listRecent(1)[0]).toMatchObject({
      action: 'ban',
      outcome: { deleted: '8', individually: '0', bulk: 'ok', ban: 'ok' },
    });
  });

  it('kicks when the rule says so', async () => {
    setSpam({ flood: { limit: 8, punishment: 'kick' } });
    await surge(0, 8);

    expect(callsOf('kick')).toEqual([{ action: 'kick', args: [AUTHOR, 'spam: flood'] }]);
    expect(callsOf('bulkDeleteMessages')).toHaveLength(1);
    expect(cases.listRecent(1)[0]).toMatchObject({
      action: 'kick',
      status: 'actioned',
      outcome: { deleted: '8', bulk: 'ok', kick: 'ok' },
    });
  });

  it('sends only new messages on a second surge and escalates it', async () => {
    await surge(0, 8);
    clock += 40_000;
    guild.calls.length = 0;
    await surge(8, 8);

    expect(callsOf('bulkDeleteMessages')).toEqual([
      { action: 'bulkDeleteMessages', args: [CHANNEL, ids(8, 8)] },
    ]);
    expect(callsOf('timeout')).toEqual([
      { action: 'timeout', args: [AUTHOR, 3_600_000, 'spam: flood'] },
    ]);
    expect(cases.listRecent(1)[0]?.outcome['deleted']).toBe('8');
    const alert = callsOf('sendMessage')[0]?.args[1] as string;
    expect(alert).toContain('Ação: 8 mensagens apagadas, timeout de 60 min (reincidência 2)');
  });

  it('escalates per user: another author starts at step 1', async () => {
    await surge(0, 8);
    clock += 40_000;
    await surge(8, 8);
    expect(cases.countActionedSpamSince(AUTHOR, NOW.toISOString())).toBe(2);
    guild.calls.length = 0;

    await surge(16, 8, 500, () => ({ authorId: OTHER_AUTHOR }));
    expect(callsOf('timeout')).toEqual([
      { action: 'timeout', args: [OTHER_AUTHOR, 600_000, 'spam: flood'] },
    ]);
  });

  it('records a partial bulk deletion', async () => {
    setSpam({ flood: { limit: 23 } });
    build(createFakeGuild({}, { ok: true, deleted: 18, individually: 2 }));
    await surge(0, 23, 100);

    expect(cases.listRecent(1)[0]?.outcome).toEqual({
      deleted: '18',
      individually: '2',
      bulk: 'ok',
      timeout: 'ok',
    });
    const alert = callsOf('sendMessage')[0]?.args[1] as string;
    expect(alert).toContain('Ação: exclusão parcial: 18 de 23 apagadas, timeout de 10 min');
  });

  it('records the first bulk error', async () => {
    build(createFakeGuild({}, { ok: false, error: 'forbidden', deleted: 0 }));
    await surge(0, 8);

    expect(cases.listRecent(1)[0]?.outcome).toMatchObject({
      deleted: '0',
      individually: '0',
      bulk: 'forbidden',
      timeout: 'ok',
    });
  });

  it('records a rejected bulk call as failed and still punishes', async () => {
    build();
    guild.bulkDeleteMessages = () => Promise.reject(new Error('boom'));
    await surge(0, 8);

    expect(cases.listRecent(1)[0]).toMatchObject({
      status: 'actioned',
      outcome: { deleted: '0', individually: '0', bulk: 'failed', timeout: 'ok' },
    });
  });

  it('keeps the case open when the punishment is refused, so it does not escalate', async () => {
    build(createFakeGuild({ timeout: { ok: false, error: 'forbidden' } }));
    await surge(0, 8);

    expect(cases.listRecent(1)[0]).toMatchObject({
      action: 'delete_timeout',
      status: 'open',
      outcome: { timeout: 'forbidden' },
      timeoutUntil: null,
    });
    clock += 40_000;
    guild.calls.length = 0;
    await surge(8, 8);
    expect(callsOf('timeout')[0]?.args[1]).toBe(600_000);
  });

  it('only alerts when the rule punishment is none', async () => {
    setSpam({ flood: { limit: 8, punishment: 'none' } });
    await surge(0, 8);

    expect(callsOf('bulkDeleteMessages')).toEqual([]);
    expect(callsOf('timeout')).toEqual([]);
    expect(cases.listRecent(1)[0]).toMatchObject({
      level: 'suspicious',
      action: 'none',
      status: 'open',
      outcome: {},
      rules: [{ rule: 'flood', count: 8, seconds: 5 }],
    });
    const alert = callsOf('sendMessage')[0]?.args[1] as string;
    expect(alert).toContain('⚠️ Caso');
    expect(alert).toContain('Ação: nenhuma');
  });

  it('does not record edits as activity', async () => {
    for (let i = 0; i < 8; i++) {
      await r.handle(message(i), 'updated');
      clock += 500;
    }
    expect(guild.calls).toEqual([]);
    expect(cases.listRecent(10)).toEqual([]);
  });

  it('ignores exempt authors and developers', async () => {
    await surge(0, 8, 500, () => ({ authorRoleIds: [EXEMPT_ROLE] }));
    await surge(8, 8, 500, () => ({ authorId: DEVELOPER }));
    expect(guild.calls).toEqual([]);
    expect(cases.listRecent(10)).toEqual([]);
  });

  it('never logs message content or IDs', async () => {
    build(createFakeGuild({ sendMessage: { ok: false, error: 'failed' } }));
    await surge(0, 8);

    const logged = JSON.stringify(logger.entries);
    for (const secret of ['mensagem', AUTHOR, CHANNEL, id(0), id(7)]) {
      expect(logged).not.toContain(secret);
    }
  });
});
