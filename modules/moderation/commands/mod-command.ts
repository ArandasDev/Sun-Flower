import type {
  CommandDefinition,
  CommandInteraction,
  Subcommand,
  SubcommandGroup,
} from '../../../shared/contracts/commands.ts';
import type { GuildActions } from '../../../shared/contracts/guild.ts';
import type { ModuleContext } from '../../../shared/contracts/module.ts';
import type { CaseStore } from '../cases.ts';
import type { DomainStore } from '../domains.ts';
import {
  configAlertChannel,
  configExemptRole,
  configThresholds,
  configTimeout,
  configView,
} from './config.ts';
import { caseDismiss, caseList, caseRevert, caseView } from './case.ts';
import { domainAllow, domainBlock, domainList, domainRemove } from './domain.ts';
import { COMMAND_UNAVAILABLE, NO_PERMISSION } from './replies.ts';

export interface ModCommandDeps {
  readonly permissions: ModuleContext['permissions'];
  readonly config: ModuleContext['config'];
  readonly guild: GuildActions;
  readonly cases: CaseStore;
  readonly domains: DomainStore;
  publish(type: string, payload: unknown): void;
  readonly now?: () => Date;
}

type Handler = (interaction: CommandInteraction, deps: ModCommandDeps) => Promise<void>;

interface Route {
  readonly permission: string;
  readonly handler: Handler;
}

const EPHEMERAL = { ephemeral: true } as const;

const unavailable: Handler = async (interaction) => {
  await interaction.reply(COMMAND_UNAVAILABLE, EPHEMERAL);
};

const CONFIG = 'moderation.config.manage';
const DOMAINS = 'moderation.domains.manage';
const CASES_READ = 'moderation.cases.read';
const CASES_REVERT = 'moderation.cases.revert';

/** (group/subcommand) -> permission and handler. Later tasks replace `unavailable` entries. */
const ROUTES: Readonly<Record<string, Route>> = {
  'config/view': { permission: CONFIG, handler: configView },
  'config/alert-channel': { permission: CONFIG, handler: configAlertChannel },
  'config/timeout': { permission: CONFIG, handler: configTimeout },
  'config/thresholds': { permission: CONFIG, handler: configThresholds },
  'config/exempt-role': { permission: CONFIG, handler: configExemptRole },
  'domain/block': { permission: DOMAINS, handler: domainBlock },
  'domain/allow': { permission: DOMAINS, handler: domainAllow },
  'domain/remove': { permission: DOMAINS, handler: domainRemove },
  'domain/list': { permission: DOMAINS, handler: domainList },
  'case/view': { permission: CASES_READ, handler: caseView },
  'case/list': { permission: CASES_READ, handler: caseList },
  'case/revert': { permission: CASES_REVERT, handler: caseRevert },
  'case/dismiss': { permission: CASES_REVERT, handler: caseDismiss },
  '/warn': { permission: 'moderation.actions.warn', handler: unavailable },
  '/timeout': { permission: 'moderation.actions.timeout', handler: unavailable },
  '/kick': { permission: 'moderation.actions.kick', handler: unavailable },
  '/ban': { permission: 'moderation.actions.ban', handler: unavailable },
};

const user = { name: 'user', description: 'Usuário alvo', type: 'user', required: true } as const;
const reason = {
  name: 'reason',
  description: 'Motivo da ação',
  type: 'string',
  required: true,
  maxLength: 512,
} as const;
const caseNumber = {
  name: 'number',
  description: 'Número do caso',
  type: 'integer',
  required: true,
  minValue: 1,
} as const;
const domain = {
  name: 'domain',
  description: 'Domínio (por exemplo exemplo.com)',
  type: 'string',
  required: true,
  maxLength: 253,
} as const;

const configGroup: SubcommandGroup = {
  name: 'config',
  description: 'Configurações da moderação',
  subcommands: [
    { name: 'view', description: 'Mostra a configuração atual' },
    {
      name: 'alert-channel',
      description: 'Define o canal de alertas',
      options: [
        { name: 'channel', description: 'Canal de alertas', type: 'channel', required: true },
      ],
    },
    {
      name: 'timeout',
      description: 'Define a duração do timeout automático',
      options: [
        {
          name: 'minutes',
          description: 'Duração em minutos',
          type: 'integer',
          required: true,
          minValue: 1,
          maxValue: 40320,
        },
      ],
    },
    {
      name: 'thresholds',
      description: 'Define os limites de pontuação',
      options: [
        {
          name: 'confirmed',
          description: 'Pontuação mínima para phishing confirmado',
          type: 'integer',
          required: true,
          minValue: 1,
          maxValue: 1000,
        },
        {
          name: 'suspicious',
          description: 'Pontuação mínima para caso suspeito',
          type: 'integer',
          required: true,
          minValue: 1,
          maxValue: 1000,
        },
      ],
    },
    {
      name: 'exempt-role',
      description: 'Adiciona ou remove um cargo isento',
      options: [
        { name: 'role', description: 'Cargo', type: 'role', required: true },
        {
          name: 'action',
          description: 'Adicionar ou remover',
          type: 'string',
          required: true,
          choices: ['add', 'remove'],
        },
      ],
    },
  ],
};

const domainGroup: SubcommandGroup = {
  name: 'domain',
  description: 'Listas de domínios',
  subcommands: [
    { name: 'block', description: 'Bloqueia um domínio', options: [domain] },
    { name: 'allow', description: 'Permite um domínio', options: [domain] },
    { name: 'remove', description: 'Remove um domínio das listas', options: [domain] },
    {
      name: 'list',
      description: 'Lista os domínios',
      options: [
        {
          name: 'list',
          description: 'Lista a mostrar',
          type: 'string',
          choices: ['block', 'allow'],
        },
      ],
    },
  ],
};

const caseGroup: SubcommandGroup = {
  name: 'case',
  description: 'Casos de moderação',
  subcommands: [
    { name: 'view', description: 'Mostra um caso', options: [caseNumber] },
    {
      name: 'list',
      description: 'Lista os casos recentes',
      options: [{ name: 'user', description: 'Filtrar por usuário', type: 'user' }],
    },
    {
      name: 'revert',
      description: 'Reverte um caso',
      options: [
        caseNumber,
        {
          name: 'allow-domain',
          description: 'Permitir também os domínios do caso',
          type: 'boolean',
        },
      ],
    },
    { name: 'dismiss', description: 'Descarta um caso aberto', options: [caseNumber] },
  ],
};

const actionSubcommands: readonly Subcommand[] = [
  { name: 'warn', description: 'Registra uma advertência', options: [user, reason] },
  {
    name: 'timeout',
    description: 'Aplica timeout a um membro',
    options: [
      user,
      {
        name: 'minutes',
        description: 'Duração em minutos',
        type: 'integer',
        required: true,
        minValue: 1,
        maxValue: 40320,
      },
      reason,
    ],
  },
  { name: 'kick', description: 'Expulsa um membro', options: [user, reason] },
  {
    name: 'ban',
    description: 'Bane um usuário',
    options: [
      user,
      reason,
      {
        name: 'delete-days',
        description: 'Dias de mensagens a apagar (0 a 7)',
        type: 'integer',
        minValue: 0,
        maxValue: 7,
      },
    ],
  },
];

export function buildModCommand(deps: ModCommandDeps): CommandDefinition {
  return {
    name: 'mod',
    description: 'Ferramentas de moderação',
    groups: [configGroup, domainGroup, caseGroup],
    subcommands: actionSubcommands,
    handle: async (interaction) => {
      const key = `${interaction.subcommandGroup ?? ''}/${interaction.subcommand ?? ''}`;
      const route = ROUTES[key];
      if (route === undefined || !deps.permissions.check(interaction.actor, route.permission)) {
        await interaction.reply(NO_PERMISSION, EPHEMERAL);
        return;
      }
      await route.handler(interaction, deps);
    },
  };
}
