# 0005 — Execução direta de TypeScript e SQLite embutido

**Status:** Aceita
**Data:** 2026-11-16

## Contexto

A Fase 1 precisa decidir como o código TypeScript é executado e qual banco de dados o Core usa. O Sun Flower atende um único servidor Discord, com volume de dados pequeno.

O Node.js 26 executa arquivos `.ts` diretamente, removendo as anotações de tipo, e inclui o módulo `node:sqlite`. Ambos foram verificados na máquina de desenvolvimento sem avisos de recurso experimental.

## Decisão

- O Node.js executa os arquivos `.ts` diretamente, sem etapa de build. O `tsc` é usado somente para checagem de tipos.
- O código usa apenas sintaxe TypeScript apagável (`erasableSyntaxOnly`): sem `enum`, `namespace` ou parâmetros de propriedade em construtores. Imports relativos usam a extensão `.ts`.
- O banco de dados é **SQLite**, acessado pelo módulo embutido **`node:sqlite`**, em modo WAL, com chaves estrangeiras ativas.
- O caminho do arquivo do banco vem de `SUNFLOWER_DB_PATH` (padrão `data/sun-flower.db`); o diretório `data/` não é versionado.
- O esquema evolui por migrações SQL versionadas, aplicadas na inicialização.

## Consequências

- O `entrypoint` do manifesto (`index.ts`) é exatamente o arquivo carregado pelo Core, sem mapeamento para `dist/`.
- Nenhuma dependência nativa precisa ser compilada na instalação.
- A API do `node:sqlite` é síncrona: consultas pesadas não podem rodar no processo principal.
- Recursos de TypeScript que geram código (`enum`, `namespace`) não podem ser usados.
