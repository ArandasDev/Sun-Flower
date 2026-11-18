# Spec — Fase 2, etapa 1: moderação contra phishing

**Status:** Aprovada em 2026-11-17
**Fase:** [ROADMAP — Fase 2](../ROADMAP.md#fase-2--moderação)
**Decisões aplicadas:** [0006](../decisions/0006-permission-model.md), [0007](../decisions/0007-event-bus-delivery.md), [0009](../decisions/0009-api-version-compatibility.md), [0010](../decisions/0010-stay-in-other-guilds.md), [0011](../decisions/0011-discord-events.md), [0012](../decisions/0012-guild-actions.md), [0013](../decisions/0013-module-storage.md), [0014](../decisions/0014-command-options-and-runtime-config.md), [0015](../decisions/0015-phishing-policy.md)

## 1. Objetivo

O módulo `moderation` detecta links de golpe e phishing nas mensagens do servidor, apaga a mensagem, silencia a conta e alerta a equipe. A equipe revisa e reverte os casos, mantém as listas de domínios e aplica advertências, timeouts, expulsões e banimentos manuais por comandos de barra.

Para isso, o Core ganha cinco extensões aditivas ao contrato de módulo, e `CORE_API_VERSION` passa de `1.0.0` para `1.1.0`.

**Fora do escopo desta etapa:**

- spam e flood sem link (etapa 2 da Fase 2, com spec própria, antes da `v0.2.0`);
- convites para outros servidores, anexos, imagens e QR codes;
- listas públicas externas de phishing;
- painel administrativo (Fase 3).

## 2. Componentes

```text
shared/contracts/
├── module.ts          ModuleManifest.capabilities, ModuleContext.guild/storage, config.set
├── commands.ts        Subcomandos, grupos, opções e leitores de opções
├── guild.ts           GuildActions, GuildActionError
├── storage.ts         ModuleStorage
└── discord-events.ts  Payloads de discord.message.created e discord.message.updated
core/
├── module-registry/   Valida capabilities; aplica migrações do módulo no register
├── storage/           Migrações de módulo, validação de prefixo e ModuleStorage
├── configuration/     config.set com validação pelo configSchema
├── event-bus/         Prefixo discord. reservado ao Core
└── application/       staff grant | revoke | grants
interfaces/discord/
├── client.ts          Intents novos
├── commands.ts        Tradução de subcomandos e opções para o discord.js
├── messages.ts        Publicação dos eventos discord.message.*
└── guild-actions.ts   Implementação de GuildActions
modules/moderation/
├── manifest.json
├── index.ts           Ciclo de vida e ligação das partes
├── detection/         Extração de links, normalização, sinais e pontuação (código puro)
├── cases.ts           Casos e listas de domínios sobre o storage
├── responder.ts       Ações automáticas e alertas
├── commands/          /mod e seus subcomandos
├── migrations/0001-moderation.sql
└── README.md
```

## 3. Extensões do Core

### 3.1. Eventos do Discord ([0011](../decisions/0011-discord-events.md))

- A interface publica `discord.message.created` e `discord.message.updated`, com `source` igual a `core` e `version` igual a `1`.
- Payload de `discord.message.created`:

  ```ts
  interface DiscordMessagePayload {
    readonly messageId: string;
    readonly messageUrl: string;
    readonly channelId: string;
    readonly authorId: string;
    readonly authorRoleIds: readonly string[];
    readonly authorJoinedAt: string | null; // ISO 8601; null se o membro não estiver em cache
    readonly authorAccountCreatedAt: string; // ISO 8601
    readonly content: string;
  }
  ```

- `discord.message.updated` usa o mesmo payload, com o conteúdo novo. Edições que não mudam o conteúdo, como a geração de pré-visualização de links, não são publicadas.
- `context` do evento traz `userId` e `channelId`.
- A interface só publica mensagens do servidor `DISCORD_GUILD_ID`, de autores que não são bots nem webhooks.
- O Event Bus recusa a publicação de qualquer evento `discord.*` por um módulo. Assinar continua exigindo a declaração em `events.subscribes`.
- O logger inclui `content` entre os campos redigidos.
- Intents: `Guilds`, `GuildMessages`, `GuildMembers` e `MessageContent`.
- Detecção do intent desligado: se as primeiras 20 mensagens com autor humano chegarem todas com conteúdo vazio e sem anexos, a interface registra um erro, uma única vez, pedindo para ativar o _Message Content Intent_.

### 3.2. Serviço `guild` ([0012](../decisions/0012-guild-actions.md))

```ts
type GuildActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'forbidden' | 'not_found' | 'failed' };

interface GuildActions {
  deleteMessage(channelId: string, messageId: string): Promise<GuildActionResult>;
  timeout(userId: string, durationMs: number, reason: string): Promise<GuildActionResult>;
  removeTimeout(userId: string): Promise<GuildActionResult>;
  kick(userId: string, reason: string): Promise<GuildActionResult>;
  ban(userId: string, reason: string, deleteMessageSeconds: number): Promise<GuildActionResult>;
  unban(userId: string): Promise<GuildActionResult>;
  sendMessage(channelId: string, content: string): Promise<GuildActionResult>;
  sendDirectMessage(userId: string, content: string): Promise<GuildActionResult>;
  getMemberRoleIds(userId: string): Promise<readonly string[] | undefined>;
}
```

- O manifesto ganha `capabilities: string[]`, opcional, com padrão `[]`. Valores aceitos: `guild.moderate` e `guild.message`. Um valor desconhecido invalida o manifesto.
- `guild.moderate` libera todas as ações menos `sendMessage`. `guild.message` libera `sendMessage`.
- Sem a capacidade, a chamada lança `CapabilityError` e o Core registra a recusa com o módulo e a ação.
- Ações contra um desenvolvedor do bot ou contra o próprio bot devolvem `forbidden` sem chamar o Discord.
- `timeout` aceita de 1 minuto a 28 dias. Fora disso, devolve `failed` sem chamar o Discord.
- `ban` aceita `deleteMessageSeconds` de 0 a 604800 (7 dias).
- Toda ação executada gera um log `info` com `module`, `action` e `reason`. IDs de usuário não entram no log ([0008](../decisions/0008-logging-and-validation.md)).
- O `reason` é enviado ao log de auditoria do Discord, truncado em 512 caracteres.
- Mensagens enviadas usam `allowedMentions: { parse: [] }`.
- Cada chamada ao Discord tem limite de 10 segundos e devolve `failed` se for excedido.

### 3.3. Serviço `storage` ([0013](../decisions/0013-module-storage.md))

```ts
type SqlValue = string | number | bigint | null;

interface ModuleStorage {
  run(
    sql: string,
    params?: readonly SqlValue[],
  ): { readonly changes: number; readonly lastInsertRowid: number | bigint };
  get<T>(sql: string, params?: readonly SqlValue[]): T | undefined;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
}
```

- Migrações em `modules/<id>/migrations/NNNN-<nome>.sql`, com `NNNN` de 4 dígitos, sem lacunas e começando em `0001`.
- O Core guarda as migrações aplicadas na tabela `module_migrations (module_id, version, applied_at)`, criada pela migração `0002` do Core.
- No `register`, o Core aplica as pendentes em ordem, cada uma numa transação, antes de chamar o `register` do módulo.
- Validação de prefixo: todo nome em `CREATE TABLE`, `CREATE INDEX`, `CREATE VIEW` e `CREATE TRIGGER`, com ou sem `IF NOT EXISTS`, precisa começar com `<id>_`. A validação é feita sobre o texto da migração, sem comentários, antes de aplicá-la. `ATTACH`, `DETACH` e `PRAGMA` são recusados.
- Falha de validação ou de aplicação leva o módulo a `FAILED` com o motivo no log, e os demais continuam funcionando.
- Migrações do Core: a aplicação passa a usar `BEGIN IMMEDIATE`, o que elimina a corrida entre `npm run staff` e `npm start` num banco novo.

### 3.4. Opções de comando ([0014](../decisions/0014-command-options-and-runtime-config.md))

```ts
type CommandOptionType = 'string' | 'integer' | 'boolean' | 'user' | 'channel' | 'role';

interface CommandOption {
  readonly name: string;
  readonly description: string;
  readonly type: CommandOptionType;
  readonly required?: boolean;
  readonly minValue?: number; // integer
  readonly maxValue?: number; // integer
  readonly maxLength?: number; // string
  readonly choices?: readonly string[]; // somente 'string'; o nome de cada escolha é igual ao valor
}

interface Subcommand {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly CommandOption[];
}

interface SubcommandGroup {
  readonly name: string;
  readonly description: string;
  readonly subcommands: readonly Subcommand[];
}

interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly CommandOption[];
  readonly subcommands?: readonly Subcommand[];
  readonly groups?: readonly SubcommandGroup[];
  handle(interaction: CommandInteraction): Promise<void>;
}

interface CommandInteraction {
  readonly actor: Actor;
  readonly channelId: string;
  readonly subcommandGroup: string | undefined;
  readonly subcommand: string | undefined;
  readonly options: {
    getString(name: string): string | undefined;
    getInteger(name: string): number | undefined;
    getBoolean(name: string): boolean | undefined;
    getUser(name: string): string | undefined; // ID do usuário
    getChannel(name: string): string | undefined; // ID do canal
    getRole(name: string): string | undefined; // ID do cargo
  };
  reply(content: string, options?: ReplyOptions): Promise<void>;
}
```

- Um comando usa `options` ou `subcommands`/`groups`, nunca os dois. Isso é validado no registro do comando.
- Nomes seguem as regras do Discord: 1 a 32 caracteres, minúsculos, `a-z`, `0-9`, `-` e `_`. No máximo 25 opções, 25 subcomandos e 25 grupos.
- Os campos novos são opcionais, e o `ping` continua funcionando sem alteração.

### 3.5. Configuração em tempo de execução ([0014](../decisions/0014-command-options-and-runtime-config.md))

- `config.set(partial)` mescla `partial` com a configuração atual, valida o resultado pelo `configSchema` e grava em `module_config.settings`. Um resultado inválido lança `ConfigValidationError` e não grava nada.
- O próximo `config.get()` devolve o valor novo.

### 3.6. Permissões por cargo pelo comando local

- `npm run staff -- grant <permissão> <ID do cargo>`
- `npm run staff -- revoke <permissão> <ID do cargo>`
- `npm run staff -- grants`, que lista as associações.
- `grant` recusa permissões `core.*` e nomes fora do formato `<module>.<resource>.<action>`.
- `grant` não verifica se a permissão existe num manifesto, já que o comando roda sem carregar módulos, mas avisa quando nenhum módulo descoberto a declara.

## 4. Módulo `moderation`

### 4.1. Manifesto

```json
{
  "id": "moderation",
  "name": "Moderation",
  "description": "Phishing detection and moderation actions",
  "version": "1.0.0",
  "apiVersion": "1.1.0",
  "entrypoint": "index.ts",
  "enabledByDefault": true,
  "dependencies": [],
  "capabilities": ["guild.moderate", "guild.message"],
  "permissions": [
    "moderation.config.manage",
    "moderation.domains.manage",
    "moderation.cases.read",
    "moderation.cases.revert",
    "moderation.actions.warn",
    "moderation.actions.timeout",
    "moderation.actions.kick",
    "moderation.actions.ban"
  ],
  "events": {
    "subscribes": ["discord.message.created", "discord.message.updated"],
    "publishes": ["moderation.case.created", "moderation.case.reverted"]
  }
}
```

### 4.2. Configuração (`configSchema`)

| Campo                        | Tipo       | Padrão  | Regra                                    |
| ---------------------------- | ---------- | ------- | ---------------------------------------- |
| `alertChannelId`             | `string`   | ausente | ID de canal (17 a 20 dígitos)            |
| `timeoutMinutes`             | `integer`  | `60`    | 1 a 40320                                |
| `thresholds.confirmed`       | `integer`  | `80`    | 1 a 1000, maior que `suspicious`         |
| `thresholds.suspicious`      | `integer`  | `40`    | 1 a 1000                                 |
| `weights.<sinal>`            | `integer`  | §4.4    | 0 a 1000                                 |
| `exemptRoleIds`              | `string[]` | `[]`    | IDs de cargo, no máximo 25               |
| `newAccountDays`             | `integer`  | `7`     | 0 a 365                                  |
| `newMemberHours`             | `integer`  | `24`    | 0 a 720                                  |
| `multiChannel.channels`      | `integer`  | `3`     | 2 a 25                                   |
| `multiChannel.windowSeconds` | `integer`  | `60`    | 10 a 3600                                |
| `baitTerms`                  | `string[]` | §4.4    | no máximo 100, cada um com até 32 letras |

### 4.3. Extração e normalização de links

- Fontes:
  - URLs com `http://` ou `https://`, inclusive com host IPv4 literal (o domínio é o IP na forma canônica, por exemplo `https://0x7f.0.0.1/` → `127.0.0.1`);
  - domínios sem esquema seguidos ou não de caminho (`golpe.gift/abc`), só quando o TLD tem exatamente 2 letras ASCII (TLD de país) ou está na lista de TLDs genéricos comuns: `com net org info biz io gg app dev xyz gift link click site online top shop store live tv me co club fun win bet vip pro icu cc ws ru su tk ml ga cf gq buzz monster rest cyou sbs lol pw`. TLDs `xn--` ou Unicode nunca valem sem esquema. Assim `disco.amei` e `disco.tá` não são links, e `golpe.gift` e `dlscord.ru` são. URLs com esquema e links markdown aceitam qualquer TLD válido (WHATWG);
  - links markdown `[texto](url)`;
  - URLs entre `<` e `>`;
  - variações com `\` ou espaços em volta do ponto não são reconstruídas (fora do escopo).
- Normalização: o host é canonicalizado como num navegador, pelo parser WHATWG (`URL`): minúsculas, IDNA, decodificação de `%`, formas de IPv4, credenciais (`usuário@`) e porta tratadas como o navegador as trata. Depois, remoção de `www.` e do ponto final. Um host que `domainToASCII` de `node:url` não aceita é descartado.
- Comparação com as listas: o domínio e cada domínio pai, até o segundo nível (`a.b.golpe.com` → `b.golpe.com` → `golpe.com`).
- Ordem e limites: a extração devolve primeiro as fontes clicáveis (links markdown e URLs com esquema, na ordem em que aparecem) e depois os domínios sem esquema, até 50 candidatos. A pontuação descarta os permitidos e analisa no máximo 20 domínios distintos não permitidos. Assim, domínios soltos usados como enchimento não escondem o link real. São lidos no máximo 4000 caracteres de conteúdo; o resto é ignorado.
- Lista inicial de permitidos: os domínios oficiais das marcas protegidas (§4.4) e os domínios conhecidos como seguros `discord.js.org`, `discordjs.dev`, `steamdb.info`, `steamcharts.com`, `disboard.org` e `discogs.com`. Esses sites legítimos seriam marcados como `lookalike`, mas não são marcas protegidas. Todos são inseridos a cada início como `allow` (`INSERT OR IGNORE`, `added_by` nulo), e a equipe ainda pode bloqueá-los.

### 4.4. Sinais e pontuação

| Sinal (`weights.<sinal>`) | Pontos | Quando                                                                                                     |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `blocked`                 | 100    | Domínio ou domínio pai na lista de bloqueados.                                                             |
| `lookalike`               | 60     | Domínio imita uma marca protegida (abaixo).                                                                |
| `masked`                  | 40     | Link markdown cujo texto contém um domínio diferente do domínio do link.                                   |
| `multiChannel`            | 50     | O mesmo domínio, pelo mesmo autor, em `multiChannel.channels` canais dentro de `windowSeconds`.            |
| `bait`                    | 30     | Algum termo de `baitTerms` no texto fora dos links, junto com um link não permitido.                       |
| `massMention`             | 20     | `@everyone` ou `@here` no texto, junto com um link não permitido.                                          |
| `newAccount`              | 15     | Conta com menos de `newAccountDays` ou entrada há menos de `newMemberHours`, junto com link não permitido. |

- Cada sinal conta uma vez por mensagem. A pontuação é a soma.
- Links de domínios permitidos não produzem nenhum sinal e não contam como "link não permitido".
- Mensagem sem link não permitido tem pontuação 0.
- Termos de isca iniciais: `nitro`, `free`, `grátis`, `gratis`, `gift`, `presente`, `airdrop`, `steam`, `giveaway`, `sorteio`, `claim`, `resgate`. A comparação ignora maiúsculas e acentos e considera só o texto fora dos links (`discord.gift` não conta como `gift`). Os nomes das marcas protegidas (`discord`, `steam`) nunca contam como isca, mesmo em `baitTerms`: falar da marca é conversa comum (`compra na steam`). `steam gift` com um link de imitação ainda conta, por `gift`.

**Marcas protegidas:** `discord` (`discord.com`, `discord.gg`, `discordapp.com`, `discordapp.net`, `discord.media`, `discord.new`, `discord.gift`, `discordstatus.com`) e `steam` (`steamcommunity.com`, `steampowered.com`, `steamstatic.com`, `s.team`). Esses domínios formam a lista inicial de permitidos.

**Imitação (`lookalike`):** o domínio não é oficial e:

1. o domínio inteiro, depois de passar por um esqueleto (acentos e diacríticos removidos, letras cirílicas e gregas parecidas → latinas, `0→o`, `1→l`, `3→e`, `5→s`, `rn→m`, `vv→w`, sem hífens e pontos), contém o nome da marca; ou
2. algum rótulo que não seja o TLD, ou alguma parte desse rótulo separada por hífen, depois do esqueleto e com pelo menos 4 letras, tem distância de Levenshtein entre 1 e 2 de um alvo: o nome da marca ou o rótulo principal de um domínio oficial (`dlscord`, `steamcomunity` comparado com `steamcommunity`).

Alvos de até 5 letras (`steam`) usam só a regra 1: a distância 1 marcaria palavras comuns (`team`, `steel`). Alvos mais longos usam as duas regras. Hosts IPv4 nunca são imitação.

**Níveis:**

| Pontuação                  | Nível        | Resposta automática                                            |
| -------------------------- | ------------ | -------------------------------------------------------------- |
| `>= thresholds.confirmed`  | `confirmed`  | Apaga a mensagem, aplica timeout de `timeoutMinutes` e alerta. |
| `>= thresholds.suspicious` | `suspicious` | Apenas alerta, com link para a mensagem.                       |
| menor                      | —            | Nada.                                                          |

**Isenções:** autores com algum cargo de `exemptRoleIds` e desenvolvedores do bot não são analisados. Para saber se o autor é desenvolvedor, o módulo usa `permissions.isDeveloper(userId)`, um método novo e somente de leitura do serviço `permissions`.

**Estado da regra de vários canais:** mapa em memória `autor → [(domínio, canal, instante)]`, com no máximo 1000 autores e 50 entradas por autor. Cada par (domínio, canal) ocupa uma única entrada: repetir o domínio no mesmo canal só atualiza o instante, para que mensagens repetidas num canal não empurrem para fora as ocorrências em outros canais. As entradas fora da janela são descartadas a cada análise e por uma limpeza a cada 60 segundos. O estado se perde ao reiniciar.

**Uma mensagem por caso:** se a mesma mensagem já gerou caso (`message_id`), uma edição só cria caso novo se o nível subir.

### 4.5. Persistência (`migrations/0001-moderation.sql`)

```sql
CREATE TABLE moderation_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('automatic', 'manual')),
  level TEXT NULL CHECK (level IS NULL OR level IN ('confirmed', 'suspicious')),
  action TEXT NOT NULL CHECK (action IN ('none', 'delete_timeout', 'warn', 'timeout', 'kick', 'ban')),
  target_user_id TEXT NOT NULL,
  actor_user_id TEXT NULL,
  channel_id TEXT NULL,
  message_id TEXT NULL,
  domains TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(domains)),
  signals TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(signals)),
  score INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(outcome)),
  status TEXT NOT NULL CHECK (status IN ('open', 'actioned', 'reverted', 'dismissed')),
  timeout_until TEXT NULL,
  created_at TEXT NOT NULL,
  reverted_by TEXT NULL,
  reverted_at TEXT NULL
);
CREATE INDEX moderation_cases_target ON moderation_cases (target_user_id, created_at);
CREATE INDEX moderation_cases_message ON moderation_cases (message_id);

CREATE TABLE moderation_domains (
  domain TEXT PRIMARY KEY,
  list TEXT NOT NULL CHECK (list IN ('block', 'allow')),
  added_by TEXT NULL,
  added_at TEXT NOT NULL
);
```

- `outcome` registra o resultado de cada etapa da resposta, por exemplo `{"delete":"ok","timeout":"forbidden"}`.
- A lista inicial de permitidos é inserida pelo módulo no `initialize`, com `INSERT OR IGNORE` e `added_by` nulo. Um domínio oficial removido pela equipe é reinserido no próximo início; para tirá-lo de vez, é preciso bloqueá-lo, e o bloqueio prevalece.
- O conteúdo das mensagens não é guardado.
- `reason` de casos automáticos é gerado pelo módulo (por exemplo, `phishing: lookalike, bait`). Em casos manuais, é o texto da pessoa, com até 512 caracteres.

### 4.6. Resposta automática e alerta

1. Para `confirmed`: o módulo chama `deleteMessage` e `timeout` de forma independente; uma falha não impede a outra. Para `suspicious`: nenhuma ação.
2. Grava o caso com `status` `actioned` (`confirmed`) ou `open` (`suspicious`) e o `outcome`.
3. Publica `moderation.case.created` com `{ caseId, kind, level, action }`.
4. Envia o alerta em `alertChannelId`. Sem canal configurado, registra um aviso no log, uma vez por início.

Formato do alerta:

```text
🚨 Caso #12 — violação confirmada
Usuário: <@ID> · Canal: <#ID>
Domínios: `dlscord-gift.com`
Sinais: lookalike (60), bait (30) = 90
Ação: mensagem apagada, timeout de 60 min
Reverter: /mod case revert 12
```

- Domínios no alerta vão entre crases, para o Discord não gerar link clicável.
- Falhas aparecem na linha de ação, por exemplo `timeout não aplicado (sem permissão)`. Em `confirmed`, se a mensagem não foi apagada, a linha `Mensagem: <link>` vem logo depois da linha de ação, para a equipe apagá-la à mão.
- Em `suspicious`, a linha de ação traz o link da mensagem e a sugestão `/mod case dismiss 12` ou `/mod timeout`.

### 4.7. Comandos `/mod`

Todas as respostas são efêmeras.

| Comando                                                                | Permissão                    |
| ---------------------------------------------------------------------- | ---------------------------- |
| `/mod config view`                                                     | `moderation.config.manage`   |
| `/mod config alert-channel <canal>`                                    | `moderation.config.manage`   |
| `/mod config timeout <minutos>`                                        | `moderation.config.manage`   |
| `/mod config thresholds <confirmado> <suspeito>`                       | `moderation.config.manage`   |
| `/mod config exempt-role <cargo> <add\|remove>`                        | `moderation.config.manage`   |
| `/mod domain block <domínio>` · `allow <domínio>` · `remove <domínio>` | `moderation.domains.manage`  |
| `/mod domain list [lista]`                                             | `moderation.domains.manage`  |
| `/mod case view <número>`                                              | `moderation.cases.read`      |
| `/mod case list [usuário]`                                             | `moderation.cases.read`      |
| `/mod case revert <número> [allow-domain]`                             | `moderation.cases.revert`    |
| `/mod case dismiss <número>`                                           | `moderation.cases.revert`    |
| `/mod warn <usuário> <motivo>`                                         | `moderation.actions.warn`    |
| `/mod timeout <usuário> <minutos> <motivo>`                            | `moderation.actions.timeout` |
| `/mod kick <usuário> <motivo>`                                         | `moderation.actions.kick`    |
| `/mod ban <usuário> <motivo> [apagar-dias]`                            | `moderation.actions.ban`     |

- `exempt-role` usa uma opção `string` com as escolhas `add` e `remove`.
- `domain list` mostra no máximo 50 domínios por lista. `case list` mostra os 10 casos mais recentes, do usuário quando informado.
- `domain block` e `allow` validam o domínio pela mesma normalização de §4.3. Bloquear um domínio permitido o move para a lista de bloqueados, e vice-versa.
- `warn` grava o caso e tenta `sendDirectMessage` com o motivo. Se a mensagem direta falhar, o caso fica registrado e a resposta informa.
- `apagar-dias` vai de 0 a 7.

**Proteções das ações manuais (`warn`, `timeout`, `kick`, `ban`):** a ação é recusada quando o alvo:

- é a própria pessoa que executa o comando;
- é o bot ou um desenvolvedor do bot (o serviço `guild` também recusa);
- tem um cargo de `exemptRoleIds`;
- tem um cargo com alguma permissão `moderation.*` associada. Para isso, o módulo usa `permissions.hasAnyGrant(roleIds, prefix)`, um método novo e somente de leitura, e o serviço `guild` ganha `getMemberRoleIds(userId)`, que devolve `undefined` se a pessoa não for membro.

`timeout` e `kick` exigem que o alvo seja membro. `ban` aceita um usuário que não é membro.

**Reversão (`case revert`):**

| Ação do caso     | Reversão                                              |
| ---------------- | ----------------------------------------------------- |
| `delete_timeout` | `removeTimeout`; a mensagem apagada não é recuperada. |
| `timeout`        | `removeTimeout`.                                      |
| `ban`            | `unban`.                                              |
| `kick`           | Nenhuma ação no Discord; só o status muda.            |
| `warn`, `none`   | Nenhuma ação no Discord; só o status muda.            |

- Só casos `actioned` ou `open` podem ser revertidos. `dismiss` só vale para casos `open`.
- `allow-domain` move para a lista de permitidos os domínios do caso que não sejam marcas protegidas imitadas. Para domínios marcados como `lookalike`, a opção é recusada com uma explicação.
- A reversão grava `reverted_by` e `reverted_at` e publica `moderation.case.reverted` com `{ caseId }`.

## 5. Erros

| Situação                                                     | Comportamento                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler de mensagem lança erro ou excede 5 s                 | O Event Bus registra a falha sem conteúdo ([0007](../decisions/0007-event-bus-delivery.md)). Se o handler lançou erro, a mensagem não é analisada; se só excedeu 5 s (Discord lento), a resposta (ações, caso e alerta) ainda termina normalmente. |
| Discord recusa uma ação                                      | `GuildActionResult` com o erro; o caso registra o `outcome`, e o alerta ou a resposta informa.                                                                                                                                                     |
| Ação manual sem permissão                                    | Resposta efêmera `Você não tem permissão para isso.`; nada é executado.                                                                                                                                                                            |
| Opção inválida (domínio malformado, valor fora do intervalo) | Resposta efêmera com o motivo da validação.                                                                                                                                                                                                        |
| Migração do módulo inválida                                  | O módulo vai para `FAILED`; os demais continuam funcionando.                                                                                                                                                                                       |
| `config.set` inválido                                        | Resposta efêmera com o campo inválido; nada é gravado.                                                                                                                                                                                             |
| Intent `MessageContent` desligado                            | Erro no log, uma vez, pedindo a ativação (§3.1).                                                                                                                                                                                                   |

## 6. Divisão em Pull Requests

1. **Contratos do Core:** opções e grupos de comando, `config.set`, `storage` com migrações de módulo e validação de prefixo, migração `0002` do Core, `BEGIN IMMEDIATE`, `permissions.isDeveloper` e `hasAnyGrant`, `staff grant | revoke | grants`, `capabilities` no manifesto e `CORE_API_VERSION` `1.1.0`.
2. **Interface Discord:** intents, eventos `discord.message.*` com o prefixo reservado, detecção do intent desligado, tradução de opções para o `discord.js` e o serviço `guild`.
3. **Módulo `moderation`, detecção e casos:** manifesto, migração, extração, normalização, sinais, pontuação, listas, casos, resposta automática e alerta.
4. **Módulo `moderation`, comandos:** `/mod` completo, proteções e reversão.

Cada PR atualiza a documentação afetada e o `CHANGELOG.md`, passa por `npm run check` e pela verificação de vazamento ([CONTRIBUTING §7.2](../../CONTRIBUTING.md#72-verificação-de-vazamento-antes-do-pull-request)).

## 7. Testes

**Detecção (unitários, sem Discord).** Cada sinal tem casos positivos e negativos.

Devem disparar:

- `dlscord.gift`, `discord-nitro.com`, `steamcomunity.com`, `ԁiscord.com` (cirílico) e `discord.com.golpe.ru`;
- link mascarado `[discord.com/nitro](https://golpe.gift)`;
- domínio bloqueado num subdomínio (`a.b.golpe.com` com `golpe.com` bloqueado);
- o mesmo domínio em 3 canais dentro de 60 s;
- isca e `@everyone` junto com link não permitido;
- link não permitido de conta nova.

Não podem disparar (falsos positivos):

- `https://discord.com/channels/...`, `cdn.discordapp.com/attachments/...`, `discord.gg/convite`;
- `https://steamcommunity.com/id/...` oficial;
- "ganhei nitro grátis" sem link, e "nitro" com link de domínio permitido;
- texto sem domínio, como `arquivo.txt` sem TLD válido e `v1.2.3`;
- link legítimo (`github.com`) de membro antigo, com pontuação abaixo de 40;
- o mesmo domínio em 2 canais, ou em 3 canais fora da janela.

Verificações de pontuação e níveis: soma, limites configuráveis, cada sinal contado uma vez, limites de 20 links e 4000 caracteres.

**Core:**

- `storage`: migrações aplicadas uma vez e em ordem, lacuna na numeração rejeitada, prefixo inválido rejeitado (incluindo `IF NOT EXISTS`, `CREATE INDEX` e `CREATE TRIGGER`), `ATTACH` e `PRAGMA` recusados, falha de um módulo não afeta os demais;
- `config.set`: valor válido gravado e lido em seguida, valor inválido não grava nada;
- opções de comando: validação de nomes e limites, `options` junto com `subcommands` rejeitado, leitores devolvem `undefined` para opção ausente;
- Event Bus: módulo publicando `discord.*` é recusado;
- `staff grant`: recusa `core.*` e nome inválido, grava e lista as associações.

**Interface Discord** (com `discord.js` simulado):

- só publica mensagens do servidor configurado e de autores humanos;
- não publica edição sem mudança de conteúdo;
- `guild` recusa ação sem a capacidade, recusa ação contra desenvolvedor e contra o bot, e registra a ação sem conteúdo nem IDs;
- detecção do intent desligado.

**Módulo `moderation`** (com `GuildActions` falso que grava as chamadas):

- `discord.message.created` com golpe gera caso, apaga, aplica timeout e alerta;
- falha ao apagar não impede o timeout, e o `outcome` registra as duas;
- autor isento e desenvolvedor não são analisados;
- edição que sobe o nível gera caso novo, e edição sem mudança de nível não gera;
- cada comando é negado sem a permissão;
- proteções das ações manuais;
- reversão de timeout e de banimento, `allow-domain` e `dismiss`.

**Teste manual no servidor real:**

1. Ativar os intents no Developer Portal.
2. Associar `moderation.*` a um cargo de teste com `npm run staff -- grant`.
3. Configurar o canal de alertas com `/mod config alert-channel`.
4. Bloquear um domínio de teste com `/mod domain block`.
5. Com uma conta sem o cargo, enviar um link desse domínio: a mensagem é apagada, a conta recebe timeout e o alerta aparece.
6. `/mod case revert <número>` remove o timeout.

## 8. Documentação

- `MODULES.md`: `capabilities`, serviço `guild`, serviço `storage` e migrações de módulo, opções de comando, `config.set` e prefixo `discord.` reservado.
- `README.md`: intents privilegiados, `staff grant | revoke | grants` e operação do módulo `moderation`.
- `modules/moderation/README.md`: sinais, configuração, comandos e permissões.
- `ROADMAP.md`: decisões da Fase 2 resolvidas e critérios marcados ao fim da etapa.
- `CHANGELOG.md` em cada PR.

## 9. Critérios de conclusão desta etapa

- [ ] Um link de domínio bloqueado é apagado, a conta recebe timeout e o alerta chega ao canal configurado.
- [ ] Cada sinal de detecção tem testes com casos positivos e negativos.
- [ ] Toda ação automática gera um caso e pode ser revertida por `/mod case revert`.
- [ ] Nenhum comando `/mod` executa sem a permissão correspondente.
- [ ] Um módulo sem a capacidade `guild.moderate` não consegue executar ações de moderação.
- [ ] O conteúdo das mensagens não aparece em nenhum log nem no banco.
