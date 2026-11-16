# 0004 — Ferramentas de desenvolvimento

**Status:** Aceita
**Data:** 2026-11-16

## Contexto

A Fase 0 do [ROADMAP](../ROADMAP.md) exige decidir versão do Node.js, gerenciador de pacotes, executor de testes, lint, formatação e plataforma de CI antes de criar o projeto.

## Decisão

| Item                   | Escolha                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| Runtime                | Node.js 26 (LTS ativa)                                               |
| Gerenciador de pacotes | npm, com `package-lock.json` versionado                              |
| Executor de testes     | Vitest                                                               |
| Lint                   | ESLint com `typescript-eslint` (regras que usam informação de tipos) |
| Formatação             | Prettier                                                             |
| CI                     | GitHub Actions                                                       |
| Repositório            | `https://github.com/ArandasDev/Sun-Flower`                           |

## Consequências

- Uma única ferramenta por função, todas padrão no ecossistema TypeScript.
- O ESLint não verifica formatação; isso é papel exclusivo do Prettier (`eslint-config-prettier`).
- Mudar o Node.js de versão `MAJOR` exige uma nova decisão.
