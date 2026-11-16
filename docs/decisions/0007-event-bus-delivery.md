# 0007 — Semântica de entrega do Event Bus

**Status:** Aceita
**Data:** 2026-11-16

## Contexto

[MODULES.md §7](../MODULES.md#7-comunicação-entre-módulos) deixava para a Fase 1 a definição de como o Event Bus local entrega eventos e trata falhas dos consumidores.

## Decisão

- `publish()` não espera os consumidores: cada consumidor é executado de forma assíncrona e isolada, com limite de tempo.
- A falha ou o estouro de tempo de um consumidor é registrado com o id do módulo e o tipo do evento, e não afeta os demais consumidores nem quem publicou.
- A entrega é **no máximo uma vez**, sem retentativas nem persistência de eventos.
- Eventos encadeados (um consumidor que publica outro evento) têm profundidade máxima de 8; acima disso, o evento é descartado e o descarte é registrado.
- O Core preenche `id`, `version`, `source` e `timestamp`. Um módulo só publica eventos declarados em `events.publishes` e com o prefixo do próprio id, e só assina eventos declarados em `events.subscribes`.
- As assinaturas de um módulo são removidas automaticamente no `stop`.

## Consequências

- Um módulo lento ou com erro não degrada os demais.
- Consumidores não podem depender de entrega garantida nem de ordem entre consumidores diferentes.
- Se um evento precisar de entrega garantida no futuro, isso exigirá uma nova decisão.
