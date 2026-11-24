# 0019 — Tecnologia do painel: Fastify, React e Vite

**Status:** Aceita
**Data:** 2026-11-24

## Contexto

O ROADMAP deixou o framework do painel para a spec da Fase 3. A pessoa mantenedora quer uma interface fluida, com atualizações em tempo real e animações. Foram avaliadas três opções:

- **Páginas geradas no servidor:** menor superfície de ataque, mas interface menos fluida.
- **API JSON com um app React:** interface rica, ao custo de um passo de build.
- **Módulo `http` do Node sem framework:** obrigaria a escrever à mão toda a segurança web.

## Decisão

- **Servidor:** Fastify, na nova interface `interfaces/dashboard/`, no mesmo processo do bot. Usa os plugins oficiais de cookies, CSRF, limite de tentativas, cabeçalhos de segurança, WebSocket e arquivos estáticos.
- **Front:** um app React com Vite e TypeScript `strict` em `interfaces/dashboard/app/`, com `package.json` próprio.
  - As animações usam a biblioteca Motion.
  - Os dados do servidor usam TanStack Query.
- O build do front gera `interfaces/dashboard/app/dist`, que o Fastify entrega na **mesma origem** da API. Não há CORS.
- O bot continua rodando TypeScript direto, sem build ([0005](0005-runtime-and-persistence.md)). Só o `interfaces/dashboard/app/` tem passo de build.
- O `npm run check` passa a incluir o lint, os tipos, os testes e o build do `interfaces/dashboard/app/`.
- As versões exatas são fixadas no Pull Request que adiciona cada dependência.

## Consequências

- A interface pode ser fluida e animada sem expor uma API em outra origem.
- O projeto ganha dependências de front e um passo de build, isolados em `interfaces/dashboard/app/`.
- Os plugins oficiais do Fastify tiram da mão do projeto a parte mais sensível da segurança web.
