import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Actor } from '../../../shared/contracts/commands.ts';
import type { OperationDefinition } from '../../../shared/contracts/operations.ts';
import { createTestModuleStorage } from '../../../tests/helpers/module-storage.ts';
import { DomainStore } from '../domains.ts';
import { registerDomainOperations } from './domains.ts';

const ACTOR: Actor = { userId: '111111111111111111', roleIds: [], isOwner: false };
const NOW = new Date('2026-11-18T12:00:00.000Z');

let domains: DomainStore;
let operations: Map<string, OperationDefinition>;

function run(name: string, input: unknown) {
  const definition = operations.get(name);
  if (definition === undefined) throw new Error(`missing ${name}`);
  const parsed = (
    definition.input as { safeParse(v: unknown): { success: boolean; data?: unknown } }
  ).safeParse(input);
  if (!parsed.success) return Promise.resolve({ ok: false, error: { code: 'invalid' } });
  return definition.handler(ACTOR, parsed.data);
}

beforeEach(() => {
  const ctx = createTestModuleStorage(fileURLToPath(new URL('..', import.meta.url)));
  domains = new DomainStore(ctx.storage);
  operations = new Map();
  registerDomainOperations(
    {
      operations: {
        register: <I, O>(definition: OperationDefinition<I, O>) => {
          operations.set(definition.name, definition);
        },
        execute: () => Promise.reject(new Error('not used')),
      },
    },
    { domains: () => domains, now: () => NOW },
  );
});

describe('moderation.domains.block and allow', () => {
  it('normalizes and stores the domain on the chosen list', async () => {
    expect(await run('moderation.domains.block', { domain: 'https://Golpe.EXAMPLE/x' })).toEqual({
      ok: true,
      data: { domain: 'golpe.example', list: 'block' },
    });
    expect(domains.isBlocked('golpe.example')).toBe(true);
    expect(await run('moderation.domains.allow', { domain: 'golpe.example' })).toMatchObject({
      ok: true,
      data: { list: 'allow' },
    });
    expect(domains.isAllowed('golpe.example')).toBe(true);
    expect(domains.isBlocked('golpe.example')).toBe(false);
  });

  it('answers invalid for a domain that does not normalize', async () => {
    expect(await run('moderation.domains.block', { domain: '!!!' })).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'Domínio inválido.' },
    });
  });

  it('rejects an empty or oversized domain at the schema', async () => {
    expect(await run('moderation.domains.block', { domain: '' })).toMatchObject({ ok: false });
    expect(await run('moderation.domains.allow', { domain: 'a'.repeat(254) })).toMatchObject({
      ok: false,
    });
  });
});

describe('allow-list refusals', () => {
  it.each(['com.br', 'github.io', 'https://GitHub.io/x'])(
    'refuses the public suffix %s on allow',
    async (domain) => {
      expect(await run('moderation.domains.allow', { domain })).toEqual({
        ok: false,
        error: {
          code: 'invalid',
          message: 'Este domínio é um sufixo público e não pode ser permitido.',
        },
      });
    },
  );

  it('still accepts a subdomain of a public suffix on allow', async () => {
    expect(await run('moderation.domains.allow', { domain: 'x.github.io' })).toMatchObject({
      ok: true,
      data: { domain: 'x.github.io', list: 'allow' },
    });
  });

  it('refuses a lookalike on allow', async () => {
    expect(await run('moderation.domains.allow', { domain: 'steɑm-gift.com' })).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        message: 'Este domínio imita um domínio conhecido e não pode ser permitido.',
      },
    });
  });

  it('still allows blocking both', async () => {
    expect(await run('moderation.domains.block', { domain: 'com.br' })).toMatchObject({ ok: true });
    expect(await run('moderation.domains.block', { domain: 'steɑm-gift.com' })).toMatchObject({
      ok: true,
    });
  });
});

describe('moderation.domains.remove', () => {
  it('removes a listed domain', async () => {
    await run('moderation.domains.block', { domain: 'golpe.example' });
    expect(await run('moderation.domains.remove', { domain: 'golpe.example' })).toEqual({
      ok: true,
      data: { domain: 'golpe.example' },
    });
    expect(domains.isBlocked('golpe.example')).toBe(false);
  });

  it('answers not_found for a domain in no list', async () => {
    expect(await run('moderation.domains.remove', { domain: 'nada.example' })).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Domínio não estava em nenhuma lista.' },
    });
  });

  it('answers invalid for a domain that does not normalize', async () => {
    expect(await run('moderation.domains.remove', { domain: '!!!' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });
});

describe('moderation.domains.list', () => {
  it('lists one list in alphabetical order', async () => {
    await run('moderation.domains.block', { domain: 'b.example' });
    await run('moderation.domains.block', { domain: 'a.example' });
    await run('moderation.domains.allow', { domain: 'c.example' });
    expect(await run('moderation.domains.list', { list: 'block' })).toEqual({
      ok: true,
      data: { list: 'block', domains: ['a.example', 'b.example'] },
    });
  });

  it('caps the page at 1000 domains', async () => {
    for (let i = 0; i < 1001; i += 1) {
      domains.set(`d${String(i).padStart(4, '0')}.example`, 'block', null, NOW.toISOString());
    }
    const result = (await run('moderation.domains.list', { list: 'block' })) as {
      data: { domains: string[] };
    };
    expect(result.data.domains).toHaveLength(1000);
  });

  it('rejects an unknown list', async () => {
    expect(await run('moderation.domains.list', { list: 'other' })).toMatchObject({ ok: false });
  });
});
