# 🌻 Sun Flower — Documentação

Cada assunto tem um único documento responsável. Quando dois documentos tratam do mesmo tema, um deles apenas remete ao outro.

| Documento                                | Responsável por                                                                            | Leia quando                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [ROADMAP.md](ROADMAP.md)                 | Fases, fase atual, decisões pendentes e critérios de conclusão.                            | For escolher o que fazer a seguir.                        |
| [ARCHITECTURE.md](ARCHITECTURE.md)       | Visão geral, servidor de atuação, domínios funcionais e princípios.                        | For entender o sistema como um todo.                      |
| [MODULES.md](MODULES.md)                 | Contrato de módulo, manifesto, ciclo de vida, eventos, permissões, configurações e testes. | For criar ou alterar um módulo ou o Core.                 |
| [GIT.md](GIT.md)                         | Branches, commits, Pull Requests, versionamento, tags, releases e changelog.               | For criar branch, commitar, abrir PR ou publicar versão.  |
| [decisions/](decisions/)                 | Registros de decisão (o que foi decidido e por quê).                                       | Antes de propor algo que contrarie uma decisão existente. |
| `specs/`                                 | Specs de design de cada fase ou subsistema, criadas antes da implementação.                | For implementar o que uma spec descreve.                  |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Fluxo de trabalho, qualidade, documentação, segurança e regras para IA.                    | Antes da primeira contribuição.                           |
| [../AGENTS.md](../AGENTS.md)             | Resumo obrigatório para agentes de IA.                                                     | Se você for um agente de IA.                              |
| [../CHANGELOG.md](../CHANGELOG.md)       | Histórico de alterações por versão.                                                        | For registrar ou consultar mudanças.                      |

## Registros de decisão

| Nº                                                  | Decisão                                            | Status                                      |
| --------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| [0001](decisions/0001-modular-monolith.md)          | Arquitetura Modular Monolith                       | Aceita                                      |
| [0002](decisions/0002-typescript-node.md)           | TypeScript + Node.js                               | Aceita                                      |
| [0003](decisions/0003-single-guild.md)              | Atuação em um único servidor Discord               | Aceita; regra de saída substituída por 0010 |
| [0004](decisions/0004-tooling.md)                   | Ferramentas de desenvolvimento                     | Aceita                                      |
| [0005](decisions/0005-runtime-and-persistence.md)   | TypeScript executado diretamente e SQLite embutido | Aceita                                      |
| [0006](decisions/0006-permission-model.md)          | Desenvolvedores do bot e cargos do servidor        | Aceita                                      |
| [0007](decisions/0007-event-bus-delivery.md)        | Semântica de entrega do Event Bus                  | Aceita                                      |
| [0008](decisions/0008-logging-and-validation.md)    | Logs com pino e validação com zod                  | Aceita                                      |
| [0009](decisions/0009-api-version-compatibility.md) | Compatibilidade do contrato por SemVer completo    | Aceita                                      |
| [0010](decisions/0010-stay-in-other-guilds.md)      | O bot não sai de outros servidores                 | Aceita                                      |
