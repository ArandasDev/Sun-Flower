# Módulo `moderation`

## 1. Descrição e finalidade

Primeiro módulo real do Sun Flower. Detecta phishing e spam/flood em mensagens do servidor, apaga a mensagem e aplica a punição ao autor quando a violação é confirmada, registra um caso e alerta a equipe. As specs estão em [docs/specs/2026-11-17-fase-2-moderacao-phishing.md](../../docs/specs/2026-11-17-fase-2-moderacao-phishing.md) (phishing) e [docs/specs/2026-11-18-fase-2-moderacao-spam.md](../../docs/specs/2026-11-18-fase-2-moderacao-spam.md) (spam).

## 2. Funcionalidades disponibilizadas

- Análise de toda mensagem criada ou editada no servidor (`discord.message.created` e `discord.message.updated`).
- Pontuação por sinais de phishing e classificação em dois níveis.
- Resposta automática, registro de casos em `moderation_cases` e alerta no canal da equipe.
- Listas de domínios bloqueados e permitidos em `moderation_domains`, com os domínios oficiais das marcas protegidas e os domínios conhecidos como seguros (§9.1) como lista inicial de permitidos.
- Detecção de spam e flood (§2.3) com punição que escala para quem reincide.
- Comando `/mod` (§7): configuração, listas de domínios, consulta, reversão e descarte de casos, e ações manuais (advertência, timeout, expulsão e banimento) com proteções.

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

### 2.3. Spam e flood

Cada mensagem criada alimenta um registro de atividade por autor (só um hash do texto normalizado, nunca o texto). Três regras analisam o registro, e cada uma pode ser ligada, ajustada e ter punição própria:

| Regra      | Dispara quando                                                                     | Padrão    |
| ---------- | ---------------------------------------------------------------------------------- | --------- |
| `flood`    | o autor envia `limit` mensagens em `seconds` segundos, somando os canais           | 7 em 5 s  |
| `repeat`   | o autor envia `limit` cópias do mesmo texto (10 caracteres ou mais) em `seconds` s | 4 em 60 s |
| `mentions` | uma única mensagem soma `limit` menções (`@everyone` e `@here` valem 3)            | 6         |

- Uma regra que disparou não dispara de novo para o mesmo autor por 30 segundos.
- Autores com cargo de `exemptRoleIds`, desenvolvedores do bot e canais de `spam.ignoredChannelIds` não são analisados.
- A resposta apaga as mensagens do autor dentro da janela `deleteMinutes` (em lote, com plano B mensagem a mensagem) e aplica a punição da regra: `none`, `timeout`, `kick` ou `ban`. Com `none` em todas as regras disparadas, o caso fica `open` e só há alerta, sem apagar nem punir.
- **Reincidência:** com `spam.escalation.enabled`, a punição sobe pelos degraus (padrão `10m,1h,ban`) conforme o número de casos de spam do autor com status `actioned` (e dos ainda em andamento) nas últimas `windowHours` horas; vale a mais grave entre a punição da regra e a do degrau. Casos revertidos, descartados ou com punição recusada pelo Discord não contam.
- Phishing confirmado e spam na mesma mensagem geram um único caso, com a punição mais grave e as duas causas.
- Exclusão em lote e punição rodam em paralelo. Banimento com `deleteMinutes` maior que 0 usa também a exclusão do próprio Discord (mensagens da pessoa em todos os canais), e a exclusão em lote da janela roda mesmo assim, para que um banimento recusado não deixe o flood no ar.
- Se o Discord recusar o banimento (`forbidden` ou `not_found`), o módulo aplica como plano B a punição mais grave das regras disparadas que não é `ban` (por exemplo, o timeout da regra) e registra `fallback` no `outcome`; o `action` do caso passa a ser o do plano B, e o caso fica `actioned` se ele deu certo.
- Um timeout com resultado `failed` (limite de 10 s do bot) pode ter sido aplicado: o caso fica `actioned`, como na etapa 1. Só `forbidden` e `not_found` deixam o caso `open`.

## 3. Requisitos e dependências

- `apiVersion` `1.3.0` do contrato do Core (operações de módulo, decisão 0022; exclusão de mensagens em lote, decisão 0016).
- Nenhuma dependência de outro módulo.
- Intents privilegiados **Server Members** e **Message Content** ativos (README do projeto).
- **Antes de testar ou de usar em produção:** isente o cargo da equipe das regras automáticas com `/mod config exempt-role <cargo da equipe> add`. As permissões `moderation.*` protegem o membro **somente das ações manuais** (`/mod warn`, `timeout`, `kick` e `ban`), não das regras automáticas de phishing e spam; sem a isenção, a própria equipe pode ser punida.

## 4. Configurações disponíveis

O módulo exporta `configSchema` (`config.ts`). Todos os campos são opcionais e têm padrão; `{}` gera a configuração completa.

| Campo                         | Padrão             | Regra                                    |
| ----------------------------- | ------------------ | ---------------------------------------- |
| `alertChannelId`              | ausente            | ID de canal (17 a 20 dígitos)            |
| `timeoutMinutes`              | `60`               | 1 a 40320                                |
| `thresholds.confirmed`        | `80`               | 1 a 1000, maior que `suspicious`         |
| `thresholds.suspicious`       | `40`               | 1 a 1000                                 |
| `weights.<sinal>`             | tabela de §2.1     | 0 a 1000                                 |
| `exemptRoleIds`               | `[]`               | IDs de cargo, no máximo 25               |
| `newAccountDays`              | `7`                | 0 a 365                                  |
| `newMemberHours`              | `24`               | 0 a 720                                  |
| `multiChannel.channels`       | `3`                | 2 a 25                                   |
| `multiChannel.windowSeconds`  | `60`               | 10 a 3600                                |
| `baitTerms`                   | lista da spec §4.4 | no máximo 100, cada um com até 32 letras |
| `spam.ignoredChannelIds`      | `[]`               | IDs de canal, no máximo 25               |
| `spam.<regra>.enabled`        | `true`             | `flood`, `repeat`, `mentions`            |
| `spam.<regra>.limit`          | 7 / 4 / 6          | 2 a 50                                   |
| `spam.<regra>.seconds`        | 5 / 60             | 2 a 600 (só `flood` e `repeat`)          |
| `spam.<regra>.deleteMinutes`  | 2 / 10 / 0         | 0 a 60                                   |
| `spam.<regra>.punishment`     | `timeout`          | `none`, `timeout`, `kick` ou `ban`       |
| `spam.<regra>.timeoutMinutes` | `10`               | 1 a 40320                                |
| `spam.escalation.enabled`     | `true`             |                                          |
| `spam.escalation.windowHours` | `24`               | 1 a 168                                  |
| `spam.escalation.steps`       | 10m, 1h, ban       | 1 a 5 degraus                            |

Sem `alertChannelId`, os casos são gravados normalmente e o log registra um aviso uma vez por início.

O módulo começa ativo e age automaticamente desde o primeiro início. Defina o canal de alertas com `/mod config alert-channel` logo após a primeira execução; até lá, os casos são gravados sem alerta.

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
- Publica: `moderation.case.created` com `{ caseId, kind, level, action }` (casos automáticos e ações manuais) e `moderation.case.reverted` com `{ caseId }` (`/mod case revert`).
- Publica também `moderation.case.dismissed` com `{ caseId }` (`/mod case dismiss` e a operação equivalente).

## 7. Comandos e interfaces disponibilizados

O comando `/mod` reúne tudo. Todas as respostas são efêmeras, e cada subcomando exige a permissão indicada, associada a um cargo com `npm run staff -- grant <permissão> <ID do cargo>`. Sem ela, a resposta é `Você não tem permissão para isso.` e nada é executado.

| Comando                                                                                                    | Permissão                    |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `/mod config view`                                                                                         | `moderation.config.manage`   |
| `/mod config alert-channel <canal>`                                                                        | `moderation.config.manage`   |
| `/mod config timeout <minutos>`                                                                            | `moderation.config.manage`   |
| `/mod config thresholds <confirmado> <suspeito>`                                                           | `moderation.config.manage`   |
| `/mod config exempt-role <cargo> <add\|remove>`                                                            | `moderation.config.manage`   |
| `/mod config spam-rule <rule> [enabled] [limit] [seconds] [delete-minutes] [punishment] [timeout-minutes]` | `moderation.config.manage`   |
| `/mod config spam-escalation [enabled] [window-hours] [steps]`                                             | `moderation.config.manage`   |
| `/mod config spam-ignore <canal> <add\|remove>`                                                            | `moderation.config.manage`   |
| `/mod domain block <domínio>` · `allow <domínio>` · `remove <domínio>`                                     | `moderation.domains.manage`  |
| `/mod domain list [lista]`                                                                                 | `moderation.domains.manage`  |
| `/mod case view <número>`                                                                                  | `moderation.cases.read`      |
| `/mod case list [usuário]`                                                                                 | `moderation.cases.read`      |
| `/mod case revert <número> [allow-domain]`                                                                 | `moderation.cases.revert`    |
| `/mod case dismiss <número>`                                                                               | `moderation.cases.revert`    |
| `/mod warn <usuário> <motivo>`                                                                             | `moderation.actions.warn`    |
| `/mod timeout <usuário> <minutos> <motivo>`                                                                | `moderation.actions.timeout` |
| `/mod kick <usuário> <motivo>`                                                                             | `moderation.actions.kick`    |
| `/mod ban <usuário> <motivo> [delete-days]`                                                                | `moderation.actions.ban`     |

- `spam-rule` muda só os campos informados da regra (`flood`, `repeat` ou `mentions`); `seconds` não vale para `mentions` (`Opção inválida: seconds.`). `spam-escalation` aceita `steps` como texto (`10m,1h,ban`: `Nm` ou `Nh` é timeout, `kick` e `ban` as demais punições; 1 a 5 degraus); texto inválido responde `Configuração inválida: steps.` e nada é gravado. `spam-ignore` adiciona (sem duplicar) ou remove um canal ignorado.
- `config view` inclui o resumo de spam: cada regra, a reincidência e os canais ignorados.
- `domain block` e `allow` normalizam o domínio (`https://Golpe.COM/abc` vira `golpe.com`); bloquear um domínio permitido o move para a lista de bloqueados, e vice-versa. `domain list` mostra no máximo 50 domínios por lista.
- `case list` mostra os 10 casos mais recentes, do usuário quando informado.
- `case revert` vale para casos `actioned` ou `open`: remove o timeout (`delete_timeout`, `timeout`), desfaz o banimento (`ban`) ou só muda o status (`kick`, `warn`, `none`). A mensagem apagada não é recuperada. `allow-domain` move os domínios do caso para a lista de permitidos, exceto imitações de marcas protegidas, que são recusadas. `case dismiss` vale só para casos `open`.
- `timeout` aceita de 1 a 40320 minutos (28 dias). `delete-days` vai de 0 a 7 (padrão 0). O motivo tem até 512 caracteres.
- `warn` envia ao membro a mensagem direta `Você recebeu uma advertência no servidor. Motivo: <motivo>` e registra o caso. Se a mensagem direta falhar (por exemplo, mensagens diretas fechadas), o caso fica registrado assim mesmo e a resposta informa. Se o alvo não pode receber a advertência (o serviço `guild` recusa a mensagem direta com `forbidden`, por exemplo, o próprio bot), a resposta é `Não é possível agir contra este membro.` e nenhum caso é registrado.
- Cada ação manual que o Discord aceita grava um caso `manual` com status `actioned` e publica `moderation.case.created`. Se o Discord recusar, a resposta é `O Discord recusou a ação: <sem permissão|não encontrado|falha>.` e nenhum caso é gravado.

**Proteções das ações manuais (`warn`, `timeout`, `kick`, `ban`).** A ação é recusada, sem nenhuma chamada ao Discord, quando o alvo:

- é a própria pessoa que executa o comando (`Não é possível agir contra você mesmo.`);
- é um desenvolvedor do bot, tem um cargo de `exemptRoleIds` ou tem um cargo com alguma permissão `moderation.*` (`Não é possível agir contra este membro.`);
- é o próprio bot: o serviço `guild` do Core recusa; em `warn` a resposta é `Não é possível agir contra este membro.` e, nas demais, `O Discord recusou a ação: sem permissão.`.

`warn`, `timeout` e `kick` exigem que o alvo seja membro do servidor (`Este usuário não é membro do servidor.`); `ban` aceita um usuário que não é membro. Se não for possível consultar os cargos do alvo (erro ou demora do Discord), nenhuma das quatro ações é executada: a resposta é `O Discord recusou a ação: falha.` e nenhum caso é gravado.

### 7.1. Operações

O módulo registra estas operações no Core (contrato em [docs/MODULES.md §5.3](../../docs/MODULES.md#53-operações)). O `/mod` e o painel usam as mesmas, com as mesmas regras e mensagens. A entrada é validada pelo Core; `id` é um inteiro a partir de 1 e `userId` é um ID de 17 a 20 dígitos.

| Operação                     | Permissão                    | Entrada                                                   | Saída                                                                                                     |
| ---------------------------- | ---------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `moderation.config.view`     | `moderation.config.manage`   | nenhuma                                                   | `{ version, config }`                                                                                     |
| `moderation.config.update`   | `moderation.config.manage`   | `{ expectedVersion, changes }` (chaves de nível superior) | `{ version, config }`; `conflict` se a versão mudou                                                       |
| `moderation.domains.list`    | `moderation.domains.manage`  | `{ list: block\|allow }`                                  | `{ list, domains }`                                                                                       |
| `moderation.domains.block`   | `moderation.domains.manage`  | `{ domain }`                                              | `{ domain, list }`                                                                                        |
| `moderation.domains.allow`   | `moderation.domains.manage`  | `{ domain }`                                              | `{ domain, list }`                                                                                        |
| `moderation.domains.remove`  | `moderation.domains.manage`  | `{ domain }`                                              | `{ domain }`; `not_found` se não está nas listas                                                          |
| `moderation.cases.list`      | `moderation.cases.read`      | `{ status?, rule?, targetUserId?, cursor? }`              | `{ cases, nextCursor }` (50 por página, `id` decrescente)                                                 |
| `moderation.cases.view`      | `moderation.cases.read`      | `{ id }`                                                  | detalhe do caso, sem o ID da mensagem                                                                     |
| `moderation.cases.revert`    | `moderation.cases.revert`    | `{ id, allowDomains? }`                                   | `{ case, deletedMessage }`                                                                                |
| `moderation.cases.dismiss`   | `moderation.cases.revert`    | `{ id }`                                                  | detalhe do caso; publica `moderation.case.dismissed`                                                      |
| `moderation.cases.mine`      | `null` (só dados da pessoa)  | nenhuma                                                   | `{ cases }`: últimos 50 casos em que a pessoa é o alvo, só `id`, `createdAt`, `kind`, `action` e `status` |
| `moderation.actions.warn`    | `moderation.actions.warn`    | `{ userId, reason }`                                      | `{ caseId, dmFailed? }`                                                                                   |
| `moderation.actions.timeout` | `moderation.actions.timeout` | `{ userId, minutes (1 a 40320), reason }`                 | `{ caseId }`                                                                                              |
| `moderation.actions.kick`    | `moderation.actions.kick`    | `{ userId, reason }`                                      | `{ caseId }`                                                                                              |
| `moderation.actions.ban`     | `moderation.actions.ban`     | `{ userId, reason, deleteDays? (0 a 7) }`                 | `{ caseId }`                                                                                              |

- `reason` tem de 1 a 512 caracteres, sem espaços nas pontas. As ações aceitam ainda `channelId` opcional (o canal onde o `/mod` rodou; o painel não envia).
- As ações aplicam as proteções descritas acima. Contra a própria pessoa ou um alvo protegido: `forbidden`; contra quem não é membro (`warn`, `timeout`, `kick`): `not_found`; consulta de cargos com falha: `unavailable`; recusa do Discord: `forbidden`, `not_found` ou `failed`. Nenhum caso é gravado quando a operação falha.

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

Falhas aparecem na linha `Ação`, por exemplo `timeout não aplicado (sem permissão)`. Se a mensagem não foi apagada, o alerta confirmado traz também a linha `Mensagem: <link>`, para a equipe apagá-la à mão. Em casos suspeitos, a linha é `Ação: nenhuma`, seguida do link da mensagem e da sugestão `/mod case dismiss 12 ou /mod timeout`.
O alerta lista no máximo 5 domínios (os demais aparecem como `e mais N`), corta cada domínio em 100 caracteres e nunca passa de 2000 caracteres, o limite do Discord.

## 9. Limitações conhecidas

- O registro de atividade de spam fica em memória e se perde ao reiniciar o bot; a reincidência continua, pois vem dos casos gravados.
- Mensagens enviadas depois do disparo de uma regra, mas antes de a punição ser aplicada, podem continuar no canal: a exclusão só leva as mensagens registradas até o disparo.
- `spam.ignoredChannelIds` vale para o canal exato: um tópico (thread) tem ID próprio e precisa ser ignorado separadamente.
- Num surto na velocidade de um bot, dois casos simultâneos do mesmo autor podem aplicar dois timeouts; vale o último que o Discord aplicar.
- Menções espalhadas em várias mensagens, cada uma abaixo do limite de `mentions`, não são detectadas; nem textos quase iguais (com contador, homóglifos ou outras variações) pela regra `repeat`.
- Permissões `moderation.*` não isentam das regras automáticas; use `exemptRoleIds` (§3).
- Mensagens fora do registro (anteriores ao início do bot ou já expiradas) só somem no banimento com `deleteMinutes` maior que 0.
- Se uma regra de spam lançar erro, a análise de spam daquela mensagem é descartada e o phishing segue normalmente.
- Alertas só de spam não trazem as linhas `Domínios` e `Sinais`; mostram `Regras` e `Ação`.
- Um domínio oficial removido da lista de permitidos volta no próximo início do bot. Para tirá-lo de vez, é preciso bloqueá-lo com `/mod domain block`; o bloqueio prevalece. O mesmo vale para os domínios conhecidos como seguros.
- O estado da regra de vários canais fica em memória (no máximo 1000 autores e 50 entradas por autor) e se perde ao reiniciar.
- Variações de link com `\` ou espaços em volta do ponto não são reconstruídas.
- Links atrás de redirecionadores (`google.com/url?q=…` e semelhantes) não são abertos: só o domínio do redirecionador é analisado, e o link interno passa despercebido.
- O alerta e o caso guardam no máximo 20 domínios por mensagem, primeiro os que produziram sinal (bloqueados, imitações, mascarados). Todos os links não permitidos são avaliados, mas só esses 20 entram na regra de vários canais.
- Quando o sinal `multiChannel` confirma um caso, só a mensagem que atingiu o limite é apagada; as mensagens anteriores do mesmo autor continuam no servidor, e as que geraram caso ficam como casos suspeitos abertos.
- Uma edição de mensagem fora do cache do bot pode chegar sem os cargos do autor; nesse caso não é possível verificar `exemptRoleIds` e a mensagem é analisada normalmente.
- Quando o Discord demora a responder, o Event Bus pode registrar `event handler failed` depois de 5 s, enquanto a resposta (ações, caso e alerta) ainda termina normalmente.
- Reverter um caso antigo de `timeout` ou `ban` também remove uma sanção mais recente do mesmo tipo aplicada ao mesmo membro: o Discord guarda um único timeout e um único banimento por pessoa.
- Uma ação manual que o Discord aplica depois do limite de 10 s é informada como falha e não grava caso. Confira o estado do membro e corrija direto no Discord.
- A opção do canal de alertas aceita qualquer tipo de canal; escolha um canal de texto.
- Um caso descartado guarda quem o descartou e quando nas mesmas colunas de reversão (`reverted_by` e `reverted_at`); `case view` mostra `Descarte: descartado por …`.

### 9.1. Falsos positivos conhecidos

**Atenção:** `lookalike` (60) somado a uma palavra de isca (`bait`, 30) dá 90 e passa do limite `confirmed` (80). Nesse caso o módulo age automaticamente: apaga a mensagem e aplica timeout, sem revisão prévia da equipe.

Para reduzir esse risco:

- Os nomes das marcas protegidas (`discord`, `steam`) nunca contam como isca, mesmo que estejam em `baitTerms`: `compra na steam` não é isca. Outras palavras continuam contando (`steam gift` conta por `gift`).
- Domínios sem `http://` ou `https://` só contam como link se o TLD tiver exatamente 2 letras (TLD de país) ou estiver numa lista de TLDs genéricos comuns (`com`, `net`, `org`, `gift`, `xyz`, `ru` e outros; a lista completa está em `detection/links.ts`). Assim `disco.amei` e `disco.tá` não são links. URLs com esquema e links markdown aceitam qualquer TLD válido.
- A lista inicial de permitidos inclui, além dos domínios oficiais, sites legítimos conhecidos que a regra `lookalike` marcaria: `discord.js.org`, `discordjs.dev`, `steamdb.info`, `steamcharts.com`, `disboard.org` e `discogs.com` (`known-safe.ts`). Eles não são marcas protegidas, e a equipe pode bloqueá-los.

A regra `lookalike` ainda marca alguns domínios legítimos como imitação:

- domínios que contêm `disco`, como `disco-music.com` e `discos.blogspot.com`;
- palavras unidas por pontos ou hífens que formam `steam`, como `sales-team.com` e `steamboat.com`.

Sozinho, o sinal `lookalike` só gera alerta de suspeita, sem ação; com uma palavra de isca, gera ação automática. Para eliminar o falso positivo, permita o domínio com `/mod domain allow <domínio>`.

## 10. Informações relevantes para manutenção

- Migração: `migrations/0001-moderation.sql` cria `moderation_cases` e `moderation_domains`.
- `index.ts` monta `DomainStore`, `CaseStore`, `MultiChannelTracker` e `Responder` no `initialize`; no `start`, uma limpeza do rastreador a cada 60 s (`unref()`), cancelada no `stop` e no `dispose`.
- `responder.ts` aplica a resposta; `alert.ts` formata o alerta. `commands/mod-command.ts` define o `/mod` e roteia cada subcomando, checando a permissão antes de tudo; `commands/{config,domain,case,actions}.ts` implementam os subcomandos e `commands/replies.ts` reúne as respostas. Os logs nunca contêm o conteúdo da mensagem nem IDs, apenas o número do caso.
- Testes: `modules/moderation/tests/` e `tests/integration/moderation.test.ts`.
