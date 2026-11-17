# 0011 — Eventos do Discord no Event Bus

**Status:** Aceita
**Data:** 2026-11-17

## Contexto

O módulo `moderation` precisa analisar as mensagens do servidor. Os módulos não podem importar `discord.js` ([0001](0001-modular-monolith.md)) e só se comunicam pelo Event Bus e por contratos do Core ([0007](0007-event-bus-delivery.md)). Até a Fase 1, a interface Discord só recebia comandos de barra.

## Decisão

- A interface Discord publica no Event Bus os eventos `discord.message.created` e `discord.message.updated`, com versão `1`.
- O prefixo `discord.` é reservado ao Core: nenhum módulo publica eventos com ele. Um módulo pode assiná-los desde que os declare em `events.subscribes` do manifesto.
- A interface publica somente mensagens do servidor `DISCORD_GUILD_ID`, de autores que não são bots, e descarta mensagens diretas e de outros servidores ([0010](0010-stay-in-other-guilds.md)).
- O payload contém `messageId`, `channelId`, `authorId`, `authorRoleIds`, `authorJoinedAt`, `authorAccountCreatedAt` e `content`. O campo `content` nunca é registrado em log.
- O bot passa a usar os intents `Guilds`, `GuildMessages`, `GuildMembers` e `MessageContent`. Os dois últimos são privilegiados e precisam ser ativados no Discord Developer Portal.

## Consequências

- Módulos futuros reaproveitam os mesmos eventos sem depender de `discord.js`.
- Todo o conteúdo das mensagens do servidor passa pela memória do processo. Por isso, o conteúdo fica fora dos logs e só é persistido quando um módulo decidir explicitamente.
- Sem o intent `MessageContent` ativo, `content` chega vazio. A interface detecta isso e registra um erro.
- A entrega segue a 0007: assíncrona, isolada e no máximo uma vez. Uma mensagem pode deixar de ser analisada se um handler falhar.
