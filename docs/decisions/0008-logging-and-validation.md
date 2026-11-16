# 0008 — Logs com pino e validação com zod

**Status:** Aceita
**Data:** 2026-11-16

## Contexto

O Core precisa de logs estruturados ([MODULES.md §13](../MODULES.md#13-observabilidade)) e de validação de manifestos, variáveis de ambiente e configurações dos módulos ([MODULES.md §4.4](../MODULES.md#44-validação) e §8).

## Decisão

- **pino** para logs estruturados em JSON na saída padrão. Cada módulo recebe um logger filho com o campo `module`. Campos sensíveis (`token`, `authorization`) são mascarados, e o conteúdo de mensagens do servidor nunca é registrado.
- **zod** para validar manifestos, variáveis de ambiente e configurações dos módulos. Os tipos TypeScript são derivados dos schemas. Mensagens de erro de validação de ambiente citam a variável, nunca o valor.

## Consequências

- Duas dependências de produção, ambas amplamente usadas e sem dependências nativas.
- Módulos podem exportar um `configSchema` zod para suas configurações.
