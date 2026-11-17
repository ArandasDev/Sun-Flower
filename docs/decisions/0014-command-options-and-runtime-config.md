# 0014 — Opções de comando e configuração em tempo de execução

**Status:** Aceita
**Data:** 2026-11-17

## Contexto

Até a Fase 1, os comandos de barra não tinham argumentos, e a configuração de um módulo só era lida. A moderação precisa de comandos como `/mod domain block <domínio>` e de configuração alterada pela equipe sem reiniciar o bot, antes de o painel existir (Fase 3).

## Decisão

- `CommandDefinition` passa a aceitar subcomandos, grupos de subcomandos e opções dos tipos `string`, `integer`, `boolean`, `user`, `channel` e `role`, cada uma obrigatória ou opcional, seguindo os limites do Discord.
- `CommandInteraction` ganha `subcommandGroup`, `subcommand` e `options`, com leitores por tipo (`getString`, `getInteger`, `getBoolean`, `getUser`, `getChannel`, `getRole`), que devolvem `undefined` para opção ausente.
- O serviço `config` ganha `set(partial)`. O valor resultante é validado pelo `configSchema` do módulo antes de ser gravado em `module_config`. Um valor inválido é recusado e nada é gravado. O próximo `get()` já devolve o novo valor.
- O comando local `npm run staff` ganha `grant <permissão> <ID do cargo>`, `revoke <permissão> <ID do cargo>` e `grants`. Permissões `core.*` continuam impossíveis de associar a cargos ([0006](0006-permission-model.md)).

## Consequências

- As mudanças são aditivas: `CORE_API_VERSION` passa a `1.1.0`, e módulos com `apiVersion` `1.0.0` continuam compatíveis ([0009](0009-api-version-compatibility.md)).
- A interface Discord traduz as definições para o formato do `discord.js`, e os módulos continuam sem depender dele.
- Até a Fase 3, a associação de permissões a cargos só é feita na máquina onde o bot roda.
