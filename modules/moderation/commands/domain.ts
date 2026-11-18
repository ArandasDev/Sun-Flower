import type { CommandInteraction } from '../../../shared/contracts/commands.ts';
import { normalizeDomain } from '../detection/links.ts';
import type { DomainList } from '../domains.ts';
import type { ModCommandDeps } from './mod-command.ts';
import { DOMAIN_REMOVED, DOMAIN_SET, DOMAIN_UNKNOWN, INVALID_DOMAIN } from './replies.ts';

const EPHEMERAL = { ephemeral: true } as const;
const LIST_LIMIT = 50;

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
  const sections = lists.map((list) => {
    const domains = deps.domains.list(list, LIST_LIMIT);
    const header = list === 'block' ? 'Bloqueados:' : 'Permitidos:';
    const body =
      domains.length === 0 ? 'Nenhum domínio.' : domains.map((d) => `\`${d}\``).join('\n');
    return `${header}\n${body}`;
  });
  await interaction.reply(sections.join('\n'), EPHEMERAL);
}
