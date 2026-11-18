# Spec — Fase 2, etapa 2: moderação contra spam e flood

**Status:** Aprovada em 2026-11-18
**Fase:** [ROADMAP — Fase 2](../ROADMAP.md#fase-2--moderação)
**Decisões aplicadas:** [0006](../decisions/0006-permission-model.md), [0009](../decisions/0009-api-version-compatibility.md), [0012](../decisions/0012-guild-actions.md), [0013](../decisions/0013-module-storage.md), [0016](../decisions/0016-bulk-message-deletion.md)
**Spec anterior:** [etapa 1, phishing](2026-11-17-fase-2-moderacao-phishing.md) — casos, alertas, reversão, isenções e `/mod` são reaproveitados.

## 1. Objetivo

O módulo `moderation` detecta flood, mensagens repetidas e menções em massa, apaga as mensagens recentes da pessoa, aplica a punição configurada para a regra, aumenta a punição em caso de reincidência, registra um caso e alerta a equipe. Tudo é configurável por regra pelos comandos `/mod config`.

Para apagar muitas mensagens de uma vez, o Core ganha a exclusão em lote ([0016](../decisions/0016-bulk-message-deletion.md)), e `CORE_API_VERSION` passa de `1.1.0` para `1.2.0`.

**Fora do escopo:** convites de outros servidores, anexos e imagens, raids (muitas contas novas entrando de uma vez), análise do conteúdo semântico e painel administrativo (Fase 3).

## 2. Componentes

```text
shared/contracts/guild.ts            + bulkDeleteMessages, BulkDeleteResult
core/guild/module-guild.ts           Capacidade, validação de 1 a 100 IDs, log de contagens
interfaces/discord/guild-actions.ts  Lote do Discord com exclusão individual como plano B
modules/moderation/
├── spam/activity.ts                 Registro de atividade em memória por autor
├── spam/rules.ts                    Regras flood, repeat e mentions (código puro)
├── spam/escalation.ts               Degraus de reincidência
├── decision.ts                      Junta phishing e spam numa decisão por mensagem
├── responder.ts                     Passa a executar a decisão combinada
├── alert.ts                         Linhas de regras e de quantidade apagada
├── cases.ts                         Coluna rules e contagem de reincidência
├── config.ts                        Bloco spam no configSchema
├── commands/config.ts               spam-rule, spam-escalation, spam-ignore e resumo no view
└── migrations/0002-spam.sql
```

## 3. Extensão do Core: exclusão em lote ([0016](../decisions/0016-bulk-message-deletion.md))

```ts
type BulkDeleteResult =
  | { readonly ok: true; readonly deleted: number; readonly individually: number }
  | { readonly ok: false; readonly error: GuildActionError; readonly deleted: number };

interface GuildActions {
  // ... ações existentes
  bulkDeleteMessages(channelId: string, messageIds: readonly string[]): Promise<BulkDeleteResult>;
}
```

- Capacidade `guild.moderate`. Sem ela, a chamada lança `CapabilityError`, como as demais.
- Validação no Core: depois de remover IDs repetidos, a lista precisa ter de 1 a 100 IDs no formato de snowflake. Caso contrário, `{ ok: false, error: 'failed', deleted: 0 }` sem chamar o Discord. Módulo inativo também devolve `failed`.
- Interface Discord:
  1. com 2 ou mais IDs, chama `channel.bulkDelete(ids, true)`, que ignora mensagens com mais de 14 dias e devolve as que apagou;
  2. as mensagens que o lote não apagou são apagadas uma por uma com a exclusão normal, cada uma com limite de 10 s;
  3. com 1 ID, apaga diretamente com a exclusão normal;
  4. se o lote falhar com erro temporário ou limite de tempo, todas as mensagens passam pela exclusão individual;
  5. casos terminais: falta de permissão (50013), falta de acesso (50001) e tópico arquivado (50083) são `forbidden`; canal inexistente (10003) é `not_found`. No lote, nada mais é tentado. Na exclusão individual, a tentativa para ali e devolve o que já foi apagado (`ok: true` com as contagens) ou, se nada foi apagado, o erro correspondente;
  6. `not_found` numa exclusão individual (exceto canal inexistente) conta como mensagem já apagada;
  7. a exclusão individual para após 3 falhas consecutivas e devolve o que já foi apagado (`failed` se nada foi).
- `deleted` soma as mensagens apagadas e as que já não existiam; `individually` conta as apagadas pelo plano B. `ok: false` só acontece quando nenhuma mensagem pôde ser apagada.
- O log do Core registra `{ module, action: 'bulkDeleteMessages', requested, deleted, individually, result }`, sem IDs.

## 4. Módulo `moderation`

### 4.1. Manifesto

`apiVersion` passa para `1.2.0`. Permissões, capacidades e eventos não mudam.

### 4.2. Registro de atividade (`spam/activity.ts`)

- Cada `discord.message.created` gera uma entrada `{ messageId, channelId, atMs, fingerprint }` no registro do autor. Edições não geram entrada.
- `fingerprint`: `sha256` (de `node:crypto`), em hexadecimal, do texto normalizado — minúsculas, `NFD` sem marcas (`\p{M}`) e sem caracteres de formatação (`\p{Cf}`), espaços colapsados e aparados. Textos com menos de 10 caracteres depois da normalização recebem `fingerprint` nulo e não contam para `repeat`. O texto em si nunca é guardado.
- Limites: 200 entradas por autor (a mais antiga sai primeiro) e 2 000 autores (o autor menos recente sai primeiro).
- As entradas expiram depois da maior janela configurada entre as regras (`seconds` e `deleteMinutes`), com teto de 60 minutos. Uma limpeza roda a cada 60 segundos, junto com a do rastreador de vários canais.
- Todos os IDs enviados para exclusão são esquecidos pelo registro **antes** de aguardar a exclusão, para que um caso concorrente na mesma janela não os reenvie. Casos de spam ainda em andamento (em processamento) contam para a reincidência.
- O registro se perde ao reiniciar o bot.

### 4.3. Regras (`spam/rules.ts`)

| Regra      | Dispara quando                                                                 | Padrão    |
| ---------- | ------------------------------------------------------------------------------ | --------- |
| `flood`    | o autor tem `limit` entradas nos últimos `seconds` segundos, somando os canais | 7 em 5 s  |
| `repeat`   | o autor tem `limit` entradas com o mesmo `fingerprint` não nulo em `seconds` s | 4 em 60 s |
| `mentions` | uma única mensagem soma `limit` menções                                        | 6         |

- `mentions` conta, no conteúdo da mensagem (criada ou editada), as menções distintas `<@ID>`, `<@!ID>` e `<@&ID>`; cada `@everyone` ou `@here` soma 3, desde que não esteja colado a letra, número, `_` ou `.` em nenhum dos lados (`fulano@everyone.com.br` não conta). Menções repetidas da mesma pessoa ou do mesmo cargo contam uma vez.
- Uma regra que disparou para um autor não dispara de novo para ele nos 30 segundos seguintes.
- Autores com cargo de `exemptRoleIds` e desenvolvedores do bot não são analisados, como na etapa 1.
- Mensagens em canais de `spam.ignoredChannelIds` não geram entrada nem disparam regras.
- O resultado de cada regra disparada inclui os números que a dispararam, por exemplo `{ rule: 'flood', count: 9, seconds: 5 }`.

### 4.4. Configuração (`configSchema`, bloco `spam`)

| Campo                                   | Tipo                               | Padrão (flood / repeat / mentions)  |
| --------------------------------------- | ---------------------------------- | ----------------------------------- |
| `spam.ignoredChannelIds`                | `string[]`, no máximo 25           | `[]`                                |
| `spam.<regra>.enabled`                  | `boolean`                          | `true` / `true` / `true`            |
| `spam.<regra>.limit`                    | `integer`, 2 a 50                  | `7` / `4` / `6`                     |
| `spam.<regra>.seconds` (flood e repeat) | `integer`, 2 a 600                 | `5` / `60` / —                      |
| `spam.<regra>.deleteMinutes`            | `integer`, 0 a 60                  | `2` / `10` / `0`                    |
| `spam.<regra>.punishment`               | `none`, `timeout`, `kick` ou `ban` | `timeout` nas três                  |
| `spam.<regra>.timeoutMinutes`           | `integer`, 1 a 40320               | `10` nas três                       |
| `spam.escalation.enabled`               | `boolean`                          | `true`                              |
| `spam.escalation.windowHours`           | `integer`, 1 a 168                 | `24`                                |
| `spam.escalation.steps`                 | lista de 1 a 5 degraus             | `timeout 10` → `timeout 60` → `ban` |

Um degrau é `{ kind: 'timeout', minutes } | { kind: 'kick' } | { kind: 'ban' }`.

### 4.5. Decisão por mensagem (`decision.ts`)

Cada mensagem é avaliada uma única vez. A decisão combina a análise de phishing da etapa 1 e as regras de spam:

1. Se nenhuma regra de spam disparou, vale a decisão de phishing da etapa 1, sem mudança.
2. Se alguma regra de spam disparou:
   - **punição da regra:** a mais grave entre as regras disparadas com `punishment` diferente de `none` (`ban` > `kick` > `timeout`; entre timeouts, o maior `timeoutMinutes`);
   - **reincidência:** se `spam.escalation.enabled` e a punição da regra não é `none`, o degrau é o de índice `min(n, steps.length − 1)`, onde `n` é o número de casos automáticos de spam do autor com `status` `actioned` nos últimos `windowHours`; a punição aplicada é a mais grave entre a da regra e a do degrau;
   - **phishing confirmado na mesma mensagem:** a punição aplicada é a mais grave entre a de spam e o timeout do phishing;
   - **plano B do banimento:** quando a punição aplicada é `ban`, a decisão guarda também a punição mais grave entre as das regras disparadas que não é `ban` (e o timeout do phishing, se confirmado), para o caso de o Discord recusar o banimento;
   - **janela de exclusão:** a maior `deleteMinutes` entre as regras disparadas; `0` significa apagar só as entradas que fizeram as regras dispararem e a própria mensagem;
   - se todas as regras disparadas têm `punishment: none` e não há phishing confirmado, o caso é `open` e só há alerta;
   - a exclusão e a punição só acontecem quando o nível está confirmado (regra com punição diferente de `none` ou phishing confirmado); um caso só de alerta não apaga nem pune.

### 4.6. Execução da resposta

- **Exclusão:** as mensagens do autor dentro da janela, mais a mensagem atual, agrupadas por canal e enviadas a `bulkDeleteMessages` em lotes de até 100.
- **Exclusão e punição em paralelo:** a exclusão em lote sempre roda junto com a punição, pois são independentes: uma falha não impede a outra.
- **Banimento com `deleteMinutes` maior que 0:** além da exclusão em lote da janela, usa `ban(userId, reason, deleteMinutes × 60)`, que apaga as mensagens da pessoa em todos os canais pelo próprio Discord. Assim, um banimento recusado não deixa o flood no ar; mensagens que o banimento já apagou contam como apagadas (`not_found`).
- **Banimento com `deleteMinutes` 0:** o `deleteMessageSeconds` 0 do `ban` não apaga nada; as mensagens que dispararam (`deleteMessageIds`) são apagadas com `bulkDeleteMessages`.
- **Banimento recusado (`forbidden` ou `not_found`):** aplica o plano B da decisão (timeout ou expulsão), registrado em `outcome` como `fallback: 'timeout' | 'kick'` e o resultado dele. O `action` do caso passa a ser o do plano B (`delete_timeout` ou `kick`), para que `/mod case revert` desfaça o que foi aplicado. O caso fica `actioned` se o plano B deu certo. Sem plano B (todas as regras com `ban`), o caso fica `open`.
- **Timeout com `failed`** (limite de 10 s do bot; pode ter chegado ao Discord): como na etapa 1, o caso fica `actioned` e guarda `timeoutUntil`. Só `forbidden` e `not_found` deixam o caso `open`.
- Uma punição recusada pelo Discord (`forbidden` ou `not_found`) não consome degrau de reincidência, porque o caso não fica `actioned`.
- **Phishing confirmado sem regra de spam:** depois de apagar a mensagem (`ok` ou `not_found`), ela sai do registro de atividade, para que um caso de spam seguinte não a envie de novo.

### 4.7. Persistência (`migrations/0002-spam.sql`)

```sql
ALTER TABLE moderation_cases ADD COLUMN rules TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(rules));
CREATE INDEX moderation_cases_target_status ON moderation_cases (target_user_id, status, created_at);
```

- `rules` guarda as regras disparadas com os números de cada uma.
- Os valores de `action` não mudam: `none` (só alerta ou só exclusão), `delete_timeout`, `kick` e `ban`.
- `outcome` registra `deleted` (quantidade), `individually`, falhas de lote e o resultado da punição.
- `reason` automático: `spam: flood, repeat` (e `phishing: …` quando houver), sem conteúdo.
- A contagem de reincidência usa só casos `kind = 'automatic'` com `rules` não vazio.

### 4.8. Alerta

O alerta da etapa 1 ganha:

```text
Regras: flood (9 mensagens em 5 s), repeat (4 cópias em 60 s)
Ação: 23 mensagens apagadas, timeout de 60 min (reincidência 2)
```

- Falhas aparecem como na etapa 1, por exemplo `exclusão parcial: 18 de 23 apagadas`.
- Alertas só de spam omitem as linhas `Domínios` e `Sinais`.
- O limite de 2 000 caracteres continua valendo.

### 4.9. Comandos `/mod config`

Todos exigem `moderation.config.manage` e respondem de forma efêmera.

| Comando                                                                                                    | Faz                                           |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `/mod config spam-rule <rule> [enabled] [limit] [seconds] [delete-minutes] [punishment] [timeout-minutes]` | Muda só os campos informados da regra.        |
| `/mod config spam-escalation [enabled] [window-hours] [steps]`                                             | `steps` é um texto como `10m,1h,ban` (1 a 5). |
| `/mod config spam-ignore <channel> <add\|remove>`                                                          | Adiciona ou remove um canal ignorado.         |

- `rule` tem as escolhas `flood`, `repeat` e `mentions`; `punishment` tem `none`, `timeout`, `kick` e `ban`.
- `steps`: degraus separados por vírgula; `Nm` ou `Nh` é timeout em minutos ou horas (até 28 dias), `kick` e `ban` são as demais punições. Um texto inválido responde `Configuração inválida: steps.` e nada é gravado.
- `seconds` não se aplica a `mentions`; informado para ela, responde `Opção inválida: seconds.`.
- `/mod config view` ganha um resumo de spam: cada regra (ligada ou não, limite, janela, exclusão, punição), a reincidência e os canais ignorados, dentro de 2 000 caracteres.
- O teste que fixa a permissão de cada rota inclui os três comandos novos.

## 5. Erros

| Situação                                                  | Comportamento                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Lote recusado por falta de permissão                      | Sem plano B; o caso registra a falha, o alerta mostra, e a punição segue independente.                |
| Lote com erro temporário ou mensagens com mais de 14 dias | Plano B, uma por uma.                                                                                 |
| Mensagem já apagada pelo autor                            | Conta como apagada.                                                                                   |
| Punição recusada (`forbidden` ou `not_found`)             | O caso registra a falha, não fica `actioned` e não conta para reincidência.                           |
| Timeout com `failed` (limite de 10 s)                     | Pode ter sido aplicado: o caso fica `actioned` e guarda `timeoutUntil`, como na etapa 1.              |
| Banimento recusado (`forbidden` ou `not_found`)           | A exclusão em lote já rodou; aplica o plano B (timeout ou expulsão da regra) e registra `fallback`.   |
| Uma regra lança erro                                      | A análise de spam daquela mensagem é descartada e o phishing segue; o log registra só o nome do erro. |
| Configuração inválida por comando                         | Resposta efêmera com o campo; nada é gravado.                                                         |
| Reinício do bot                                           | O registro de atividade zera; a reincidência continua pelos casos no banco.                           |

## 6. Divisão em Pull Requests

1. **PR E — Core e interface:** `bulkDeleteMessages` com plano B, `CORE_API_VERSION` `1.2.0`, decisão 0016, `MODULES.md`, `CHANGELOG.md`.
2. **PR F — módulo:** registro de atividade, regras, reincidência, decisão combinada, migração `0002`, alerta, comandos, README do módulo, README raiz (teste manual), ROADMAP e `CHANGELOG.md`.

Se o PR F crescer demais, ele se divide em detecção e resposta num PR e comandos no seguinte.

## 7. Testes

**Core e interface:**

- `bulkDeleteMessages` sem `guild.moderate` lança `CapabilityError`; lista vazia, com mais de 100 IDs ou com ID inválido devolve `failed` sem chamar o Discord; IDs repetidos são descartados; módulo inativo devolve `failed`.
- O lote apaga parte, e o resto sai pelo plano B; o lote falha e tudo sai pelo plano B; `forbidden` no lote não tenta o plano B; um único ID usa a exclusão normal; `not_found` conta como apagada; o log tem só contagens.

**Regras (código puro):**

- `flood`: 7 mensagens em 5 s dispara; 6 não; 7 espalhadas por 10 s não; somando dois canais dispara.
- `repeat`: 4 cópias em 60 s dispara; textos que diferem só em maiúsculas, acentos, espaços ou caracteres invisíveis contam como iguais; 4 textos diferentes não; `kkkkkkk` e `bom dia` repetidos não (menos de 10 caracteres).
- `mentions`: 6 menções distintas dispara; a mesma pessoa marcada 6 vezes não; 2 `@everyone` disparam (6); 5 menções não.
- Canais ignorados, autores isentos e desenvolvedores ficam de fora; o intervalo de 30 s impede um segundo disparo.

**Registro de atividade:** limite de 200 entradas e de 2 000 autores; expiração; nenhum texto guardado, só o hash; edições não geram entrada.

**Reincidência e decisão:**

- Degraus 1, 2 e 3 em 24 h; casos revertidos, descartados ou com punição recusada não contam; regra com `none` nunca pune; a punição final é a mais grave.
- Mensagem com phishing confirmado e flood gera um único caso, com a punição mais grave e as duas causas.

**Execução:** IDs agrupados por canal e em lotes de 100; banimento usa `deleteMessageSeconds` e também chama a exclusão em lote; banimento recusado aplica o plano B; timeout com `failed` deixa o caso `actioned`; exclusão parcial aparece no caso e no alerta.

**Comandos:** os três comandos novos, a validação de `steps` e de `seconds` em `mentions`, o `view` dentro de 2 000 caracteres e a permissão de cada rota.

**Integração:** um surto falso de 8 mensagens publicadas por `publishCoreEvent` gera um caso, exclusão em lote e timeout; um segundo surto gera o degrau 2.

**Teste manual no servidor real:** com uma conta sem cargo, 8 mensagens rápidas somem, a conta recebe timeout e o alerta aparece; repetir aplica o degrau 2; `/mod case revert` remove o timeout.

## 8. Documentação

- `MODULES.md`: `bulkDeleteMessages` no serviço `guild`.
- `modules/moderation/README.md`: regras de spam, configuração, comandos novos, reincidência e limitações (registro de atividade perdido ao reiniciar).
- `README.md`: passo a passo do teste manual de spam.
- `ROADMAP.md`: etapa 2 com link para esta spec; critérios marcados depois do teste manual.
- `CHANGELOG.md` em cada PR.

## 9. Critérios de conclusão desta etapa

- [ ] Um flood de uma conta sem cargo é apagado, a conta recebe a punição configurada e o alerta chega.
- [ ] A reincidência aplica o degrau seguinte dentro da janela.
- [ ] Cada regra tem testes com casos positivos e negativos.
- [ ] Toda ação automática de spam gera um caso e pode ser revertida por `/mod case revert`.
- [ ] Nenhum comando novo executa sem `moderation.config.manage`.
- [ ] Nenhum conteúdo de mensagem aparece em log ou no banco.
