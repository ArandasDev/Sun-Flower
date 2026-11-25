import { ApiError } from './api.ts';

export type Level = 'developer' | 'owner' | 'staff' | 'member';

const LEVELS: Record<Level, string> = {
  developer: 'Desenvolvedor',
  owner: 'Dono',
  staff: 'Equipe',
  member: 'Membro',
};

export function levelLabel(level: string): string {
  return Object.hasOwn(LEVELS, level) ? LEVELS[level as Level] : LEVELS.member;
}

const SCREENS: Record<string, string> = {
  profile: 'Meu perfil',
  overview: 'Visão geral',
  cases: 'Casos',
  actions: 'Ações',
  domains: 'Domínios',
  'moderation-config': 'Moderação',
};

export const NO_PERMISSION_TEXT = 'Sem permissão.';

/** The text to show for a failed operation: a 403 is always `Sem permissão.` */
export function errorText(error: Error): string {
  return error instanceof ApiError && error.status === 403 ? NO_PERMISSION_TEXT : error.message;
}

/** The Core's fixed text when the person lacks the operation's permission. */
const CORE_FORBIDDEN_TEXT = 'Você não tem permissão para isso.';

/**
 * Like `errorText`, for the actions: the Core's permission refusal becomes `Sem permissão.`, but a
 * 403 about the target (the person themselves, a protected member) keeps the server's text.
 */
export function actionErrorText(error: Error): string {
  return error instanceof ApiError && error.status === 403 && error.message === CORE_FORBIDDEN_TEXT
    ? NO_PERMISSION_TEXT
    : error.message;
}

const CASE_STATUSES: Record<string, string> = {
  open: 'Aberto',
  actioned: 'Com ação aplicada',
  reverted: 'Revertido',
  dismissed: 'Descartado',
};

export function caseStatusLabel(status: string): string {
  return CASE_STATUSES[status] ?? status;
}

const CASE_ACTIONS: Record<string, string> = {
  none: 'Nenhuma',
  delete_timeout: 'Apagar e silenciar',
  warn: 'Aviso',
  timeout: 'Silenciar',
  kick: 'Expulsar',
  ban: 'Banir',
};

export function caseActionLabel(action: string): string {
  return CASE_ACTIONS[action] ?? action;
}

const CASE_RULES: Record<string, string> = {
  flood: 'Excesso de mensagens',
  repeat: 'Mensagens repetidas',
  mentions: 'Menções em massa',
};

export function caseRuleLabel(rule: string): string {
  return CASE_RULES[rule] ?? rule;
}

export function caseKindLabel(kind: string, level: string | null): string {
  if (kind === 'manual') return 'Manual';
  if (level === 'confirmed') return 'Automático, confirmado';
  if (level === 'suspicious') return 'Automático, suspeito';
  return 'Automático';
}

export function screenLabel(screen: string): string {
  return Object.hasOwn(SCREENS, screen) ? (SCREENS[screen] ?? screen) : screen;
}

const CONNECTIONS: Record<string, string> = {
  ready: 'Conectado',
  connecting: 'Conectando',
  disconnected: 'Desconectado',
};

export function connectionLabel(connection: string): string {
  return CONNECTIONS[connection] ?? connection;
}

const MODULE_STATES: Record<string, string> = {
  RUNNING: 'Ativo',
  STOPPED: 'Parado',
  DISPOSED: 'Parado',
  FAILED: 'Com falha',
};

export function moduleStateLabel(state: string): string {
  return MODULE_STATES[state] ?? state;
}
