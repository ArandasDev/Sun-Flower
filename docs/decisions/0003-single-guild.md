# 0003 — Atuação em um único servidor Discord

**Status:** Aceita
**Data:** 2026-11-16

## Contexto

A documentação inicial descrevia o Sun Flower como um bot para vários servidores, com configurações e dados isolados por servidor. O Sun Flower é, na verdade, um bot dedicado a uma única comunidade.

## Decisão

O Sun Flower atua **exclusivamente** em um único servidor Discord, identificado pela variável de ambiente `DISCORD_GUILD_ID`.

- O ID do servidor é informação não pública e nunca é escrito no repositório.
- O ID é lido da variável de ambiente `DISCORD_GUILD_ID`; sem ela, a aplicação não inicia.
- Eventos, comandos e interações de qualquer outro servidor são ignorados.
- Quando adicionado a outro servidor, o bot registra a ocorrência e sai dele.
- Os comandos são registrados no escopo do servidor, não globalmente.
- Não existe isolamento multi-servidor: configurações, regras e dados pertencem a esse servidor.

## Consequências

- Configurações, permissões e persistência não precisam de chave de servidor, o que simplifica o modelo de dados.
- Eventos não carregam `serverId` ([MODULES.md §7.2](../MODULES.md#72-estrutura-de-eventos)).
- Comandos registrados no servidor ficam disponíveis imediatamente, sem a espera da propagação global.
- Atender outro servidor no futuro exigiria uma nova decisão e mudanças em configuração, permissões e persistência.
