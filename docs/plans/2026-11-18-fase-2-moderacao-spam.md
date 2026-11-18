# Fase 2, etapa 2 — Moderação contra spam e flood: Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** regras de flood, repetição e menções em massa no módulo `moderation`, com exclusão em lote, punição por regra, reincidência e comandos de configuração.

**Architecture:** O Core ganha `bulkDeleteMessages` (lote do Discord com exclusão individual como plano B). O módulo ganha um registro de atividade em memória, regras puras, degraus de reincidência e uma decisão que junta phishing e spam; o `Responder` passa a executar essa decisão.

**Tech Stack:** Node.js 26 (type stripping, `node:sqlite`, `node:crypto`), TypeScript 6 (`strict`), discord.js 14.28, zod 4, Vitest 5.

**Spec:** [`docs/specs/2026-11-18-fase-2-moderacao-spam.md`](../specs/2026-11-18-fase-2-moderacao-spam.md) — decisão 0016; base: [spec da etapa 1](../specs/2026-11-17-fase-2-moderacao-phishing.md).

## Global Constraints

- Tudo das Global Constraints do [plano da etapa 1](2026-11-17-fase-2-moderacao-phishing.md#global-constraints) continua valendo.
- `CORE_API_VERSION = '1.2.0'`; `moderation` declara `apiVersion` `1.2.0`; `ping` continua `1.0.0`.
- `bulkDeleteMessages`: 1 a 100 IDs únicos de snowflake por chamada; capacidade `guild.moderate`; log só com contagens.
- Registro de atividade: 200 entradas por autor, 2 000 autores, teto de 60 min, limpeza a cada 60 000 ms, `fingerprint` nulo abaixo de 10 caracteres normalizados; nunca guarda texto.
- Padrões das regras (flood / repeat / mentions): `limit` 7 / 4 / 6; `seconds` 5 / 60 / —; `deleteMinutes` 2 / 10 / 0; `punishment` `timeout`; `timeoutMinutes` 10. Reincidência ligada, `windowHours` 24, degraus `timeout 10` → `timeout 60` → `ban`. Intervalo entre disparos da mesma regra: 30 s. `@everyone`/`@here` = 3 menções.
- Gravidade: `ban` > `kick` > `timeout` (maior `timeoutMinutes` vence) > `none`.
- Textos novos ao usuário: `Configuração inválida: steps.` e `Opção inválida: seconds.` (reaproveitando `CONFIG_INVALID` e `INVALID_OPTION`).
- Respostas e alertas dentro de 2 000 caracteres.

## Review Focus

1. **Conversa animada de várias pessoas no mesmo canal:** cada autor é contado separadamente; nenhuma regra dispara por soma de autores. Teste na Task 5.
2. **Pessoa que já levou ban por spam e volta com outra conta:** reincidência é por usuário; conta nova começa do degrau 1. Teste na Task 6 (degrau por `targetUserId`).
3. **Surto de 150 mensagens em um canal:** a exclusão faz 2 lotes (100 + 50) e o caso registra 150 apagadas. Teste na Task 8.
4. **`steps` com espaços e maiúsculas (`10M, 1H , BAN`):** aceito e normalizado. Teste na Task 6.
5. **Mensagem com phishing confirmado num surto de flood:** um único caso com as duas causas e a punição mais grave. Teste na Task 7.

## Entrega em Pull Requests

| PR  | Tasks | Título                                                            |
| --- | ----- | ----------------------------------------------------------------- |
| E   | 1–2   | `feat(core): add bulk message deletion with per-message fallback` |
| F   | 3–9   | `feat(moderation): detect spam and flood with escalation`         |

O PR F parte da `main` depois do merge do PR E.

---

## PR E

### Task 1: Contrato e wrapper do Core

**Files:**

- Modify: `shared/contracts/{guild,module}.ts`, `core/guild/module-guild.ts`, `tests/helpers/fake-guild.ts`, testes/fakes que implementam `GuildActions` à mão
- Test: `core/guild/module-guild.test.ts`, `core/module-registry/manifest.test.ts`

**Interfaces:**

- Produces:
  - `type BulkDeleteResult = { ok: true; deleted: number; individually: number } | { ok: false; error: GuildActionError; deleted: number }` em `shared/contracts/guild.ts` (todos `readonly`).
  - `GuildActions.bulkDeleteMessages(channelId: string, messageIds: readonly string[]): Promise<BulkDeleteResult>`.
  - `CORE_API_VERSION = '1.2.0'`.
  - `UNAVAILABLE_GUILD.bulkDeleteMessages` → `{ ok: false, error: 'failed', deleted: 0 }`.
  - `createFakeGuild` grava `{ action: 'bulkDeleteMessages', args: [channelId, ids] }` e devolve `{ ok: true, deleted: ids.length, individually: 0 }` (sobrescrevível).

- [ ] **Step 1: Escrever os testes que falham** em `module-guild.test.ts`: sem `guild.moderate` lança `CapabilityError`; lista vazia, 101 IDs únicos ou um ID fora de `/^\d{17,20}$/` devolve `{ ok:false, error:'failed', deleted:0 }` sem chamar a porta; IDs repetidos chegam à porta sem repetição; módulo inativo devolve `failed` sem chamar a porta; porta que lança vira `{ ok:false, error:'failed', deleted:0 }`; o log `info` tem `{ module, action:'bulkDeleteMessages', requested, deleted, individually, result }` e nenhum ID. Em `manifest.test.ts`: `apiVersion` `1.1.0` aceito contra core `1.2.0`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run core/guild core/module-registry` → FAIL.
- [ ] **Step 3: Implementar.** Ajustar todos os objetos que implementam `GuildActions` (fakes de teste, `createGuildActions` com um stub temporário que lança `Error('not implemented')`, substituído na Task 2).
- [ ] **Step 4: Verificar** — `npm run check` → PASS.
- [ ] **Step 5: Commit** — `feat(core): add bulk message deletion to the guild contract`.

### Task 2: Interface Discord e documentação do PR E

**Files:**

- Modify: `interfaces/discord/guild-actions.ts`, `docs/MODULES.md`, `docs/decisions/0012-guild-actions.md` (uma linha remetendo à 0016), `CHANGELOG.md`
- Test: `interfaces/discord/guild-actions.test.ts`

**Interfaces:**

- Consumes: Task 1.
- Produces:
  - `GuildGateway.bulkDelete(channelId: string, messageIds: readonly string[]): Promise<readonly string[]>` — IDs que o lote apagou; lança os erros do discord.js.
  - `GuildGateway.deleteMessage` já existe e é usado no plano B.
  - `createDiscordGateway.bulkDelete`: canal de texto do servidor; `channel.bulkDelete(ids, true)`; devolve as chaves da coleção.

Algoritmo de `createGuildActions.bulkDeleteMessages` (cada chamada ao gateway com o limite de 10 s existente). Nota: o algoritmo implementado acrescenta os códigos terminais e a parada após 3 falhas consecutivas descritos na spec §3.

```text
ids.length === 1 → individual(ids)
senão: try bulk → apagados = resultado; restantes = ids − apagados
       erro forbidden → { ok:false, error:'forbidden', deleted:0 }
       outro erro ou timeout → restantes = ids
individual(restantes): para cada id, deleteMessage;
       ok ou not_found → deleted++ (individually++ só quando ok)
       forbidden → parar e devolver forbidden se deleted === 0, senão ok com o que apagou
       failed → continuar
resultado: deleted === 0 && nenhum ok → { ok:false, error: último erro, deleted:0 }; senão { ok:true, deleted, individually }
```

- [ ] **Step 1: Escrever os testes que falham** (gateway falso): lote apaga 3 de 5 e os 2 restantes saem um por um (`deleted:5, individually:2`); lote lança erro com código 500 e os 5 saem um por um; lote lança 50013 → `forbidden` e nenhuma exclusão individual; um único ID não chama `bulkDelete`; `not_found` individual conta em `deleted`; `forbidden` na primeira exclusão individual para o plano B; lote que excede `callTimeoutMs` (20 ms no teste) cai no plano B.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run interfaces/discord/guild-actions.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Documentar** — `MODULES.md` (serviço `guild`): `bulkDeleteMessages`, o plano B e o resultado; `0012`: linha "A exclusão em lote está em [0016]"; `CHANGELOG.md` [Unreleased]: Core 1.2.0 com exclusão em lote.
- [ ] **Step 5: Verificar** — `npm run check` → PASS.
- [ ] **Step 6: Commit** — `feat(discord): delete messages in bulk with per-message fallback`.

---

## PR F

### Task 3: Configuração, migração e casos

**Files:**

- Modify: `modules/moderation/{config.ts,manifest.json,cases.ts}`
- Create: `modules/moderation/migrations/0002-spam.sql`
- Test: `modules/moderation/tests/{config,cases}.test.ts`

**Interfaces:**

- Produces:
  - `SPAM_RULES = ['flood','repeat','mentions'] as const`, `type SpamRuleName`.
  - `type Punishment = { kind:'none' } | { kind:'timeout'; minutes:number } | { kind:'kick' } | { kind:'ban' }` (em `config.ts`).
  - `configSchema` ganha `spam` exatamente como a spec §4.4 (padrões da Global Constraints); `ModerationConfig['spam']`.
  - Migração `0002-spam.sql` exatamente como a spec §4.7.
  - `NewCase.rules: RuleHit[]` com `interface RuleHit { rule: SpamRuleName; count: number; seconds?: number }`; `CaseRecord.rules` desserializado.
  - `CaseStore.countActionedSpamSince(targetUserId: string, sinceIso: string): number` — casos `kind='automatic'`, `status='actioned'`, `rules <> '[]'`, `created_at >= since`.
  - Manifesto `apiVersion` `1.2.0`.

- [ ] **Step 1: Testes que falham:** `{}` gera o bloco `spam` completo com os padrões; `limit` 1 e 51 recusados; `deleteMinutes` 61 recusado; `steps` vazio ou com 6 degraus recusado; `ignoredChannelIds` com 26 recusado. `cases`: `create` com `rules` e leitura de volta; `countActionedSpamSince` ignora casos de phishing (`rules` vazio), revertidos, descartados, `open` e anteriores a `since`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/config.test.ts modules/moderation/tests/cases.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Casos já existentes sem `rules` passam a ler `[]` (default da coluna); `create` sem `rules` grava `[]` (campo opcional em `NewCase`, padrão `[]`).
- [ ] **Step 4: Verificar** — `npm run check` → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): add spam settings and case rules`.

### Task 4: Registro de atividade

**Files:**

- Create: `modules/moderation/spam/activity.ts`
- Test: `modules/moderation/tests/activity.test.ts`

**Interfaces:**

- Produces:
  - `fingerprintOf(content: string): string | null` — normalização da spec §4.2; `sha256` hex.
  - `interface ActivityEntry { messageId: string; channelId: string; atMs: number; fingerprint: string | null }`.
  - `class ActivityLog { constructor(limits?: { maxAuthors?: number; maxEntries?: number }); record(authorId: string, entry: ActivityEntry): void; since(authorId: string, sinceMs: number): readonly ActivityEntry[]; forget(authorId: string, messageIds: readonly string[]): void; prune(nowMs: number, maxAgeMs: number): void; get authorCount(): number }`.

- [ ] **Step 1: Testes que falham:** `fingerprintOf('Olá   Mundo, tudo bem?')` igual a `fingerprintOf('ola mundo, tudo BEM?')` e a uma versão com ZWSP; `fingerprintOf('kkkkkkk')` é `null`; o resultado tem 64 caracteres hex e não contém o texto; 201 entradas mantêm as 200 mais novas; o 2 001º autor expulsa o menos recente; `since` filtra por tempo; entradas esquecidas com `forget` não aparecem mais em `since`; `prune` remove entradas antigas e autores vazios.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/activity.test.ts` → FAIL.
- [ ] **Step 3: Implementar** com `node:crypto` `createHash('sha256')`.
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): track recent author activity for spam rules`.

### Task 5: Regras

**Files:**

- Create: `modules/moderation/spam/rules.ts`
- Test: `modules/moderation/tests/spam-rules.test.ts`

**Interfaces:**

- Consumes: Tasks 3 e 4.
- Produces:
  - `countMentions(content: string): number` — spec §4.3.
  - `interface SpamHit extends RuleHit { messageIds: readonly string[] }` — `messageIds` = entradas que fizeram a regra disparar (para `mentions`, só a mensagem atual).
  - `class SpamCooldown { isCooling(authorId: string, rule: SpamRuleName, nowMs: number): boolean; mark(authorId: string, rule: SpamRuleName, nowMs: number): void; prune(nowMs: number): void }` (30 000 ms).
  - `evaluateSpam(input: { authorId: string; messageId: string; channelId: string; content: string; nowMs: number; isEdit: boolean }, deps: { activity: ActivityLog; cooldown: SpamCooldown; config: ModerationConfig['spam'] }): SpamHit[]` — para mensagens criadas, registra a entrada antes de avaliar; edições só avaliam `mentions`; canais ignorados devolvem `[]` sem registrar; regras desligadas não disparam; marca o intervalo das regras que dispararam.

- [ ] **Step 1: Testes que falham** (casos da spec §7 "Regras"): flood 7 em 5 s dispara, 6 não, 7 em 10 s não, dois canais somam; repeat 4 cópias dispara, variações de caixa/acento/espaço/ZWSP contam iguais, 4 textos diferentes não, `kkkkkkk` e `bom dia` não; mentions 6 distintas dispara, mesma pessoa 6 vezes não, 2 `@everyone` dispara, 5 não; canal ignorado não registra nem dispara; segundo disparo em 30 s não ocorre e ocorre após 31 s; edição não registra entrada; Review Focus 1: dois autores com 4 mensagens cada em 5 s não disparam flood.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/spam-rules.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): detect flood, repeated messages and mass mentions`.

### Task 6: Reincidência e degraus

**Files:**

- Create: `modules/moderation/spam/escalation.ts`
- Test: `modules/moderation/tests/escalation.test.ts`

**Interfaces:**

- Consumes: `Punishment` (Task 3).
- Produces:
  - `severity(p: Punishment): number` e `mostSevere(...ps: Punishment[]): Punishment` — ordem da Global Constraints.
  - `escalationStep(steps: readonly Punishment[], priorActioned: number): { step: number; punishment: Punishment }` — índice `min(prior, steps.length − 1)`, `step` = índice + 1.
  - `parseSteps(text: string): Punishment[] | undefined` — degraus separados por vírgula, espaços ignorados, caixa ignorada; `Nm` (1–40320) e `Nh` (1–672) viram timeout em minutos; `kick`, `ban`; 1 a 5 degraus; qualquer outro texto → `undefined`.
  - `formatSteps(steps: readonly Punishment[]): string` — inverso legível (`10m,1h,ban`).

- [ ] **Step 1: Testes que falham:** `mostSevere` (ban vence kick, kick vence timeout, timeout 60 vence 10, none perde); `escalationStep` com 0, 1, 2 e 5 casos anteriores sobre 3 degraus; `parseSteps('10m,1h,ban')`; Review Focus 4: `parseSteps('10M, 1H , BAN')` igual; `parseSteps('')`, `'10x'`, `'0m'`, `'40321m'`, seis degraus → `undefined`; `formatSteps(parseSteps('90m,ban'))` = `'90m,ban'` (horas só quando divisível por 60: `'60m'` → `'1h'`).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/escalation.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): escalate spam punishments for repeat offenders`.

### Task 7: Decisão combinada

**Files:**

- Create: `modules/moderation/decision.ts`
- Test: `modules/moderation/tests/decision.test.ts`

**Interfaces:**

- Consumes: `Analysis` (etapa 1), `SpamHit` (Task 5), Task 6.
- Produces:
  - `interface Decision { level: 'confirmed' | 'suspicious' | undefined; punishment: Punishment; deleteMinutes: number; deleteMessageIds: readonly string[]; spamHits: readonly SpamHit[]; escalationStep: number | undefined; reason: string }`.
  - `decide(input: { analysis: Analysis; spamHits: readonly SpamHit[]; config: ModerationConfig; priorActionedSpam: number; messageId: string }): Decision` — regras da spec §4.5:
    - sem `spamHits`: comportamento da etapa 1 (`confirmed` → `{ kind:'timeout', minutes: config.timeoutMinutes }`, `deleteMessageIds: [messageId]`, `deleteMinutes: 0`; `suspicious` → `none`, nenhuma exclusão);
    - com `spamHits`: `level = 'confirmed'` se alguma regra tem `punishment` ≠ `none` ou o phishing é `confirmed`, senão `'suspicious'`; punição = `mostSevere(regras não none, degrau (se escalonamento ligado e há regra não none), timeout do phishing confirmado)`; `deleteMinutes` = maior entre as regras disparadas; `deleteMessageIds` = união dos `messageIds` das regras + `messageId`;
    - `reason`: `spam: flood, repeat` e, se houver, `; phishing: <sinais>`.

- [ ] **Step 1: Testes que falham:** phishing sozinho reproduz a etapa 1; flood sozinho com `timeout 10` e 0 anteriores → timeout 10, `escalationStep` 1; com 1 anterior → timeout 60, step 2; com 2 → ban, step 3; regra `none` → `suspicious`, punição `none`, mesmo com 5 anteriores; escalonamento desligado → só a punição da regra; Review Focus 5: phishing confirmado + flood → um `Decision` com `confirmed`, as duas causas no `reason` e a punição mais grave; duas regras → maior `deleteMinutes` e união dos IDs.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/decision.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): combine phishing and spam into one decision`.

### Task 8: Execução no Responder, alerta e ligação no módulo

**Files:**

- Modify: `modules/moderation/{responder,alert,index}.ts`
- Test: `modules/moderation/tests/{responder,alert}.test.ts`, `tests/integration/moderation.test.ts`

**Interfaces:**

- Consumes: Tasks 3–7; `bulkDeleteMessages` (Task 1).
- Produces:
  - `ResponderDeps` ganha `activity: ActivityLog` e `cooldown: SpamCooldown`; `handle(payload, kind: 'created' | 'updated')`.
  - Fluxo: isenções → `analyzeMessage` → `evaluateSpam` → se nada disparou, sair → `priorActionedSpam = cases.countActionedSpamSince(authorId, now − windowHours)` → `decide` → dedupe por mensagem (como hoje, pelo nível) → executar → caso → publicar → alerta.
  - Execução: para `ban`, `ban(authorId, reason, deleteMinutes × 60)` e, com `deleteMinutes` 0 (o `deleteMessageSeconds` 0 não apaga nada), também `bulkDeleteMessages(deleteMessageIds)`; para os demais, exclusão em lote dos IDs da janela (`activity.since(authorId, now − deleteMinutes·60 000)` quando `deleteMinutes > 0`, senão `deleteMessageIds`) agrupados por canal e em fatias de 100, e em paralelo a punição (`timeout` ou `kick`; a execução em paralelo continua); depois de apagar, chama `activity.forget(authorId, deletedIds)` para que um caso posterior na mesma janela não reenvie essas mensagens; `outcome` ganha `deleted` (soma, como texto), `individually`, `bulk` (`ok` ou o primeiro erro) e a chave da punição; `action`: `ban` → `ban`, `kick` → `kick`, `timeout` → `delete_timeout`, `none` → `none`; `status` `actioned` só se a punição devolveu `ok`, senão `open` (não conta para reincidência).
  - `formatAlert` ganha a linha `Regras: …` e a linha de ação com quantidade apagada e `(reincidência N)` (spec §4.8), dentro de 2 000 caracteres.
  - `index.ts`: cria `ActivityLog({ maxAuthors: 2000, maxEntries: 200 })` e `SpamCooldown`; a limpeza de 60 s também chama `activity.prune(now, maxAgeMs)` (maior janela configurada, teto 3 600 000) e `cooldown.prune(now)`; os dois eventos passam `kind`.

- [ ] **Step 1: Testes que falham:**
  - Responder: 8 mensagens de flood em 5 s → um caso `delete_timeout` com `rules` `flood`, uma chamada `bulkDeleteMessages` com os 8 IDs e um `timeout` de 10 min; mensagens em 2 canais → 2 chamadas; Review Focus 3: 150 entradas no mesmo canal → chamadas com 100 e 50 e `outcome.deleted` `'150'`; punição `ban` com `deleteMinutes` > 0 → `ban` com `deleteMessageSeconds` = `deleteMinutes × 60` e nenhuma chamada de lote; `ban` com `deleteMinutes` 0 → `ban` com 0 segundos e `bulkDeleteMessages` com os `deleteMessageIds`; um segundo surto 40 s depois reenvia só as mensagens novas (o `outcome.deleted` conta apenas elas); lote parcial (`deleted` 18 de 23) aparece no `outcome`; punição `forbidden` → caso `open`; segundo surto em 24 h → timeout 60 e `(reincidência 2)` no alerta; regra com `none` → caso `open`, sem exclusão nem punição, alerta enviado; autor isento e desenvolvedor → nada; nenhum log contém conteúdo.
  - Alerta: linhas exatas da spec §4.8; 2 000 caracteres com muitas regras.
  - Integração: 8 `discord.message.created` do mesmo autor via `publishCoreEvent` com `createFakeGuild` → caso, `bulkDeleteMessages` e `timeout`; um segundo surto 40 s depois → degrau 2.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation tests/integration` → FAIL.
- [ ] **Step 3: Implementar.** O caminho só de phishing (sem `spamHits`) mantém o comportamento e os testes da etapa 1.
- [ ] **Step 4: Verificar** — `npm run check` → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): respond to spam with bulk deletion and escalation`.

### Task 9: Comandos e documentação do PR F

**Files:**

- Modify: `modules/moderation/commands/{mod-command,config,replies}.ts`, `modules/moderation/README.md`, `README.md`, `docs/ROADMAP.md`, `CHANGELOG.md`
- Test: `modules/moderation/tests/commands-config.test.ts`, `tests/integration/mod-command.test.ts`

**Interfaces:**

- Consumes: Tasks 3 e 6.
- Produces: subcomandos do grupo `config` exatamente como a spec §4.9 — `spam-rule` (opções `rule` com escolhas `flood`/`repeat`/`mentions` obrigatória; `enabled` boolean; `limit` 2–50; `seconds` 2–600; `delete-minutes` 0–60; `punishment` com escolhas `none`/`timeout`/`kick`/`ban`; `timeout-minutes` 1–40320), `spam-escalation` (`enabled`, `window-hours` 1–168, `steps` string ≤ 100), `spam-ignore` (`channel` obrigatório, `action` `add`/`remove` obrigatório); todos com `moderation.config.manage`; cada um grava o bloco `spam` completo com `config.set`.

- [ ] **Step 1: Testes que falham:** cada subcomando sem permissão → `NO_PERMISSION` e nada gravado (entra na tabela de rotas com a permissão esperada); `spam-rule rule:flood limit:10` muda só `limit`; `spam-rule rule:mentions seconds:5` → `Opção inválida: seconds.`; `spam-escalation steps:'10m,1h,ban'` grava os degraus; `steps:'abc'` → `Configuração inválida: steps.` e nada gravado; `spam-ignore add` idempotente e `remove`; `config view` mostra o resumo de spam (`formatSteps`) e fica ≤ 2 000 caracteres; o comando completo passa pelo validador real do Core.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/commands-config.test.ts tests/integration/mod-command.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Documentar** — README do módulo: regras, configuração, comandos, reincidência e limitações (registro perdido ao reiniciar; mensagens fora do registro só somem no banimento); README raiz, seção "Moderação": teste manual de spam da spec §7; ROADMAP: Fase 2 "etapas 1 e 2 implementadas; falta a verificação manual no servidor real"; CHANGELOG [Unreleased].
- [ ] **Step 5: Verificar** — `npm run check` → PASS.
- [ ] **Step 6: Commit** — `feat(moderation): configure spam rules and escalation by command`.
