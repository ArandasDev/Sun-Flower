# 0012 — Ações no servidor por capacidades declaradas

**Status:** Aceita
**Data:** 2026-11-17

## Contexto

O módulo `moderation` precisa apagar mensagens, silenciar, expulsar e banir membros e enviar alertas. Os módulos não podem usar `discord.js` diretamente, e cada ação sobre membros do servidor é sensível.

## Decisão

- O `ModuleContext` ganha o serviço `guild`, implementado pela interface Discord, com as ações `deleteMessage`, `timeout`, `removeTimeout`, `kick`, `ban`, `unban`, `sendMessage` e `sendDirectMessage`, e a consulta `getMemberRoleIds`.
- O manifesto ganha o campo opcional `capabilities`. Os valores aceitos são:
  - `guild.moderate`: `deleteMessage`, `timeout`, `removeTimeout`, `kick`, `ban`, `unban`, `sendDirectMessage` e `getMemberRoleIds`;
  - `guild.message`: `sendMessage`.
- Um módulo que chama uma ação sem declarar a capacidade correspondente recebe um erro, e o Core registra a recusa no log.
- O Core recusa qualquer ação de moderação contra um desenvolvedor do bot ([0006](0006-permission-model.md)) ou contra o próprio bot.
- Toda ação executada é registrada no log do Core com o módulo, a ação e o motivo, com IDs mascarados, sem conteúdo de mensagens.
- `getMemberRoleIds` tem três resultados: a lista de cargos quando a pessoa é membro; `null` quando o Discord confirma que ela não é membro (Unknown Member ou Unknown User); `undefined` quando a consulta falhou (erro, limite de tempo, servidor indisponível ou módulo inativo). Assim o módulo distingue "não é membro" de "não foi possível verificar" e pode recusar a ação no segundo caso.
- Falhas do Discord são devolvidas como erros tipados: `forbidden`, `not_found` ou `failed`, sem detalhes internos.
- Mensagens enviadas pelo bot não notificam ninguém (`allowedMentions` vazio).

## Consequências

- Um módulo sem a capacidade declarada não consegue agir sobre o servidor, nem por engano.
- A capacidade é declarada em revisão de código, no manifesto, e não depende de configuração em tempo de execução.
- As permissões de quem usa um comando continuam sendo verificadas pelo módulo ([0006](0006-permission-model.md)). A capacidade limita o módulo, e a permissão limita a pessoa.
