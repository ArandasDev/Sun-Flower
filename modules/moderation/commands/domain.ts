import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import { normalizeDomain } from '../detection/links.ts';
import type { DomainList } from '../domains.ts';
import type { ModCommandDeps } from './mod-command.ts';
import { DOMAIN_REMOVED, DOMAIN_SET, DOMAIN_UNKNOWN, INVALID_DOMAIN } from './replies.ts';

const EPHEMERAL = { ephemeral: true } as const;
const LIST_LIMIT = 50;
const REPLY_BUDGET = 1900;
const MORE_RESERVE = 12;
const DOMAIN_MAX = 100;

const clip = (domain: string): string =>
  domain.length > DOMAIN_MAX ? `${domain.slice(0, DOMAIN_MAX - 1)}…` : domain;

function readDomain(interaction: CommandInteraction): string | undefined {
  const input = interaction.options.getString('domain');
  return input === undefined ? undefined : normalizeDomain(input);
}

async function setList(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
  list: DomainList,
): Promise<void> {
  const domain = readDomain(interaction);
  if (domain === undefined) {
    await interaction.reply(INVALID_DOMAIN, EPHEMERAL);
    return;
  }
  const now = (deps.now ?? (() => new Date()))();
  deps.domains.set(domain, list, interaction.actor.userId, now.toISOString());
  await interaction.reply(DOMAIN_SET(list, domain), EPHEMERAL);
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
  const domain = readDomain(interaction);
  if (domain === undefined) {
    await interaction.reply(INVALID_DOMAIN, EPHEMERAL);
    return;
  }
  const removed = deps.domains.remove(domain);
  await interaction.reply(removed ? DOMAIN_REMOVED(domain) : DOMAIN_UNKNOWN, EPHEMERAL);
}

export async function domainList(
  interaction: CommandInteraction,
  deps: ModCommandDeps,
): Promise<void> {
  const chosen = interaction.options.getString('list');
  const lists: readonly DomainList[] =
    chosen === 'block' ? ['block'] : chosen === 'allow' ? ['allow'] : ['block', 'allow'];
  const budget = Math.floor(REPLY_BUDGET / lists.length);
  const sections = lists.map((list) => {
    const header = list === 'block' ? 'Bloqueados:' : 'Permitidos:';
    const domains = deps.domains.list(list, LIST_LIMIT);
    if (domains.length === 0) return `${header}\nNenhum domínio.`;
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
    return [header, ...lines].join('\n');
  });
  await interaction.reply(sections.join('\n'), EPHEMERAL);
}
