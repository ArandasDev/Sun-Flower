# Spec — Fase 1: Core + Discord mínimo

**Status:** Aprovada em 2026-11-16
**Fase:** [ROADMAP — Fase 1](../ROADMAP.md#fase-1--core--discord-mínimo)
**Decisões aplicadas:** [0001](../decisions/0001-modular-monolith.md), [0002](../decisions/0002-typescript-node.md), [0003](../decisions/0003-single-guild.md), [0005](../decisions/0005-runtime-and-persistence.md), [0006](../decisions/0006-permission-model.md), [0007](../decisions/0007-event-bus-delivery.md), [0008](../decisions/0008-logging-and-validation.md), [0009](../decisions/0009-api-version-compatibility.md)

## 1. Objetivo

O Sun Flower conecta ao servidor configurado, carrega módulos pelo contrato de [MODULES.md](../MODULES.md) e responde ao comando `/ping` do módulo de exemplo.

**Fora do escopo:** moderação, painel, social, música, eventos `discord.*` no Event Bus, acesso de módulos ao banco de dados e alteração de configuração em tempo de execução.

## 2. Componentes

```text
shared/contracts/      Tipos públicos: SunFlowerModule, ModuleManifest, ModuleContext,
                       SunFlowerEvent, Actor, CommandDefinition, CommandInteraction,
                       Logger, CORE_API_VERSION
core/
├── configuration/     Validação do ambiente e das configurações dos módulos
├── infrastructure/    Logger (pino), banco (node:sqlite), migrações
├── module-registry/   Descoberta, validação de manifesto, ordem de dependências, ciclo de vida
├── event-bus/         Publicação e assinatura isoladas
├── permissions/       Desenvolvedores, permission_grants e verificação
└── application/       Montagem da aplicação, encerramento controlado, comando `staff`
interfaces/discord/
├── main.ts            Ponto de entrada (`npm start`)
├── client.ts          Cliente discord.js e intents
├── guild-guard.ts     Restrição ao servidor DISCORD_GUILD_ID
└── commands.ts        Sincronização e despacho de comandos
modules/ping/          manifest.json, index.ts, README.md, tests/
```

Um módulo recebe somente o `ModuleContext` e nunca importa `core/`, `interfaces/` ou `discord.js`.

```typescript
interface ModuleContext {
  readonly moduleId: string;
  readonly logger: Logger;
  readonly events: {
    publish(type: string, payload: unknown, context?: EventContext): void;
    subscribe(type: string, handler: (event: SunFlowerEvent) => Promise<void> | void): void;
  };
  readonly permissions: {
    check(actor: Actor, permission: string): boolean;
  };
  readonly config: {
    get<T>(): T;
  };
  readonly commands: {
    register(command: CommandDefinition): void;
  };
}

interface Actor {
  readonly userId: string;
  readonly roleIds: readonly string[];
}

interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  handle(interaction: CommandInteraction): Promise<void>;
}

interface CommandInteraction {
  readonly actor: Actor;
  reply(content: string, options?: { ephemeral?: boolean }): Promise<void>;
}
```

`CORE_API_VERSION` inicia em `1.0.0`. Um módulo pode exportar, junto da implementação, um `configSchema` zod para suas configurações.

## 3. Ambiente

| Variável            | Obrigatória | Regra                                                                |
| ------------------- | ----------- | -------------------------------------------------------------------- |
| `DISCORD_TOKEN`     | sim         | Não vazia.                                                           |
| `DISCORD_GUILD_ID`  | sim         | 17 a 20 dígitos.                                                     |
| `SUNFLOWER_DB_PATH` | não         | Padrão `data/sun-flower.db`.                                         |
| `LOG_LEVEL`         | não         | `fatal`, `error`, `warn`, `info`, `debug` ou `trace`. Padrão `info`. |

Variável ausente ou inválida impede a inicialização. A mensagem cita o nome da variável e a regra violada, nunca o valor. O `.env` é carregado com `node --env-file-if-exists=.env`.

## 4. Persistência

- `node:sqlite` em modo WAL, com `foreign_keys = ON`.
- Migrações em `core/infrastructure/migrations/NNNN-<nome>.sql`, aplicadas em ordem na inicialização, cada uma em uma transação, registradas em `schema_migrations (version, applied_at)`. Falha de migração impede a inicialização. Migração aplicada nunca é editada.
- Migração inicial `0001-core.sql`:

| Tabela              | Colunas                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `schema_migrations` | `version` (PK), `applied_at`                                                                  |
| `developers`        | `user_id` (PK), `added_at`                                                                    |
| `permission_grants` | `permission`, `role_id` (PK composta), `granted_at`                                           |
| `module_config`     | `module_id` (PK), `enabled` (nulo = usar `enabledByDefault`), `settings` (JSON), `updated_at` |

## 5. Registry e ciclo de vida

1. **Descoberta:** cada subdiretório de `modules/` com `manifest.json`.
2. **Validação do manifesto** (zod), conforme [MODULES.md §4](../MODULES.md#4-manifesto-do-módulo): campos e tipos, nenhum campo extra, `id` igual ao diretório e em `kebab-case`, `version` SemVer, `apiVersion` compatível ([0009](../decisions/0009-api-version-compatibility.md)), permissões e eventos publicados com o prefixo do próprio `id`. Ids duplicados: todos os módulos com esse id são rejeitados.
3. **Ordem de dependências** por ordenação topológica (Kahn). Dependência ausente ou circular: o módulo e seus dependentes ficam `FAILED`.
4. **Habilitação:** um módulo só é iniciado se `module_config.enabled` for verdadeiro ou, quando nulo, se `enabledByDefault` for verdadeiro.
5. **Estados:** `DISCOVERED → VALIDATED → REGISTERED → INITIALIZED → RUNNING → STOPPED → DISPOSED`, ou `FAILED`. Transição fora de ordem é rejeitada.
6. **Execução:** `register`, `initialize` e `start` na ordem das dependências; `stop` e `dispose` na ordem inversa. Cada chamada tem limite de 10 segundos; estouro conta como falha.
7. **Falhas:** conforme [MODULES.md §6.10](../MODULES.md#610-falhas-no-ciclo-de-vida). `dispose()` após falha também tem limite de tempo e sua própria falha é apenas registrada.
8. **Configuração:** no `initialize`, `module_config.settings` é validado contra o `configSchema` do módulo, com os valores padrão do schema. Configuração inválida torna o módulo `FAILED`.

## 6. Event Bus

Conforme [0007](../decisions/0007-event-bus-delivery.md): `publish` não aguarda os consumidores; cada consumidor roda isolado, com limite de 5 segundos; falhas são registradas; entrega no máximo uma vez; profundidade máxima de encadeamento 8; publicação e assinatura restritas ao declarado no manifesto; assinaturas removidas no `stop`.

## 7. Permissões

Conforme [0006](../decisions/0006-permission-model.md):

- `check(actor, permission)` com permissão `core.*`: verdadeiro somente se `actor.userId` estiver em `developers`.
- Com permissão de módulo: verdadeiro somente se algum `actor.roleIds` tiver a permissão em `permission_grants`.
- Permissão não declarada pelo módulo que chama: erro.
- Gravar em `permission_grants` uma permissão `core.*`: erro.
- Nenhuma regra especial para dono ou administradores do servidor.

**Comando `staff`** (`npm run staff -- <ação>`), executado localmente:

| Ação              | Efeito                     |
| ----------------- | -------------------------- |
| `add <userId>`    | Adiciona um desenvolvedor. |
| `remove <userId>` | Remove um desenvolvedor.   |
| `list`            | Lista os desenvolvedores.  |

O `userId` é validado (17 a 20 dígitos). Cada alteração é registrada no log. O comando usa o mesmo banco (`SUNFLOWER_DB_PATH`) e não conecta ao Discord.

## 8. Interface Discord

- `discord.js` 14, intent `Guilds` somente.
- **Restrição ao servidor:** interações de outros servidores e de mensagens diretas são ignoradas. O bot não sai de outros servidores ([decisão 0010](../decisions/0010-stay-in-other-guilds.md), que substitui a regra de saída original). Se o bot não estiver no servidor configurado, registra um erro e permanece aguardando.
- **Comandos:** após o `start` dos módulos, a lista de comandos do servidor é substituída pelos comandos registrados; os comandos globais são removidos. Nome de comando duplicado: o módulo que registrou por último fica `FAILED`.
- **Despacho:** a interface monta o `Actor` (`userId` e `roleIds` do membro) e chama `handle`. Sem resposta em 2,5 segundos, a interação é adiada (`deferReply`) e a resposta posterior usa `editReply`. Erro no handler: registrado no log; o usuário recebe "Ocorreu um erro." como resposta efêmera, sem detalhes internos.

## 9. Inicialização e encerramento

Ordem: ambiente → logger → banco e migrações → descoberta, validação e ordem → `register`/`initialize`/`start` → login no Discord → sincronização de comandos.

- Falha no login: os módulos são encerrados e o processo termina com código 1.
- `SIGINT`/`SIGTERM`: encerramento controlado (`stop`, `dispose`, desconexão do Discord, fechamento do banco) e código 0.
- `uncaughtException`/`unhandledRejection`: registro `fatal`, encerramento controlado e código 1.

## 10. Módulo `ping`

```json
{
  "id": "ping",
  "name": "Ping",
  "description": "Health check command",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "entrypoint": "index.ts",
  "enabledByDefault": true,
  "dependencies": [],
  "permissions": []
}
```

Registra `/ping`, que responde `Pong!` sem exigir permissão.

## 11. Dependências e projeto

- Produção: `discord.js` (14.x), `pino`, `zod`.
- `tsconfig.json`: adiciona `erasableSyntaxOnly`, `allowImportingTsExtensions` e `noEmit`; o script `build` deixa de existir.
- Scripts: `npm start` (`node --env-file-if-exists=.env interfaces/discord/main.ts`) e `npm run staff`.
- `.gitignore`: adiciona `data/`.
- `.env.example`: adiciona `SUNFLOWER_DB_PATH=` e `LOG_LEVEL=`.
- `tests/sanity.test.ts` é removido.

## 12. Testes

Todos com Vitest, banco SQLite em memória e IDs fictícios (`000000000000000000`, `111111111111111111`). Nenhum teste usa a rede ou o Discord real.

| Área          | Casos                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifesto     | Campos obrigatórios, campo extra, `id` × diretório, SemVer inválido, prefixos de permissão e evento, ids duplicados.                                                                     |
| `apiVersion`  | Todas as linhas da tabela de [0009](../decisions/0009-api-version-compatibility.md).                                                                                                     |
| Dependências  | Ordem correta, dependência ausente, ciclo, dependentes de módulo falho.                                                                                                                  |
| Ciclo de vida | Falha e estouro de tempo em cada etapa, `dispose` após falha, transição fora de ordem, encerramento em ordem inversa, módulo desabilitado.                                               |
| Configuração  | Ambiente ausente ou inválido sem expor valores; `configSchema` com padrão e inválido.                                                                                                    |
| Event Bus     | Isolamento de falha, estouro de tempo, prefixo e declaração, assinatura não declarada, profundidade, remoção no `stop`.                                                                  |
| Permissões    | Negação padrão, `core.*` só para desenvolvedores, permissão por cargo, desenvolvedor sem cargo não recebe permissão de módulo, permissão não declarada, `core.*` não associável a cargo. |
| Migrações     | Ordem, reexecução sem efeito, falha impede inicialização.                                                                                                                                |
| `staff`       | `add`, `remove`, `list`, ID inválido.                                                                                                                                                    |
| Discord       | Saída de servidor não autorizado, interação de outro servidor ignorada, sincronização de comandos, adiamento após 2,5 s, erro do handler sem detalhes.                                   |
| Integração    | Core completo com módulos de teste em diretório temporário; `ping` respondendo a uma interação simulada.                                                                                 |

## 13. Documentação

- `README.md`: `npm start`, `npm run staff` e cadastro do primeiro desenvolvedor.
- `modules/ping/README.md` conforme [MODULES.md §15](../MODULES.md#15-documentação-dos-módulos).
- `docs/ROADMAP.md`: estado da Fase 1.
- `CHANGELOG.md`: entradas em `Unreleased`.

## 14. Critérios de conclusão

Os critérios da [Fase 1 no ROADMAP](../ROADMAP.md#fase-1--core--discord-mínimo), mais:

- [ ] `npm run check` passa com todos os testes da seção 12.
- [ ] Verificação de vazamento por subagentes antes de cada Pull Request ([CONTRIBUTING.md §7.2](../../CONTRIBUTING.md#72-verificação-de-vazamento-antes-do-pull-request)).
- [ ] `/ping` respondido no servidor real, verificado pela pessoa mantenedora.
