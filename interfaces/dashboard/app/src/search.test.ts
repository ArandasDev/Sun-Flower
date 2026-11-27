import { expect, it } from 'vitest';
import { normalizeSearch } from './search.ts';

it('ignores accents when matching', () => {
  expect(normalizeSearch('Domínio')).toBe(normalizeSearch('dominio'));
  expect(normalizeSearch('Sessões, ação, você')).toBe('sessoes, acao, voce');
});

it('ignores case when matching', () => {
  expect(normalizeSearch('ABC')).toBe('abc');
});
