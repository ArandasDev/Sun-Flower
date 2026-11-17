# Fase 2, etapa 1 — Moderação contra phishing: Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** módulo `moderation` que detecta links de phishing, apaga a mensagem, aplica timeout e alerta a equipe, com casos reversíveis e comandos `/mod`, sobre cinco extensões aditivas do Core.

**Architecture:** O Core ganha opções de comando, `config.set`, `storage` com migrações por módulo, o serviço `guild` liberado por capacidades e a publicação de eventos `discord.*` pelo próprio Core. A interface Discord implementa a porta `GuildActions` e publica as mensagens do servidor. O módulo separa a detecção (código puro) das lojas sobre `storage`, da resposta automática e dos comandos.

**Tech Stack:** Node.js 26 (type stripping, `node:sqlite`, `node:url` `domainToASCII`), TypeScript 6 (`strict`, `erasableSyntaxOnly`), discord.js 14.28, pino, zod 4, Vitest 5.

**Spec:** [`docs/specs/2026-11-17-fase-2-moderacao-phishing.md`](../specs/2026-11-17-fase-2-moderacao-phishing.md) — decisões 0011 a 0015 em `docs/decisions/`.

## Global Constraints

- Tudo da seção Global Constraints do [plano da Fase 1](2026-11-16-fase-1-core-discord.md#global-constraints) continua valendo (imports `.ts`, sintaxe apagável, módulos só importam `shared/` e `zod`, regexes de snowflake, permissão e evento, IDs fictícios nos testes, commits sem `Co-Authored-By`).
- `CORE_API_VERSION = '1.1.0'`. O `ping` continua com `apiVersion` `1.0.0`; o `moderation` usa `1.1.0`.
- IDs de módulo reservados: `core` e `discord`.
- Capacidades aceitas: `guild.moderate`, `guild.message`.
- Eventos publicados pelo Core: `discord.message.created`, `discord.message.updated`, `source: 'core'`, `version: 1`.
- Intents: `Guilds`, `GuildMessages`, `GuildMembers`, `MessageContent`.
- Limites: timeout de 60 000 ms a 2 419 200 000 ms (28 dias); `deleteMessageSeconds` 0 a 604 800; chamada ao Discord 10 000 ms; `reason` truncado em 512 caracteres; análise de no máximo 20 links e 4 000 caracteres; amostra do intent 20 mensagens; rastreador de vários canais com 1 000 autores e 50 entradas por autor, limpeza a cada 60 000 ms.
- O conteúdo das mensagens nunca vai para log nem para o banco. IDs de usuário, cargo e canal não entram nos logs do Core.
- Mensagens ao usuário em português, exatamente como na tabela da Task 17. Respostas de `/mod` são sempre efêmeras.
- A exceção que a spec chama de `ConfigValidationError` é a `InvalidModuleConfigError` já existente em `core/configuration/module-config.ts`.
- Ajustes à spec, aplicados no texto dela pela Task 7: `DiscordMessagePayload` ganha `messageUrl: string` (o módulo não conhece o ID do servidor e precisa do link para o alerta de caso suspeito); `CommandOption` ganha `choices?: readonly string[]` (exigido por `exempt-role` e `domain list`).
- Antes de cada Pull Request: `npm run check` e verificação de vazamento por subagentes ([CONTRIBUTING.md §7.2](../../CONTRIBUTING.md#72-verificação-de-vazamento-antes-do-pull-request)).

## Review Focus

1. **Mensagem sem texto (só figurinha ou anexo):** a análise devolve pontuação 0 e nada é registrado, e o monitor do intent não a conta como evidência de intent desligado. Testes nas Tasks 9 e 14.
2. **Mensagem gigante com dezenas de links:** só os primeiros 4 000 caracteres e 20 links são analisados, sem exceção nem lentidão. Teste na Task 14.
3. **Canal de alertas apagado ou sem permissão de escrita:** a ação automática e o caso continuam registrados; o alerta que falhou gera um `warn`, e o handler não lança. Teste na Task 16.
4. **`/mod case revert` duas vezes no mesmo caso:** a segunda resposta é `Este caso não pode ser revertido.` e nenhuma ação é repetida no Discord. Teste na Task 18.
5. **`/mod domain block https://Golpe.COM/abc`:** a entrada é normalizada para `golpe.com`, e não recusada. Teste na Task 18.

## Entrega em Pull Requests

| PR  | Tasks | Título                                                                            |
| --- | ----- | --------------------------------------------------------------------------------- |
| A   | 1–7   | `feat(core): add command options, module storage, guild actions and staff grants` |
| B   | 8–10  | `feat(discord): publish message events and implement guild actions`               |
| C   | 11–16 | `feat(moderation): detect phishing links and respond automatically`               |
| D   | 17–19 | `feat(moderation): add /mod commands`                                             |

Cada PR parte da `main` atualizada, depois do merge do anterior.

## Mapa de arquivos

```text
shared/contracts/commands.ts          + CommandOption, Subcommand, SubcommandGroup, CommandOptions; campos novos
shared/contracts/guild.ts             GuildActions, GuildActionResult, GuildActionError (novo)
shared/contracts/storage.ts           ModuleStorage, SqlValue (novo)
shared/contracts/discord-events.ts    DiscordMessagePayload, DISCORD_MESSAGE_CREATED/UPDATED (novo)
shared/contracts/module.ts            capabilities, ModuleContext.guild/storage, config.set, permissions.isDeveloper/hasAnyGrant
core/module-registry/manifest.ts      capabilities, id "discord" reservado
core/module-registry/lifecycle.ts     assertValidCommand com opções e subcomandos
core/module-registry/registry.ts      migrações no register, storage, guild, config.set, cópia congelada das opções
core/infrastructure/migrations.ts     BEGIN IMMEDIATE + reverificação
core/infrastructure/migrations/0002-module-migrations.sql
core/storage/module-migrations.ts     validateModuleMigration, applyModuleMigrations (novo)
core/storage/module-storage.ts        createModuleStorage (novo)
core/configuration/module-config.ts   updateSettings
core/permissions/permission-service.ts hasAnyGrant, listGrants; forModule com isDeveloper/hasAnyGrant
core/guild/module-guild.ts            createModuleGuild, CapabilityError, UNAVAILABLE_GUILD (novo)
core/event-bus/event-bus.ts           publishFromCore
core/application/core.ts              opção guild; CoreHandle.publishCoreEvent
core/application/staff.ts             grant | revoke | grants
core/infrastructure/logger.ts         redação de content
interfaces/discord/commands.ts        toDiscordCommandData; RawInteraction com opções
interfaces/discord/client.ts          intents; toRawInteraction com opções; toRawMessage
interfaces/discord/messages.ts        shouldPublish, toMessagePayload, ContentIntentMonitor (novo)
interfaces/discord/guild-actions.ts   GuildGateway, createGuildActions, createDiscordGateway (novo)
interfaces/discord/main.ts            cliente antes do Core; eventos de mensagem
modules/moderation/manifest.json, index.ts, config.ts, README.md
modules/moderation/migrations/0001-moderation.sql
modules/moderation/detection/{links,lookalike,multi-channel,score}.ts
modules/moderation/{domains,cases,responder,alert}.ts
modules/moderation/commands/{mod-command,replies,config,domain,case,actions}.ts
tests/helpers/fake-guild.ts           GuildActions falso que grava as chamadas (novo)
tests/integration/moderation.test.ts  (novo)
```

---

## PR A

### Task 1: Contratos e manifesto

**Files:**

- Modify: `shared/contracts/{module,commands}.ts`, `core/module-registry/manifest.ts`
- Create: `shared/contracts/{guild,storage,discord-events}.ts`
- Test: `core/module-registry/manifest.test.ts`

**Interfaces:**

- Produces (todos os campos `readonly`):

```typescript
// shared/contracts/commands.ts
export type CommandOptionType = 'string' | 'integer' | 'boolean' | 'user' | 'channel' | 'role';
export interface CommandOption { name: string; description: string; type: CommandOptionType;
  required?: boolean; minValue?: number; maxValue?: number; maxLength?: number;
  choices?: readonly string[] } // choices: só para 'string'; nome e valor iguais
export interface Subcommand { name: string; description: string; options?: readonly CommandOption[] }
export interface SubcommandGroup { name: string; description: string; subcommands: readonly Subcommand[] }
export interface CommandOptions {
  getString(name: string): string | undefined; getInteger(name: string): number | undefined;
  getBoolean(name: string): boolean | undefined; getUser(name: string): string | undefined;
  getChannel(name: string): string | undefined; getRole(name: string): string | undefined;
}
// CommandDefinition ganha options?, subcommands?, groups?
// CommandInteraction ganha channelId: string; subcommandGroup: string | undefined;
//   subcommand: string | undefined; options: CommandOptions
// shared/contracts/guild.ts
export type GuildActionError = 'forbidden' | 'not_found' | 'failed';
export type GuildActionResult = { ok: true } | { ok: false; error: GuildActionError };
export interface GuildActions { /* exatamente as 9 assinaturas da spec §3.2 */ }
// shared/contracts/storage.ts — exatamente a spec §3.3
export type SqlValue = string | number | bigint | null;
export interface ModuleStorage { run(...); get<T>(...); all<T>(...); transaction<T>(fn: () => T): T }
// shared/contracts/discord-events.ts
export const DISCORD_MESSAGE_CREATED = 'discord.message.created';
export const DISCORD_MESSAGE_UPDATED = 'discord.message.updated';
export interface DiscordMessagePayload { /* exatamente a spec §3.1 */ }
// shared/contracts/module.ts
export const CORE_API_VERSION = '1.1.0';
export type Capability = 'guild.moderate' | 'guild.message';
// ModuleManifest ganha capabilities: readonly Capability[]
// ModuleContext:
//   permissions: { check(actor, permission): boolean; isDeveloper(userId: string): boolean;
//                  hasAnyGrant(roleIds: readonly string[], prefix: string): boolean }
//   config: { get<T>(): T; set(partial: Record<string, unknown>): void }
//   guild: GuildActions
//   storage: ModuleStorage
```

- [ ] **Step 1: Escrever os testes que falham** em `manifest.test.ts`:
  - `accepts capabilities guild.moderate and guild.message` → `ok: true`, `manifest.capabilities` igual à entrada.
  - `defaults capabilities to an empty array` → manifesto sem o campo dá `capabilities: []`.
  - `rejects an unknown capability` → `ok: false`, erro contém `capabilities`.
  - `rejects the reserved id discord` → erro `id "discord" is reserved for the Core`.
  - `accepts apiVersion 1.0.0 against core 1.1.0` → `ok: true`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run core/module-registry/manifest.test.ts` → FAIL.
- [ ] **Step 3: Implementar** os contratos acima e, no `manifestSchema`, `capabilities: z.array(z.enum(['guild.moderate','guild.message'])).default([])`; `RESERVED_IDS = new Set(['core','discord'])` com a mesma mensagem de erro para os dois. Os testes e fakes existentes que montam `ModuleContext`, `CommandInteraction` ou `ModuleManifest` à mão ganham os campos novos (valores vazios ou `vi.fn()`), para o `typecheck` passar.
- [ ] **Step 4: Verificar** — `npm run check` → PASS (o registry ainda não preenche `guild`, `storage` nem `config.set`; use um `throw new Error('not wired')` provisório no contexto, removido na Task 6).
- [ ] **Step 5: Commit** — `feat(core): extend module contracts for api 1.1.0`.

### Task 2: Validação de comandos com opções

**Files:**

- Modify: `core/module-registry/lifecycle.ts`, `core/module-registry/registry.ts` (`#registerCommand`)
- Test: `core/module-registry/lifecycle.test.ts`, `core/module-registry/registry.test.ts`

**Interfaces:**

- Consumes: tipos da Task 1.
- Produces: `assertValidCommand(command: CommandDefinition): void` validando também opções, subcomandos e grupos.

- [ ] **Step 1: Escrever os testes que falham** em `lifecycle.test.ts`, cada um esperando `CommandRegistrationError`:
  - `rejects options together with subcommands`, `rejects options together with groups`.
  - `rejects an option name with uppercase` (`'Domain'`), `rejects more than 25 options`, `rejects more than 25 subcommands in a group`.
  - `rejects a required option after an optional one` (regra do Discord).
  - `rejects choices on a non-string option`, `rejects more than 25 choices`, `rejects minValue on a string option`.
  - `rejects duplicate subcommand names inside the same level`.
  - E `accepts a command with groups and loose subcommands` (forma do `/mod`) sem lançar.
- [ ] **Step 2: Escrever o teste que falha** em `registry.test.ts`: `keeps options and subcommands in the frozen copy` — o comando lido de `commands()` tem `groups[0].subcommands[0].options[0].name` igual ao registrado, e alterar o objeto original depois do `register` não muda a cópia.
- [ ] **Step 3: Rodar e ver falhar** — `npx vitest run core/module-registry` → FAIL.
- [ ] **Step 4: Implementar** — nomes com `COMMAND_NAME`, descrições de 1 a 100, limite de 25 por nível, `choices` de 1 a 100 caracteres. Em `#registerCommand`, copiar com `structuredClone` dos campos de dados (sem `handle`) e congelar em profundidade (`deepFreeze` local).
- [ ] **Step 5: Verificar** — `npx vitest run core/module-registry` → PASS.
- [ ] **Step 6: Commit** — `feat(core): validate command options and subcommands`.

### Task 3: Migrações do Core seguras e migrações de módulo

**Files:**

- Modify: `core/infrastructure/migrations.ts`
- Create: `core/infrastructure/migrations/0002-module-migrations.sql`, `core/storage/module-migrations.ts`, `core/storage/module-storage.ts`
- Test: `core/infrastructure/migrations.test.ts`, `core/storage/module-migrations.test.ts`, `core/storage/module-storage.test.ts`

**Interfaces:**

- Produces:
  - `0002-module-migrations.sql`: `CREATE TABLE module_migrations (module_id TEXT NOT NULL, version TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (module_id, version))`.
  - `class ModuleMigrationError extends Error { readonly moduleId: string; readonly version: string | undefined }`
  - `validateModuleMigration(moduleId: string, sql: string): string[]` — lista de problemas; vazia se válida.
  - `applyModuleMigrations(db: DatabaseSync, moduleId: string, directory: string): string[]` — versões aplicadas; diretório ausente devolve `[]`.
  - `createModuleStorage(db: DatabaseSync): ModuleStorage`

- [ ] **Step 1: Escrever os testes que falham:**
  - `migrations.test.ts`: `does not reapply a migration recorded by another connection in the meantime` — duas conexões ao mesmo arquivo temporário; a segunda roda `runMigrations` depois da primeira e devolve `[]`, sem erro.
  - `module-migrations.test.ts`, `validateModuleMigration('moderation', sql)`:
    - aceita `CREATE TABLE moderation_cases (...)`, `CREATE INDEX IF NOT EXISTS moderation_x ON moderation_cases (id)`, `CREATE UNIQUE INDEX moderation_u ...`, `CREATE TRIGGER moderation_t ...`, nomes entre `"..."`, `` `...` `` e `[...]`;
    - recusa `CREATE TABLE cases`, `CREATE TABLE main.moderation_x`, `CREATE TABLE IF NOT EXISTS developers`, `DROP TABLE developers`, `ALTER TABLE permission_grants ADD x`, `ATTACH DATABASE 'x' AS y`, `PRAGMA foreign_keys = OFF`;
    - ignora nomes dentro de comentários `-- CREATE TABLE x` e `/* CREATE TABLE x */`.
  - `applyModuleMigrations`: aplica `0001` e `0002` em ordem e devolve `['0001-a','0002-b']`; numa segunda chamada devolve `[]`; lacuna (`0001`, `0003`) lança `ModuleMigrationError` sem aplicar nada; SQL com erro desfaz só a migração com erro e lança; um módulo não enxerga versões de outro (`module_migrations` separado por `module_id`).
  - `module-storage.test.ts`: `run` devolve `changes` e `lastInsertRowid`; `get` devolve `undefined` sem linha; `all` com parâmetros; `transaction` faz commit no retorno e rollback na exceção (que é relançada); `transaction` aninhada lança `Error('nested transactions are not supported')`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run core/infrastructure core/storage` → FAIL.
- [ ] **Step 3: Implementar:**
  - `runMigrations`: para cada arquivo, `BEGIN IMMEDIATE`, reconsultar `schema_migrations` dentro da transação e pular se já aplicada.
  - `validateModuleMigration`: remover comentários; recusar `/\b(ATTACH|DETACH|PRAGMA)\b/i`; capturar nomes com `/\b(?:CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)(?:\s+IF\s+EXISTS)?|ALTER\s+TABLE)\s+([^\s(;]+)/gi` e também o alvo de `ON <tabela>` em `CREATE INDEX`/`TRIGGER`; tirar aspas, crases e colchetes; recusar nome com `.` ou sem o prefixo `${moduleId}_`.
  - `applyModuleMigrations`: arquivos `/^\d{4}-.+\.sql$/` ordenados, numeração exigida `0001..N` sem lacunas; validar todos antes de aplicar qualquer um; cada migração em `BEGIN IMMEDIATE` com reverificação, como no Core.
- [ ] **Step 4: Verificar** — `npx vitest run core/infrastructure core/storage` → PASS.
- [ ] **Step 5: Commit** — `feat(core): add module migrations and storage`.

### Task 4: `config.set`

**Files:**

- Modify: `core/configuration/module-config.ts`
- Test: `core/configuration/module-config.test.ts`

**Interfaces:**

- Produces: `ModuleConfigStore.updateSettings<T>(moduleId: string, schema: z.ZodType<T> | undefined, partial: Record<string, unknown>): T` — mescla **no primeiro nível** (`{ ...stored, ...partial }`, onde `stored` é o JSON gravado, sem padrões aplicados), valida, grava o JSON mesclado e devolve o valor validado.

- [ ] **Step 1: Escrever os testes que falham:** `merges top-level keys and returns parsed settings` (padrões do schema aplicados no retorno, mas não gravados); `rejects an invalid merge without writing` (lança `InvalidModuleConfigError` com o caminho, e `loadSettings` continua devolvendo o valor anterior); `throws when the module has no configSchema`; `replaces a nested object as a whole` (`{ thresholds: { confirmed: 90, suspicious: 40 } }` substitui o objeto inteiro).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run core/configuration` → FAIL.
- [ ] **Step 3: Implementar** `updateSettings`, reusando a função de caminhos do `loadSettings`.
- [ ] **Step 4: Verificar** — `npx vitest run core/configuration` → PASS.
- [ ] **Step 5: Commit** — `feat(core): allow modules to update their settings`.

### Task 5: Permissões de leitura e serviço `guild` do módulo

**Files:**

- Modify: `core/permissions/permission-service.ts`
- Create: `core/guild/module-guild.ts`
- Test: `core/permissions/permission-service.test.ts`, `core/guild/module-guild.test.ts`

**Interfaces:**

- Produces:
  - `PermissionService.hasAnyGrant(roleIds: readonly string[], prefix: string): boolean` — `LIKE prefix || '%'` com `ESCAPE`.
  - `PermissionService.listGrants(): { permission: string; roleId: string; grantedAt: string }[]` ordenado por permissão e cargo.
  - `forModule(manifest)` passa a devolver também `isDeveloper` e `hasAnyGrant`; `hasAnyGrant` lança `UndeclaredPermissionError` se `prefix` não começar com `${manifest.id}.`.
  - `class CapabilityError extends Error` (`name = 'CapabilityError'`).
  - `UNAVAILABLE_GUILD: GuildActions` — toda ação devolve `{ ok: false, error: 'failed' }`; `getMemberRoleIds` devolve `undefined`.
  - `createModuleGuild(options: { manifest: ModuleManifest; port: GuildActions; isDeveloper(userId: string): boolean; logger: Logger }): GuildActions`

- [ ] **Step 1: Escrever os testes que falham:**
  - Permissões: `hasAnyGrant` verdadeiro com uma permissão `moderation.*` num dos cargos, falso para outro prefixo, falso com `roleIds` vazio; um `%` no prefixo não age como curinga; `forModule(...).hasAnyGrant([...], 'ping.')` num manifesto `moderation` lança `UndeclaredPermissionError`; `listGrants` em ordem.
  - `module-guild.test.ts` (porta falsa que grava chamadas):
    - sem `guild.moderate`, `timeout` lança `CapabilityError` e grava um `warn` com `module` e `action`; sem `guild.message`, `sendMessage` lança;
    - com `guild.moderate`, `sendMessage` lança (capacidades separadas);
    - `timeout`, `kick` e `ban` contra um desenvolvedor devolvem `forbidden` sem chamar a porta;
    - `timeout` com 59 999 ms ou 2 419 200 001 ms devolve `failed` sem chamar a porta; `ban` com `deleteMessageSeconds` 604 801 também;
    - `reason` com 600 caracteres chega à porta com 512;
    - uma ação executada grava `info` com `{ module, action, reason }`, e nenhuma entrada de log contém o `userId`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run core/permissions core/guild` → FAIL.
- [ ] **Step 3: Implementar.** `getMemberRoleIds` exige `guild.moderate` e não gera log de ação.
- [ ] **Step 4: Verificar** — `npx vitest run core/permissions core/guild` → PASS.
- [ ] **Step 5: Commit** — `feat(core): add capability-gated guild actions for modules`.

### Task 6: Ligação no registry, no Event Bus e no `startCore`

**Files:**

- Modify: `core/module-registry/registry.ts`, `core/event-bus/event-bus.ts`, `core/application/core.ts`, `core/infrastructure/logger.ts`
- Test: `core/module-registry/registry.test.ts`, `core/event-bus/event-bus.test.ts`, `core/infrastructure/logger.test.ts`, `tests/integration/core.test.ts`

**Interfaces:**

- Consumes: Tasks 3, 4 e 5.
- Produces:
  - `ModuleRegistryDeps` ganha `db: DatabaseSync` e `guild: GuildActions`.
  - `EventBus.publishFromCore(type: string, payload: unknown, context?: EventContext): void` — lança `UndeclaredEventError('core', type)` se `type` não começar com `discord.`; `source: 'core'`.
  - `StartCoreOptions.guild?: GuildActions` (padrão `UNAVAILABLE_GUILD`).
  - `CoreHandle.publishCoreEvent(type: string, payload: unknown, context?: EventContext): void`.
  - Logger: caminhos `content`, `*.content`, `*.*.content` redigidos.

- [ ] **Step 1: Escrever os testes que falham:**
  - Registry: `applies module migrations before register()` (o módulo de teste consulta a própria tabela dentro do `register`); `fails only the module whose migration is invalid` (outro módulo chega a `RUNNING`); `config.set updates config.get immediately`; `config.set before initialize throws`; `guild is gated by the manifest capabilities` (módulo sem capacidade recebe `CapabilityError`).
  - Event Bus: `publishFromCore delivers discord.* to declared subscribers with source core`; `publishFromCore rejects other prefixes`; um módulo com `events.publishes: ['discord.message.created']` já é recusado pela validação de manifesto (prefixo próprio) — só confirmar que o teste existente cobre.
  - Logger: `redacts content at depth 0 to 2`.
  - Integração: `startCore` com `guild` falso → o `ping` continua `RUNNING` e `/ping` responde `Pong!`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run core tests/integration` → FAIL.
- [ ] **Step 3: Implementar.** No passo `register`, antes de `instance.register(context)`: `applyModuleMigrations(db, id, path.join(record.directory, 'migrations'))`. O contexto ganha `storage: createModuleStorage(db)`, `guild: createModuleGuild({...})` e `config.set`, que chama `updateSettings` e substitui `record.settings`. Remover os `throw 'not wired'` da Task 1.
- [ ] **Step 4: Verificar** — `npm run check` → PASS.
- [ ] **Step 5: Commit** — `feat(core): wire storage, guild actions and core events into modules`.

### Task 7: `staff grant | revoke | grants` e documentação do PR A

**Files:**

- Modify: `core/application/staff.ts`, `docs/MODULES.md`, `README.md`, `CHANGELOG.md`
- Test: `core/application/staff.test.ts`

**Interfaces:**

- Consumes: `PermissionService.grant/revoke/listGrants`; `discoverModules(modulesDir, CORE_API_VERSION)` para o aviso.
- Produces: `STAFF_USAGE = 'Uso: npm run staff -- add|remove|list [userId] | grant|revoke <permissão> <roleId> | grants'`; `StaffDeps` ganha `declaredPermissions: () => ReadonlySet<string>`.

Saídas exatas: `Permissão associada ao cargo.`, `Permissão removida do cargo.`, `Nenhuma associação.`, `ID de cargo inválido.`, `Permissão inválida.`, `Permissões core.* não podem ser associadas a cargos.`, `Aviso: nenhum módulo declara esta permissão.` (depois de associar). `grants` imprime `<permissão> <roleId> <grantedAt>` por linha.

- [ ] **Step 1: Escrever os testes que falham** cobrindo cada saída acima e os códigos de saída: 0 em sucesso, 2 em uso ou entrada inválida; o log `info` de associação tem `{ action, permission }` e não tem o ID do cargo.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run core/application/staff.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Em `main()`, `declaredPermissions` lê os manifestos válidos de `modules/` sem importar entrypoints.
- [ ] **Step 4: Documentar** — spec da etapa: `messageUrl` no payload (§3.1) e `choices` em `CommandOption` (§3.4). `MODULES.md`: `capabilities` (§4.3), serviços `guild` e `storage`, migrações de módulo e prefixo (§10), opções de comando, `config.set` (§8), prefixo `discord.` reservado (§7). `README.md`: linhas de `staff grant|revoke|grants` na tabela de comandos. `CHANGELOG.md` (Added/Changed): `CORE_API_VERSION` 1.1.0 aditivo.
- [ ] **Step 5: Verificar** — `npm run check` → PASS.
- [ ] **Step 6: Commit** — `feat(core): manage role grants with the staff command`.

---

## PR B

### Task 8: Opções de comando na interface Discord

**Files:**

- Modify: `interfaces/discord/commands.ts`, `interfaces/discord/client.ts`
- Test: `interfaces/discord/commands.test.ts`, `interfaces/discord/client.test.ts`

**Interfaces:**

- Consumes: `CommandDefinition` da Task 1.
- Produces:
  - `toDiscordCommandData(command: CommandDefinition): RESTPostAPIChatInputApplicationCommandsJSONBody` — tipos `ApplicationCommandOptionType` (`Subcommand`, `SubcommandGroup`, `String`, `Integer`, `Boolean`, `User`, `Channel`, `Role`), `min_value`, `max_value`, `max_length`, `choices: [{ name, value }]`, `required`.
  - `CommandTarget.setGuildCommands(commands: RESTPostAPIChatInputApplicationCommandsJSONBody[])`.
  - `RawInteraction` ganha `channelId: string`, `subcommandGroup: string | undefined`, `subcommand: string | undefined`, `options: CommandOptions`.

- [ ] **Step 1: Escrever os testes que falham:** `toDiscordCommandData` do `/ping` igual a `{ name, description }` sem `options`; de um comando com grupo e subcomando solto, a ordem e os tipos numéricos corretos; `dispatchCommand` repassa `channelId`, `subcommandGroup`, `subcommand` e `options` ao `CommandInteraction`; `toRawInteraction` lê `getSubcommandGroup(false)`, `getSubcommand(false)` e devolve IDs em `getUser`/`getChannel`/`getRole` (interação falsa estrutural).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run interfaces/discord` → FAIL.
- [ ] **Step 3: Implementar** e ajustar `syncCommands` para usar `toDiscordCommandData` (mantendo a ordenação por nome).
- [ ] **Step 4: Verificar** — `npx vitest run interfaces/discord` → PASS.
- [ ] **Step 5: Commit** — `feat(discord): translate command options and subcommands`.

### Task 9: Eventos de mensagem e intents

**Files:**

- Create: `interfaces/discord/messages.ts`
- Modify: `interfaces/discord/client.ts`, `interfaces/discord/main.ts`
- Test: `interfaces/discord/messages.test.ts`, `interfaces/discord/client.test.ts`

**Interfaces:**

- Produces:
  - `interface RawMessage { guildId: string | null; messageId: string; messageUrl: string; channelId: string; authorId: string; authorIsBot: boolean; isWebhook: boolean; content: string; hasNonTextParts: boolean; authorRoleIds: readonly string[]; authorJoinedAt: string | null; authorAccountCreatedAt: string }` — `hasNonTextParts`: anexos, embeds ou figurinhas.
  - `shouldPublish(raw: RawMessage, guildId: string): boolean`
  - `toMessagePayload(raw: RawMessage): DiscordMessagePayload`
  - `isContentChange(oldContent: string | null, newContent: string): boolean` — `null` (desconhecido) conta como mudança.
  - `class ContentIntentMonitor { constructor(logger: Logger, sampleSize?: number); observe(raw: RawMessage): void }` — a amostra são as `sampleSize` (20) primeiras mensagens humanas com `hasNonTextParts === false`. Se todas tiverem `content === ''`, registra uma única vez o erro `message content is empty: enable the Message Content Intent in the Discord Developer Portal`. A primeira mensagem da amostra com texto encerra o monitor sem erro.
  - `toRawMessage(message: Message): RawMessage` em `client.ts`; `createDiscordClient()` com os quatro intents.

- [ ] **Step 1: Escrever os testes que falham:**
  - `shouldPublish`: falso para outro servidor, DM (`guildId: null`), bot e webhook; verdadeiro para humano no servidor.
  - `toMessagePayload` copia os campos e não inclui `guildId`, `authorIsBot`, `isWebhook` nem `hasNonTextParts`.
  - `isContentChange`: igual → falso; diferente → verdadeiro; `null` → verdadeiro.
  - Monitor: 20 mensagens humanas com `content: ''` e `hasNonTextParts: false` → um `error`; a 21ª não gera outro; se alguma das 20 tiver texto, nenhum erro; mensagens só com anexo (`content: ''`, `hasNonTextParts: true`) não contam para a amostra (Review Focus 1).
  - `createDiscordClient().options.intents` contém os quatro bits.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run interfaces/discord` → FAIL.
- [ ] **Step 3: Implementar** e ligar em `main.ts`: `Events.MessageCreate` → se `shouldPublish`, `monitor.observe` e `core.publishCoreEvent(DISCORD_MESSAGE_CREATED, toMessagePayload(raw), { userId, channelId })`; `Events.MessageUpdate` → ignorar `newMessage.partial`; publicar `DISCORD_MESSAGE_UPDATED` só se `isContentChange(old.partial ? null : old.content, new.content)`. Erros de conversão vão para o log sem conteúdo.
- [ ] **Step 4: Verificar** — `npx vitest run interfaces/discord` → PASS.
- [ ] **Step 5: Commit** — `feat(discord): publish guild message events`.

### Task 10: Ações no servidor e documentação do PR B

**Files:**

- Create: `interfaces/discord/guild-actions.ts`
- Modify: `interfaces/discord/main.ts`, `README.md`, `CHANGELOG.md`
- Test: `interfaces/discord/guild-actions.test.ts`

**Interfaces:**

- Produces:
  - `interface GuildGateway { botUserId(): string | undefined; deleteMessage(channelId, messageId): Promise<void>; setTimeout(userId, durationMs: number | null, reason?: string): Promise<void>; kick(userId, reason): Promise<void>; ban(userId, reason, deleteMessageSeconds): Promise<void>; unban(userId): Promise<void>; send(channelId, content): Promise<void>; sendDirect(userId, content): Promise<void>; memberRoleIds(userId): Promise<readonly string[] | undefined> }` — lança os erros do discord.js.
  - `createGuildActions(gateway: GuildGateway, options?: { callTimeoutMs?: number }): GuildActions`
  - `createDiscordGateway(client: Client, guildId: string): GuildGateway` — guild por `client.guilds.cache.get(guildId)`; sem guild lança `Error('guild unavailable')`; mensagens com `allowedMentions: { parse: [] }`; `memberRoleIds` devolve `undefined` para `Unknown Member` e remove o cargo `@everyone`.

- [ ] **Step 1: Escrever os testes que falham** (gateway falso):
  - Erro com `code` 50013 → `forbidden`; 10003, 10007, 10008, 10013, 10026 → `not_found`; outro erro ou `Error('guild unavailable')` → `failed`; o `GuildActionResult` não carrega a mensagem do erro.
  - Chamada que não termina em `callTimeoutMs` (teste com 20 ms) → `failed`.
  - `timeout`, `kick` e `ban` contra `botUserId()` → `forbidden` sem chamar o gateway.
  - `removeTimeout` chama `setTimeout(userId, null)`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run interfaces/discord/guild-actions.test.ts` → FAIL.
- [ ] **Step 3: Implementar** e, em `main.ts`, criar o cliente antes do Core e passar `guild: createGuildActions(createDiscordGateway(client, environment.guildId))` para `startCore`.
- [ ] **Step 4: Documentar** — `README.md`: seção "Intents privilegiados" (ativar _Server Members Intent_ e _Message Content Intent_ em **Bot** no Developer Portal) e permissões do convite (`Manage Messages`, `Moderate Members`, `Kick Members`, `Ban Members`, `Send Messages`, `View Channels`). `CHANGELOG.md`.
- [ ] **Step 5: Verificar** — `npm run check` → PASS.
- [ ] **Step 6: Commit** — `feat(discord): implement guild actions`.

---

## PR C

### Task 11: Esqueleto do módulo `moderation`

**Files:**

- Create: `modules/moderation/{manifest.json,index.ts,config.ts,README.md}`, `modules/moderation/migrations/0001-moderation.sql`, `tests/helpers/fake-guild.ts`
- Test: `modules/moderation/tests/config.test.ts`, `tests/integration/moderation.test.ts`

**Interfaces:**

- Produces:
  - `manifest.json` e migração exatamente como a spec §4.1 e §4.5.
  - `config.ts`: `configSchema` (zod, campos e padrões da spec §4.2, com `.refine` de `confirmed > suspicious`), `type ModerationConfig = z.output<typeof configSchema>`, `SIGNAL_NAMES = ['blocked','lookalike','masked','multiChannel','bait','massMention','newAccount'] as const`, `type SignalName`, `DEFAULT_WEIGHTS: Record<SignalName, number>`, `DEFAULT_BAIT_TERMS`.
  - `index.ts`: `export default createModeration` e `export { configSchema }`; nesta task, só ciclo de vida vazio.
  - `tests/helpers/fake-guild.ts`: `createFakeGuild(overrides?: Partial<Record<keyof GuildActions, GuildActionResult>>): GuildActions & { calls: { action: string; args: unknown[] }[]; memberRoles: Map<string, string[]> }`.

- [ ] **Step 1: Escrever os testes que falham:** `config.test.ts` — `{}` gera todos os padrões; `thresholds.confirmed` 40 com `suspicious` 40 é recusado; `timeoutMinutes` 40 321 é recusado; `alertChannelId: 'abc'` é recusado. Integração — com a pasta real `modules/`, `moderation` e `ping` chegam a `RUNNING` e `moderation_cases` existe.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation tests/integration/moderation.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): add module skeleton, settings and schema`.

### Task 12: Extração e normalização de links

**Files:**

- Create: `modules/moderation/detection/links.ts`
- Test: `modules/moderation/tests/links.test.ts`

**Interfaces:**

- Produces:
  - `normalizeDomain(input: string): string | undefined` — aceita domínio puro ou URL; minúsculas, `domainToASCII`, sem `www.` nem ponto final; `undefined` se inválido ou sem TLD alfabético de 2 a 24 letras.
  - `parentDomains(domain: string): string[]` — `'a.b.golpe.com'` → `['a.b.golpe.com','b.golpe.com','golpe.com']`.
  - `interface ExtractedLink { domain: string; maskedTextDomain?: string }`
  - `extractLinks(content: string): ExtractedLink[]` — no máximo 20, analisando só os primeiros 4 000 caracteres; sem duplicatas de `domain` sem máscara.

- [ ] **Step 1: Escrever os testes que falham:** `https://Golpe.COM/abc` → `golpe.com`; `www.discord.com.` → `discord.com`; `ԁiscord.com` → forma `xn--`; `discord-gift.com/abc` sem esquema é extraído; `<https://x.gift>` é extraído; `[discord.com/nitro](https://golpe.gift)` dá `{ domain: 'golpe.gift', maskedTextDomain: 'discord.com' }`; `v1.2.3`, `1.5`, `a.b` (TLD de 1 letra) e `email@exemplo.com` não geram link (`arquivo.txt` gera, e a Task 14 prova que ele não leva a nenhum nível); 25 links distintos → 20; 5 000 caracteres com o link depois do 4 000º → nenhum link.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/links.test.ts` → FAIL.
- [ ] **Step 3: Implementar** — markdown por `/\[([^\]]{1,256})\]\(<?(https?:\/\/[^\s)>]+)>?\)/g` primeiro (removendo o trecho), depois URLs com esquema, depois domínios sem esquema por `/(?<![@\w.-])((?:[a-z0-9-]{1,63}\.)+[a-z]{2,24})(?=[\/:\s>)\]"']|$)/gi` (sem `u`; a forma Unicode é coberta por uma segunda passada com `\p{L}` e a flag `u`).
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): extract and normalize links`.

### Task 13: Imitação de marcas

**Files:**

- Create: `modules/moderation/detection/lookalike.ts`
- Test: `modules/moderation/tests/lookalike.test.ts`

**Interfaces:**

- Produces:
  - `PROTECTED_BRANDS: readonly { brand: string; official: readonly string[] }[]` — `discord` e `steam` com os domínios da spec §4.4.
  - `OFFICIAL_DOMAINS: readonly string[]` (achatado).
  - `skeleton(value: string): string`, `levenshtein(a: string, b: string): number`.
  - `isLookalike(domain: string): boolean` — falso para domínio oficial ou subdomínio de oficial.

- [ ] **Step 1: Escrever os testes que falham:** verdadeiro para `dlscord.gift`, `discord-nitro.com`, `discordapp.co`, `steamcomunity.com`, `stearncommunity.com`, `xn--iscord-…` (forma de `ԁiscord.com`), `discord.com.golpe.ru`; falso para `discord.com`, `cdn.discordapp.com`, `steamcommunity.com`, `github.com`, `record.com` (distância 3) e `dis.com` (rótulo com menos de 4 letras); `disco.com` é **verdadeiro** (distância 2) e fica no teste como falso positivo aceito, porque sozinho só gera alerta; `levenshtein('kitten','sitting') === 3`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/lookalike.test.ts` → FAIL.
- [ ] **Step 3: Implementar** — forma Unicode por `domainToUnicode`; mapa de confusos (cirílico `а е о р с у х і ԁ ѕ` e gregos `α ο ρ ν`); dígitos `0→o 1→l 3→e 5→s`; `rn→m`, `vv→w`; remover `-` e `.` para a regra "contém"; Levenshtein sobre o rótulo principal (antes do TLD) para a regra de distância 1 a 2, só quando o rótulo tiver 4 ou mais letras.
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): detect brand lookalike domains`.

### Task 14: Pontuação e vários canais

**Files:**

- Create: `modules/moderation/detection/{multi-channel,score}.ts`
- Test: `modules/moderation/tests/{multi-channel,score}.test.ts`

**Interfaces:**

- Consumes: Tasks 11, 12, 13.
- Produces:
  - `class MultiChannelTracker { constructor(limits?: { maxAuthors?: number; maxEntries?: number }); record(authorId: string, domain: string, channelId: string, nowMs: number, windowMs: number): number /* canais distintos na janela */; prune(nowMs: number, windowMs: number): void; get authorCount(): number }`
  - `interface DomainLists { isBlocked(domain: string): boolean; isAllowed(domain: string): boolean }` — já consideram domínios pai.
  - `interface AnalysisInput { content: string; authorId: string; channelId: string; authorAccountCreatedAt: string; authorJoinedAt: string | null; now: Date }`
  - `interface Signal { name: SignalName; points: number }`
  - `interface Analysis { score: number; level: 'confirmed' | 'suspicious' | undefined; signals: Signal[]; domains: string[] }` — `domains`: domínios não permitidos, sem repetição.
  - `analyzeMessage(input: AnalysisInput, deps: { lists: DomainLists; config: ModerationConfig; tracker: MultiChannelTracker }): Analysis`

- [ ] **Step 1: Escrever os testes que falham:**
  - Tracker: 3 canais em 60 s → 3; o mesmo canal duas vezes conta 1; entradas fora da janela não contam; com `maxAuthors: 2`, o terceiro autor expulsa o mais antigo e `authorCount` fica em 2; `maxEntries: 50` por autor.
  - Score, com listas falsas e config padrão: domínio bloqueado em subdomínio → 100 e `confirmed`; `dlscord.gift` + `nitro` → 90 e `confirmed`; só `dlscord.gift` → 60 e `suspicious`; `[discord.com](https://golpe.gift)` → `masked` 40; `@everyone` + link não permitido → `massMention`; conta de 3 dias → `newAccount`; `authorJoinedAt: null` com conta antiga → sem `newAccount`; `ganhei nitro grátis` sem link → 0 e `level` indefinido; `nitro https://discord.com/x` → 0; `github.com` de conta antiga → 0; `arquivo.txt` de conta de 3 dias → 15 e `level` indefinido; cada sinal conta uma vez mesmo com dois links que o disparam; pesos e limites trocados na config mudam o resultado; termo `GRÁTIS` casa com `gratis`; mensagem sem texto → 0 (Review Focus 1); 5 000 caracteres com 30 links → só 20 analisados, sem exceção (Review Focus 2).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests` → FAIL.
- [ ] **Step 3: Implementar.** `multiChannel` registra cada domínio não permitido da mensagem e dispara quando algum atinge `config.multiChannel.channels`. Termos de isca comparados com `normalize('NFD')` sem diacríticos e em minúsculas, por palavra inteira.
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): score messages by phishing signals`.

### Task 15: Listas de domínios e casos

**Files:**

- Create: `modules/moderation/{domains,cases}.ts`
- Test: `modules/moderation/tests/{domains,cases}.test.ts`

**Interfaces:**

- Consumes: `ModuleStorage` (testes com `createModuleStorage` sobre `:memory:` e a migração do módulo aplicada por `applyModuleMigrations`).
- Produces:
  - `class DomainStore implements DomainLists { constructor(storage: ModuleStorage); seedOfficial(nowIso: string): void; set(domain: string, list: 'block' | 'allow', addedBy: string | null, nowIso: string): void; remove(domain: string): boolean; list(list: 'block' | 'allow', limit: number): string[]; isBlocked(domain): boolean; isAllowed(domain): boolean }` — `isBlocked` vence `isAllowed` quando os dois casam.
  - `type CaseAction = 'none' | 'delete_timeout' | 'warn' | 'timeout' | 'kick' | 'ban'`; `type CaseStatus = 'open' | 'actioned' | 'reverted' | 'dismissed'`.
  - `interface NewCase { kind: 'automatic' | 'manual'; level: 'confirmed' | 'suspicious' | null; action: CaseAction; targetUserId: string; actorUserId: string | null; channelId: string | null; messageId: string | null; domains: string[]; signals: Signal[]; score: number; reason: string; outcome: Record<string, string>; status: CaseStatus; timeoutUntil: string | null; createdAt: string }`
  - `interface CaseRecord extends NewCase { id: number; revertedBy: string | null; revertedAt: string | null }`
  - `class CaseStore { constructor(storage: ModuleStorage); create(c: NewCase): number; get(id: number): CaseRecord | undefined; findLatestByMessage(messageId: string): CaseRecord | undefined; listRecent(limit: number, targetUserId?: string): CaseRecord[]; setStatus(id: number, status: 'reverted' | 'dismissed', by: string, nowIso: string): boolean /* falso se o status atual não permitir */ }`

- [ ] **Step 1: Escrever os testes que falham:** `seedOfficial` duas vezes não duplica; domínio oficial bloqueado continua bloqueado depois de novo `seedOfficial`; `set` move entre listas; `isBlocked('a.golpe.com')` com `golpe.com` bloqueado; `list` respeita o limite; casos: `create` devolve ids crescentes, `get` desserializa `domains`, `signals` e `outcome`; `listRecent` por usuário em ordem decrescente; `setStatus('reverted')` só a partir de `open` ou `actioned`; `setStatus('dismissed')` só de `open`; nenhuma coluna guarda conteúdo de mensagem.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests` → FAIL.
- [ ] **Step 3: Implementar** com `storage.transaction` em `setStatus` (`UPDATE ... WHERE id = ? AND status IN (...)`).
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): store domain lists and cases`.

### Task 16: Resposta automática, alerta e documentação do PR C

**Files:**

- Create: `modules/moderation/{responder,alert}.ts`
- Modify: `modules/moderation/index.ts`, `modules/moderation/README.md`, `CHANGELOG.md`
- Test: `modules/moderation/tests/{responder,alert}.test.ts`, `tests/integration/moderation.test.ts`

**Interfaces:**

- Consumes: Tasks 11 a 15; `createFakeGuild`.
- Produces:
  - `formatAlert(record: CaseRecord, messageUrl: string): string` — formato exato da spec §4.6; domínios entre crases; falhas por etapa: `forbidden` → `sem permissão`, `not_found` → `não encontrado`, `failed` → `falha`; em `suspicious`, a linha de ação traz `Mensagem: <messageUrl>` e a sugestão `/mod case dismiss <n>` ou `/mod timeout`.
  - `class Responder { constructor(deps: { guild: GuildActions; cases: CaseStore; lists: DomainStore; tracker: MultiChannelTracker; config: () => ModerationConfig; isDeveloper(userId: string): boolean; publish(type: string, payload: unknown): void; logger: Logger; now?: () => Date }); handle(payload: DiscordMessagePayload): Promise<void> }`
  - `index.ts`: no `register`, assina os dois eventos; no `initialize`, `seedOfficial`; no `start`, `setInterval` de limpeza (60 000 ms, `unref()`); no `stop`, `clearInterval`.

- [ ] **Step 1: Escrever os testes que falham:**
  - `formatAlert` de um caso `confirmed` igual ao bloco da spec; de um caso com `outcome: { delete: 'ok', timeout: 'forbidden' }` contém `timeout não aplicado (sem permissão)`; de um `suspicious` contém `/mod case dismiss 12`.
  - Responder: golpe confirmado → chamadas `deleteMessage` e `timeout` (60 min), caso `actioned` com `outcome` `{delete:'ok',timeout:'ok'}`, `moderation.case.created` publicado, alerta enviado; `deleteMessage` falhando não impede `timeout`; suspeito → nenhuma ação, caso `open`, alerta; autor com cargo isento ou desenvolvedor → nada; sem `alertChannelId` → um `warn` por instância, não por mensagem; `sendMessage` devolvendo `forbidden` → `warn`, caso registrado, `handle` resolve (Review Focus 3); edição com o mesmo nível de um caso existente → nada; edição que sobe de `suspicious` para `confirmed` → caso novo e ações; nenhum log contém `content`.
  - Integração: `startCore` com `createFakeGuild`, `alertChannelId` gravado por `module_config`, `publishCoreEvent('discord.message.created', payload)` com um domínio bloqueado (inserido na tabela) → depois de `events.idle()`, o fake registrou `deleteMessage`, `timeout` e `sendMessage`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation tests/integration` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Documentar** — `modules/moderation/README.md`: sinais e pesos, configuração, permissões (lista do manifesto) e a nota de que domínios oficiais removidos voltam no próximo início. `CHANGELOG.md`.
- [ ] **Step 5: Verificar** — `npm run check` → PASS.
- [ ] **Step 6: Commit** — `feat(moderation): respond to phishing automatically`.

---

## PR D

### Task 17: Comando `/mod`, permissões e `config`

**Files:**

- Create: `modules/moderation/commands/{mod-command,replies,config}.ts`
- Modify: `modules/moderation/index.ts`
- Test: `modules/moderation/tests/commands-config.test.ts`

**Interfaces:**

- Produces:
  - `replies.ts` com estas constantes exatas:

| Constante                           | Texto                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `NO_PERMISSION`                     | `Você não tem permissão para isso.`                                                             |
| `CONFIG_UPDATED`                    | `Configuração atualizada.`                                                                      |
| `CONFIG_INVALID`                    | `Configuração inválida: {campos}.`                                                              |
| `INVALID_DOMAIN`                    | `Domínio inválido.`                                                                             |
| `DOMAIN_SET`                        | `Domínio {bloqueado\|permitido}: \`{domínio}\`.`                                                |
| `DOMAIN_REMOVED` / `DOMAIN_UNKNOWN` | `Domínio removido: \`{domínio}\`.`/`Domínio não estava em nenhuma lista.`                       |
| `CASE_NOT_FOUND`                    | `Caso não encontrado.`                                                                          |
| `CASE_REVERTED`                     | `Caso #{n} revertido.` (+ ` A mensagem apagada não pode ser recuperada.` em `delete_timeout`)   |
| `CASE_NOT_REVERTIBLE`               | `Este caso não pode ser revertido.`                                                             |
| `CASE_DISMISSED` / `CASE_NOT_OPEN`  | `Caso #{n} descartado.` / `Só casos abertos podem ser descartados.`                             |
| `LOOKALIKE_NOT_ALLOWED`             | `Domínios que imitam marcas protegidas não podem ser permitidos.`                               |
| `SELF_TARGET`                       | `Não é possível agir contra você mesmo.`                                                        |
| `PROTECTED_TARGET`                  | `Não é possível agir contra este membro.`                                                       |
| `NOT_A_MEMBER`                      | `Este usuário não é membro do servidor.`                                                        |
| `DISCORD_REFUSED`                   | `O Discord recusou a ação: {sem permissão\|não encontrado\|falha}.`                             |
| `WARNED` / `DM_FAILED`              | `Advertência registrada (caso #{n}).` / ` Não foi possível enviar mensagem direta.`             |
| `TIMED_OUT` / `KICKED` / `BANNED`   | `Timeout aplicado (caso #{n}).` / `Membro expulso (caso #{n}).` / `Usuário banido (caso #{n}).` |
| `WARN_DM`                           | `Você recebeu uma advertência no servidor. Motivo: {motivo}`                                    |

- `buildModCommand(deps: ModCommandDeps): CommandDefinition` — grupos `config`, `domain`, `case` e subcomandos `warn`, `timeout`, `kick`, `ban`, com as opções da spec §4.7 (nomes em minúsculas: `channel`, `minutes`, `confirmed`, `suspicious`, `role`, `action` com choices `add`/`remove`, `domain`, `list` com choices `block`/`allow`, `number`, `allow-domain`, `user`, `reason` com `maxLength: 512`, `delete-days` 0–7).
- `ModCommandDeps = { permissions: ModuleContext['permissions']; config: ModuleContext['config']; guild: GuildActions; cases: CaseStore; domains: DomainStore; publish(type: string, payload: unknown): void; now?: () => Date }`
- Roteador: tabela `(group, subcommand) → { permission, handler }`; checa a permissão antes de qualquer outra coisa; toda resposta com `{ ephemeral: true }`.

- [ ] **Step 1: Escrever os testes que falham:** cada uma das 15 entradas da tabela de comandos da spec, chamada sem a permissão, responde `NO_PERMISSION` e não chama `guild`, `cases`, `domains` nem `config.set` (teste parametrizado); `config view` mostra os valores atuais; `config alert-channel`, `timeout`, `thresholds` e `exempt-role add/remove` chamam `config.set` com o objeto completo do primeiro nível; `thresholds 40 40` responde `CONFIG_INVALID` com `thresholds`; o comando registrado passa por `assertValidCommand`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/commands-config.test.ts` → FAIL.
- [ ] **Step 3: Implementar** e registrar `/mod` no `register` do módulo.
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): add /mod command with config subcommands`.

### Task 18: `domain` e `case`

**Files:**

- Create: `modules/moderation/commands/{domain,case}.ts`
- Test: `modules/moderation/tests/commands-domain-case.test.ts`

**Interfaces:**

- Consumes: Tasks 15, 17; `isLookalike`; `normalizeDomain`.

- [ ] **Step 1: Escrever os testes que falham:**
  - `domain block https://Golpe.COM/abc` → `DOMAIN_SET` com `golpe.com` (Review Focus 5); `domain allow nao-e-dominio` → `INVALID_DOMAIN`; `domain remove` de domínio inexistente → `DOMAIN_UNKNOWN`; `domain list block` mostra no máximo 50.
  - `case view 999` → `CASE_NOT_FOUND`; `case list` sem usuário → 10 mais recentes.
  - `case revert` de `delete_timeout` → `removeTimeout` chamado, resposta com o aviso da mensagem apagada, status `reverted`, `moderation.case.reverted` publicado; de `ban` → `unban`; de `kick` e `warn` → nenhuma chamada ao `guild`; `removeTimeout` devolvendo `not_found` ainda reverte; devolvendo `forbidden` → `DISCORD_REFUSED` e o caso continua como estava.
  - Revertendo o mesmo caso duas vezes → a segunda responde `CASE_NOT_REVERTIBLE` e não chama o `guild` (Review Focus 4).
  - `allow-domain` com domínio comum → vai para a lista de permitidos; com domínio que é `lookalike` → `LOOKALIKE_NOT_ALLOWED` e o caso **não** é revertido.
  - `case dismiss` de caso `open` → `CASE_DISMISSED`; de caso `actioned` → `CASE_NOT_OPEN`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation/tests/commands-domain-case.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** A verificação de `allow-domain` acontece antes de qualquer chamada ao Discord.
- [ ] **Step 4: Verificar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(moderation): manage domain lists and cases by command`.

### Task 19: Ações manuais e documentação do PR D

**Files:**

- Create: `modules/moderation/commands/actions.ts`
- Modify: `modules/moderation/README.md`, `README.md`, `docs/ROADMAP.md`, `CHANGELOG.md`
- Test: `modules/moderation/tests/commands-actions.test.ts`, `tests/integration/moderation.test.ts`

**Interfaces:**

- Consumes: Tasks 15, 17; `permissions.isDeveloper`, `permissions.hasAnyGrant(roleIds, 'moderation.')`, `guild.getMemberRoleIds`.

- [ ] **Step 1: Escrever os testes que falham:**
  - Proteções, para cada uma das 4 ações: alvo = executor → `SELF_TARGET`; alvo desenvolvedor → `PROTECTED_TARGET`; alvo com cargo isento → `PROTECTED_TARGET`; alvo com cargo que tem grant `moderation.*` → `PROTECTED_TARGET`; em todos, nenhuma ação no Discord e nenhum caso criado.
  - `timeout` e `kick` de não membro → `NOT_A_MEMBER`; `ban` de não membro → executa.
  - `warn` cria caso `manual`/`warn`/`actioned` e chama `sendDirectMessage` com `WARN_DM`; DM falhando → resposta com `DM_FAILED` e caso criado.
  - `timeout 30` → `timeout` com 1 800 000 ms e `timeout_until` preenchido; `ban` com `delete-days 2` → `deleteMessageSeconds` 172 800.
  - Discord recusando (`forbidden`) → `DISCORD_REFUSED` com `sem permissão` e **nenhum** caso criado.
  - Integração: `/mod timeout` por `dispatchCommand` com um ator que tem o grant `moderation.actions.timeout` → resposta efêmera `Timeout aplicado (caso #1).`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run modules/moderation tests/integration` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Documentar** — `modules/moderation/README.md`: tabela de comandos e permissões; `README.md`: seção "Moderação" com o passo a passo do teste manual da spec §7; `docs/ROADMAP.md`: estado da Fase 2 ("etapa 1 implementada; falta a verificação manual"); `CHANGELOG.md`.
- [ ] **Step 5: Verificar** — `npm run check` → PASS.
- [ ] **Step 6: Commit** — `feat(moderation): add manual moderation actions`.
