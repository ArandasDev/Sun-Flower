export const NO_PERMISSION = 'Você não tem permissão para isso.';
export const CONFIG_UPDATED = 'Configuração atualizada.';
export const CONFIG_INVALID = (fields: string): string => `Configuração inválida: ${fields}.`;
export const COMMAND_UNAVAILABLE = 'Comando indisponível.';
export const INVALID_DOMAIN = 'Domínio inválido.';
export const DOMAIN_SET = (list: 'block' | 'allow', domain: string): string =>
  `Domínio ${list === 'block' ? 'bloqueado' : 'permitido'}: \`${domain}\`.`;
export const DOMAIN_REMOVED = (domain: string): string => `Domínio removido: \`${domain}\`.`;
export const DOMAIN_UNKNOWN = 'Domínio não estava em nenhuma lista.';
export const CASE_NOT_FOUND = 'Caso não encontrado.';
export const CASE_REVERTED = (n: number, deletedMessage = false): string =>
  `Caso #${String(n)} revertido.${deletedMessage ? ' A mensagem apagada não pode ser recuperada.' : ''}`;
export const CASE_NOT_REVERTIBLE = 'Este caso não pode ser revertido.';
export const CASE_DISMISSED = (n: number): string => `Caso #${String(n)} descartado.`;
export const CASE_NOT_OPEN = 'Só casos abertos podem ser descartados.';
export const LOOKALIKE_NOT_ALLOWED =
  'Domínios que imitam marcas protegidas não podem ser permitidos.';
export const SELF_TARGET = 'Não é possível agir contra você mesmo.';
export const PROTECTED_TARGET = 'Não é possível agir contra este membro.';
export const NOT_A_MEMBER = 'Este usuário não é membro do servidor.';
export const DISCORD_REFUSED = (reason: 'sem permissão' | 'não encontrado' | 'falha'): string =>
  `O Discord recusou a ação: ${reason}.`;
export const WARNED = (n: number): string => `Advertência registrada (caso #${String(n)}).`;
export const DM_FAILED = ' Não foi possível enviar mensagem direta.';
export const TIMED_OUT = (n: number): string => `Timeout aplicado (caso #${String(n)}).`;
export const KICKED = (n: number): string => `Membro expulso (caso #${String(n)}).`;
export const BANNED = (n: number): string => `Usuário banido (caso #${String(n)}).`;
export const WARN_DM = (reason: string): string =>
  `Você recebeu uma advertência no servidor. Motivo: ${reason}`;
