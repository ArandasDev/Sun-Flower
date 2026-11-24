# Fase 3, etapa 1 — Base segura do painel: Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a primeira etapa do painel. Inclui:

- níveis de acesso da 0017;
- login com Discord;
- sessões;
- interface `dashboard` segura;
- tempo real com presença e estado do bot;
- o app React com login, perfil e visão geral.

**Architecture:** o trabalho se divide em três partes.

- **Core:** ganha os níveis de acesso, sessões guardadas por hash, eventos `core.*`, a versão da configuração e as variáveis do painel.
- **`interfaces/dashboard/`:** servidor Fastify que roda no mesmo processo do bot. Fala com o Core pelo `CoreHandle` e com o Discord por uma porta de consulta de membros que a interface Discord implementa.
- **`interfaces/dashboard/app/`:** app Vite, com `package.json` próprio, servido na mesma origem.

**Tech Stack:**

- **Servidor:** Node.js 26 (type stripping, `node:sqlite`, `node:crypto`), TypeScript 6 (`strict`), discord.js 14.28, zod 4, Vitest 5, Fastify 5 com `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/websocket` e `@fastify/static`.
- **App:** React 19, React Router 7, TanStack Query 5, Motion 12, Vite 7, Vitest com jsdom e Testing Library.

**Spec:** [`docs/specs/2026-11-24-fase-3-painel.md`](../specs/2026-11-24-fase-3-painel.md), §1 a §6 e §9 a §12 na parte da etapa 1. Decisões aplicadas: 0017 a 0021.

## Global Constraints

- Tudo das Global Constraints do [plano da Fase 2, etapa 1](2026-11-17-fase-2-moderacao-phishing.md#global-constraints) continua valendo: logs sem IDs nem conteúdo, mensagens ao usuário em português e código em inglês.
- **Dependências:** aprovar este plano autoriza adicionar as dependências da Tech Stack e mudar a CI só como a Task 9 descreve. As versões são fixadas com `^` na major atual na hora da instalação.
- **`CORE_API_VERSION` continua `1.2.0`.** `Actor.isOwner` é obrigatório, mas só o Core e as interfaces criam um `Actor`, e os módulos apenas leem. Por isso a MAJOR não muda.
- **Sessão:**
  - ID de 32 bytes em base64url, no cookie `__Host-sf_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`);
  - o banco guarda `sha256` em hexadecimal;
  - expira após 12 h sem uso (`43_200_000` ms) e em 7 dias no máximo (`604_800_000` ms);
  - `last_seen_at` é gravado no máximo a cada `60_000` ms;
  - a limpeza roda a cada `3_600_000` ms.
- **Cookie OAuth:** `__Host-sf_oauth`, assinado, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 10 minutos.
- **CSRF:** `base64url(HMAC-SHA256(SESSION_SECRET, "csrf:" + idHash))`, no cabeçalho `X-CSRF-Token`, comparado com `timingSafeEqual`.
- **Limites:**
  - login: 10 por minuto por IP;
  - API: 120 requisições por minuto por sessão (ou por IP, sem sessão), das quais 30 podem ser alterações;
  - corpo: só `application/json`, até `65_536` bytes;
  - WebSocket: 5 conexões por sessão, 1 mensagem por segundo, fechamento na 10ª violação, mensagem de até 256 bytes, `screen` com `^[a-z0-9.-]{1,40}$`;
  - presença: sai 30 s depois da última conexão da pessoa fechar;
  - revalidação das conexões a cada 60 s;
  - chamadas ao Discord: 10 s de limite.
- **CSP exata:** `default-src 'self'; img-src 'self' https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. Também `Strict-Transport-Security`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: same-origin`.
- **Escuta:** o servidor escuta só em `127.0.0.1`.
- **Erros da API:** sempre `{ "error": { "code": string, "message": string } }`. O `403` nunca diz qual permissão falta, e nenhuma resposta traz rastreamento de erro ou caminho de arquivo.
- **Textos fixos ao usuário:**
  - `Desenvolvedores precisam ser membros do servidor para acessar o painel. Isso faz parte da segurança do projeto: limita o estrago se uma conta for invadida.`
  - `Só membros do servidor podem acessar o painel.`
  - `Não foi possível confirmar seu acesso agora. Tente de novo em instantes.`
  - `Não foi possível entrar. Tente de novo.`
  - `Reconectando…`
  - `Sem permissão.`
- **Valores fictícios nos testes e na documentação:** IDs com dígitos repetidos (`111111111111111111`, `222222222222222222`…) e domínios `example.com`.

## Review Focus

1. **Sessão aberta quando a pessoa perde o último cargo de equipe:** a próxima requisição devolve as permissões novas. Não pode haver cache de nível na sessão. Teste na Task 7 (`/api/me` depois de trocar os cargos no diretório falso).
2. **Dono que transfere a propriedade do servidor no meio da sessão:** o antigo dono perde as permissões de módulo na hora. Testes na Task 1 (`check`) e na Task 7 (`/api/me`).
3. **Duas abas abertas:** presença não duplica a pessoa, e fechar uma aba não a remove. Teste na Task 8.
4. **Bot ainda conectando ao Discord quando alguém tenta entrar:** a consulta de membro devolve `undefined`, e o login mostra "tente de novo" em vez de "sem acesso". Teste na Task 5.
5. **`PANEL_PUBLIC_URL` com barra final (`https://painel.example.com/`):** é aceita e normalizada para a origem. Com caminho (`/painel`), é recusada. Teste na Task 4.

## Entrega em Pull Requests

| PR  | Tasks | Título                                                          |
| --- | ----- | --------------------------------------------------------------- |
| H   | 1–4   | `feat(core): add access levels, panel sessions and core events` |
| I   | 5–8   | `feat(dashboard): add secure panel server with discord login`   |
| J   | 9–11  | `feat(dashboard): add panel app with live presence`             |

Cada PR parte da `main` depois do merge do anterior.

---

## PR H

### Task 1: Níveis de acesso

**Files:**

- Modify:
  - `shared/contracts/commands.ts`
  - `core/permissions/permission-service.ts`
  - `core/application/staff.ts`
  - `interfaces/discord/client.ts` (`toRawInteraction`)
  - `interfaces/discord/commands.ts` (montagem do `Actor`)
  - todos os literais de `Actor` nos testes e fakes (`grep -rn "roleIds:"`)
- Test: `core/permissions/permission-service.test.ts`, `core/application/staff.test.ts`, `interfaces/discord/client.test.ts`

**Interfaces:**

- Produces:
  - `interface Actor { readonly userId: string; readonly roleIds: readonly string[]; readonly isOwner: boolean }`.
  - `RawInteraction.isOwner: boolean`, preenchido com `interaction.guild?.ownerId === interaction.user.id`. Sem `guild` em cache, o valor é `false`.
  - `type AccessLevel = 'developer' | 'owner' | 'staff' | 'member'`, em `permission-service.ts`.
  - `PermissionService.check(actor, permission): boolean`, na ordem da spec §3.
  - `PermissionService.level(actor): AccessLevel`. `staff` é quem tem qualquer linha em `permission_grants` para um dos cargos.
  - `PermissionService.effective(actor, declared: ReadonlySet<string>): string[]`. Devolve, em ordem alfabética, as permissões de `declared` que `check` aceita, mais `core.*` declaradas, só para desenvolvedores.
  - `PermissionService.grant(permission, roleId, declared: ReadonlySet<string>): void`. Lança `ProtectedPermissionGrantError` para `administration.*` e `UndeclaredPermissionError` para quem não está em `declared`, além dos erros atuais.

- [ ] **Step 1: Testes que falham** (`permission-service.test.ts`):
  - `check` dá `true` a um desenvolvedor sem cargos em `moderation.actions.ban` e em `core.modules.manage`;
  - o dono (`isOwner: true`, sem cargos) tem `true` em `moderation.actions.ban` e `false` em `core.modules.manage`;
  - com o mesmo `userId` e `isOwner: false`, `moderation.actions.ban` dá `false`;
  - equipe com o cargo associado dá `true`, e sem o cargo dá `false`;
  - `level` devolve `developer` > `owner` > `staff` > `member`, conforme o caso;
  - `effective` de um membro devolve `[]`, e a de um desenvolvedor inclui as `core.*` declaradas;
  - `grant('administration.grants.manage', …)` lança `ProtectedPermissionGrantError`;
  - `grant('moderation.unknown', …)` com `declared` sem ela lança `UndeclaredPermissionError`;
  - `grant('core.x', …)` continua lançando `CorePermissionGrantError`.
- [ ] **Step 2: Rodar.** `npx vitest run core/permissions` → FAIL (`isOwner`/`level` inexistentes).
- [ ] **Step 3: Implementar** os itens de Produces. O `forModule(...).check` continua recusando permissão não declarada antes de consultar o nível.
- [ ] **Step 4: `staff.ts`** passa `declaredPermissions()` para `grant`. O comando passa a recusar, com a mensagem `Nenhum módulo declara a permissão <permissão>.`, o que antes só gerava aviso, e devolve código 1. Atualizar o teste correspondente em `staff.test.ts`.
- [ ] **Step 5: Interface Discord.** Em `client.test.ts`, testar `isOwner` `true` e `false`. Implementar em `toRawInteraction` e passar o valor ao `Actor` em `commands.ts`.
- [ ] **Step 6: Rodar.** `npm run check` → PASS, com todos os literais de `Actor` atualizados.
- [ ] **Step 7: Commit.** `feat(core): add developer, owner, staff and member access levels`

### Task 2: Sessões do painel

**Files:**

- Create:
  - `core/infrastructure/migrations/0003-panel.sql`
  - `core/sessions/session-store.ts`
  - `core/sessions/session-store.test.ts`
- Modify: `core/application/core.ts` (`CoreHandle.sessions`)

**Interfaces:**

- Produces (`session-store.ts`):
  - `interface SessionRecord { readonly idHash: string; readonly userId: string; readonly createdAt: number; readonly lastSeenAt: number; readonly expiresAt: number }`.
  - `class SessionStore`, com `constructor(db: DatabaseSync, now: () => number = Date.now)` e os métodos:
    - `create(userId: string): { token: string; record: SessionRecord }`;
    - `resolve(token: string): SessionRecord | null`, que confere as duas expirações e grava `last_seen_at` se passou o intervalo;
    - `delete(token: string): void` e `deleteByHash(idHash: string): void`;
    - `deleteForUser(userId: string): number`;
    - `purgeExpired(): number`.
  - `hashSessionToken(token: string): string`, em sha256 hexadecimal.
  - `CoreHandle.sessions: SessionStore`. A limpeza horária é registrada em `startCore` e cancelada no `stop`.
- Migração `0003-panel.sql`:
  - a tabela e o índice da spec §5.3, com tempos em ISO 8601, como as outras tabelas;
  - `ALTER TABLE module_config ADD COLUMN version INTEGER NOT NULL DEFAULT 0;`.

- [ ] **Step 1: Testes que falham:**
  - `create` gera token com 43 caracteres base64url, e o banco não contém o token, só `hashSessionToken(token)`;
  - dois `create` geram tokens diferentes;
  - `resolve` devolve `null` para token desconhecido;
  - devolve o registro em 12 h − 1 ms sem uso e `null` em 12 h + 1 ms;
  - com uso a cada hora, devolve `null` aos 7 dias + 1 ms;
  - `last_seen_at` não é regravado antes de 60 s;
  - `purgeExpired` apaga só as vencidas;
  - `deleteForUser` apaga todas da pessoa.

  Os testes usam um relógio falso.

- [ ] **Step 2: Rodar.** `npx vitest run core/sessions` → FAIL.
- [ ] **Step 3: Implementar.** Usar `randomBytes(32).toString('base64url')` e `createHash('sha256')`.
- [ ] **Step 4: Rodar.** `npx vitest run core/sessions core/infrastructure` → PASS.
- [ ] **Step 5: Commit.** `feat(core): store panel sessions by token hash`

### Task 3: Eventos `core.*` e versão da configuração

**Files:**

- Modify:
  - `core/event-bus/event-bus.ts`
  - `core/configuration/module-config.ts`
  - `core/module-registry/registry.ts` (`config.set`)
  - `core/application/core.ts`
- Test: `core/event-bus/event-bus.test.ts`, `core/configuration/module-config.test.ts`, `core/module-registry/registry.test.ts`

**Interfaces:**

- Produces:
  - `EventBus.publishFromCore` aceita `discord.*` e `core.*`, e os módulos continuam só no próprio prefixo.
  - `EventBus.subscribeFromCore(type: string, handler: EventHandler): () => void`, para interfaces. O retorno cancela a assinatura.
  - `ModuleConfigStore.getVersion(moduleId): number`, que devolve 0 sem linha.
  - `setSettings` incrementa `version`.
  - `updateSettings(moduleId, schema, partial, expectedVersion?: number)` lança `ConfigVersionConflictError` quando `expectedVersion` difere da versão atual, sem gravar.
  - O `config.set` do contexto publica `core.config.changed` `{ moduleId, version }` depois de gravar.
  - O registro de módulos publica `core.module.state.changed` `{ moduleId, state }` a cada transição de estado.
  - `CoreHandle.subscribe(type, handler): () => void`, que repassa a `subscribeFromCore`. O `CoreHandle.publishCoreEvent` passa a aceitar `core.*`.
  - `CoreHandle.declaredPermissions(): ReadonlySet<string>`, com as permissões dos manifestos carregados.

- [ ] **Step 1: Testes que falham:**
  - `publishFromCore('core.config.changed')` entrega o evento, e `publishFromCore('moderation.x')` lança `UndeclaredEventError`;
  - `subscribeFromCore` recebe o evento, e depois de cancelar não recebe mais;
  - a versão vai de 0 para 1 e depois para 2;
  - `expectedVersion` errada lança o erro e mantém as configurações;
  - `config.set` num módulo de teste publica `core.config.changed` com a versão nova;
  - iniciar um módulo de teste publica `core.module.state.changed` com `RUNNING`.
- [ ] **Step 2: Rodar.** `npx vitest run core/event-bus core/configuration core/module-registry` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** os mesmos testes → PASS.
- [ ] **Step 5: Commit.** `feat(core): publish core events and version module settings`

### Task 4: Variáveis do painel e documentação do PR H

**Files:**

- Create: `core/configuration/panel-environment.ts` e `.test.ts`
- Modify:
  - `.env.example`
  - `docs/MODULES.md` (`Actor.isOwner`, prefixo `core.` reservado, níveis)
  - `docs/ARCHITECTURE.md` §3.4 (interface `dashboard`)
  - `CHANGELOG.md`

**Interfaces:**

- Produces:
  - `interface PanelEnvironment`, com os campos:
    - `publicUrl: string` (a origem, sem barra final);
    - `port: number`;
    - `clientId: string`;
    - `clientSecret: string`;
    - `sessionSecret: Buffer`;
    - `trustProxy: string[]`.

    Todos são `readonly`.

  - `loadPanelEnvironment(env): PanelEnvironment | null`. Devolve `null` sem `PANEL_PUBLIC_URL`. Quando a configuração é inválida, lança `EnvironmentError(variables)` (reaproveitado) só com os nomes das variáveis.
  - As regras de validação:
    - `PANEL_PUBLIC_URL`: `https:` sem caminho além de `/`, sem consulta e sem fragmento;
    - `PANEL_PORT`: inteiro de 1 a 65535, padrão `3000`;
    - `DISCORD_CLIENT_ID`: de 17 a 20 dígitos;
    - `DISCORD_CLIENT_SECRET`: não vazio;
    - `SESSION_SECRET`: base64 com pelo menos 32 bytes decodificados;
    - `PANEL_TRUST_PROXY`: lista separada por vírgulas, e vazio vira `[]`.

- [ ] **Step 1: Testes que falham:**
  - sem `PANEL_PUBLIC_URL`, devolve `null`;
  - a URL com barra final vira origem, e `http://`, `/painel` ou `?x=1` são recusados;
  - um segredo de 31 bytes é recusado;
  - com secret inválido, a mensagem do erro contém `DISCORD_CLIENT_SECRET` e nunca o valor;
  - `PANEL_TRUST_PROXY=127.0.0.1, ::1` vira `['127.0.0.1', '::1']`.
- [ ] **Step 2: Rodar.** `npx vitest run core/configuration` → FAIL.
- [ ] **Step 3: Implementar** com zod, no padrão de `environment.ts`.
- [ ] **Step 4: Documentação.** Atualizar `.env.example` com as seis variáveis comentadas e valores fictícios, além de MODULES, ARCHITECTURE e CHANGELOG (`Added`/`Changed` do PR H).
- [ ] **Step 5: Rodar.** `npm run check` → PASS.
- [ ] **Step 6: Commit.** `feat(core): validate panel environment variables`

---

## PR I

### Task 5: Diretório de membros e estado da conexão

**Files:**

- Create:
  - `interfaces/dashboard/ports.ts`
  - `interfaces/discord/directory.ts` e `.test.ts`
- Modify: `interfaces/discord/main.ts` (eventos de conexão)

**Interfaces:**

- Produces (`ports.ts`):
  - `interface MemberInfo { readonly roleIds: readonly string[]; readonly isOwner: boolean; readonly displayName: string; readonly avatarUrl: string | null }`.
  - `interface MemberDirectory { lookup(userId: string): Promise<MemberInfo | null | undefined> }`. Devolve `null` quando a pessoa não é membro e `undefined` quando a consulta falha ou o servidor ainda não está disponível.
  - `type ConnectionState = 'connecting' | 'ready' | 'disconnected'`.
  - `interface BotStatus { connection(): ConnectionState; startedAt: number }`.
- Produces (`directory.ts`):
  - `createMemberDirectory(client: Client, guildId: string): MemberDirectory`. Usa `guild.members.cache` e, se faltar, `members.fetch` com limite de 10 s, que mapeia o erro 10007 para `null`. Os cargos vêm sem `@everyone`. `avatarUrl` usa `displayAvatarURL({ size: 128 })`.
  - `createBotStatus(client): BotStatus`.
  - Em `main.ts`, o cliente publica `core.discord.connection.changed` `{ state }` nos eventos `ClientReady`, `ShardDisconnect` e `ShardReconnecting`.

- [ ] **Step 1: Testes que falham**, com um cliente falso:
  - membro em cache devolve `MemberInfo`, com `isOwner` conforme `guild.ownerId`;
  - um membro fora do cache é buscado;
  - o erro 10007 devolve `null`;
  - um erro genérico, o limite de tempo ou o servidor fora do cache devolvem `undefined`.
- [ ] **Step 2: Rodar.** `npx vitest run interfaces/discord/directory` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit.** `feat(discord): add member directory and connection events for the panel`

### Task 6: Servidor do painel

**Files:**

- Create:
  - `interfaces/dashboard/server.ts` e `.test.ts`
  - `interfaces/dashboard/errors.ts`
- Modify: `package.json` (dependências do servidor)

**Interfaces:**

- Produces:
  - `interface DashboardDeps`, com:
    - `env: PanelEnvironment`;
    - `core: CoreHandle`;
    - `directory: MemberDirectory`;
    - `status: BotStatus`;
    - `oauth: OAuthClient` (Task 7);
    - `logger: Logger`;
    - `staticDir: string`;
    - `now?: () => number`.
  - `buildDashboard(deps): Promise<FastifyInstance>`, sem escutar porta. É o que os testes usam com `inject`.
  - `startDashboard(deps): Promise<{ close(): Promise<void> }>`, que escuta em `127.0.0.1:env.port`.
  - `apiError(reply, status, code, message)`, em `errors.ts`. O tratador global devolve `500` com `{ code: 'failed', message: 'Erro interno.' }` e registra só `error.name`.
- **Configuração do servidor:**
  - `trustProxy: env.trustProxy.length > 0 ? env.trustProxy : false`;
  - `bodyLimit: 65_536`;
  - outros tipos de conteúdo além de `application/json` recebem `415`.
- **Plugins:**
  - `@fastify/helmet`, com a CSP exata;
  - `@fastify/cookie`, com `secret: env.sessionSecret`;
  - `@fastify/rate-limit`, com chave = hash da sessão ou IP, 120 por minuto e um segundo limite de 30 por minuto em `POST`/`PUT`/`PATCH`/`DELETE`;
  - `@fastify/static`, em `staticDir`.
- **Rotas fora de `/api` e `/auth`:** servem `index.html`. Sem `staticDir/index.html`, respondem `503` com o texto `Painel não compilado.`.

- [ ] **Step 1: Testes que falham** (`inject`):
  - a CSP, a HSTS, o `nosniff` e o `Referrer-Policy` aparecem em `/` e em `/api/me`;
  - `POST /api/logout` com `text/plain` dá `415`;
  - um corpo de 70 000 bytes dá `413`;
  - a 121ª requisição no minuto dá `429` no formato de erro;
  - com `trustProxy: []`, `X-Forwarded-For` é ignorado no IP usado pelo limite;
  - `/../package.json` e `/%2e%2e/package.json` não saem de `staticDir`;
  - `/qualquer/rota` devolve o `index.html` de um diretório temporário;
  - um erro lançado numa rota de teste devolve `500` genérico, sem `stack`.
- [ ] **Step 2: Rodar.** `npx vitest run interfaces/dashboard/server` → FAIL.
- [ ] **Step 3: Instalar** as dependências e implementar.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add hardened fastify server`

### Task 7: Login, sessão, CSRF e `/api/me`

**Files:**

- Create:
  - `interfaces/dashboard/oauth.ts`
  - `interfaces/dashboard/auth-routes.ts` e `.test.ts`
  - `interfaces/dashboard/session.ts`
- Modify: `interfaces/dashboard/server.ts`

**Interfaces:**

- Produces:
  - `interface OAuthClient`, com:
    - `authorizeUrl(state: string, challenge: string): string`;
    - `exchange(code: string, verifier: string): Promise<string>`, que devolve o token de acesso;
    - `fetchUserId(accessToken: string): Promise<string>`.
  - `createDiscordOAuth(env): OAuthClient`. Usa `fetch` com `AbortSignal.timeout(10_000)` em `https://discord.com/api/v10/oauth2/token` e `/users/@me`, e o `redirect_uri` é `${publicUrl}/auth/callback`.
  - **`session.ts`:**
    - `authenticate(request): Promise<Authenticated | null>`, onde `Authenticated = { record: SessionRecord; actor: Actor; member: MemberInfo }`. Resolve a sessão e consulta o diretório. Com `null`, apaga a sessão e devolve `null`. Com `undefined`, devolve `null` sem apagar.
    - `csrfToken(idHash): string`.
    - `requireSession`, um `preHandler` que dá `401` e, nos métodos de alteração, `403` com CSRF ausente ou errado.
  - **Rotas:**
    - `GET /auth/login` redireciona com `302`, `state` e PKCE `S256`;
    - `GET /auth/callback` redireciona para `/` ou para `/login?error=dev_not_member|not_member|retry|failed`;
    - `GET /api/me` devolve `{ id, name, avatarUrl, level, permissions, csrfToken }`;
    - `POST /api/logout` devolve `204` e apaga o cookie.
  - O login tem um limite próprio de 10 por minuto por IP em `/auth/*`.
  - O token de acesso nunca é atribuído a nada além de uma variável local, nem vai para log.

- [ ] **Step 1: Testes que falham**, com `OAuthClient` e diretório falsos:
  - `/auth/login` define o cookie `__Host-sf_oauth` e redireciona para a URL com `code_challenge_method=S256`;
  - o callback sem cookie, com `state` diferente ou com o cookie expirado vai para `error=failed` e não cria sessão;
  - `exchange` lançando também vai para `failed`;
  - um não membro vai para `not_member`, e um desenvolvedor não membro vai para `dev_not_member`;
  - o diretório com `undefined` leva a `retry`;
  - no sucesso, o cookie `__Host-sf_session` tem `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/`, e o banco tem uma sessão;
  - cada login gera um token diferente;
  - `/api/me` sem cookie dá `401`, e com sessão devolve o nível e as permissões;
  - **(Review Focus 1)** depois de tirar os cargos no diretório falso, a próxima chamada a `/api/me` devolve `level: 'member'`;
  - **(Review Focus 2)** depois de mudar `isOwner` para `false`, as permissões de módulo somem;
  - um membro que saiu leva a `401` e a sessão é apagada;
  - `POST /api/logout` sem CSRF ou com o token de outra sessão dá `403`, e com o token certo dá `204`;
  - a 11ª tentativa em `/auth/login` no minuto dá `429`;
  - nenhum log capturado contém o token falso de acesso, o `clientSecret` ou o token de sessão.
- [ ] **Step 2: Rodar.** `npx vitest run interfaces/dashboard/auth` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add discord login, sessions and csrf`

### Task 8: `/api/status`, tempo real e ligação no processo

**Files:**

- Create:
  - `interfaces/dashboard/live.ts` e `.test.ts`
  - `interfaces/dashboard/status-route.ts`
- Modify:
  - `interfaces/dashboard/server.ts`
  - `interfaces/discord/main.ts` (inicia e encerra o painel)
  - `CHANGELOG.md`

**Interfaces:**

- Produces:
  - `GET /api/status`, só para `developer` e `owner`. Para os outros, responde `403`. Devolve `{ connection, uptimeMs, modules: [{ id, state }] }`.
  - **`class LiveHub`** em `live.ts`, com dependências de autenticação, relógio e `CoreHandle`:
    - aceita conexões em `GET /api/live` (`@fastify/websocket`). Antes do upgrade, recusa com `401` sem sessão e com `403` quando o `Origin` é diferente de `publicUrl` ou quando já há 5 conexões da sessão;
    - envia `status` a quem é `developer` ou `owner` quando chega `core.discord.connection.changed` ou `core.module.state.changed`;
    - envia `config.changed` `{ moduleId, version }` a quem tem alguma permissão com o prefixo `${moduleId}.`;
    - envia `presence` `{ users: [{ userId, screen }] }` a quem tem alguma permissão nomeada. A lista tem só pessoas com permissão nomeada e nenhuma pessoa duplicada (cada uma aparece com a última tela informada);
    - recalcula o ator a cada envio pelo diretório;
    - revalida as conexões a cada 60 s e encerra a pessoa com `session.ended` seguido do fechamento `4401`;
    - quem viola os limites é fechado com `4408`, e um `type` desconhecido com `4400`;
    - `revokeSession(idHash)` envia `session.ended` e fecha, e o `POST /api/logout` o chama.
  - Em `main.ts`:
    - com `loadPanelEnvironment` não nulo, chama `startDashboard`, depois de `startCore` e antes do login;
    - um erro na configuração ou no início do painel só gera `logger.error` com os nomes das variáveis ou `error.name`;
    - no encerramento, fecha o painel antes de `core.stop()`;
    - `staticDir` é `interfaces/dashboard/app/dist`.

- [ ] **Step 1: Testes que falham.** Usam WebSocket real em `127.0.0.1` numa porta `0`, com o cliente `ws` que vem do plugin.
  - sem cookie, o upgrade dá `401`;
  - com `Origin` `https://outro.example.com`, dá `403`;
  - a 6ª conexão da mesma sessão é recusada;
  - um membro não recebe `presence` nem `status`, e o dono recebe `status`;
  - `config.changed` de `moderation` chega a quem tem `moderation.config.manage` e não chega a um membro;
  - **(Review Focus 3)** duas conexões da mesma pessoa aparecem uma vez na presença, e fechar uma mantém a pessoa;
  - fechar as duas a remove depois de 30 s, com relógio falso;
  - 11 mensagens no mesmo segundo, repetidas até a 10ª violação, fecham a conexão com `4408`;
  - `{"type":"x"}` fecha com `4400`;
  - uma mensagem de 300 bytes é recusada;
  - `screen: "../a"` é recusado;
  - o logout fecha a conexão depois de `session.ended`;
  - a revalidação fecha a conexão de quem saiu do servidor;
  - `/api/status` dá `403` para a equipe e `200` para o dono.
- [ ] **Step 2: Rodar.** `npx vitest run interfaces/dashboard` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: CHANGELOG do PR I.**
- [ ] **Step 6: Commit.** `feat(dashboard): add live channel with presence and bot status`

---

## PR J

### Task 9: Estrutura do app e CI

**Files:**

- Create:
  - `interfaces/dashboard/app/package.json`
  - `interfaces/dashboard/app/package-lock.json`
  - `interfaces/dashboard/app/tsconfig.json`
  - `interfaces/dashboard/app/vite.config.ts`
  - `interfaces/dashboard/app/index.html`
  - `interfaces/dashboard/app/src/main.tsx`
  - `interfaces/dashboard/app/src/test-setup.ts`
- Modify:
  - `package.json`
  - `tsconfig.json` (`exclude` do app)
  - `vitest.config.ts` (`exclude` do app)
  - `eslint.config.js`
  - `.gitignore` (`interfaces/dashboard/app/dist/`)
  - `.github/workflows/ci.yml`

**Interfaces:**

- Produces:
  - Os scripts do app: `typecheck` (`tsc --noEmit`), `test` (`vitest run`, jsdom), `build` (`vite build`) e `check` (os três).
  - Os scripts na raiz:
    - `app:install` = `npm ci --prefix interfaces/dashboard/app`;
    - `app:check` = `npm run check --prefix interfaces/dashboard/app`;
    - `check` passa a terminar com `&& npm run app:check`.
  - **ESLint:** um bloco para `interfaces/dashboard/app/**/*.{ts,tsx}` com o `tsconfig` do app e `no-restricted-syntax`, que proíbe `JSXAttribute[name.name='dangerouslySetInnerHTML']` com a mensagem `Use texto; a CSP e a revisão proíbem HTML bruto.`.
  - **CI:** depois de `npm ci`, roda `npm run app:install`. A `cache-dependency-path` cobre os dois lockfiles.
  - **Vite:** `build.outDir: 'dist'`, sem `sourcemap` em produção e sem `define` de variáveis de ambiente. O app não lê nada de `import.meta.env`.
  - `index.html` sem script inline.

- [ ] **Step 1: Criar** a estrutura com um componente `App` vazio e um teste `renders without crashing`.
- [ ] **Step 2: Rodar** `npm run app:install` e depois `npm run check` → PASS, com o build gerando `dist/index.html`.
- [ ] **Step 3: Conferir** que `grep -r "SESSION_SECRET\|CLIENT_SECRET" interfaces/dashboard/app/dist` não encontra nada.
- [ ] **Step 4: Commit.** `build(dashboard): scaffold panel app and run it in ci`

### Task 10: Login, menu, perfil e visão geral

**Files:**

- Create em `interfaces/dashboard/app/src/`:
  - `api.ts`
  - `session.tsx`
  - `routes/{Login,Profile,Overview,NoPermission}.tsx`
  - `components/Menu.tsx`
  - testes `*.test.tsx`

**Interfaces:**

- Produces:
  - `apiFetch<T>(path, init?)`, com `credentials: 'same-origin'`, cabeçalho `X-CSRF-Token` nos métodos de alteração e `Content-Type: application/json`. Lança `ApiError { status, code, message }`.
  - `useMe()`, com TanStack Query na chave `['me']`. Um `401` leva a `/login`.
  - `Menu`, que mostra "Visão geral" só para `developer` e `owner`. "Meu perfil" aparece sempre.
  - `Login`: botão "Entrar com Discord" que leva a `/auth/login`. Com `?error=`, mostra o texto fixo correspondente das Global Constraints (`dev_not_member`, `not_member`, `retry` e `failed`).
  - `Profile`: avatar, nome, ID e nível em português (Desenvolvedor, Dono, Equipe, Membro).
  - `Overview`: os dados de `/api/status`. Um `403` leva a `NoPermission` com `Sem permissão.`.
  - O `MotionConfig` com `reducedMotion="user"` fica na raiz, e as transições de rota usam `AnimatePresence`.

- [ ] **Step 1: Testes que falham**, com `fetch` falso:
  - para um membro, o menu não mostra "Visão geral", e para o dono mostra;
  - cada `?error=` mostra o texto exato;
  - o perfil mostra "Membro";
  - um `401` em `/api/me` leva à tela de login;
  - `apiFetch('POST', …)` envia o `X-CSRF-Token` de `/api/me`.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add login, profile and overview screens`

### Task 11: Conexão ao vivo, presença e documentação final

**Files:**

- Create em `interfaces/dashboard/app/src/`: `live.ts`, `components/{ReconnectBanner,PresenceList}.tsx` e os testes
- Modify:
  - `README.md`
  - `CONTRIBUTING.md`
  - `docs/ROADMAP.md`
  - `CHANGELOG.md`

**Interfaces:**

- Produces:
  - `useLive()`, que abre `wss://${location.host}/api/live`, ou `ws://` em `http:` no desenvolvimento local.
    - Reconecta com espera de 1 s, dobrando até 30 s.
    - Ao reconectar, invalida todas as consultas.
    - Com `config.changed`, invalida `['config', moduleId]`. Com `status`, atualiza `['status']`.
    - Com `session.ended`, limpa o cache e vai para `/login`.
    - A cada troca de rota, envia `{ type: 'presence', screen }`, com o `screen` derivado da rota (`profile`, `overview`).
  - `ReconnectBanner`, que mostra `Reconectando…` enquanto a conexão está fechada.
  - `PresenceList`, com os avatares de quem está online e a tela de cada um, animada com Motion.

- [ ] **Step 1: Testes que falham**, com um WebSocket falso:
  - a queda mostra `Reconectando…`, e as esperas são 1 s, 2 s, 4 s… até 30 s;
  - `config.changed` invalida a chave certa;
  - `session.ended` leva ao login;
  - a troca de rota envia a presença;
  - a presença lista as pessoas recebidas.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Documentação.**
  - **README:** uma seção "Painel" com:
    - as variáveis;
    - o cadastro de `https://painel.example.com/auth/callback` como endereço de retorno no Discord Developer Portal;
    - o build (`npm run app:install` e `npm run build --prefix interfaces/dashboard/app`);
    - a hospedagem: Caddy (`reverse_proxy 127.0.0.1:3000`), Nginx (com `Upgrade`/`Connection` para o WebSocket) e túnel. Para `PANEL_TRUST_PROXY`, `127.0.0.1` no proxy local e o IP do conector no túnel;
    - a regra de filiação dos desenvolvedores, com o motivo;
    - o teste manual da etapa 1.
  - **CONTRIBUTING:** a mesma regra de filiação, para quem quer participar.
  - **ROADMAP:** a etapa 1 implementada, com o teste manual pendente.
  - **CHANGELOG** do PR J.
- [ ] **Step 5: Rodar.** `npm run check` → PASS.
- [ ] **Step 6: Teste manual** (pessoa mantenedora), atrás de um proxy HTTPS:
  1. Um membro comum entra e vê só "Meu perfil".
  2. Uma conta que não é membro recebe a mensagem certa.
  3. O dono vê a visão geral.
  4. Duas abas aparecem como uma pessoa na presença.
  5. Desconectar a rede mostra `Reconectando…`.
  6. O logout em uma aba leva a outra para o login.
- [ ] **Step 7: Commit.** `feat(dashboard): add live connection, presence and panel docs`
