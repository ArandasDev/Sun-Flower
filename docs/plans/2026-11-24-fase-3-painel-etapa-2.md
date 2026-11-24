# Fase 3, etapa 2 — Moderação pelo painel: Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** operações de módulo no Core, o `/mod` migrado para elas e as telas de moderação do painel. As telas cobrem casos ao vivo, ações manuais, domínios, configuração sincronizada com detecção de conflito e "Meus casos" no perfil.

**Architecture:**

- O Core ganha um registro de operações ([0022](../decisions/0022-module-operations.md)). Cada operação tem nome, permissão, schema zod e handler sem Discord. O Core checa se o módulo está ativo, a permissão e a entrada antes do handler.
- O `moderation` registra uma operação por subcomando, e o `/mod` passa a chamá-las pelo próprio contexto.
- A interface `dashboard` expõe `POST /api/operations/:name` e repassa ao vivo os eventos de casos.
- O app ganha as telas de moderação.

**Tech Stack:** o mesmo da etapa 1, sem dependências novas. O servidor usa Node.js 26, TypeScript 6, zod 4, Fastify 5 e Vitest 5. O app usa React 19, React Router 8, TanStack Query 5, Motion 14 e Vite 8.

**Spec:** [`docs/specs/2026-11-24-fase-3-painel.md`](../specs/2026-11-24-fase-3-painel.md) §4, §5.5 a §5.7, §6, §7 e §9 a §13. Decisões aplicadas: [0017](../decisions/0017-access-levels.md), [0020](../decisions/0020-panel-realtime.md) e [0022](../decisions/0022-module-operations.md). Base: [plano da etapa 1](2026-11-24-fase-3-painel-etapa-1.md).

## Global Constraints

- Tudo das Global Constraints do [plano da etapa 1](2026-11-24-fase-3-painel-etapa-1.md#global-constraints) continua valendo: CSP, sessão, CSRF, limites, formato de erro e valores fictícios.
- **Versões:** `CORE_API_VERSION = '1.3.0'`, de forma aditiva. O `moderation` declara `apiVersion` `1.3.0`, e o `ping` continua em `1.0.0`.
- **Nome da operação:** segue `^<id do módulo>\.[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`. Um nome repetido é recusado no registro.
- **Permissão da operação:**
  - precisa estar declarada no manifesto, ou ser `null`;
  - `null` só vale para nomes terminados em `.mine`.
- **Ordem de checagem do Core** antes do handler. Cada falha devolve um erro tipado com mensagem fixa e não executa nada.
  1. Operação inexistente: `not_found`, `Operação desconhecida.`
  2. Módulo inativo: `unavailable`, `Módulo indisponível.`
  3. Sem permissão: `forbidden`, `Você não tem permissão para isso.`
  4. Entrada inválida: `invalid`, `Entrada inválida: <caminhos separados por vírgula>.`, só com os caminhos e nunca com os valores.
- **Erro no handler:** um erro lançado vira `failed`, `Erro interno.` O log registra só `error.name`.
- **Log de cada chamada:** `{ module, operation, source, result }`, com `source` `discord` ou `dashboard` e `result` `ok` ou o código de erro. Não leva entrada, IDs nem texto.
- **Mapeamento HTTP:** `forbidden` → 403, `invalid` → 422, `not_found` → 404, `conflict` → 409, `unavailable` → 503 e `failed` → 500. A mensagem da operação vai para o corpo de erro sem alteração.
- **Listagem de casos:** 50 por página. O cursor é o `id` do último caso da página, e a página seguinte traz os `id` menores, em ordem decrescente de `id`.
- **"Meus casos":** os últimos 50 casos em que a pessoa é o alvo. Mostram só `id`, `createdAt`, `kind`, `action` e `status`, sem quem moderou e sem motivo.
- **Texto de conflito, ao usuário:** `Outra pessoa alterou esta configuração. Recarregue para ver a versão atual.`, com o botão `Recarregar`.
- **Confirmação:** expulsão, banimento e reversão pedem confirmação no painel antes de enviar.
- **IDs digitados:** campos de usuário, canal e cargo aceitam IDs de 17 a 20 dígitos. Nesta etapa não há seletor ligado ao Discord.
- **Respostas do `/mod`:** continuam idênticas às de hoje. Os textos estão em `modules/moderation/commands/replies.ts`, e os testes atuais do `/mod` passam sem alteração de comportamento.

## Review Focus

1. **Dono sem cargo usando as ações manuais pelo painel:** a operação aceita, porque o dono tem as permissões de módulo, e as proteções valem igual. Quando o dono tenta agir contra si mesmo, recebe `Não é possível agir contra você mesmo.` Teste na Task 4.
2. **Duas abas salvando a mesma configuração:** a segunda recebe 409, e a tela mostra o texto de conflito sem perder o que foi digitado. Testes nas Tasks 2 e 7.
3. **Moderador sem `moderation.cases.read` recebendo um caso novo ao vivo:** não recebe nada. Teste na Task 5.
4. **Lista com mais de 50 casos e filtros combinados (situação + regra + alvo):** a paginação não repete nem pula casos. Teste na Task 3.
5. **Membro chamando uma operação de moderação diretamente pela API:** recebe 403, e nenhum caso é gravado. Teste na Task 5.

## Entrega em Pull Requests

| PR  | Tasks | Título                                                      |
| --- | ----- | ----------------------------------------------------------- |
| K   | 1–4   | `feat(core): add module operations and move /mod onto them` |
| L   | 5–8   | `feat(dashboard): add moderation screens to the panel`      |

O PR L parte da `main` depois do merge do PR K.

---

## PR K

### Task 1: Contrato e registro de operações

**Files:**

- Create:
  - `shared/contracts/operations.ts`
  - `core/operations/operation-registry.ts` e `.test.ts`
- Modify:
  - `shared/contracts/module.ts` (`operations` no contexto, `config.set` com versão, `CORE_API_VERSION`)
  - `core/module-registry/registry.ts`
  - `core/application/core.ts`
  - `tests/helpers/*` (fakes de contexto)

**Interfaces:**

- Produces (`shared/contracts/operations.ts`):
  - `type OperationErrorCode = 'forbidden' | 'invalid' | 'not_found' | 'conflict' | 'unavailable' | 'failed'`.
  - `interface OperationError { readonly code: OperationErrorCode; readonly message: string }`.
  - `type OperationResult<O = unknown> = { readonly ok: true; readonly data: O } | { readonly ok: false; readonly error: OperationError }`.
  - `interface OperationDefinition<I = unknown, O = unknown> { readonly name: string; readonly permission: string | null; readonly input: unknown; handler(actor: Actor, input: I): Promise<OperationResult<O>> }`.
  - `type OperationSource = 'discord' | 'dashboard'`.
  - `ok<O>(data: O): OperationResult<O>` e `fail(code, message): OperationResult<never>`, como helpers.
- Produces (`ModuleContext`):
  - `operations.register(definition): void`. Valida o nome, a permissão e se `input` tem `safeParse`. Um registro inválido lança `InvalidOperationError`.
  - `operations.execute(name: string, actor: Actor, input: unknown): Promise<OperationResult>`. Só aceita operações do próprio módulo e usa `source: 'discord'`.
  - `config.set(partial, expectedVersion?: number)`. Com `expectedVersion` errada, lança `ConfigVersionConflictError`, que já existe em `core/configuration/module-config.ts`.
  - `config.version(): number`.
- Produces (Core):
  - `class OperationRegistry`, com:
    - `register(manifest, definition)`;
    - `dropModule(moduleId)`;
    - `names(): string[]`;
    - `execute(name, actor, input, source): Promise<OperationResult>`, na ordem das Global Constraints.
  - O registro de módulos chama `dropModule` onde hoje chama `#dropCommands`, ou seja, na falha e na parada.
  - `CoreHandle.operations: { names(): string[]; execute(name, actor, input, source): Promise<OperationResult> }`.

- [ ] **Step 1: Testes que falham** (`operation-registry.test.ts`, com um módulo de teste):
  - nome fora do prefixo, nome repetido, permissão não declarada e `null` sem `.mine` são recusados no registro;
  - `execute` de operação inexistente devolve `not_found`;
  - com o módulo parado, devolve `unavailable` e o handler não roda;
  - um membro sem a permissão recebe `forbidden` e o handler não roda;
  - entrada `{ minutes: 'x' }` devolve `invalid`, com a mensagem contendo `minutes` e não `x`;
  - um handler que lança devolve `failed`, e o log tem só `error.name`;
  - `permission: null` aceita qualquer ator;
  - o desenvolvedor e o dono passam pelas permissões de módulo;
  - cada chamada gera um log `{ module, operation, source, result }`, sem a entrada;
  - `context.operations.execute` de outro módulo devolve `not_found`;
  - `config.set` com `expectedVersion` errada lança `ConfigVersionConflictError` e não grava;
  - `config.version()` acompanha as gravações.
- [ ] **Step 2: Rodar.** `npx vitest run core/operations core/module-registry` → FAIL.
- [ ] **Step 3: Implementar.** Atualizar os fakes de `ModuleContext` dos testes e `CORE_API_VERSION`.
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(core): add module operations registry`

### Task 2: Operações de configuração e domínios

**Files:**

- Create:
  - `modules/moderation/operations/config.ts` e `.test.ts`
  - `modules/moderation/operations/domains.ts` e `.test.ts`
  - `modules/moderation/operations/index.ts`
- Modify:
  - `modules/moderation/index.ts` (registra as operações)
  - `modules/moderation/commands/{config,domain}.ts` (chamam as operações)
  - `modules/moderation/manifest.json` (`apiVersion` `1.3.0`)

**Interfaces:**

- Produces:
  - `moderation.config.view` (`moderation.config.manage`), com entrada `{}`. Devolve `{ version: number; config: ModerationConfig }`.
  - `moderation.config.update` (`moderation.config.manage`), com entrada `{ expectedVersion: int ≥ 0; changes: Record<string, unknown> }`:
    - só aceita chaves de topo do `configSchema`, e uma chave desconhecida dá `invalid`;
    - a validação pelo schema do módulo dá `invalid`, com os caminhos;
    - uma versão errada dá `conflict`, com o texto de conflito;
    - devolve `{ version, config }`.
  - `moderation.domains.list` (`moderation.domains.manage`), com entrada `{ list: 'block' | 'allow' }`. Devolve `{ list, domains: string[] }`, até 1 000, em ordem alfabética.
  - `moderation.domains.block` e `moderation.domains.allow` (`moderation.domains.manage`), com entrada `{ domain: string (1–253) }`:
    - normalizam o domínio como o `/mod` faz hoje;
    - um domínio inválido dá `invalid`, `Domínio inválido.`;
    - não há regra nova: o comportamento é o do `/mod domain` de hoje;
    - devolvem `{ domain, list }`.
  - `moderation.domains.remove` (`moderation.domains.manage`), com entrada `{ domain }`. Devolve `{ domain }`. Um domínio que não está em lista nenhuma dá `not_found`, `Domínio não estava em nenhuma lista.`
  - Os handlers `config*` e `domain*` do `/mod` montam a entrada a partir das opções e chamam `context.operations.execute`. Com sucesso, respondem os textos atuais; com erro, respondem `error.message`.
  - O `/mod config` mantém a regra de que a última alteração vale (spec §5.7). Ele chama `moderation.config.update` com `expectedVersion` igual a `context.config.version()`, lida no mesmo instante.

- [ ] **Step 1: Testes que falham.**
  - Cada operação é testada direto, com `createFakeGuild` e o armazenamento de teste:
    - sucesso;
    - `invalid`;
    - `conflict`;
    - `not_found`;
    - **(Review Focus 2)** duas atualizações com a mesma `expectedVersion`: a segunda dá `conflict`, e a configuração fica a da primeira.
  - Os testes atuais de `commands/config` e `commands/domain` continuam passando sem mudança.
- [ ] **Step 2: Rodar.** `npx vitest run modules/moderation` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(moderation): expose config and domain operations`

### Task 3: Operações de casos

**Files:**

- Create: `modules/moderation/operations/cases.ts` e `.test.ts`
- Modify:
  - `modules/moderation/cases.ts` (`listPage`, `listForTarget`)
  - `modules/moderation/commands/case.ts`
  - `modules/moderation/manifest.json` (`publishes` + `moderation.case.dismissed`)

**Interfaces:**

- Produces:
  - `CaseStore.listPage({ status?, rule?, targetUserId?, before?: number, limit: number }): CaseRecord[]`, em ordem decrescente de `id`. O filtro `rule` busca na coluna JSON `rules` com `json_each`.
  - `type CaseSummary = { id; kind; level; action; status; targetUserId; rules: SpamRuleName[]; createdAt }`.
  - `type CaseDetail = CaseRecord` sem `messageId`. O link da mensagem não é montado no painel nesta etapa.
  - **Operações:**
    - `moderation.cases.list` (`moderation.cases.read`): entrada `{ status?: CaseStatus; rule?: SpamRuleName; targetUserId?: snowflake; cursor?: int ≥ 1 }`. Devolve `{ cases: CaseSummary[]; nextCursor: number | null }`, com 50 casos por página.
    - `moderation.cases.view` (`moderation.cases.read`): entrada `{ id: int ≥ 1 }`. Devolve `CaseDetail`, ou `not_found` com `Caso não encontrado.`
    - `moderation.cases.revert` (`moderation.cases.revert`): entrada `{ id; allowDomains?: boolean }`. Tem as mesmas regras e mensagens do `/mod case revert`. Devolve `{ case: CaseDetail; deletedMessage: boolean }`.
    - `moderation.cases.dismiss` (`moderation.cases.revert`): entrada `{ id }`, com as mesmas regras do `/mod`. Publica `moderation.case.dismissed` `{ caseId }` e devolve `CaseDetail`.
    - `moderation.cases.mine` (`null`): entrada `{}`. Devolve `{ cases: Array<{ id; createdAt; kind; action; status }> }`, os últimos 50 com `targetUserId === actor.userId`.
  - Os handlers `case*` do `/mod` passam a chamar as operações, e as respostas não mudam.

- [ ] **Step 1: Testes que falham.**
  - **(Review Focus 4)** 120 casos com situações e regras variadas. A paginação com e sem filtros (situação + regra + alvo) percorre tudo sem repetir nem pular, e `nextCursor` é `null` na última página.
  - `view` de caso inexistente dá `not_found`.
  - `revert` e `dismiss` seguem as mesmas recusas de hoje.
  - `dismiss` publica `moderation.case.dismissed`.
  - `mine` só traz os casos do próprio ator, sem `actorUserId` e sem `reason` no resultado.
  - Os testes atuais de `commands/case` passam.
- [ ] **Step 2: Rodar.** `npx vitest run modules/moderation` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(moderation): expose case operations`

### Task 4: Operações de ação manual e documentação do PR K

**Files:**

- Create: `modules/moderation/operations/actions.ts` e `.test.ts`
- Modify:
  - `modules/moderation/commands/actions.ts`
  - `docs/MODULES.md` (operações, `CORE_API_VERSION` 1.3.0)
  - `modules/moderation/README.md`
  - `CHANGELOG.md`

**Interfaces:**

- Produces:
  - `moderation.actions.warn`: entrada `{ userId: snowflake; reason: string (1–512, aparado) }`.
  - `moderation.actions.timeout`: entrada `{ userId; minutes: int 1–40320; reason }`.
  - `moderation.actions.kick`: entrada `{ userId; reason }`.
  - `moderation.actions.ban`: entrada `{ userId; reason; deleteDays?: int 0–7 }`.
  - Todas devolvem `{ caseId: number; dmFailed?: boolean }`, e cada uma exige a permissão do subcomando equivalente.
  - **Erros:**
    - contra a própria pessoa: `forbidden`, `Não é possível agir contra você mesmo.`;
    - contra um alvo protegido: `forbidden`, `Não é possível agir contra este membro.`;
    - contra quem não é membro, em `warn`, `timeout` e `kick`: `not_found`, `Este usuário não é membro do servidor.`;
    - falha na consulta de cargos: `unavailable`, `O Discord recusou a ação: falha.`;
    - recusa do Discord: `forbidden`, `not_found` ou `failed`, conforme o resultado, com o texto `O Discord recusou a ação: <motivo>.`
  - Nenhum caso é gravado quando a operação falha, como hoje.
  - Os handlers de ação do `/mod` chamam as operações e respondem com os textos atuais.

- [ ] **Step 1: Testes que falham:**
  - cada ação com sucesso;
  - cada proteção;
  - recusa do Discord;
  - falha na consulta de cargos;
  - **(Review Focus 1)** o dono sem cargos consegue `timeout` em um membro comum e recebe a recusa ao mirar a si mesmo;
  - um membro sem permissão recebe `forbidden` sem nenhuma chamada ao serviço `guild`;
  - os testes atuais de `commands/actions` passam.
- [ ] **Step 2: Rodar.** `npx vitest run modules/moderation` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Documentação.** Contrato de operações em MODULES.md, lista das operações no README do módulo e CHANGELOG do PR K.
- [ ] **Step 5: Rodar.** `npm run check` → PASS.
- [ ] **Step 6: Commit.** `feat(moderation): run manual actions through operations`

---

## PR L

### Task 5: Rota de operações e eventos de casos ao vivo

**Files:**

- Create: `interfaces/dashboard/operations-route.ts` e `.test.ts`
- Modify:
  - `interfaces/dashboard/server.ts`
  - `interfaces/dashboard/live.ts` e `live.test.ts`

**Interfaces:**

- Produces:
  - `POST /api/operations/:name`:
    - exige sessão e CSRF (`requireSession`);
    - o `:name` segue `^[a-z][a-z0-9.-]{2,100}$`, e um nome fora do formato ou não registrado dá 404;
    - o corpo é um objeto JSON e, sem corpo, vale `{}`;
    - chama `core.operations.execute(name, actor, body, 'dashboard')`;
    - com sucesso, devolve `200 { data }`;
    - com erro, responde com o status das Global Constraints e `{ error }`.
  - **Eventos ao vivo:** a conexão assina `moderation.case.created`, `moderation.case.reverted` e `moderation.case.dismissed` pelo `CoreHandle.subscribe`. Envia `case.created` `{ caseId }` (para o primeiro) ou `case.updated` `{ caseId }` (para os outros) só a quem tem `moderation.cases.read` naquele momento.

- [ ] **Step 1: Testes que falham** (`inject` e WebSocket real):
  - **(Review Focus 5)** um membro chama `moderation.actions.ban` e recebe 403, e nenhum caso é gravado;
  - sem CSRF, 403;
  - nome inválido, 404;
  - entrada inválida, 422 com a mensagem da operação;
  - conflito, 409;
  - módulo parado, 503;
  - um moderador com `moderation.cases.read` consegue `cases.list`, 200;
  - o dono sem cargo consegue `config.update`, 200;
  - **(Review Focus 3)** um caso novo chega como `case.created` a quem tem `moderation.cases.read` e não chega a um moderador só com `moderation.domains.manage`;
  - `dismiss` gera `case.updated`.
- [ ] **Step 2: Rodar.** `npx vitest run interfaces/dashboard` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): run module operations from the panel`

### Task 6: Tela de casos

**Files:**

- Create em `interfaces/dashboard/app/src/`:
  - `operations.ts` e `.test.ts`
  - `routes/Cases.tsx` e `.test.tsx`
  - `components/CaseDetail.tsx`
  - `components/ConfirmDialog.tsx`
- Modify:
  - `App.tsx` (rota `/casos`)
  - `components/Menu.tsx`
  - `live.ts` (`case.created` e `case.updated`)
  - `labels.ts`
  - `styles.css`

**Interfaces:**

- Produces:
  - `runOperation<O>(name: string, input: object): Promise<O>`, que faz `POST /api/operations/<name>` com `apiFetch` e lança `ApiError` em erro.
  - `useOperationQuery(key, name, input)` e `useOperationMutation(name)`.
  - **`Cases`:**
    - filtros de situação, regra e alvo (ID), refletidos na URL;
    - lista com `id`, data, tipo (`automático`/`manual`, nível), ação, situação e alvo;
    - botão `Carregar mais` pelo `nextCursor`;
    - um clique abre `CaseDetail` ao lado, ou abaixo no celular.
  - **`CaseDetail`:**
    - mostra todos os campos;
    - `Reverter` (com opção "permitir também os domínios do caso") e `Descartar` aparecem só com `moderation.cases.revert`;
    - as duas ações pedem confirmação pelo `ConfirmDialog`;
    - erros aparecem com `error.message`.
  - **Ao vivo:** `case.created` invalida `['cases']`; `case.updated` invalida `['cases']` e `['case', caseId]`.
  - **Tela na presença:** `cases`.
  - **Menu:** "Casos" aparece com `moderation.cases.read`.

- [ ] **Step 1: Testes que falham**, com `fetch` falso:
  - a lista mostra os casos;
  - mudar o filtro refaz a busca com os parâmetros certos;
  - `Carregar mais` usa o cursor;
  - reverter pede confirmação e envia `{ id, allowDomains }`;
  - quem não tem `moderation.cases.revert` não vê os botões;
  - `case.created` atualiza a lista;
  - um 403 mostra `Sem permissão.`
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.** Reaproveitar os tokens e os padrões de `styles.css` e dos componentes da etapa 1:
  - cores céu, caule, folha, pétala e semente;
  - fontes do sistema;
  - painéis só onde agrupam informação;
  - sem `style=`, sem caixa alta e sem `→`.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add the cases screen`

### Task 7: Ações, domínios, configuração e "Meus casos"

**Files:**

- Create em `interfaces/dashboard/app/src/routes/`: `Actions.tsx`, `Domains.tsx`, `ModerationConfig.tsx` e os testes
- Modify:
  - `routes/Profile.tsx` ("Meus casos")
  - `App.tsx`
  - `components/Menu.tsx`
  - `live.ts` (`config.changed` de `moderation` invalida `['config', 'moderation']`)
  - `styles.css`

**Interfaces:**

- Produces:
  - **`Actions` (`/acoes`):**
    - mostra uma aba por ação permitida;
    - os campos são usuário (ID), motivo (até 512), minutos (timeout) e dias de mensagens (ban, 0–7);
    - expulsão e banimento pedem confirmação;
    - com sucesso, mostra `Caso #<n> registrado.` e, quando `dmFailed`, também `Não foi possível enviar mensagem direta.`
  - **`Domains` (`/dominios`):** duas listas (bloqueados e permitidos), com campo para adicionar e um botão `Remover` por domínio.
  - **`ModerationConfig` (`/moderacao`):**
    - seções de alertas (canal), timeout, limites, cargos isentos, regras de spam (flood, repeat, mentions), reincidência e canais ignorados;
    - cada seção salva só as suas chaves por `config.update`, com a `expectedVersion` carregada;
    - **(Review Focus 2)** um 409 mostra o texto de conflito e o botão `Recarregar`, sem apagar o que foi digitado;
    - `config.changed` de outra pessoa mostra `Outra pessoa alterou esta configuração. Recarregue para ver a versão atual.` enquanto há alterações não salvas, ou recarrega sozinho quando não há.
  - **`Profile`:** a seção "Meus casos" lista `moderation.cases.mine` (data, tipo, ação, situação). Sem casos, mostra `Nenhum caso registrado com você.`
  - **Menu:** "Ações" aparece com qualquer `moderation.actions.*`, "Domínios" com `moderation.domains.manage` e "Moderação" com `moderation.config.manage`.
  - **Telas na presença:** `actions`, `domains`, `moderation-config`.

- [ ] **Step 1: Testes que falham:**
  - o banimento pede confirmação e envia a entrada certa;
  - um ID inválido bloqueia o envio no próprio formulário;
  - adicionar e remover domínios;
  - salvar uma seção envia só as suas chaves e a versão;
  - um 409 mostra o conflito mantendo os campos;
  - `config.changed` sem edição recarrega sozinho;
  - "Meus casos" mostra os casos e o texto vazio;
  - o menu aparece por permissão.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add actions, domains, moderation settings and my cases`

### Task 8: Documentação e fechamento da etapa 2

**Files:**

- Modify:
  - `README.md` (seção "Painel": telas de moderação e teste manual da etapa 2)
  - `docs/ROADMAP.md`
  - `docs/ARCHITECTURE.md` §3.4 (operações)
  - `CHANGELOG.md`

- [ ] **Step 1: Documentação.**
  - **README, teste manual da etapa 2:**
    1. Uma conta de equipe vê um caso novo aparecer na hora.
    2. Ela reverte o caso com confirmação.
    3. Duas abas salvam a mesma seção, e a segunda recebe o conflito.
    4. O dono sem cargo bane um usuário de teste pelo painel.
    5. Um membro vê só "Meus casos".
  - **ROADMAP:** etapa 2 implementada, com o teste manual pendente.
  - **CHANGELOG** do PR L.
- [ ] **Step 2: Rodar.** `npm run check` → PASS.
- [ ] **Step 3: Commit.** `docs: document panel moderation and stage 2 status`
