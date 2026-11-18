import { describe, expect, it } from 'vitest';

import { configSchema } from '../config.ts';
import { ActivityLog } from '../spam/activity.ts';
import { SpamCooldown, countMentions, evaluateSpam } from '../spam/rules.ts';
import type { SpamHit } from '../spam/rules.ts';

const A = '111111111111111111';
const B = '333333333333333333';
const CH1 = '222222222222222222';
const CH2 = '444444444444444444';
const T0 = 1_000_000;

function setup(overrides: Record<string, unknown> = {}) {
  const config = configSchema.parse({ spam: overrides }).spam;
  return { activity: new ActivityLog(), cooldown: new SpamCooldown(), config };
}

type Deps = ReturnType<typeof setup>;
let seq = 0;

function send(
  deps: Deps,
  content: string,
  nowMs: number,
  extra: { authorId?: string; channelId?: string; isEdit?: boolean } = {},
) {
  seq += 1;
  return evaluateSpam(
    {
      authorId: extra.authorId ?? A,
      messageId: `m${String(seq)}`,
      channelId: extra.channelId ?? CH1,
      content,
      nowMs,
      isEdit: extra.isEdit ?? false,
    },
    deps,
  );
}

describe('countMentions', () => {
  it('counts distinct users and roles, with <@!id> equal to <@id>', () => {
    expect(countMentions('<@111111111111111111> <@!1> <@111111111111111111>')).toBe(1);
    expect(countMentions('<@111111111111111111> <@&111111111111111111>')).toBe(2);
    expect(
      countMentions('<@111111111111111111> <@222222222222222222> <@&333333333333333333>'),
    ).toBe(3);
  });

  it('counts 3 per @everyone or @here occurrence', () => {
    expect(countMentions('@everyone')).toBe(3);
    expect(countMentions('@everyone @here @everyone')).toBe(9);
    expect(countMentions('oi')).toBe(0);
  });
});

describe('flood', () => {
  it('fires with 7 messages in 5 seconds and reports the entries', () => {
    const deps = setup();
    let hits: SpamHit[] = [];
    for (let i = 0; i < 7; i += 1) hits = send(deps, `a${String(i)}`, T0 + i * 500);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ rule: 'flood', count: 7, seconds: 5 });
    expect(hits[0]?.messageIds).toHaveLength(7);
  });

  it('does not fire with 6 messages', () => {
    const deps = setup();
    let hits: SpamHit[] = [];
    for (let i = 0; i < 6; i += 1) hits = send(deps, `a${String(i)}`, T0 + i * 500);
    expect(hits).toEqual([]);
  });

  it('does not fire with 7 messages in 10 seconds', () => {
    const deps = setup();
    let hits: SpamHit[] = [];
    for (let i = 0; i < 7; i += 1) hits = send(deps, `a${String(i)}`, T0 + i * 1600);
    expect(hits).toEqual([]);
  });

  it('sums channels', () => {
    const deps = setup();
    let hits: SpamHit[] = [];
    for (let i = 0; i < 7; i += 1) {
      hits = send(deps, `a${String(i)}`, T0 + i * 100, { channelId: i % 2 === 0 ? CH1 : CH2 });
    }
    expect(hits[0]?.rule).toBe('flood');
  });

  it('does not mix authors', () => {
    const deps = setup();
    let hits: SpamHit[] = [];
    for (let i = 0; i < 4; i += 1) {
      send(deps, `a${String(i)}`, T0 + i * 100, { authorId: A });
      hits = send(deps, `b${String(i)}`, T0 + i * 100 + 50, { authorId: B });
    }
    expect(hits).toEqual([]);
  });

  it('does not fire when disabled', () => {
    const deps = setup({ flood: { enabled: false } });
    let hits: SpamHit[] = [];
    for (let i = 0; i < 7; i += 1) hits = send(deps, `a${String(i)}`, T0 + i * 100);
    expect(hits).toEqual([]);
  });
});

describe('repeat', () => {
  it('fires with 4 copies', () => {
    const deps = setup();
    const texts = [
      'Compre agora mesmo!',
      'compre AGORA mesmo!',
      'Compré  agora mesmo!',
      'compre agora\u200B mesmo!',
    ];
    let hits: SpamHit[] = [];
    texts.forEach((text, i) => {
      hits = send(deps, text, T0 + i * 1000);
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ rule: 'repeat', count: 4, seconds: 60 });
    expect(hits[0]?.messageIds).toHaveLength(4);
  });

  it('does not fire with 4 different texts', () => {
    const deps = setup();
    let hits: SpamHit[] = [];
    for (let i = 0; i < 4; i += 1)
      hits = send(deps, `texto bem diferente numero ${String(i)}`, T0 + i * 1000);
    expect(hits).toEqual([]);
  });

  it('ignores short texts', () => {
    const deps = setup();
    let hits: SpamHit[] = [];
    for (let i = 0; i < 4; i += 1) hits = send(deps, 'kkkkkkk', T0 + i * 1000);
    expect(hits).toEqual([]);
    for (let i = 0; i < 4; i += 1) hits = send(deps, 'bom dia', T0 + 10_000 + i * 1000);
    expect(hits).toEqual([]);
  });
});

describe('mentions', () => {
  it('fires with 6 distinct mentions in one message', () => {
    const deps = setup();
    const hits = send(
      deps,
      '<@111111111111111111> <@222222222222222222> <@333333333333333333> <@444444444444444444> <@555555555555555555> <@&666666666666666666>',
      T0,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ rule: 'mentions', count: 6 });
    expect(hits[0]?.seconds).toBeUndefined();
    expect(hits[0]?.messageIds).toHaveLength(1);
  });

  it('does not fire for the same person 6 times', () => {
    expect(
      send(
        setup(),
        '<@111111111111111111> <@111111111111111111> <@111111111111111111> <@111111111111111111> <@111111111111111111> <@111111111111111111>',
        T0,
      ),
    ).toEqual([]);
  });

  it('fires with 2 @everyone and not with 5 mentions', () => {
    expect(send(setup(), '@everyone @everyone', T0)[0]?.rule).toBe('mentions');
    expect(
      send(
        setup(),
        '<@111111111111111111> <@222222222222222222> <@333333333333333333> <@444444444444444444> <@555555555555555555>',
        T0,
      ),
    ).toEqual([]);
  });

  it('evaluates edits without recording them', () => {
    const deps = setup();
    const hits = send(deps, '@everyone @here', T0, { isEdit: true });
    expect(hits[0]?.rule).toBe('mentions');
    expect(deps.activity.since(A, 0)).toEqual([]);
  });

  it('edits never trigger flood', () => {
    const deps = setup();
    let hits: SpamHit[] = [];
    for (let i = 0; i < 10; i += 1) hits = send(deps, `a${String(i)}`, T0 + i, { isEdit: true });
    expect(hits).toEqual([]);
  });
});

describe('ignored channels', () => {
  it('neither record nor fire', () => {
    const deps = setup({ ignoredChannelIds: [CH1] });
    let hits: SpamHit[] = [];
    for (let i = 0; i < 7; i += 1) hits = send(deps, `a${String(i)}`, T0 + i * 100);
    expect(hits).toEqual([]);
    expect(deps.activity.since(A, 0)).toEqual([]);
    expect(send(deps, '@everyone @everyone', T0 + 1000)).toEqual([]);
  });
});

describe('cooldown', () => {
  it('blocks a second firing within 30 seconds and allows it after 31', () => {
    const deps = setup();
    const burst = (start: number) => {
      let hits: SpamHit[] = [];
      for (let i = 0; i < 7; i += 1) hits = send(deps, `a${String(i)}`, start + i * 100);
      return hits;
    };
    expect(burst(T0)).toHaveLength(1);
    expect(burst(T0 + 10_000)).toEqual([]);
    expect(burst(T0 + 31_000)).toHaveLength(1);
  });

  it('is per rule: mentions fire while flood is cooling', () => {
    const deps = setup();
    for (let i = 0; i < 7; i += 1) send(deps, `a${String(i)}`, T0 + i * 100);
    const hits = send(deps, '@everyone @everyone', T0 + 1000);
    expect(hits.map((hit) => hit.rule)).toEqual(['mentions']);
  });

  it('prunes marks older than 30 seconds', () => {
    const cooldown = new SpamCooldown();
    cooldown.mark(A, 'flood', T0);
    expect(cooldown.isCooling(A, 'flood', T0 + 29_000)).toBe(true);
    cooldown.prune(T0 + 31_000);
    expect(cooldown.isCooling(A, 'flood', T0)).toBe(false);
  });
});

describe('false-positive guards', () => {
  it('requires a right boundary on @everyone and @here', () => {
    expect(countMentions('@heresia @heresia')).toBe(0);
    expect(countMentions('contato@herelabs.example.com')).toBe(0);
    expect(countMentions('@everyone!')).toBe(3);
  });

  it('requires a left boundary on @everyone and @here', () => {
    expect(countMentions('fulano@everyone.com.br')).toBe(0);
    expect(countMentions('contato@here.example.com')).toBe(0);
    expect(countMentions('a_@everyone x.@here 9@here')).toBe(0);
    expect(countMentions('oi @everyone (@here) "@everyone"')).toBe(9);
  });

  it('ignores code, escaped mentions and short IDs', () => {
    expect(countMentions('\\@everyone `@here`')).toBe(0);
    expect(countMentions('```\n@everyone @everyone\n```')).toBe(0);
    expect(countMentions('\\<@111111111111111111> <@1>')).toBe(0);
    expect(countMentions('`@everyone` @everyone')).toBe(3);
  });

  it('does not fire repeat or mentions when disabled', () => {
    const deps = setup({ repeat: { enabled: false }, mentions: { enabled: false } });
    for (let i = 0; i < 4; i += 1) {
      expect(send(deps, 'Compre agora mesmo!', T0 + i * 1000)).toEqual([]);
    }
    expect(send(deps, '@everyone @everyone', T0 + 9000)).toEqual([]);
  });

  it('stops counting repeat copies outside the window', () => {
    const deps = setup();
    for (let i = 0; i < 3; i += 1) send(deps, 'Compre agora mesmo!', T0 + i * 1000);
    expect(send(deps, 'Compre agora mesmo!', T0 + 70_000)).toEqual([]);
  });

  it('returns flood before repeat', () => {
    const deps = setup({ repeat: { limit: 7 } });
    let hits: SpamHit[] = [];
    for (let i = 0; i < 7; i += 1) hits = send(deps, 'Compre agora mesmo!', T0 + i * 100);
    expect(hits.map((hit) => hit.rule)).toEqual(['flood', 'repeat']);
  });

  it('edit in an ignored channel returns [] and records nothing', () => {
    const deps = setup({ ignoredChannelIds: [CH1] });
    expect(send(deps, '@everyone @everyone', T0, { isEdit: true })).toEqual([]);
    expect(deps.activity.since(A, 0)).toEqual([]);
  });
});
