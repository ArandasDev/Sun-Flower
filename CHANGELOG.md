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

### Changed

- **BREAKING:** `apiVersion` do manifesto passa a ser a versão SemVer completa do contrato do Core (`"1.0.0"`), com compatibilidade por `MAJOR` igual e `MINOR.PATCH` menor ou igual ao do Core.
- Permissões em duas camadas: lista de desenvolvedores do bot para as permissões `core.*` e cargos do servidor para as permissões dos módulos; o dono e os administradores do servidor não recebem permissões automáticas.
- Fase 3 do ROADMAP passa a exigir revisão ofensiva por três subagentes antes da release.
