import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import type { DomainList } from '../domains.ts';
import type { ModCommandDeps } from './mod-command.ts';
import { DOMAIN_REMOVED, DOMAIN_SET, INVALID_DOMAIN } from './replies.ts';

const EPHEMERAL = { ephemeral: true } as const;
const LIST_LIMIT = 50;
const REPLY_BUDGET = 1900;
const MORE_RESERVE = 12;
const DOMAIN_MAX = 100;

const clip = (domain: string): string =>
  domain.length > DOMAIN_MAX ? `${domain.slice(0, DOMAIN_MAX - 1)}…` : domain;

async function setList(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
  list: DomainList,
): Promise<void> {
  const input = interaction.options.getString('domain');
  if (input === undefined) {
    await interaction.reply(INVALID_DOMAIN, EPHEMERAL);
    return;
  }
  const result = await deps.operations.execute(`moderation.domains.${list}`, interaction.actor, {
    domain: input,
  });
  await interaction.reply(
    result.ok ? DOMAIN_SET(list, (result.data as { domain: string }).domain) : result.error.message,
    EPHEMERAL,
  );
}

export function domainBlock(interaction: CommandInteraction, deps: ModCommandDeps): Promise<void> {
  return setList(interaction, deps, 'block');
}

export function domainAllow(interaction: CommandInteraction, deps: ModCommandDeps): Promise<void> {
  return setList(interaction, deps, 'allow');
}

export async function domainRemove(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const input = interaction.options.getString('domain');
  if (input === undefined) {
    await interaction.reply(INVALID_DOMAIN, EPHEMERAL);
    return;
  }
  const result = await deps.operations.execute('moderation.domains.remove', interaction.actor, {
    domain: input,
  });
  await interaction.reply(
    result.ok ? DOMAIN_REMOVED((result.data as { domain: string }).domain) : result.error.message,
    EPHEMERAL,
  );
}

export async function domainList(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const chosen = interaction.options.getString('list');
  const lists: readonly DomainList[] =
    chosen === 'block' ? ['block'] : chosen === 'allow' ? ['allow'] : ['block', 'allow'];
  const budget = Math.floor(REPLY_BUDGET / lists.length);
  const sections: string[] = [];
  for (const list of lists) {
    const header = list === 'block' ? 'Bloqueados:' : 'Permitidos:';
    const result = await deps.operations.execute('moderation.domains.list', interaction.actor, {
      list,
    });
    if (!result.ok) {
      await interaction.reply(result.error.message, EPHEMERAL);
      return;
    }
    const domains = (result.data as { domains: string[] }).domains.slice(0, LIST_LIMIT);
    if (domains.length === 0) {
      sections.push(`${header}\nNenhum domínio.`);
      continue;
    }
    const lines: string[] = [];
    let used = header.length + MORE_RESERVE;
    for (const domain of domains) {
      const line = `\`${clip(domain)}\``;
      if (used + line.length + 1 > budget) break;
      lines.push(line);
      used += line.length + 1;
    }
    if (lines.length < domains.length) {
      lines.push(`… (+${String(domains.length - lines.length)})`);
    }
    sections.push([header, ...lines].join('\n'));
  }
  await interaction.reply(sections.join('\n'), EPHEMERAL);
}
