# 0002 — TypeScript + Node.js

**Status:** Aceita
**Data:** 2026-11-16

## Contexto

A documentação inicial descrevia o contrato de módulo em notação semelhante a TypeScript, sem definir a linguagem. Foram consideradas TypeScript + Node.js, Rust, Python e C#.

Rust foi avaliado pelo desempenho. Um bot Discord passa a maior parte do tempo aguardando rede (Gateway, REST, banco de dados), e o limite prático de vazão são os rate limits do Discord, não a CPU. A moderação por heurísticas é leve, e o processamento de áudio pode ficar fora do processo (Fase 5). O ganho de desempenho seria pequeno, enquanto o custo seria alto: desenvolvimento mais lento, carregamento de módulos por manifesto mais difícil e painel web em outra stack.

## Decisão

O Sun Flower é escrito em **TypeScript**, em modo `strict`, executado em **Node.js**, com **`discord.js`** para a integração com o Discord.

## Consequências

- Core, módulos, API e painel usam a mesma linguagem e compartilham tipos por `shared/`.
- O contrato de módulo de [MODULES.md §5](../MODULES.md#5-contrato-de-desenvolvimento) é uma interface TypeScript real.
- Se um ponto específico exigir mais desempenho, ele poderá virar um serviço separado em outra linguagem, por uma nova decisão.
