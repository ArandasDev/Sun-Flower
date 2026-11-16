# Fase 1 — Core + Discord mínimo: Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Core do Sun Flower carregando módulos pelo contrato de `docs/MODULES.md`, interface Discord restrita a um servidor e módulo `ping` respondendo `/ping`.

**Architecture:** Modular Monolith em um processo Node.js 26 que executa TypeScript diretamente. O Core (registry, Event Bus, permissões, configuração, logs, SQLite) expõe aos módulos apenas um `ModuleContext`; a interface Discord traduz `discord.js` para os contratos do Core por portas pequenas, testáveis com objetos falsos.

**Tech Stack:** Node.js 26 (type stripping, `node:sqlite`), TypeScript 6 (`strict`, `erasableSyntaxOnly`), discord.js 14.28, pino, zod 4, Vitest 5.

**Spec:** [`docs/specs/2026-11-16-fase-1-core-discord.md`](../specs/2026-11-16-fase-1-core-discord.md) — decisões 0005 a 0009 em `docs/decisions/`.

## Global Constraints

- Imports relativos com extensão `.ts`; somente sintaxe apagável (sem `enum`, `namespace`, parâmetros de propriedade).
- Módulos nunca importam `core/`, `interfaces/` nem `discord.js`; só `shared/`.
- `CORE_API_VERSION = '1.0.0'`.
- Snowflake: `/^\d{17,20}$/`. SemVer: `/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/`. Id de módulo: `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`. Permissão e evento: três segmentos `/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/`.
- Limites: etapa do ciclo de vida 10 000 ms; consumidor do Event Bus 5 000 ms; adiamento de interação 2 500 ms; profundidade de eventos 8. Todos injetáveis por opções para os testes.
- Mensagens ao usuário do Discord: `Pong!`, `Ocorreu um erro.`, `Comando indisponível.` (as duas últimas efêmeras, via `MessageFlags.Ephemeral`).
- Testes usam somente IDs fictícios (`000000000000000000`, `111111111111111111`, `222222222222222222`) e SQLite em memória (`:memory:`) ou em diretório temporário.
- Commits: Conventional Commits, e-mail _noreply_, **sem** `Co-Authored-By`. Antes de abrir cada Pull Request: `npm run check` e verificação de vazamento por subagentes ([CONTRIBUTING.md §7.2](../../CONTRIBUTING.md#72-verificação-de-vazamento-antes-do-pull-request)).

## Review Focus

1. **Diretório `modules/` ausente ou vazio:** a aplicação inicia com zero módulos e registra um aviso, sem falhar. Teste na Task 9.
2. **`manifest.json` com JSON malformado:** apenas aquele módulo é rejeitado, com o motivo no estado. Teste na Task 5.
3. **Interação para comando desconhecido ou de módulo que falhou:** resposta efêmera `Comando indisponível.`, sem exceção. Teste na Task 11.
4. **Handler que chama `reply` duas vezes:** a segunda chamada é ignorada e registrada, sem exceção. Teste na Task 11.
5. **Segundo `SIGINT` durante o encerramento:** ignorado; o encerramento roda uma única vez. Teste na Task 12.

## Entrega em Pull Requests

| PR  | Tasks | Título                                                                |
| --- | ----- | --------------------------------------------------------------------- |
| A   | 1–4   | `feat(core): add contracts, environment, logging and database`        |
| B   | 5–9   | `feat(core): add module registry, event bus, permissions and config`  |
| C   | 10–12 | `feat(discord): add discord interface, staff command and ping module` |

Cada PR parte da `main` atualizada, depois do merge do anterior.

## Mapa de arquivos

```text
shared/contracts/module.ts          SunFlowerModule, ModuleManifest, ModuleContext, ModuleFactory, CORE_API_VERSION
shared/contracts/events.ts          SunFlowerEvent, EventContext, EventHandler
shared/contracts/commands.ts        Actor, CommandDefinition, CommandInteraction, ReplyOptions
shared/contracts/logger.ts          Logger
shared/utilities/semver.ts          parseSemver, isApiCompatible
core/infrastructure/timeout.ts      withTimeout, TimeoutError
core/configuration/environment.ts   loadEnvironment, loadDatabaseEnvironment, EnvironmentError
core/infrastructure/logger.ts       createLogger
core/infrastructure/database.ts     openDatabase
core/infrastructure/migrations.ts   runMigrations, MigrationError
core/infrastructure/migrations/0001-core.sql
core/module-registry/manifest.ts    validateManifest
core/module-registry/discovery.ts   discoverModules
core/module-registry/dependencies.ts resolveOrder
core/module-registry/registry.ts    ModuleRegistry
core/event-bus/event-bus.ts         EventBus
core/permissions/permission-service.ts PermissionService
core/configuration/module-config.ts ModuleConfigStore
core/application/core.ts            startCore, CoreHandle
core/application/shutdown.ts        installShutdownHandlers
core/application/staff.ts           runStaff + entrada `npm run staff`
interfaces/discord/guild-guard.ts   leaveUnauthorizedGuilds, isAllowedInteraction
interfaces/discord/commands.ts      syncCommands, dispatchCommand
interfaces/discord/client.ts        createDiscordClient, adaptadores discord.js
interfaces/discord/main.ts          entrada `npm start`
modules/ping/                       manifest.json, index.ts, README.md, tests/ping.test.ts
tests/integration/core.test.ts      Core completo com módulos de teste (diretório temporário)
tests/integration/ping.test.ts      Core com o diretório modules/ real e /ping simulado
```

---

## PR A

### Task 1: Projeto, contratos e utilitários

**Files:**

- Modify: `tsconfig.json`, `package.json`, `.gitignore`, `.env.example`, `docs/MODULES.md` (§5.1)
- Delete: `tests/sanity.test.ts`
- Create: `shared/contracts/{module,events,commands,logger}.ts`, `shared/utilities/semver.ts`, `core/infrastructure/timeout.ts`
- Test: `shared/utilities/semver.test.ts`, `core/infrastructure/timeout.test.ts`

**Interfaces:**

- Produces:
  - `parseSemver(value: string): { major: number; minor: number; patch: number } | null`
  - `isApiCompatible(core: string, module: string): boolean`
  - `withTimeout<T>(work: () => Promise<T>, ms: number, label: string): Promise<T>`; rejeita com `TimeoutError` (`name = 'TimeoutError'`, mensagem contém `label` e `ms`).
  - Contratos (todos `readonly`):

```typescript
// shared/contracts/module.ts
export const CORE_API_VERSION = '1.0.0';
export interface ModuleManifest {
  id: string; name: string; description: string; version: string; apiVersion: string;
  entrypoint: string; dependencies: string[]; permissions: string[];
  enabledByDefault: boolean; events: { subscribes: string[]; publishes: string[] };
}
export interface SunFlowerModule {
  register(context: ModuleContext): Promise<void>;
  initialize(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; dispose(): Promise<void>;
}
export type ModuleFactory = () => SunFlowerModule;
export interface ModuleContext {
  moduleId: string; logger: Logger;
  events: { publish(type: string, payload: unknown, context?: EventContext): void;
            subscribe(type: string, handler: EventHandler): void };
  permissions: { check(actor: Actor, permission: string): boolean };
  config: { get<T>(): T };
  commands: { register(command: CommandDefinition): void };
}
// shared/contracts/events.ts
export interface EventContext { userId?: string; channelId?: string }
export interface SunFlowerEvent { id: string; type: string; version: number; source: string;
  timestamp: string; context: EventContext; payload: unknown }
export type EventHandler = (event: SunFlowerEvent) => Promise<void> | void;
// shared/contracts/commands.ts
export interface Actor { userId: string; roleIds: readonly string[] }
export interface ReplyOptions { ephemeral?: boolean }
export interface CommandInteraction { actor: Actor; reply(content: string, options?: ReplyOptions): Promise<void> }
export interface CommandDefinition { name: string; description: string; handle(interaction: CommandInteraction): Promise<void> }
// shared/contracts/logger.ts — subconjunto compatível com pino
export interface Logger {
  trace(obj: object | string, msg?: string): void; debug(...): void; info(...): void;
  warn(...): void; error(...): void; fatal(...): void; child(bindings: Record<string, unknown>): Logger;
}
```

Um `entrypoint` exporta `default` (`ModuleFactory`) e, opcionalmente, `configSchema` (zod).

- [ ] **Step 1: Ajustar o projeto**
  - `tsconfig.json`: adicionar `"erasableSyntaxOnly": true`, `"allowImportingTsExtensions": true`, `"noEmit": true`; remover `outDir` e `sourceMap`; `include` não muda.
  - `package.json`: remover `build`; adicionar `"start": "node --env-file-if-exists=.env interfaces/discord/main.ts"` e `"staff": "node --env-file-if-exists=.env core/application/staff.ts"`; `npm install discord.js@14 pino zod`.
  - `.gitignore`: adicionar `data/`. `.env.example`: adicionar `SUNFLOWER_DB_PATH=` e `LOG_LEVEL=`.
  - `docs/MODULES.md §5.1`: trocar a interface por `SunFlowerModule` acima (sem a propriedade `manifest`) e explicar que o `manifest.json` é a fonte do manifesto e o `entrypoint` exporta `default` (fábrica) e `configSchema` opcional.
  - Apagar `tests/sanity.test.ts`.

- [ ] **Step 2: Escrever os testes que falham**

```typescript
// shared/utilities/semver.test.ts
it.each([
  ['1.3.0', '1.2.0', true],
  ['1.3.0', '1.3.0', true],
  ['1.3.0', '1.4.0', false],
  ['1.3.0', '1.3.1', false],
  ['1.3.0', '2.0.0', false],
  ['2.0.0', '1.3.0', false],
])('core %s, module %s → %s', (core, mod, expected) => {
  expect(isApiCompatible(core, mod)).toBe(expected);
});
it('rejects malformed versions', () => {
  expect(parseSemver('1')).toBeNull();
  expect(parseSemver('01.0.0')).toBeNull();
  expect(parseSemver('1.0.0-beta')).toBeNull();
  expect(isApiCompatible('1.0.0', 'x')).toBe(false);
});
// core/infrastructure/timeout.test.ts
it('resolves when work finishes in time', async () => {
  await expect(withTimeout(async () => 7, 50, 'job')).resolves.toBe(7);
});
it('rejects with TimeoutError naming the label', async () => {
  await expect(withTimeout(() => new Promise(() => {}), 10, 'job')).rejects.toMatchObject({
    name: 'TimeoutError',
    message: expect.stringContaining('job'),
  });
});
```

- [ ] **Step 3: Rodar e ver falhar** — `npx vitest run shared core/infrastructure/timeout.test.ts` → FAIL (módulos inexistentes).
- [ ] **Step 4: Implementar** `semver.ts`, `timeout.ts` (limpa o `setTimeout` ao resolver) e os contratos.
- [ ] **Step 5: Verificar** — `npm run check` → PASS.
- [ ] **Step 6: Commit** — `feat(core): add module contracts and core utilities`.

### Task 2: Ambiente

**Files:** Create `core/configuration/environment.ts`; Test `core/configuration/environment.test.ts`

**Interfaces:**

- Produces:
  - `interface Environment { discordToken: string; guildId: string; dbPath: string; logLevel: LogLevel }`
  - `type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'`
  - `loadEnvironment(env: Record<string, string | undefined>): Environment`
  - `loadDatabaseEnvironment(env): { dbPath: string; logLevel: LogLevel }` (para o comando `staff`, que não exige token nem servidor)
  - `class EnvironmentError extends Error { readonly variables: string[] }` — mensagem lista nome da variável e regra violada, nunca o valor.

- [ ] **Step 1: Testes que falham**

```typescript
const valid = { DISCORD_TOKEN: 'fake-token-value', DISCORD_GUILD_ID: '000000000000000000' };
it('applies defaults', () => {
  expect(loadEnvironment(valid)).toEqual({
    discordToken: 'fake-token-value',
    guildId: '000000000000000000',
    dbPath: 'data/sun-flower.db',
    logLevel: 'info',
  });
});
it('rejects missing and invalid variables without leaking values', () => {
  const run = () =>
    loadEnvironment({ DISCORD_TOKEN: '', DISCORD_GUILD_ID: 'secret-guild-123', LOG_LEVEL: 'loud' });
  expect(run).toThrow(EnvironmentError);
  try {
    run();
  } catch (e) {
    const err = e as EnvironmentError;
    expect(err.variables.sort()).toEqual(['DISCORD_GUILD_ID', 'DISCORD_TOKEN', 'LOG_LEVEL']);
    expect(err.message).not.toContain('secret-guild-123');
    expect(err.message).not.toContain('loud');
  }
});
it('database environment does not require Discord variables', () => {
  expect(loadDatabaseEnvironment({})).toEqual({ dbPath: 'data/sun-flower.db', logLevel: 'info' });
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** com `z.object` e `safeParse`; montar a mensagem a partir de `issue.path` e de uma descrição fixa por variável (nunca `issue.input`). String vazia conta como ausente.
- [ ] **Step 4: Verificar** — `npx vitest run core/configuration` → PASS.
- [ ] **Step 5: Commit** — `feat(core): validate environment variables`.

### Task 3: Logger

**Files:** Create `core/infrastructure/logger.ts`; Test `core/infrastructure/logger.test.ts`

**Interfaces:**

- Consumes: `Logger`, `LogLevel`.
- Produces: `createLogger(options: { level: LogLevel; destination?: NodeJS.WritableStream }): Logger` — pino com `redact: { paths: ['token', '*.token', 'authorization', '*.authorization'], censor: '[REDACTED]' }`, `base: { service: 'sun-flower' }`.

- [ ] **Step 1: Teste que falha** — capturar a saída em um `Writable` e fazer `JSON.parse` de cada linha:

```typescript
it('redacts sensitive fields and keeps module bindings', () => {
  const lines: string[] = [];
  const logger = createLogger({ level: 'info', destination: sink(lines) });
  logger
    .child({ module: 'ping' })
    .info({ token: 'abc', nested: { authorization: 'xyz' } }, 'hello');
  const entry = JSON.parse(lines[0]!);
  expect(entry).toMatchObject({
    module: 'ping',
    msg: 'hello',
    token: '[REDACTED]',
    nested: { authorization: '[REDACTED]' },
  });
});
it('respects the level', () => {
  /* nível warn: info não gera linha */
});
```

- [ ] **Step 2–4:** ver falhar, implementar, `npx vitest run core/infrastructure/logger.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(core): add structured logger`.

### Task 4: Banco e migrações

**Files:** Create `core/infrastructure/database.ts`, `core/infrastructure/migrations.ts`, `core/infrastructure/migrations/0001-core.sql`; Test `core/infrastructure/migrations.test.ts`

**Interfaces:**

- Produces:
  - `openDatabase(path: string): DatabaseSync` — cria o diretório pai quando não for `:memory:`; executa `PRAGMA journal_mode = WAL` e `PRAGMA foreign_keys = ON`.
  - `runMigrations(db: DatabaseSync, directory: string): string[]` — retorna as versões aplicadas nesta execução.
  - `class MigrationError extends Error { readonly version: string }`.
  - `MIGRATIONS_DIR` exportado de `migrations.ts` (`new URL('./migrations/', import.meta.url)` convertido com `fileURLToPath`).
- Tabelas de `0001-core.sql` (texto ISO 8601 para datas):
  - `schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)` — criada por `runMigrations`, não pelo arquivo.
  - `developers(user_id TEXT PRIMARY KEY, added_at TEXT NOT NULL)`
  - `permission_grants(permission TEXT NOT NULL, role_id TEXT NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY(permission, role_id))`
  - `module_config(module_id TEXT PRIMARY KEY, enabled INTEGER NULL, settings TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)`

- [ ] **Step 1: Testes que falham** (diretório temporário com arquivos SQL de teste):

```typescript
it('applies migrations in order and records them', () => {
  // 0002-b.sql cria tabela b, 0001-a.sql cria tabela a
  expect(runMigrations(db, dir)).toEqual(['0001-a', '0002-b']);
  expect(runMigrations(db, dir)).toEqual([]);
});
it('rolls back a failing migration and stops', () => {
  // 0001 válido, 0002 com SQL inválido, 0003 válido
  expect(() => runMigrations(db, dir)).toThrow(MigrationError);
  expect(applied(db)).toEqual(['0001-a']); // 0002 e 0003 não aplicadas
});
it('creates the core tables', () => {
  runMigrations(db, MIGRATIONS_DIR);
  expect(tables(db)).toEqual(
    expect.arrayContaining(['developers', 'permission_grants', 'module_config']),
  );
});
```

- [ ] **Step 2–4:** ver falhar; implementar (ordenar por nome `NNNN-*.sql`; cada arquivo em `BEGIN`/`COMMIT`, `ROLLBACK` no erro); `npx vitest run core/infrastructure` → PASS.
- [ ] **Step 5: Commit** — `feat(core): add sqlite database and migrations`.
- [ ] **Step 6: Abrir o PR A** — `npm run check`; verificação de vazamento por dois subagentes; push e PR com o título da tabela.

---

## PR B

### Task 5: Manifesto e descoberta

**Files:** Create `core/module-registry/manifest.ts`, `core/module-registry/discovery.ts`; Test `core/module-registry/manifest.test.ts`, `core/module-registry/discovery.test.ts`

**Interfaces:**

- Consumes: `ModuleManifest`, `isApiCompatible`, `CORE_API_VERSION`.
- Produces:
  - `validateManifest(raw: unknown, directoryName: string, coreApiVersion: string): { ok: true; manifest: ModuleManifest } | { ok: false; errors: string[] }` — schema `z.strictObject`; aplica padrões `enabledByDefault: false`, `events: { subscribes: [], publishes: [] }`.
  - `interface DiscoveredModule { directory: string; directoryName: string; manifest?: ModuleManifest; errors: string[] }`
  - `discoverModules(modulesDir: string, coreApiVersion: string): DiscoveredModule[]` — diretório inexistente retorna `[]`; subdiretório sem `manifest.json` é ignorado; JSON malformado vira `errors: ['manifest.json is not valid JSON']`; ids duplicados: todos recebem erro `duplicate module id "<id>"`.

- [ ] **Step 1: Testes que falham** — um manifesto válido de base e uma variação por regra:

```typescript
it.each([
  ['missing field', omit('name'), /name/],
  ['extra field', { ...base, extra: true }, /extra/],
  ['id differs from directory', { ...base, id: 'other' }, /directory/],
  ['id not kebab-case', { ...base, id: 'Ping_Mod' }, /id/],
  ['invalid version', { ...base, version: '1.0' }, /version/],
  ['incompatible apiVersion', { ...base, apiVersion: '1.1.0' }, /apiVersion/],
  ['permission without module prefix', { ...base, permissions: ['other.res.act'] }, /permission/],
  ['published event without module prefix', { ...base, events: { subscribes: [], publishes: ['other.x.created'] } }, /event/],
])('rejects %s', (_, raw, pattern) => {
  const result = validateManifest(raw, 'ping', '1.0.0');
  expect(result.ok).toBe(false);
  expect((result as { errors: string[] }).errors.join(' ')).toMatch(pattern);
});
it('applies defaults', () => {
  expect(validateManifest(minimal, 'ping', '1.0.0')).toMatchObject({ ok: true,
    manifest: { enabledByDefault: false, events: { subscribes: [], publishes: [] } } });
});
// discovery.test.ts (diretório temporário)
it('returns [] when the modules directory does not exist', ...);
it('marks malformed JSON without affecting other modules', ...);   // Review Focus 2
it('rejects every module sharing a duplicated id', ...);
```

- [ ] **Step 2–4:** ver falhar, implementar, `npx vitest run core/module-registry` → PASS.
- [ ] **Step 5: Commit** — `feat(core): validate and discover module manifests`.

### Task 6: Ordem de dependências

**Files:** Create `core/module-registry/dependencies.ts`; Test `core/module-registry/dependencies.test.ts`

**Interfaces:**

- Produces: `resolveOrder(manifests: readonly ModuleManifest[]): { order: string[]; failed: Map<string, string> }` — Kahn; empate resolvido por ordem alfabética do id (ordem determinística). Motivos: `missing dependency "<id>"`, `circular dependency`, `dependency "<id>" failed`.

- [ ] **Step 1: Testes que falham**

```typescript
it('orders dependencies first', () => {
  expect(resolveOrder([m('c', ['b']), m('b', ['a']), m('a')]).order).toEqual(['a', 'b', 'c']);
});
it('fails a module with a missing dependency and its dependents', () => {
  const r = resolveOrder([m('a', ['ghost']), m('b', ['a']), m('c')]);
  expect(r.order).toEqual(['c']);
  expect(r.failed.get('a')).toMatch(/missing dependency "ghost"/);
  expect(r.failed.get('b')).toMatch(/dependency "a" failed/);
});
it('fails every module in a cycle', () => {
  const r = resolveOrder([m('a', ['b']), m('b', ['a']), m('c')]);
  expect([...r.failed.keys()].sort()).toEqual(['a', 'b']);
  expect(r.order).toEqual(['c']);
});
```

- [ ] **Step 2–4:** ver falhar, implementar, rodar → PASS.
- [ ] **Step 5: Commit** — `feat(core): resolve module dependency order`.

### Task 7: Event Bus

**Files:** Create `core/event-bus/event-bus.ts`; Test `core/event-bus/event-bus.test.ts`

**Interfaces:**

- Consumes: `Logger`, `ModuleManifest`, `SunFlowerEvent`, `EventHandler`, `withTimeout`.
- Produces:
  - `class EventBus { constructor(logger: Logger, options?: { handlerTimeoutMs?: number; maxDepth?: number }) }` — padrões 5000 e 8.
  - `forModule(manifest: ModuleManifest): ModuleContext['events'] & { unsubscribeAll(): void }`
  - `idle(): Promise<void>` — resolve quando não há consumidores pendentes (para testes e encerramento).
  - `class UndeclaredEventError extends Error`.
- Comportamento: `publish` monta o evento (`id = crypto.randomUUID()`, `version = 1`, `source = manifest.id`, `timestamp = new Date().toISOString()`, `context = context ?? {}`) e agenda cada consumidor com `setImmediate`, isolado por `withTimeout` e `try/catch`. A profundidade é carregada por `AsyncLocalStorage` (`node:async_hooks`): consumidores rodam com `depth + 1`; publicar com `depth >= maxDepth` descarta e registra `warn` com o `type`.

- [ ] **Step 1: Testes que falham**

```typescript
it('delivers to subscribers without blocking the publisher', async () => {
  const received: string[] = [];
  bus.forModule(consumer).subscribe('producer.item.created', (e) => { received.push(e.source); });
  bus.forModule(producer).publish('producer.item.created', { n: 1 });
  expect(received).toEqual([]);          // ainda não entregue
  await bus.idle(); expect(received).toEqual(['producer']);
});
it('isolates a failing and a hanging consumer', async () => { /* um lança, outro nunca resolve (timeout 20 ms), terceiro recebe; 2 logs de erro */ });
it('rejects publishing or subscribing to undeclared events', () => {
  expect(() => bus.forModule(producer).publish('producer.other.created', {})).toThrow(UndeclaredEventError);
  expect(() => bus.forModule(consumer).subscribe('x.y.z', () => {})).toThrow(UndeclaredEventError);
});
it('drops events beyond the maximum depth', async () => { /* consumidor que republica o mesmo tipo; maxDepth 3 → 3 entregas, 1 warn */ });
it('stops delivering after unsubscribeAll', async () => { ... });
```

- [ ] **Step 2–4:** ver falhar, implementar, rodar → PASS.
- [ ] **Step 5: Commit** — `feat(core): add isolated event bus`.

### Task 8: Permissões e configuração de módulos

**Files:** Create `core/permissions/permission-service.ts`, `core/configuration/module-config.ts`; Test `core/permissions/permission-service.test.ts`, `core/configuration/module-config.test.ts`

**Interfaces:**

- Consumes: `DatabaseSync` já migrado (Task 4), `Actor`, `ModuleManifest`.
- Produces:
  - `class PermissionService { constructor(db: DatabaseSync) }` com:
    - `isDeveloper(userId: string): boolean`
    - `addDeveloper(userId: string): boolean` (falso se já existia), `removeDeveloper(userId: string): boolean`, `listDevelopers(): { userId: string; addedAt: string }[]`
    - `grant(permission: string, roleId: string): void`, `revoke(permission: string, roleId: string): void`
    - `check(actor: Actor, permission: string): boolean`
    - `forModule(manifest: ModuleManifest): ModuleContext['permissions']`
  - Erros: `InvalidSnowflakeError`, `CorePermissionGrantError` (grant de `core.*`), `UndeclaredPermissionError`.
  - `class ModuleConfigStore { constructor(db: DatabaseSync) }` com:
    - `isEnabled(moduleId: string, enabledByDefault: boolean): boolean`
    - `setEnabled(moduleId: string, enabled: boolean | null): void`
    - `setSettings(moduleId: string, settings: unknown): void`
    - `loadSettings<T>(moduleId: string, schema?: z.ZodType<T>): T` — sem schema retorna `{}`; inválido lança `InvalidModuleConfigError` (mensagem com os caminhos inválidos, sem os valores).

- [ ] **Step 1: Testes que falham**

```typescript
const dev = '000000000000000000', mod = '111111111111111111', role = '222222222222222222';
it('denies by default', () => { expect(perms.check({ userId: mod, roleIds: [role] }, 'ping.cmd.use')).toBe(false); });
it('grants core.* only to developers', () => {
  perms.addDeveloper(dev);
  expect(perms.check({ userId: dev, roleIds: [] }, 'core.modules.manage')).toBe(true);
  expect(perms.check({ userId: mod, roleIds: [role] }, 'core.modules.manage')).toBe(false);
});
it('refuses to grant core.* to a role', () => {
  expect(() => perms.grant('core.modules.manage', role)).toThrow(CorePermissionGrantError);
});
it('grants module permissions through roles, not developer status', () => {
  perms.addDeveloper(dev); perms.grant('ping.cmd.use', role);
  expect(perms.check({ userId: mod, roleIds: [role] }, 'ping.cmd.use')).toBe(true);
  expect(perms.check({ userId: dev, roleIds: [] }, 'ping.cmd.use')).toBe(false);
});
it('restricts a module to its declared permissions', () => {
  expect(() => perms.forModule(manifest({ permissions: ['ping.cmd.use'] }))
    .check({ userId: mod, roleIds: [] }, 'ping.other.use')).toThrow(UndeclaredPermissionError);
});
it('validates snowflakes', () => { expect(() => perms.addDeveloper('abc')).toThrow(InvalidSnowflakeError); });
// module-config.test.ts
it('uses enabledByDefault when nothing is stored, stored value otherwise', ...);
it('applies schema defaults', () => {
  expect(store.loadSettings('ping', z.object({ greeting: z.string().default('hi') }))).toEqual({ greeting: 'hi' });
});
it('rejects invalid settings without echoing values', () => {
  store.setSettings('ping', { greeting: 42 });
  expect(() => store.loadSettings('ping', schema)).toThrow(/greeting/);
});
```

- [ ] **Step 2–4:** ver falhar, implementar, rodar → PASS.
- [ ] **Step 5: Commit** — `feat(core): add permission service and module config store`.

### Task 9: Module Registry e ciclo de vida

**Files:** Create `core/module-registry/registry.ts`; Test `core/module-registry/registry.test.ts` (módulos de teste gravados pelo próprio teste em diretório temporário)

**Interfaces:**

- Consumes: `discoverModules`, `resolveOrder`, `EventBus`, `PermissionService`, `ModuleConfigStore`, `withTimeout`, `Logger`, contratos.
- Produces:
  - `type ModuleState = 'DISCOVERED' | 'VALIDATED' | 'REGISTERED' | 'INITIALIZED' | 'RUNNING' | 'STOPPED' | 'DISPOSED' | 'FAILED'`
  - `interface ModuleStatus { state: ModuleState; failedAt?: string; error?: string }`
  - `class ModuleRegistry { constructor(deps: { modulesDir: string; logger: Logger; events: EventBus; permissions: PermissionService; config: ModuleConfigStore; coreApiVersion?: string; stepTimeoutMs?: number }) }`
  - `load(): Promise<void>`, `start(): Promise<void>`, `stop(): Promise<void>` — `start` antes de `load`, ou `load`/`start` repetidos, lançam `RegistryStateError`.
  - `status(): ReadonlyMap<string, ModuleStatus>` — chave: id do manifesto ou, se inválido, nome do diretório.
  - `commands(): ReadonlyMap<string, CommandDefinition>` — somente de módulos `RUNNING`.
- Comportamento:
  - `load`: descobrir; inválidos `FAILED` (`failedAt: 'validation'`); `resolveOrder`; carregar `entrypoint` com `import(pathToFileURL(...).href)`; `default` que não seja função → `FAILED` (`failedAt: 'import'`). Diretório sem módulos: `warn` e nenhum erro (Review Focus 1).
  - `start`: para cada id em ordem, pular desabilitados (`config.isEnabled`) e os que dependem de módulo `FAILED` ou desabilitado (marcar `FAILED` com motivo); executar `register(context)`, `initialize()`, `start()` com `withTimeout(stepTimeoutMs)`; `config.get()` devolve `loadSettings(id, configSchema)` carregado antes do `initialize`.
  - `context.commands.register`: nome `/^[a-z0-9_-]{1,32}$/`, descrição 1–100 caracteres; nome já usado por outro módulo lança erro (o `register` do módulo falha).
  - Falha em qualquer etapa: `FAILED` com `failedAt`; `dispose()` com timeout, erro apenas registrado; `events.unsubscribeAll()`; comandos do módulo descartados; dependentes ainda não iniciados ficam `FAILED`.
  - `stop`: ordem inversa; `RUNNING` → `stop()` → `STOPPED` → `dispose()` → `DISPOSED`; `unsubscribeAll()` antes do `stop()`; falhas registradas e o encerramento continua.

- [ ] **Step 1: Testes que falham** — helper `writeModule(dir, id, { manifest?, source })` grava `manifest.json` e `index.ts` em diretório temporário; o `source` registra chamadas em `globalThis.__calls` para asserções.

```typescript
it('starts modules in dependency order and stops in reverse', async () => {
  // b depende de a
  await registry.load(); await registry.start();
  expect(calls()).toEqual(['a:register', 'a:initialize', 'a:start', 'b:register', 'b:initialize', 'b:start']);
  await registry.stop();
  expect(calls().slice(6)).toEqual(['b:stop', 'b:dispose', 'a:stop', 'a:dispose']);
});
it.each(['register', 'initialize', 'start'])('marks FAILED, disposes and skips dependents when %s throws', ...);
it('treats a step that exceeds the timeout as a failure', ...);       // stepTimeoutMs: 20
it('survives dispose throwing after a failure', ...);
it('does not start disabled modules or their dependents', ...);
it('fails a module whose config is invalid', ...);
it('fails the second module registering the same command name', ...);
it('starts with zero modules when the directory is empty', ...);   // Review Focus 1
it('rejects start before load and a second start', ...);
it('exposes commands of running modules only', ...);
```

- [ ] **Step 2–4:** ver falhar, implementar, `npx vitest run core/module-registry` → PASS.
- [ ] **Step 5: Commit** — `feat(core): add module registry and lifecycle`.
- [ ] **Step 6: Abrir o PR B** — `npm run check`; verificação de vazamento; push e PR.

---

## PR C

### Task 10: Núcleo da aplicação e comando `staff`

**Files:** Create `core/application/core.ts`, `core/application/staff.ts`; Test `core/application/staff.test.ts`, `tests/integration/core.test.ts`

**Interfaces:**

- Consumes: todas as peças do Core.
- Produces:
  - `startCore(options: { dbPath: string; modulesDir: string; logger: Logger; stepTimeoutMs?: number }): Promise<CoreHandle>` — abre o banco, migra, cria serviços, `load` e `start`.
  - `interface CoreHandle { commands(): ReadonlyMap<string, CommandDefinition>; status(): ReadonlyMap<string, ModuleStatus>; permissions: PermissionService; stop(): Promise<void> }` — `stop` idempotente: registry, `events.idle()`, `db.close()`.
  - `runStaff(args: string[], deps: { permissions: PermissionService; logger: Logger; out: (line: string) => void }): number` — código de saída; uso inválido imprime `Uso: npm run staff -- add|remove|list [userId]` e retorna 2; ID inválido retorna 2; `add`/`remove` registram `info` com `action`.
  - Entrada em `staff.ts`: executa somente quando `import.meta.main` for verdadeiro; usa `loadDatabaseEnvironment(process.env)`, `openDatabase`, `runMigrations` e `process.exitCode = runStaff(process.argv.slice(2), ...)`.

- [ ] **Step 1: Testes que falham**

```typescript
// staff.test.ts
it('adds, lists and removes developers', () => {
  expect(runStaff(['add', '000000000000000000'], deps)).toBe(0);
  runStaff(['list'], deps);
  expect(out).toContainEqual(expect.stringContaining('000000000000000000'));
  expect(runStaff(['remove', '000000000000000000'], deps)).toBe(0);
});
it('rejects invalid ids and usage', () => {
  expect(runStaff(['add', 'abc'], deps)).toBe(2);
  expect(runStaff([], deps)).toBe(2);
});
// tests/integration/core.test.ts — diretório temporário com módulo válido, inválido e dependente do inválido
it('boots the core, isolates broken modules and shuts down cleanly', async () => {
  const core = await startCore({ dbPath: ':memory:', modulesDir: dir, logger });
  expect(core.status().get('good')?.state).toBe('RUNNING');
  expect(core.status().get('broken')?.state).toBe('FAILED');
  expect(core.status().get('needs-broken')?.state).toBe('FAILED');
  expect([...core.commands().keys()]).toEqual(['good']);
  await core.stop();
  await core.stop(); // idempotente
});
```

- [ ] **Step 2–4:** ver falhar, implementar, rodar → PASS.
- [ ] **Step 5: Commit** — `feat(core): add core bootstrap and staff command`.

### Task 11: Interface Discord

**Files:** Create `interfaces/discord/guild-guard.ts`, `interfaces/discord/commands.ts`, `interfaces/discord/client.ts`; Test `interfaces/discord/guild-guard.test.ts`, `interfaces/discord/commands.test.ts`

**Interfaces:**

- Consumes: `CommandDefinition`, `Actor`, `Logger`.
- Produces:
  - `leaveUnauthorizedGuilds(guilds: Iterable<{ id: string; leave(): Promise<unknown> }>, allowedGuildId: string, logger: Logger): Promise<boolean>` — sai de todos os outros, registra `warn` por saída, retorna se o permitido está presente.
  - `isAllowedInteraction(interaction: { guildId: string | null }, allowedGuildId: string): boolean`
  - `interface CommandTarget { setGuildCommands(commands: { name: string; description: string }[]): Promise<void>; clearGlobalCommands(): Promise<void> }`
  - `syncCommands(target: CommandTarget, commands: Iterable<CommandDefinition>): Promise<void>`
  - `interface RawInteraction { commandName: string; userId: string; roleIds: string[]; guildId: string | null; reply(content: string, ephemeral: boolean): Promise<void>; deferReply(): Promise<void>; editReply(content: string): Promise<void> }`
  - `dispatchCommand(raw: RawInteraction, commands: ReadonlyMap<string, CommandDefinition>, logger: Logger, options?: { deferAfterMs?: number }): Promise<void>` — padrão 2500.
  - `createDiscordClient(): Client` (intent `GatewayIntentBits.Guilds`) e `toRawInteraction(interaction: ChatInputCommandInteraction): RawInteraction` — `roleIds` de `GuildMemberRoleManager.cache.keys()` ou do array `roles` da API; `reply(..., true)` usa `flags: MessageFlags.Ephemeral`.
- Comportamento de `dispatchCommand`: comando inexistente → `reply('Comando indisponível.', true)`; um temporizador chama `deferReply()` se nada foi respondido em `deferAfterMs`, e respostas posteriores usam `editReply`; segunda resposta do handler é ignorada com `warn`; exceção do handler → `error` com `command` e `reply`/`editReply` `Ocorreu um erro.` (efêmero quando ainda não adiado).

- [ ] **Step 1: Testes que falham** (objetos falsos registrando chamadas)

```typescript
it('leaves every guild except the allowed one', async () => {
  const left: string[] = [];
  const guilds = ['000000000000000000', '111111111111111111'].map((id) => ({ id, leave: async () => { left.push(id); } }));
  expect(await leaveUnauthorizedGuilds(guilds, '000000000000000000', logger)).toBe(true);
  expect(left).toEqual(['111111111111111111']);
});
it('ignores interactions from other guilds and DMs', () => {
  expect(isAllowedInteraction({ guildId: null }, allowed)).toBe(false);
  expect(isAllowedInteraction({ guildId: '111111111111111111' }, allowed)).toBe(false);
});
it('replaces guild commands and clears global ones', async () => { ... });
it('passes the actor and replies', async () => { /* reply('Pong!', false) */ });
it('defers after the threshold and edits the reply', async () => { /* deferAfterMs: 10; handler espera 30 ms */ });
it('answers unknown commands with Comando indisponível.', async () => { ... });   // Review Focus 3
it('ignores a second reply from the handler', async () => { ... });               // Review Focus 4
it('hides handler errors from the user', async () => {
  // handler lança Error('db password=x') → reply('Ocorreu um erro.', true); conteúdo não contém 'password'
});
```

- [ ] **Step 2–4:** ver falhar, implementar, `npx vitest run interfaces` → PASS. `client.ts` não tem teste unitário (adaptador fino de `discord.js`); é coberto pelo teste manual da Task 12.
- [ ] **Step 5: Commit** — `feat(discord): add guild guard and command dispatch`.

### Task 12: Entrada, encerramento, módulo `ping` e documentação

**Files:** Create `core/application/shutdown.ts`, `interfaces/discord/main.ts`, `modules/ping/{manifest.json,index.ts,README.md}`, `modules/ping/tests/ping.test.ts`; Test `core/application/shutdown.test.ts`, `tests/integration/ping.test.ts`; Modify `README.md`, `docs/ROADMAP.md`, `CHANGELOG.md`, `docs/specs/2026-11-16-fase-1-core-discord.md` (status `Aprovada em 2026-11-16`)

**Interfaces:**

- Consumes: `startCore`, `loadEnvironment`, `createLogger`, `leaveUnauthorizedGuilds`, `isAllowedInteraction`, `syncCommands`, `dispatchCommand`, `createDiscordClient`, `toRawInteraction`.
- Produces:
  - `installShutdownHandlers(proc: { on(event: string, listener: (...args: unknown[]) => void): unknown; exit(code: number): void }, shutdown: () => Promise<void>, logger: Logger): void` — `SIGINT`/`SIGTERM` → `shutdown()` → `exit(0)`; `uncaughtException`/`unhandledRejection` → `fatal` → `shutdown()` → `exit(1)`; chamadas seguintes ignoradas (Review Focus 5).
  - `modules/ping/index.ts`: `default` = fábrica cujo `register` registra `{ name: 'ping', description: 'Verifica se o Sun Flower está respondendo.', handle: (i) => i.reply('Pong!') }`; demais métodos vazios. Manifesto exatamente como na spec §10.
- `main.ts` (sem teste unitário): `loadEnvironment(process.env)` (erro → mensagem no `stderr`, `exitCode = 1`); logger; `startCore({ modulesDir: <raiz>/modules, ... })`; cliente; `installShutdownHandlers(process, ...)` com encerramento = `client.destroy()` + `core.stop()`; em `ready` e `guildCreate`: `leaveUnauthorizedGuilds` e, se o servidor estiver presente, `syncCommands`; ausente → `error` e aguardar; `interactionCreate` de comando de barra permitido → `dispatchCommand`; falha no `login` → `core.stop()` e `exitCode = 1`.

- [ ] **Step 1: Testes que falham**

```typescript
// shutdown.test.ts — proc falso baseado em EventEmitter
it('runs shutdown once and exits 0 on signals', async () => {
  proc.emit('SIGINT'); proc.emit('SIGINT'); await settle();
  expect(shutdown).toHaveBeenCalledTimes(1); expect(exitCodes).toEqual([0]);
});
it('logs fatal and exits 1 on uncaught errors', async () => { ... });
// modules/ping/tests/ping.test.ts
it('registers /ping and answers Pong!', async () => {
  // context falso: captura a definição registrada; handle com interaction falsa
  expect(replies).toEqual(['Pong!']);
});
it('has a manifest accepted by the core', () => {
  expect(validateManifest(manifestJson, 'ping', CORE_API_VERSION).ok).toBe(true);
});
// tests/integration/ping.test.ts
it('answers /ping end to end through the real modules directory', async () => {
  const core = await startCore({ dbPath: ':memory:', modulesDir: MODULES_DIR, logger });
  const raw = fakeInteraction({ commandName: 'ping', guildId: '000000000000000000' });
  await dispatchCommand(raw, core.commands(), logger);
  expect(raw.replies).toEqual([{ content: 'Pong!', ephemeral: false }]);
  await core.stop();
});
```

- [ ] **Step 2–4:** ver falhar, implementar, `npm run check` → PASS.
- [ ] **Step 5: Documentação** — `README.md`: `npm start`, `npm run staff -- add <seu ID de usuário>` para o primeiro desenvolvedor, e o lembrete de que IDs ficam só no banco local; `modules/ping/README.md` com as 10 seções de MODULES §15 (as que não se aplicam com `Não se aplica`); `ROADMAP.md`: Fase 1 em revisão; `CHANGELOG.md`: entradas `Added` do Core, da interface Discord, do comando `staff` e do módulo `ping`.
- [ ] **Step 6: Verificação manual (pessoa mantenedora)** — com `.env` real: `npm run staff -- add <ID>`, `npm start`, `/ping` responde `Pong!` no servidor; adicionar o bot a outro servidor de teste faz o bot sair.
- [ ] **Step 7: Commit** — `feat(discord): add entry point, shutdown handling and ping module`.
- [ ] **Step 8: Abrir o PR C** — `npm run check`; verificação de vazamento; push e PR. Após o merge e a verificação manual, a pessoa mantenedora publica `v0.1.0` conforme [GIT.md §6](../GIT.md#6-tags-e-releases).
