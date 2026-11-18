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
});
