# Módulo `administration`

## 1. Descrição e finalidade

Expõe, como operações de módulo, a administração do Core: desenvolvedores, permissões de cargos, ativação de módulos, logs técnicos recentes e sessões do painel. É o que as telas de administração do painel chamam. Decisão: [0023](../../docs/decisions/0023-administration-module.md).

O módulo não guarda estado, não tem comandos nem eventos e não faz nada nas etapas `initialize`, `start`, `stop` e `dispose`. Cada operação chama o serviço `admin` do contexto, liberado pela capacidade `core.admin` (a única do repositório que declara essa capacidade), e devolve o resultado dele.

## 2. Operações

| Operação                             | Permissão                      | Entrada                               | Resultado                             |
| ------------------------------------ | ------------------------------ | ------------------------------------- | ------------------------------------- |
| `administration.grants.list`         | `administration.grants.manage` | `{}`                                  | `{ grants, grantable }`               |
| `administration.grants.grant`        | `administration.grants.manage` | `{ permission, roleId }`              | `{ granted }`                         |
| `administration.grants.revoke`       | `administration.grants.manage` | `{ permission, roleId }`              | `{ revoked }`                         |
| `administration.developers.list`     | `core.developers.manage`       | `{}`                                  | `{ developers }`                      |
| `administration.developers.add`      | `core.developers.manage`       | `{ userId }`                          | `{ added }`                           |
| `administration.developers.remove`   | `core.developers.manage`       | `{ userId }`                          | `{ removed }`                         |
| `administration.modules.list`        | `core.modules.manage`          | `{}`                                  | `{ modules }`                         |
| `administration.modules.set-enabled` | `core.modules.manage`          | `{ moduleId, enabled }`               | `{ changed, module }`                 |
| `administration.logs.recent`         | `core.logs.read`               | `{ limit?, minLevel? }` (200, `info`) | `{ entries }`                         |
| `administration.sessions.list`       | `core.sessions.manage`         | `{}`                                  | `{ sessions }`                        |
| `administration.sessions.revoke`     | `core.sessions.manage`         | `{ ref }`                             | `{ revoked }`                         |
| `administration.sessions.revoke-all` | `core.sessions.manage`         | `{ userId }`                          | `{ revoked }` (quantidade de sessões) |

- Todas recusam campos extras. IDs seguem o formato canônico de 17 a 20 dígitos.
- O dono recebe só `administration.grants.manage`; as permissões `core.*` são só dos desenvolvedores ([0017](../../docs/decisions/0017-access-levels.md)).
- As mensagens de erro (por exemplo `Este módulo não pode ser desligado.`) vêm do serviço `admin`.

## 3. Limites

- **Este módulo não pode ser desligado**, nem pelo painel: desligá-lo tiraria do painel a própria administração.
- Nenhuma permissão `administration.*` ou `core.*` pode ser associada a cargos.
- `npm run staff` continua sendo o acesso de emergência (desenvolvedores e permissões de cargos), sem depender deste módulo.
