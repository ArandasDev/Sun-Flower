import { z } from 'zod';

import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { fail, ok } from '../../../shared/contracts/operations.ts';
import {
  INVALID_DOMAIN,
  DOMAIN_UNKNOWN,
  DOMAIN_PUBLIC_SUFFIX,
  DOMAIN_LOOKALIKE,
} from '../commands/replies.ts';
import { normalizeDomain } from '../detection/links.ts';
import { isLookalike } from '../detection/lookalike.ts';
import type { DomainList, DomainStore } from '../domains.ts';

const DOMAINS_PERMISSION = 'moderation.domains.manage';
const LIST_LIMIT = 1000;
const DOMAIN_MAX = 253;

/** Shared suffixes that must never be allowed as a whole: one entry would trust every site under them. */
const PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  'com.br',
  'net.br',
  'org.br',
  'gov.br',
  'edu.br',
  'co.uk',
  'org.uk',
  'com.au',
  'co.jp',
  'github.io',
  'gitlab.io',
  'pages.dev',
  'workers.dev',
  'vercel.app',
  'netlify.app',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'blogspot.com',
  'glitch.me',
  'repl.co',
]);

export interface DomainOperationDeps {
  readonly domains: () => DomainStore;
  readonly now?: () => Date;
}

export const listInput = z.object({ list: z.enum(['block', 'allow']) });
export const domainInput = z.object({ domain: z.string().min(1).max(DOMAIN_MAX) });

export function registerDomainOperations(
  ctx: Pick<ModuleContext, 'operations'>,
  deps: DomainOperationDeps,
): void {
  const now = deps.now ?? ((): Date => new Date());

  ctx.operations.register({
    name: 'moderation.domains.list',
    permission: DOMAINS_PERMISSION,
    input: listInput,
    handler: (_actor, input: z.output<typeof listInput>) =>
      Promise.resolve(
        ok({ list: input.list, domains: deps.domains().list(input.list, LIST_LIMIT) }),
      ),
  });

  const registerSet = (list: DomainList): void => {
    ctx.operations.register({
      name: `moderation.domains.${list}`,
      permission: DOMAINS_PERMISSION,
      input: domainInput,
      handler: (actor, input: z.output<typeof domainInput>) => {
        const domain = normalizeDomain(input.domain);
        if (domain === undefined) return Promise.resolve(fail('invalid', INVALID_DOMAIN));
        if (list === 'allow') {
          if (isPublicSuffix(domain)) {
            return Promise.resolve(fail('invalid', DOMAIN_PUBLIC_SUFFIX));
          }
          if (isLookalike(domain)) return Promise.resolve(fail('invalid', DOMAIN_LOOKALIKE));
        }
        deps.domains().set(domain, list, actor.userId, now().toISOString());
        return Promise.resolve(ok({ domain, list }));
      },
    });
  };
  registerSet('block');
  registerSet('allow');

  ctx.operations.register({
    name: 'moderation.domains.remove',
    permission: DOMAINS_PERMISSION,
    input: domainInput,
    handler: (_actor, input: z.output<typeof domainInput>) => {
      const domain = normalizeDomain(input.domain);
      if (domain === undefined) return Promise.resolve(fail('invalid', INVALID_DOMAIN));
      if (!deps.domains().remove(domain)) return Promise.resolve(fail('not_found', DOMAIN_UNKNOWN));
      return Promise.resolve(ok({ domain }));
    },
  });
}

export function isPublicSuffix(domain: string): boolean {
  return PUBLIC_SUFFIXES.has(domain);
}
