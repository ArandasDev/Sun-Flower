# Fase 3, etapa 3 — Administração pelo painel: Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o serviço `admin` do Core e o módulo `administration`, o ligar e desligar de módulos em tempo de execução, a memória de logs técnicos e as telas de administração do painel: permissões dos cargos, desenvolvedores, módulos, logs e sessões.

**Architecture:**

- O Core ganha a capacidade `core.admin` ([0023](../decisions/0023-administration-module.md)), que entrega no contexto o serviço `admin`. O serviço reúne o que já existe no Core (desenvolvedores, permissões, sessões) e as peças novas desta etapa:
  - o registro de módulos aprende a ligar e desligar um módulo com o bot rodando;
  - uma memória guarda os logs recentes.
- O módulo `administration` registra uma operação para cada função do serviço. O painel chama essas operações pela rota da etapa 2, sem rota nova.
- O app ganha cinco telas. A interface Discord ressincroniza os comandos quando um módulo liga ou desliga.

**Tech Stack:** o mesmo das etapas 1 e 2, sem dependências novas. O servidor usa Node.js 26, TypeScript 6, zod 4, pino, Fastify 5 e Vitest 5. O app usa React 19, React Router 8, TanStack Query 5, Motion 14 e Vite 8.

**Spec:** [`docs/specs/2026-11-24-fase-3-painel.md`](../specs/2026-11-24-fase-3-painel.md) §2, §6, §8, §9, §10 (etapa 3), §11 e §12. Decisões aplicadas: [0009](../decisions/0009-api-version-compatibility.md), [0017](../decisions/0017-access-levels.md), [0022](../decisions/0022-module-operations.md) e [0023](../decisions/0023-administration-module.md). Base: planos das etapas [1](2026-11-24-fase-3-painel-etapa-1.md) e [2](2026-11-24-fase-3-painel-etapa-2.md).

## Global Constraints

- Tudo das Global Constraints das etapas 1 e 2 continua valendo:
  - CSP e cabeçalhos;
  - sessão e CSRF;
  - limites;
  - formato de erro e mapeamento HTTP;
  - ordem de checagem das operações;
  - valores fictícios;
  - texto do 403 no painel (`Sem permissão.`).
- **Versões:**
  - `CORE_API_VERSION = '1.4.0'`, de forma aditiva: a capacidade nova e `admin` no contexto ([0009](../decisions/0009-api-version-compatibility.md)).
  - O `administration` declara `apiVersion` `1.4.0`. O `moderation` continua em `1.3.0` e o `ping` em `1.0.0`.
  - A spec §2 põe a capacidade na `1.3.0`. Como a `1.3.0` saiu no PR #21 sem ela, a [0009](../decisions/0009-api-version-compatibility.md) pede a `1.4.0`.
- **Capacidade:** `Capability = 'guild.moderate' | 'guild.message' | 'core.admin'`.
  - Só um manifesto com `core.admin` pode declarar permissões `core.*`. Os outros continuam recebendo o erro atual `permission "<p>" must start with "<id>."`.
  - Um módulo sem `core.admin` que chama `context.admin` recebe um erro: `Module "<id>" lacks capability core.admin`.
- **Operações e permissões do `administration`:**

  | Operação                                                                        | Permissão                      |
  | ------------------------------------------------------------------------------- | ------------------------------ |
  | `administration.grants.list`, `.grant`, `.revoke`                               | `administration.grants.manage` |
  | `administration.developers.list`, `.add`, `.remove`                             | `core.developers.manage`       |
  | `administration.modules.list`, `administration.modules.set-enabled`             | `core.modules.manage`          |
  | `administration.logs.recent`                                                    | `core.logs.read`               |
  | `administration.sessions.list`, `.revoke`, `administration.sessions.revoke-all` | `core.sessions.manage`         |

- **Textos fixos do serviço `admin`** (código da operação e mensagem):
  - Remover a si mesmo: `conflict`, `Você não pode remover a si mesmo dos desenvolvedores.`
  - Remover o último: `conflict`, `Não é possível remover o último desenvolvedor.`
  - Permissão em formato inválido: `invalid`, `Permissão inválida.`
  - `core.*` ou `administration.*`: `invalid`, `Esta permissão não pode ser associada a cargos.`
  - Permissão que nenhum módulo declara: `invalid`, `Nenhum módulo declara esta permissão.`
  - Módulo inexistente: `not_found`, `Módulo desconhecido.`
  - Módulo com `core.admin`: `conflict`, `Este módulo não pode ser desligado.`
  - Desligar com dependentes ativos: `conflict`, `Outros módulos dependem deste: <ids separados por vírgula>.`
  - Ligar com dependência inativa: `conflict`, `Ligue antes: <ids separados por vírgula>.`
  - Falha ao ligar: `failed`, `O módulo não conseguiu iniciar.` O módulo fica em `FAILED`.
  - Bot encerrando: `unavailable`, `O bot está encerrando.`
  - Sessão inexistente: `not_found`, `Sessão não encontrada.`
- **Idempotência:**
  - Adicionar um desenvolvedor que já existe, associar uma permissão já associada, remover algo que não existe e ligar um módulo já ligado devolvem `ok`, com `false` no campo de efeito (`added`, `granted`, `revoked` ou `changed`).
  - Nada disso grava log de alteração.
- **Log de alteração do serviço `admin`:**
  - mensagem `admin change`;
  - campos `{ action, actor, target?, permission?, moduleId?, count? }`;
  - `action` é o nome curto da função, por exemplo `developers.add`;
  - `actor` e `target` são IDs mascarados como `…` seguido dos 4 últimos dígitos.
  - Uma chamada que não muda nada não registra.
- **Memória de logs:**
  - guarda as 500 entradas mais recentes, nível `info` ou acima, depois da redação do pino;
  - cada entrada é `{ time, level, message, module?, fields }`:
    - `time` em ISO;
    - `level` é `info`, `warn`, `error` ou `fatal`;
    - `fields` traz só os valores primitivos de primeiro nível;
  - os campos `pid`, `hostname`, `service`, `level`, `time`, `msg` e `module` saem de `fields`;
  - cada texto é cortado em 300 caracteres;
  - toda sequência de 17 a 20 dígitos vira `[id]`;
  - um objeto aninhado vira `[objeto]`.
- **Referência de sessão:**
  - a listagem nunca traz o hash, e sim `ref`, que são os 16 primeiros caracteres hexadecimais de `sha256('ref:' + idHash)`;
  - `revoke` recebe `ref`;
  - `revoke-all` recebe `userId` e encerra todas as sessões dessa pessoa.
- **Lista de módulos:**
  - cada item é `{ id, name, description, version, state, enabled, canDisable, dependencies, dependents, failedAt? }`;
  - a mensagem de erro interna não sai do Core, porque pode trazer caminhos de arquivo, e fica só no log;
  - `dependents` são os módulos que declaram dependência deste.
- **Ligar e desligar:**
  - as chamadas de `setEnabled` rodam uma por vez, numa fila;
  - cada etapa usa o mesmo limite de tempo da inicialização;
  - a ressincronização de comandos no Discord acontece depois de cada mudança.
- **Painel:**
  - as telas de administração buscam os dados ao abrir e depois de cada alteração, sem consulta periódica, porque as leituras usam `POST` e contam no limite de alterações;
  - os logs têm o botão `Atualizar`;
  - remover desenvolvedor, desligar módulo e encerrar sessões pedem confirmação.
- **IDs digitados:** como na etapa 2, de 17 a 20 dígitos no formato canônico (`isSnowflake` de `app/src/ids.ts`). Não há seletor ligado ao Discord.

## Review Focus

1. **Dono sem ser desenvolvedor no painel:**
   - consegue associar uma permissão de módulo a um cargo;
   - recebe `Esta permissão não pode ser associada a cargos.` ao tentar `administration.grants.manage`;
   - recebe 403 em qualquer operação `core.*`, como desenvolvedores ou módulos.

   Testes nas Tasks 4 e 5.

2. **Desligar o `moderation` com um módulo ativo que depende dele:** recebe 409 com a lista, e nada é parado. Teste na Task 2.
3. **Ligar um módulo cujo `start()` lança erro:**
   - ele fica em `FAILED` e os outros seguem rodando;
   - a operação devolve `failed`;
   - uma nova tentativa de ligar, depois de corrigido, cria outra instância e funciona.

   Teste na Task 2.

4. **Encerrar pelo painel a sessão de alguém com o painel aberto:** a conexão ao vivo dessa pessoa recebe `session.ended` e fecha na hora, sem esperar a revalidação de 60 s. Teste na Task 7.
5. **Log com ID, token ou conteúdo:**
   - uma entrada com um número de 18 dígitos, `token` ou `content` nunca aparece crua em `logs.recent`;
   - o número vira `[id]`, e `token` e `content` vêm `[REDACTED]`.

   Teste na Task 3.

## Entrega em Pull Requests

| PR  | Tasks | Título                                                            |
| --- | ----- | ----------------------------------------------------------------- |
| M   | 1–5   | `feat(core): add the admin service and the administration module` |
| N   | 6–8   | `feat(dashboard): add administration screens to the panel`        |

O PR N parte da `main` depois do merge do PR M. Depois do PR N vem a revisão ofensiva da spec §11.4, que não faz parte deste plano.

---

## PR M

### Task 1: Contrato `admin` e capacidade `core.admin`

**Files:**

- Create: `shared/contracts/admin.ts`
- Modify:
  - `shared/contracts/module.ts` (`Capability`, `ModuleContext.admin`, `CORE_API_VERSION`)
  - `core/module-registry/manifest.ts` e `manifest.test.ts`
  - `core/module-registry/registry.ts` (contexto com `admin`)
  - `core/module-registry/registry.test.ts`
  - `tests/helpers/*` (fakes de contexto)

**Interfaces:**

- Produces (`shared/contracts/admin.ts`):
  - `interface DeveloperEntry { readonly userId: string; readonly addedAt: string }`
  - `interface GrantEntry { readonly permission: string; readonly roleId: string; readonly grantedAt: string }`
  - `interface ModuleEntry`, com os campos das Global Constraints. `state` é `ModuleState`, que sai de `core/module-registry/lifecycle.ts` para `shared/contracts/module.ts`. O `lifecycle.ts` passa a reexportá-lo.
  - `type LogLevelName = 'info' | 'warn' | 'error' | 'fatal'`
  - `interface LogEntry { readonly time: string; readonly level: LogLevelName; readonly message: string; readonly module?: string; readonly fields: Readonly<Record<string, string | number | boolean | null>> }`
  - `interface SessionEntry { readonly ref: string; readonly userId: string; readonly createdAt: string; readonly lastSeenAt: string }`
  - `interface AdminService`, em que as funções que alteram recebem o `Actor` de quem pediu e devolvem `OperationResult`:
    - `developers`:
      - `list(): DeveloperEntry[]`
      - `add(actor, userId): OperationResult<{ added: boolean }>`
      - `remove(actor, userId): OperationResult<{ removed: boolean }>`
    - `grants`:
      - `list(): { grants: GrantEntry[]; grantable: string[] }`
      - `grant(actor, permission, roleId): OperationResult<{ granted: boolean }>`
      - `revoke(actor, permission, roleId): OperationResult<{ revoked: boolean }>`
    - `modules`:
      - `list(): ModuleEntry[]`
      - `setEnabled(actor, moduleId, enabled): Promise<OperationResult<{ changed: boolean; module: ModuleEntry }>>`
    - `logs`:
      - `recent(options: { limit: number; minLevel: LogLevelName }): LogEntry[]`
    - `sessions`:
      - `list(): SessionEntry[]`
      - `revoke(actor, ref): OperationResult<{ revoked: boolean }>`
      - `revokeAll(actor, userId): OperationResult<{ revoked: number }>`
- Produces (`ModuleContext`): `readonly admin: AdminService`.
  - Para módulos sem `core.admin`, todo acesso lança o erro das Global Constraints.
  - O registro recebe o serviço real em `ModuleRegistryDeps.admin?: AdminService`. A Task 4 cria o serviço.

- [ ] **Step 1: Testes que falham:**
  - um manifesto com `core.admin` e permissão `core.logs.read` é válido;
  - o mesmo manifesto sem `core.admin` é recusado com o erro atual;
  - `capabilities: ['core.admin']` é aceito pelo schema;
  - um módulo com a capacidade recebe o `admin` injetado;
  - um módulo sem a capacidade recebe o erro ao chamar `context.admin.developers.list()`;
  - `CORE_API_VERSION` é `1.4.0`, e os manifestos `1.0.0` e `1.3.0` continuam compatíveis.
- [ ] **Step 2: Rodar.** `npx vitest run core/module-registry` → FAIL.
- [ ] **Step 3: Implementar.** O `admin` do contexto segue o padrão de `createModuleGuild`: um objeto congelado que confere a capacidade a cada chamada.
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(core): add the core.admin capability and admin contract`

### Task 2: Ligar e desligar módulos em tempo de execução

**Files:**

- Modify:
  - `core/module-registry/lifecycle.ts` e `lifecycle.test.ts`
  - `core/module-registry/entrypoint.ts`
  - `core/module-registry/registry.ts` e `registry.test.ts`
  - `interfaces/discord/main.ts` (ressincronização)
- Test: `tests/integration/module-toggle.test.ts`

**Interfaces:**

- Consumes: `ModuleEntry` da Task 1.
- Produces (`ModuleRegistry`):
  - `entries(): ModuleEntry[]`, na ordem de dependência.
  - `setEnabled(moduleId: string, enabled: boolean): Promise<SetEnabledOutcome>`, com:

    ```ts
    type SetEnabledOutcome =
      | { kind: 'changed' | 'unchanged'; entry: ModuleEntry }
      | { kind: 'unknown' }
      | { kind: 'protected' }
      | { kind: 'dependents'; ids: string[] }
      | { kind: 'dependencies'; ids: string[] }
      | { kind: 'failed'; entry: ModuleEntry }
      | { kind: 'stopping' };
    ```

    Quem traduz o resultado para `OperationResult` é a Task 4.
- Produces (ciclo de vida):
  - novas transições `DISPOSED → VALIDATED` e `FAILED → VALIDATED`, usadas só por `setEnabled`;
  - `loadModule` passa a devolver também `factory`, guardada no registro para criar instâncias novas.

- [ ] **Step 1: Testes que falham**, com módulos de teste em diretório temporário:
  - **Desligar:**
    - um módulo `RUNNING` termina em `DISPOSED`;
    - os comandos e as operações dele somem de `commands()` e de `operations.names()`;
    - as assinaturas dele não recebem mais eventos;
    - `config.isEnabled` passa a `false`.
  - **(Review Focus 2)** desligar um módulo com um dependente `RUNNING` devolve `dependents` com os IDs, e nada para.
  - **Proteção:** desligar um módulo com `core.admin` devolve `protected`.
  - **Ligar:**
    - um módulo desligado volta a `RUNNING` com uma instância nova (a fábrica é chamada de novo);
    - os comandos voltam;
    - um módulo desligado desde a inicialização também liga.
  - Ligar com uma dependência inativa devolve `dependencies`.
  - **(Review Focus 3)** um `start()` que lança deixa o módulo em `FAILED`, sem afetar os outros, e devolve `failed`. Uma segunda tentativa, com a fábrica já corrigida, chega a `RUNNING`.
  - **Repetição:** ligar o que está ligado, ou desligar o que está desligado, devolve `unchanged`.
  - **Concorrência:** duas chamadas simultâneas rodam em sequência, e a segunda vê o estado deixado pela primeira.
  - **Encerramento:** depois de `stop()`, `setEnabled` devolve `stopping`.
  - **Eventos:** cada transição publica `core.module.state.changed`.
- [ ] **Step 2: Rodar.** `npx vitest run core/module-registry tests/integration/module-toggle.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
  - **Desligar** reaproveita o caminho de `#stopAll` para um só módulo: `stop`, `STOPPED`, comandos e operações removidos, `dispose`, `DISPOSED` e assinaturas canceladas. Depois grava `setEnabled(id, false)` e põe o ID em `#disabled`.
  - **Ligar** faz `VALIDATED`, grava `setEnabled(id, true)`, cria a instância pela fábrica e roda `#startModule`.
  - Na interface Discord, `core.subscribe('core.module.state.changed', …)` enfileira a ressincronização quando o estado é `RUNNING`, `DISPOSED` ou `FAILED`. Use a mesma fila de `sync`, e cancele a assinatura no encerramento.
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(core): enable and disable modules at runtime`

### Task 3: Memória de logs e listagem de sessões

**Files:**

- Create: `core/infrastructure/recent-logs.ts` e `.test.ts`
- Modify:
  - `core/infrastructure/logger.ts` e `logger.test.ts`
  - `interfaces/discord/main.ts`
  - `core/sessions/session-store.ts` e `.test.ts`
  - `core/permissions/permission-service.ts` e `.test.ts`

**Interfaces:**

- Produces:
  - `class RecentLogs`:
    - `constructor(capacity = 500)`;
    - `write(line: string): void`, que funciona como destino de stream do pino;
    - `recent(options: { limit: number; minLevel: LogLevelName }): LogEntry[]`, da mais nova para a mais antiga.
  - `createLogger({ level, destination?, recent? })`: com `recent`, usa `pino.multistream`, com o destino atual no `level` configurado e `recent` em `info`. O `main.ts` cria um `RecentLogs` e o passa ao logger e à Task 4.
  - `SessionStore`:
    - `list(): SessionRecord[]`, só as não vencidas, da mais recente para a mais antiga;
    - `refOf(idHash: string): string`;
    - `revokeByRef(ref: string): boolean`;
    - `revokeForUser(userId: string): number`;
    - `onRevoked(listener: (idHashes: readonly string[]) => void): () => void`. Os dois métodos de revogação chamam os ouvintes com os hashes apagados.
  - `PermissionService.revoke(permission, roleId): boolean`, que passa a dizer se apagou algo.

- [ ] **Step 1: Testes que falham:**
  - **Capacidade:** a memória guarda no máximo 500 entradas e descarta as mais antigas.
  - **Nível:** `debug` não entra.
  - **`minLevel` e `limit`:** funcionam juntos.
  - **(Review Focus 5)**, pelo logger real:
    - `logger.info({ userId: '123456789012345678', token: 'abc', content: 'oi' }, 'x')` gera uma entrada em que `fields.userId` é `[id]` e `token` e `content` são `[REDACTED]`;
    - um texto de 400 caracteres sai com 300;
    - um objeto aninhado vira `[objeto]`;
    - `pid`, `hostname` e `service` não aparecem.
  - **Linha inválida:** uma linha que não é JSON é ignorada, sem lançar erro.
  - **Sessões:**
    - `list` não traz as vencidas;
    - `refOf` é estável e não é o hash;
    - `revokeByRef` apaga só aquela sessão e avisa os ouvintes;
    - `revokeForUser` apaga todas da pessoa e avisa uma vez;
    - um ouvinte que lança não impede os outros.
  - **`revoke`:** devolve `false` quando não havia a associação.
- [ ] **Step 2: Rodar.** `npx vitest run core/infrastructure core/sessions core/permissions` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(core): keep recent logs in memory and list panel sessions`

### Task 4: Serviço `admin`

**Files:**

- Create: `core/administration/admin-service.ts` e `.test.ts`
- Modify:
  - `core/application/core.ts` (`StartCoreOptions.recentLogs?: RecentLogs`, criação do serviço e repasse ao registro)
  - `tests/integration/core.test.ts`

**Interfaces:**

- Consumes:
  - `ModuleRegistry.entries` e `setEnabled` (Task 2);
  - `RecentLogs`, `SessionStore` e `PermissionService.revoke` (Task 3);
  - `declaredPermissions()`.
- Produces: `createAdminService(deps: { permissions; sessions; registry: () => ModuleRegistry; recentLogs?: RecentLogs; logger: Logger }): AdminService`.
  - **`grants.list`:** a lista `grantable` traz as permissões declaradas, sem `core.*` e sem `administration.*`, em ordem alfabética.
  - **Sem memória de logs:** sem `recentLogs`, `logs.recent` devolve `[]`.
  - **Erros:** traduz os erros de `PermissionService` e os resultados de `setEnabled` para os códigos e textos das Global Constraints.

- [ ] **Step 1: Testes que falham:**
  - **Desenvolvedores:**
    - remover a si mesmo devolve o conflito, e nada muda;
    - remover o último devolve o conflito;
    - adicionar ou remover alguém que já está, ou que não está, devolve `false` sem log.
  - **(Review Focus 1)** `grant`:
    - de `administration.grants.manage` → `Esta permissão não pode ser associada a cargos.`;
    - de `core.logs.read` → o mesmo texto;
    - de `moderation.cases.read` → `granted: true`;
    - de uma permissão não declarada → `Nenhum módulo declara esta permissão.`;
    - de `x` → `Permissão inválida.`
  - **Módulos:** `setEnabled` traduz cada `SetEnabledOutcome`, e a lista de módulos não traz `error`.
  - **Sessões:** `revoke` de um `ref` desconhecido dá `not_found`.
  - **Log de alteração:**
    - cada alteração registra `admin change` com `actor: '…5678'` para o ID `111111111111115678`;
    - nenhum ID aparece inteiro nesse log.
  - **`startCore`:** com `recentLogs` passa o serviço ao registro, e um módulo de teste com `core.admin` consegue `admin.modules.list()`.
- [ ] **Step 2: Rodar.** `npx vitest run core/administration tests/integration/core.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** `registry` é uma função porque o serviço é criado antes do `load()`.
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(core): add the admin service`

### Task 5: Módulo `administration`

**Files:**

- Create em `modules/administration/`:
  - `manifest.json`
  - `index.ts`
  - `operations.ts` e `operations.test.ts`
  - `README.md`
- Test: `tests/integration/administration-operations.test.ts`
- Modify:
  - `docs/MODULES.md` (capacidade `core.admin` e `admin` no contexto)
  - `CHANGELOG.md`

**Interfaces:**

- Consumes: `context.admin` (Tasks 1 e 4).
- Produces:
  - **Manifesto:**
    - `id` `administration`;
    - `apiVersion` `1.4.0`;
    - `enabledByDefault: true`;
    - `capabilities: ['core.admin']`;
    - `permissions`: `administration.grants.manage`, `core.developers.manage`, `core.modules.manage`, `core.logs.read` e `core.sessions.manage`.
  - **Operações** da tabela das Global Constraints, todas com schema `z.strictObject`:
    - `grants.grant` e `grants.revoke`: `{ permission: string (até 100), roleId: snowflake }`;
    - `developers.add` e `developers.remove`: `{ userId: snowflake }`;
    - `modules.set-enabled`: `{ moduleId: string (até 64), enabled: boolean }`;
    - `logs.recent`: `{ limit?: 1–500 (padrão 200), minLevel?: LogLevelName (padrão 'info') }`;
    - `sessions.revoke`: `{ ref: /^[0-9a-f]{16}$/ }`;
    - `sessions.revoke-all`: `{ userId: snowflake }`;
    - as de listagem: `{}`.
    - O `snowflake` é a mesma regra canônica do `moderation`: `^[1-9]\d{16,19}$` e no máximo 2^64−1. Ela é copiada para o módulo, porque os módulos não importam uns dos outros.
  - **Handlers:** chamam o serviço com o `actor` da operação e devolvem o resultado dele.

- [ ] **Step 1: Testes que falham:**
  - **Unitários com fake do serviço:** cada operação passa a entrada certa, e cada schema recusa os campos extras.
  - **Integração com o Core real e os módulos reais:**
    - **(Review Focus 1)** o dono sem cargo, que não é desenvolvedor, recebe `forbidden` em `developers.list`, `modules.list`, `logs.recent` e `sessions.list`, e consegue `grants.grant` de `moderation.cases.read`;
    - um membro recebe `forbidden` em todas as operações;
    - um desenvolvedor desliga e liga o `moderation`, e `/mod` some e volta em `commands()`;
    - desligar o `administration` dá `Este módulo não pode ser desligado.`
- [ ] **Step 2: Rodar.** `npx vitest run modules/administration tests/integration/administration-operations.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
  - O README segue o formato do `modules/moderation/README.md`, com a tabela de operações.
  - O `docs/MODULES.md` registra a capacidade e a regra de `core.*` da [0023](../decisions/0023-administration-module.md).
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(administration): add the administration module`

## PR N

### Task 6: Telas de permissões e desenvolvedores

**Files:**

- Create em `interfaces/dashboard/app/src/routes/`: `Grants.tsx`, `Developers.tsx` e os testes
- Modify:
  - `App.tsx`
  - `components/Menu.tsx`
  - `live.ts` (`screenFor`)
  - `labels.ts`
  - `styles.css`

**Interfaces:**

- Consumes:
  - `runOperation`, `useOperationQuery` e `useOperationMutation` (`app/src/operations.ts`);
  - `ConfirmDialog`;
  - `isSnowflake`;
  - `labels.ts`, com o texto do 403;
  - os formatos de `shared/contracts/admin.ts`, espelhados no app como na etapa 2.
- Produces:
  - **`Grants`** (`/permissoes`, tela `grants`, menu "Permissões" com `administration.grants.manage`):
    - lista agrupada por permissão, com os IDs de cargo e `Remover`;
    - formulário com a permissão (escolhida em `grantable`) e o ID do cargo.
  - **`Developers`** (`/desenvolvedores`, tela `developers`, menu "Desenvolvedores" com `core.developers.manage`):
    - lista com o ID, a data e `Remover` (com confirmação), marcando `Você` na própria linha;
    - formulário para adicionar por ID.
  - **Chaves de consulta:** `['admin', 'grants']` e `['admin', 'developers']`.

- [ ] **Step 1: Testes que falham**, com `fetch` falso:
  - associar envia `{ permission, roleId }` e recarrega a lista;
  - um ID de cargo inválido bloqueia o envio;
  - o erro `Esta permissão não pode ser associada a cargos.` aparece no formulário;
  - remover um desenvolvedor pede confirmação e envia `{ userId }`;
  - o conflito de remover a si mesmo aparece com o texto do servidor;
  - um 403 mostra `Sem permissão.`;
  - o menu mostra cada item só com a permissão;
  - `screenFor` devolve `grants` e `developers`.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.** Use os tokens de `styles.css` e os padrões das telas da etapa 2. Sem `style=`, sem caixa alta e sem `→`.
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add the grants and developers screens`

### Task 7: Telas de módulos, logs e sessões

**Files:**

- Create em `interfaces/dashboard/app/src/routes/`: `Modules.tsx`, `Logs.tsx`, `Sessions.tsx` e os testes
- Modify:
  - `interfaces/dashboard/server.ts` e `live.test.ts` (sessão revogada fecha a conexão)
  - no app: `App.tsx`, `components/Menu.tsx`, `live.ts`, `labels.ts` e `styles.css`

**Interfaces:**

- Consumes:
  - `SessionStore.onRevoked` (Task 3);
  - `LiveHub.revokeSession(idHash)`, que já existe;
  - as peças do app da Task 6.
- Produces:
  - **Servidor:** `buildDashboard` assina `core.sessions.onRevoked` e chama `hub.revokeSession` para cada hash. A assinatura é cancelada no `onClose`.
  - **`Modules`** (`/modulos`, tela `modules`, menu "Módulos" com `core.modules.manage`):
    - uma linha por módulo, com nome, versão, situação, dependências e um botão `Ligar` ou `Desligar`;
    - `Desligar` pede confirmação;
    - sem `canDisable`, não há botão e a linha mostra `Não pode ser desligado.`;
    - situações: `RUNNING` → `Ligado`; desligado → `Desligado`; `FAILED` → `Falhou ao iniciar (<failedAt>)`; as outras → `Em transição`.
    - O evento ao vivo `status` invalida `['admin', 'modules']`, passando pela junção de 5 s da etapa 2.
  - **`Logs`** (`/logs`, tela `logs`, menu "Logs" com `core.logs.read`):
    - tabela com hora, nível, módulo, mensagem e campos, do mais novo para o mais antigo;
    - filtro de nível mínimo;
    - botão `Atualizar`, sem consulta periódica.
    - Os campos aparecem como texto `chave: valor`.
  - **`Sessions`** (`/sessoes`, tela `sessions`, menu "Sessões" com `core.sessions.manage`):
    - linhas com usuário, criação e último uso, e `Você` na própria pessoa;
    - `Encerrar` por sessão e `Encerrar todas desta pessoa`, os dois com confirmação.
    - Encerrar a própria sessão leva ao login pelo caminho do 401 que já existe.

- [ ] **Step 1: Testes que falham:**
  - **(Review Focus 4)** no servidor, com WebSocket real:
    - `core.sessions.revokeByRef(ref)` faz a conexão daquela sessão receber `session.ended` e fechar;
    - uma conexão de outra sessão continua aberta.
  - **Módulos:**
    - desligar pede confirmação e envia `{ moduleId, enabled: false }`;
    - o 409 com dependentes mostra o texto do servidor;
    - `FAILED` aparece com `failedAt`;
    - um `status` ao vivo recarrega a lista.
  - **Logs:**
    - a tabela mostra as entradas;
    - mudar o filtro envia `minLevel`;
    - `Atualizar` busca de novo;
    - HTML numa mensagem aparece como texto.
  - **Sessões:**
    - `Encerrar` envia `{ ref }`;
    - `Encerrar todas desta pessoa` envia `{ userId }`;
    - a própria sessão aparece marcada.
  - **Menu e presença:** o menu mostra cada item por permissão, e `screenFor` devolve `modules`, `logs` e `sessions`.
- [ ] **Step 2: Rodar.** `npx vitest run interfaces/dashboard` e `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add the modules, logs and sessions screens`

### Task 8: Documentação e fechamento da etapa 3

**Files:**

- Modify:
  - `README.md` (seção "Painel": telas de administração e teste manual da etapa 3)
  - `docs/ROADMAP.md`
  - `docs/ARCHITECTURE.md` §3.4 (serviço `admin` e ligar e desligar)
  - `CHANGELOG.md`

- [ ] **Step 1: Documentação.**
  - **README, teste manual da etapa 3**, a partir dos itens 5 e 6 da spec §11.5:
    1. O dono associa uma permissão a um cargo, e a pessoa com o cargo passa a ver a tela correspondente.
    2. Um desenvolvedor desliga e liga um módulo, e o comando some e volta no Discord.
    3. Um desenvolvedor encerra a sessão de outra conta, que volta para o login na hora.
    4. Os logs mostram a alteração do item 1 com os IDs mascarados.
  - **README:** lembrar que o `npm run staff` continua funcionando como acesso de emergência.
  - **ROADMAP:** etapa 3 implementada, com o teste manual e a revisão ofensiva pendentes.
  - **CHANGELOG:** entradas do PR N.
- [ ] **Step 2: Rodar.** `npm run check` → PASS.
- [ ] **Step 3: Commit.** `docs: document panel administration and stage 3 status`
