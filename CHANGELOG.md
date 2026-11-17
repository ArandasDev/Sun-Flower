# 🌻 Sun Flower — Changelog

Todas as alterações relevantes do Sun Flower são registradas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) e o projeto usa [Semantic Versioning](https://semver.org/). As regras de atualização estão em [docs/GIT.md §7](docs/GIT.md#7-changelog).

## [Unreleased]

### Added

- Documentação inicial do projeto:
  - `docs/ARCHITECTURE.md`: visão arquitetural, servidor de atuação e domínios funcionais (moderação, social, música, painel administrativo).
  - `docs/MODULES.md`: contrato de módulo, `manifest.json`, ciclo de vida, Event Bus, permissões, configurações e testes.
  - `docs/GIT.md`: branches, Conventional Commits, Pull Requests, Semantic Versioning, tags, releases e changelog.
  - `docs/ROADMAP.md`: fases 0 a 5, decisões pendentes e critérios de conclusão.
  - `CONTRIBUTING.md`: fluxo de trabalho, qualidade, documentação, segurança e regras para agentes de IA.
  - `AGENTS.md`: resumo para agentes de IA.
- Registros de decisão: Modular Monolith (0001), TypeScript + Node.js (0002), atuação exclusiva em um único servidor Discord (0003) e ferramentas de desenvolvimento (0004).
- Spec da Fase 0 (base do repositório).
- Projeto Node.js 26 + TypeScript (`strict`) com ESLint, Prettier e Vitest, executáveis por `npm run check`.
- CI no GitHub Actions executando `npm run check` em todo Pull Request para `main`.
- `.env.example` com as variáveis `DISCORD_TOKEN` e `DISCORD_GUILD_ID`.
- Registros de decisão 0005 a 0009 (execução direta de TypeScript e SQLite, modelo de permissões, Event Bus, pino e zod, compatibilidade do `apiVersion`) e spec da Fase 1.
- Core da Fase 1:
  - Module Registry: descoberta de módulos, validação de manifesto e de `apiVersion`, ordem por dependências e ciclo de vida completo com limite de tempo por etapa; um módulo com falha não impede os demais.
  - Event Bus local, assíncrono e isolado, com validação de prefixo e de eventos declarados no manifesto.
  - Serviço de permissões: desenvolvedores do bot para `core.*` e cargos do servidor para as permissões dos módulos, com negação por padrão.
  - Configuração: validação das variáveis de ambiente e da configuração de cada módulo pelo `configSchema`.
  - Logs estruturados com pino, sem token nem IDs do Discord.
  - Banco SQLite embutido (`SUNFLOWER_DB_PATH`) com migrações versionadas.
  - Encerramento controlado em `SIGINT`/`SIGTERM`, com prazo de 15 segundos (código 1 se for excedido), e registro `fatal` com código 1 em erros não tratados.
- Interface Discord: atuação exclusiva no servidor `DISCORD_GUILD_ID` (ignora interações de outros servidores e as mensagens diretas, sem sair dos servidores — decisão 0010), sincronização dos comandos dos módulos no servidor, adiamento automático de respostas lentas, erros sem detalhes internos e respostas sem menções. Iniciada por `npm start`.
- Comando `npm run staff -- add|remove|list` para gerenciar os desenvolvedores do bot sem conectar ao Discord.
- Módulo `ping`: comando `/ping`, que responde `Pong!`.
- Registros de decisão 0011 a 0015 (eventos do Discord no Event Bus, ações no servidor por capacidades, persistência dos módulos, opções de comando e configuração em tempo de execução, detecção de phishing) e spec da Fase 2, etapa 1 (moderação contra phishing).
- Core da Fase 2, etapa 1:
  - Eventos `discord.message.created` e `discord.message.updated` publicados pela interface; o prefixo `discord.` é reservado ao Core.
  - Capacidades `guild.moderate` e `guild.message` no manifesto e serviço `guild` do contexto do módulo (apagar mensagem, castigo, expulsão, banimento, mensagens), com recusa registrada quando a capacidade não foi declarada.
  - Serviço `storage` e migrações SQL por módulo, com tabelas no prefixo `<id>_`.
  - Opções de comando (`options`, incluindo `choices` para texto) e `config.set` para alterar configurações em tempo de execução.
  - `npm run staff -- grant|revoke <permissão> <ID do cargo>` e `grants` para gerenciar as permissões dos cargos, com aviso quando nenhum módulo declara a permissão.
- Interface Discord da Fase 2: ações no servidor (apagar mensagem, castigo, expulsão, banimento, desbanimento, mensagens no canal e diretas, cargos do membro) com recusa de ações contra o próprio bot, erros mapeados para `forbidden`, `not_found` e `failed`, limite de 10 s por chamada e mensagens sem menções. O README documenta os intents privilegiados e as permissões do convite.

### Changed

- `CORE_API_VERSION` passa para 1.1.0, de forma aditiva: módulos com `apiVersion` 1.0.0 continuam compatíveis.
- **BREAKING:** `apiVersion` do manifesto passa a ser a versão SemVer completa do contrato do Core (`"1.0.0"`), com compatibilidade por `MAJOR` igual e `MINOR.PATCH` menor ou igual ao do Core.
- Permissões em duas camadas: lista de desenvolvedores do bot para as permissões `core.*` e cargos do servidor para as permissões dos módulos; o dono e os administradores do servidor não recebem permissões automáticas.
- Fase 3 do ROADMAP passa a exigir revisão ofensiva por três subagentes antes da release.
