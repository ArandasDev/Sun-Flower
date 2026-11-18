import { describe, expect, it } from 'vitest';

import { formatAlert } from '../alert.ts';
import type { CaseRecord } from '../cases.ts';

const MESSAGE_URL =
  'https://discord.com/channels/000000000000000000/222222222222222222/333333333333333333';

function record(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: 12,
    kind: 'automatic',
    level: 'confirmed',
    action: 'delete_timeout',
    targetUserId: '111111111111111111',
    actorUserId: null,
    channelId: '222222222222222222',
    messageId: '333333333333333333',
    domains: ['dlscord-gift.com'],
    signals: [
      { name: 'lookalike', points: 60 },
      { name: 'bait', points: 30 },
    ],
    rules: [],
    score: 90,
    reason: 'phishing: lookalike, bait',
    outcome: { delete: 'ok', timeout: 'ok' },
    status: 'actioned',
    timeoutUntil: '2026-11-17T13:00:00.000Z',
    createdAt: '2026-11-17T12:00:00.000Z',
    revertedBy: null,
    revertedAt: null,
    ...overrides,
  };
}

describe('formatAlert', () => {
  it('renders a confirmed case exactly as the spec', () => {
    expect(formatAlert(record(), MESSAGE_URL)).toBe(
      [
        '🚨 Caso #12 — violação confirmada',
        'Usuário: <@111111111111111111> · Canal: <#222222222222222222>',
        'Domínios: `dlscord-gift.com`',
        'Sinais: lookalike (60), bait (30) = 90',
        'Ação: mensagem apagada, timeout de 60 min',
        'Reverter: /mod case revert 12',
      ].join('\n'),
    );
  });

  it('puts every domain in backticks', () => {
    const text = formatAlert(record({ domains: ['a.com', 'b.net'] }), MESSAGE_URL);
    expect(text).toContain('Domínios: `a.com`, `b.net`');
  });

  it('stays within the Discord limit with many long domains', () => {
    const domains = Array.from(
      { length: 20 },
      (_, i) => `${'a'.repeat(114)}${String(i).padStart(2, '0')}.com`,
    );
    expect(domains[0]).toHaveLength(120);
    const text = formatAlert(record({ domains }), MESSAGE_URL);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain('e mais 15');
    expect(text).toContain(`\`${'a'.repeat(99)}…\``);
    expect(text).toContain('Reverter: /mod case revert 12');
  });

  it('lists five domains without a remainder note', () => {
    const domains = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'];
    const text = formatAlert(record({ domains }), MESSAGE_URL);
    expect(text).toContain('Domínios: `a.com`, `b.com`, `c.com`, `d.com`, `e.com`\n');
  });

  it('reports a failed timeout on the action line', () => {
    const text = formatAlert(
      record({ outcome: { delete: 'ok', timeout: 'forbidden' } }),
      MESSAGE_URL,
    );
    expect(text).toContain('Ação: mensagem apagada, timeout não aplicado (sem permissão)');
  });

  it('reports a failed delete on the action line', () => {
    const text = formatAlert(
      record({ outcome: { delete: 'not_found', timeout: 'failed' } }),
      MESSAGE_URL,
    );
    expect(text).toContain(
      'Ação: mensagem não apagada (não encontrado), timeout não aplicado (falha)',
    );
  });

  it('adds the message link to a confirmed case whose delete failed', () => {
    const text = formatAlert(
      record({ outcome: { delete: 'forbidden', timeout: 'ok' } }),
      MESSAGE_URL,
    );
    expect(text).toBe(
      [
        '🚨 Caso #12 — violação confirmada',
        'Usuário: <@111111111111111111> · Canal: <#222222222222222222>',
        'Domínios: `dlscord-gift.com`',
        'Sinais: lookalike (60), bait (30) = 90',
        'Ação: mensagem não apagada (sem permissão), timeout de 60 min',
        `Mensagem: ${MESSAGE_URL}`,
        'Reverter: /mod case revert 12',
      ].join('\n'),
    );
  });

  it('omits the message link when a confirmed delete succeeded', () => {
    expect(formatAlert(record(), MESSAGE_URL)).not.toContain('Mensagem:');
  });

  it('renders a suspicious case with the message link and suggestions', () => {
    const text = formatAlert(
      record({
        level: 'suspicious',
        action: 'none',
        status: 'open',
        outcome: {},
        timeoutUntil: null,
        signals: [{ name: 'lookalike', points: 60 }],
        score: 60,
      }),
      MESSAGE_URL,
    );
    expect(text).toBe(
      [
        '⚠️ Caso #12 — suspeito',
        'Usuário: <@111111111111111111> · Canal: <#222222222222222222>',
        'Domínios: `dlscord-gift.com`',
        'Sinais: lookalike (60) = 60',
        'Ação: nenhuma',
        `Mensagem: ${MESSAGE_URL}`,
        'Sugestão: /mod case dismiss 12 ou /mod timeout',
      ].join('\n'),
    );
    expect(text).toContain('/mod case dismiss 12');
  });

  describe('spam cases', () => {
    function spam(overrides: Partial<CaseRecord> = {}): CaseRecord {
      return record({
        domains: [],
        signals: [],
        score: 0,
        rules: [
          { rule: 'flood', count: 9, seconds: 5 },
          { rule: 'repeat', count: 4, seconds: 60 },
        ],
        reason: 'spam: flood, repeat',
        outcome: { deleted: '23', individually: '0', bulk: 'ok', timeout: 'ok' },
        ...overrides,
      });
    }

    it('renders the rules and the action line exactly as spec §4.8', () => {
      expect(formatAlert(spam(), MESSAGE_URL, { requested: 23, escalationStep: 2 })).toBe(
        [
          '🚨 Caso #12 — violação confirmada',
          'Usuário: <@111111111111111111> · Canal: <#222222222222222222>',
          'Regras: flood (9 mensagens em 5 s), repeat (4 cópias em 60 s)',
          'Ação: 23 mensagens apagadas, timeout de 60 min (reincidência 2)',
          'Reverter: /mod case revert 12',
        ].join('\n'),
      );
    });

    it('omits the escalation note on the first step', () => {
      const text = formatAlert(spam(), MESSAGE_URL, { requested: 23, escalationStep: 1 });
      expect(text).toContain('Ação: 23 mensagens apagadas, timeout de 60 min\n');
    });

    it('renders mentions and a single deleted message', () => {
      const text = formatAlert(
        spam({
          rules: [{ rule: 'mentions', count: 8 }],
          outcome: { deleted: '1', individually: '1', bulk: 'ok', timeout: 'ok' },
        }),
        MESSAGE_URL,
        { requested: 1 },
      );
      expect(text).toContain('Regras: mentions (8 menções)\n');
      expect(text).toContain('Ação: 1 mensagem apagada, timeout de 60 min\n');
    });

    it('reports a partial deletion and links the message', () => {
      const text = formatAlert(
        spam({ outcome: { deleted: '18', individually: '0', bulk: 'ok', timeout: 'ok' } }),
        MESSAGE_URL,
        { requested: 23 },
      );
      expect(text).toContain('Ação: exclusão parcial: 18 de 23 apagadas, timeout de 60 min\n');
      expect(text).toContain(`Mensagem: ${MESSAGE_URL}`);
    });

    it('reports a refused deletion and a refused timeout', () => {
      const text = formatAlert(
        spam({
          outcome: { deleted: '0', individually: '0', bulk: 'forbidden', timeout: 'forbidden' },
          timeoutUntil: null,
        }),
        MESSAGE_URL,
        { requested: 23 },
      );
      expect(text).toContain(
        'Ação: mensagens não apagadas (sem permissão), timeout não aplicado (sem permissão)\n',
      );
      expect(text).toContain(`Mensagem: ${MESSAGE_URL}`);
    });

    it('renders kick and ban punishments', () => {
      const kick = formatAlert(
        spam({
          action: 'kick',
          timeoutUntil: null,
          outcome: { deleted: '9', individually: '0', bulk: 'ok', kick: 'ok' },
        }),
        MESSAGE_URL,
        { requested: 9, escalationStep: 3 },
      );
      expect(kick).toContain('Ação: 9 mensagens apagadas, expulsão (reincidência 3)\n');
      const ban = formatAlert(
        spam({ action: 'ban', timeoutUntil: null, outcome: { ban: 'ok' } }),
        MESSAGE_URL,
        { requested: 0 },
      );
      expect(ban).toContain('Ação: banimento com exclusão das mensagens recentes\n');
      expect(ban).not.toContain('Mensagem:');
      const refused = formatAlert(
        spam({ action: 'ban', timeoutUntil: null, outcome: { ban: 'forbidden' } }),
        MESSAGE_URL,
        { requested: 0 },
      );
      expect(refused).toContain('Ação: banimento não aplicado (sem permissão)\n');
      expect(refused).toContain(`Mensagem: ${MESSAGE_URL}`);
    });

    it('keeps the phishing lines when the same message also had a scam link', () => {
      const text = formatAlert(
        spam({
          domains: ['dlscord-gift.com'],
          signals: [{ name: 'lookalike', points: 60 }],
          score: 60,
        }),
        MESSAGE_URL,
        { requested: 23 },
      );
      expect(text).toContain(
        'Domínios: `dlscord-gift.com`\nSinais: lookalike (60) = 60\nRegras: flood',
      );
    });

    it('renders an alert-only spam case with the link and suggestions', () => {
      expect(
        formatAlert(
          spam({
            level: 'suspicious',
            action: 'none',
            status: 'open',
            outcome: {},
            timeoutUntil: null,
          }),
          MESSAGE_URL,
        ),
      ).toBe(
        [
          '⚠️ Caso #12 — suspeito',
          'Usuário: <@111111111111111111> · Canal: <#222222222222222222>',
          'Regras: flood (9 mensagens em 5 s), repeat (4 cópias em 60 s)',
          'Ação: nenhuma',
          `Mensagem: ${MESSAGE_URL}`,
          'Sugestão: /mod case dismiss 12 ou /mod timeout',
        ].join('\n'),
      );
    });

    it('stays within the Discord limit with many rules and domains', () => {
      const rules = Array.from({ length: 200 }, (_, i) => ({
        rule: 'flood' as const,
        count: 1000 + i,
        seconds: 600,
      }));
      const domains = Array.from({ length: 20 }, (_, i) => `${'a'.repeat(116)}${String(i)}.com`);
      const text = formatAlert(spam({ rules, domains }), MESSAGE_URL, {
        requested: 23,
        escalationStep: 2,
      });
      expect(text.length).toBeLessThanOrEqual(2000);
      expect(text).toContain('Ação: 23 mensagens apagadas, timeout de 60 min (reincidência 2)');
      expect(text).toContain('Reverter: /mod case revert 12');
    });
  });
});
