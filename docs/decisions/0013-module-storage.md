# 0013 — Persistência dos módulos

**Status:** Aceita
**Data:** 2026-11-17

## Contexto

O módulo `moderation` precisa guardar casos e listas de domínios, e consultar casos por usuário e por data. Até a Fase 1, só o Core acessava o banco SQLite ([0005](0005-runtime-and-persistence.md)). [MODULES.md §10](../MODULES.md#10-persistência-de-dados) exige separação por domínio, migrações versionadas e proteção contra acesso indevido.

## Decisão

- Cada módulo pode trazer migrações SQL em `modules/<id>/migrations/NNNN-<nome>.sql`.
- O Core aplica as migrações pendentes do módulo em ordem, no `register`, cada uma numa transação. As migrações aplicadas ficam numa tabela de controle do Core, por módulo.
- Todo `CREATE TABLE`, `CREATE INDEX` e `CREATE TRIGGER` de uma migração de módulo precisa usar nomes com o prefixo `<id>_`. Migração sem o prefixo, com SQL inválido ou com falha leva o módulo a `FAILED`, e os demais continuam funcionando.
- O `ModuleContext` ganha o serviço `storage` com `run`, `get`, `all` e `transaction`, sempre com parâmetros preparados.
- Um módulo não consulta tabelas de outro módulo nem do Core. A regra é verificada em revisão de código; o Core não analisa as consultas em tempo de execução.

## Consequências

- Os módulos usam SQL completo, com índices e consultas por usuário e por data.
- O isolamento entre módulos é por convenção e revisão, não por sandbox: todos compartilham o mesmo arquivo SQLite. Isso é aceitável porque todos os módulos são do próprio projeto.
- As migrações do Core e as dos módulos passam a ser aplicadas pelo mesmo mecanismo. A corrida entre `staff` e `start` num banco novo é resolvida nessa mudança.
