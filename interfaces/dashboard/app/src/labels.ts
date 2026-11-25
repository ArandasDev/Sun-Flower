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
};

export const NO_PERMISSION_TEXT = 'Sem permissão.';

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
