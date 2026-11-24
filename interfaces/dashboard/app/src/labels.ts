export type Level = 'developer' | 'owner' | 'staff' | 'member';

const LEVELS: Record<Level, string> = {
  developer: 'Desenvolvedor',
  owner: 'Dono',
  staff: 'Equipe',
  member: 'Membro',
};

export function levelLabel(level: Level): string {
  return LEVELS[level];
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
