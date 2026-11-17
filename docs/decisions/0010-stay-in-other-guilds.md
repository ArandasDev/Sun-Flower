# 0010 — O bot não sai de outros servidores

**Status:** Aceita
**Data:** 2026-11-17
**Substitui:** a regra de saída de outros servidores da [decisão 0003](0003-single-guild.md).

## Contexto

A decisão 0003 previa que o bot, ao ser adicionado a outro servidor, registrasse a ocorrência e saísse dele. O bot não é compartilhado: só a pessoa mantenedora o adiciona a servidores. A saída automática não protege nada, porque o bot já ignora toda interação vinda de outro servidor, e trazia um risco: um `DISCORD_GUILD_ID` digitado errado faria o bot sair do servidor real.

## Decisão

- O bot **não sai** de servidores diferentes de `DISCORD_GUILD_ID`.
- Eventos, comandos e interações de qualquer outro servidor, e as mensagens diretas, continuam ignorados.
- Os comandos continuam registrados somente no servidor `DISCORD_GUILD_ID`, e os comandos globais continuam sendo removidos.
- Se o bot não estiver no servidor configurado, ele registra um erro e aguarda ser adicionado.

As demais regras da decisão 0003 permanecem válidas.

## Consequências

- Menos código: a interface Discord não precisa tentar sair de servidores nem tratar falhas de saída.
- Um `DISCORD_GUILD_ID` errado deixa o bot inerte, sem comandos, em vez de tirá-lo do servidor real.
- Se o bot for adicionado a outro servidor, ele permanece lá sem responder a nada.
