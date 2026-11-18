# Módulo `moderation`

## 1. Descrição e finalidade

Primeiro módulo real do Sun Flower. Detecta phishing em mensagens do servidor, apaga a mensagem e aplica timeout ao autor quando a violação é confirmada, registra um caso e alerta a equipe. A spec está em [docs/specs/2026-11-17-fase-2-moderacao-phishing.md](../../docs/specs/2026-11-17-fase-2-moderacao-phishing.md).

## 2. Funcionalidades disponibilizadas

- Análise de toda mensagem criada ou editada no servidor (`discord.message.created` e `discord.message.updated`).
- Pontuação por sinais de phishing e classificação em dois níveis.
- Resposta automática, registro de casos em `moderation_cases` e alerta no canal da equipe.
- Listas de domínios bloqueados e permitidos em `moderation_domains`, com os domínios oficiais das marcas protegidas como lista inicial de permitidos.

### 2.1. Sinais e pesos

| Sinal          | Pontos | Quando                                                                                                     |
| -------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `blocked`      | 100    | Domínio ou domínio pai na lista de bloqueados.                                                             |
| `lookalike`    | 60     | Domínio imita `discord` ou `steam` sem ser oficial.                                                        |
| `masked`       | 40     | Link markdown cujo texto mostra um domínio diferente do domínio do link.                                   |
| `multiChannel` | 50     | O mesmo domínio, pelo mesmo autor, em `multiChannel.channels` canais dentro de `windowSeconds`.            |
| `bait`         | 30     | Termo de `baitTerms` no texto fora dos links, junto com um link não permitido.                             |
| `massMention`  | 20     | `@everyone` ou `@here`, junto com um link não permitido.                                                   |
| `newAccount`   | 15     | Conta com menos de `newAccountDays` ou entrada há menos de `newMemberHours`, junto com link não permitido. |

Cada sinal conta uma vez por mensagem e a pontuação é a soma. Links de domínios permitidos não produzem sinal; uma mensagem sem link não permitido tem pontuação 0. Os pesos podem ser alterados em `weights.<sinal>`.

### 2.2. Níveis e resposta

| Pontuação                  | Nível        | Resposta                                                                     |
| -------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `>= thresholds.confirmed`  | `confirmed`  | Apaga a mensagem, aplica timeout de `timeoutMinutes`, grava o caso e alerta. |
| `>= thresholds.suspicious` | `suspicious` | Grava o caso como `open` e alerta com o link da mensagem; nenhuma ação.      |
| menor                      | —            | Nada.                                                                        |

- Apagar e aplicar timeout são etapas independentes: a falha de uma não impede a outra, e o resultado de cada uma fica no `outcome` do caso e na linha `Ação` do alerta.
- Autores com cargo de `exemptRoleIds` e desenvolvedores do bot não são analisados.
- Uma mensagem gera no máximo um caso por nível: uma edição só cria caso novo se o nível subir.
- Cada caso publica `moderation.case.created` com `{ caseId, kind, level, action }`.

## 3. Requisitos e dependências

- `apiVersion` `1.1.0` do contrato do Core.
- Nenhuma dependência de outro módulo.
- Intents privilegiados **Server Members** e **Message Content** ativos (README do projeto).

## 4. Configurações disponíveis

O módulo exporta `configSchema` (`config.ts`). Todos os campos são opcionais e têm padrão; `{}` gera a configuração completa.

| Campo                        | Padrão             | Regra                                    |
| ---------------------------- | ------------------ | ---------------------------------------- |
| `alertChannelId`             | ausente            | ID de canal (17 a 20 dígitos)            |
| `timeoutMinutes`             | `60`               | 1 a 40320                                |
| `thresholds.confirmed`       | `80`               | 1 a 1000, maior que `suspicious`         |
| `thresholds.suspicious`      | `40`               | 1 a 1000                                 |
| `weights.<sinal>`            | tabela de §2.1     | 0 a 1000                                 |
| `exemptRoleIds`              | `[]`               | IDs de cargo, no máximo 25               |
| `newAccountDays`             | `7`                | 0 a 365                                  |
| `newMemberHours`             | `24`               | 0 a 720                                  |
| `multiChannel.channels`      | `3`                | 2 a 25                                   |
| `multiChannel.windowSeconds` | `60`               | 10 a 3600                                |
| `baitTerms`                  | lista da spec §4.4 | no máximo 100, cada um com até 32 letras |

Sem `alertChannelId`, os casos são gravados normalmente e o log registra um aviso uma vez por início.

## 5. Permissões necessárias

- Capacidades: `guild.moderate` (apagar mensagem, timeout e demais ações) e `guild.message` (enviar o alerta).
- Permissões declaradas no manifesto:
  - `moderation.config.manage`
  - `moderation.domains.manage`
  - `moderation.cases.read`
  - `moderation.cases.revert`
  - `moderation.actions.warn`
  - `moderation.actions.timeout`
  - `moderation.actions.kick`
  - `moderation.actions.ban`

## 6. Eventos emitidos e consumidos

- Consome: `discord.message.created`, `discord.message.updated`.
- Publica: `moderation.case.created` (`moderation.case.reverted` está declarado para os comandos `/mod`).

## 7. Comandos e interfaces disponibilizados

Nenhum ainda. Os comandos `/mod` chegam no próximo Pull Request.

## 8. Exemplos de utilização

Alerta de um caso confirmado:

```text
🚨 Caso #12 — violação confirmada
Usuário: <@ID> · Canal: <#ID>
Domínios: `dlscord-gift.com`
Sinais: lookalike (60), bait (30) = 90
Ação: mensagem apagada, timeout de 60 min
Reverter: /mod case revert 12
```

Falhas aparecem na linha `Ação`, por exemplo `timeout não aplicado (sem permissão)`. Em casos suspeitos, a linha é `Ação: nenhuma`, seguida do link da mensagem e da sugestão `/mod case dismiss 12 ou /mod timeout`.

O alerta lista no máximo 5 domínios (os demais aparecem como `e mais N`), corta cada domínio em 100 caracteres e nunca passa de 2000 caracteres, o limite do Discord.

## 9. Limitações conhecidas

- Um domínio oficial removido da lista de permitidos volta no próximo início do bot. Para tirá-lo de vez, é preciso bloqueá-lo; o bloqueio prevalece.
- O estado da regra de vários canais fica em memória (no máximo 1000 autores e 50 entradas por autor) e se perde ao reiniciar.
- Variações de link com `\` ou espaços em volta do ponto não são reconstruídas.
- Quando o Discord demora a responder, o Event Bus pode registrar `event handler failed` depois de 5 s, enquanto a resposta (ações, caso e alerta) ainda termina normalmente.

### 9.1. Falsos positivos conhecidos

A regra `lookalike` marca alguns domínios legítimos como imitação:

- domínios que contêm `disco`, como `disco-music.com` e `discos.blogspot.com`;
- `disboard.org` e `discogs.com`;
- palavras unidas por pontos ou hífens que formam `steam`, como `sales-team.com` e `steamboat.com`.

Sozinho, o sinal `lookalike` (60) só gera alerta de suspeita, sem ação. Para eliminar o falso positivo, permita o domínio com `/mod domain allow <domínio>`.

## 10. Informações relevantes para manutenção

- Migração: `migrations/0001-moderation.sql` cria `moderation_cases` e `moderation_domains`.
- `index.ts` monta `DomainStore`, `CaseStore`, `MultiChannelTracker` e `Responder` no `initialize`; no `start`, uma limpeza do rastreador a cada 60 s (`unref()`), cancelada no `stop` e no `dispose`.
- `responder.ts` aplica a resposta; `alert.ts` formata o alerta. Os logs nunca contêm o conteúdo da mensagem nem IDs, apenas o número do caso.
- Testes: `modules/moderation/tests/` e `tests/integration/moderation.test.ts`.
