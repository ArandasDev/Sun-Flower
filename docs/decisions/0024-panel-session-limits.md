# 0024 — Limites de sessões e de conexões ao vivo do painel

**Status:** Aceita
**Data:** 2026-11-25

## Contexto

Qualquer pessoa do servidor consegue entrar no painel, mesmo sem permissão alguma. Até aqui, nada limitava quantas sessões ela abria nem quantas conexões ao vivo mantinha, só as conexões por sessão. Um membro sem permissão podia esgotar a memória do processo do bot, que é o mesmo do painel ([0021](0021-panel-hosting.md)).

## Decisão

- **No máximo 5 sessões por pessoa** (`MAX_SESSIONS_PER_USER`). Ao criar a sexta, o Core apaga as mais antigas pelo último uso (`last_seen_at`, e pela criação em caso de empate) até sobrarem 4, e então cria a nova.
  - Sessões vencidas não contam. A limpeza horária continua removendo-as.
  - O apagamento avisa os ouvintes de `onRevoked` com os hashes apagados, e o painel fecha a conexão ao vivo dessas sessões com `session.ended` ([0020](0020-panel-realtime.md)).
- **No máximo 10 conexões ao vivo por pessoa** (`MAX_CONNECTIONS_PER_USER`), somando todas as sessões dela.
- **No máximo 500 conexões ao vivo no total** (`MAX_CONNECTIONS_TOTAL`).
- Acima de qualquer um dos limites (os dois novos e o de 5 conexões por sessão que já existia), o upgrade é recusado com 403 antes de abrir o WebSocket. Nenhuma conexão aberta é fechada por isso.
- O limite de requisições continua por sessão, como em [0018](0018-panel-authentication.md).

## Consequências

- Quem entra de novo seis vezes perde a sessão que menos usou, em vez de acumular sessões. Quem trabalha em vários navegadores ao mesmo tempo continua tendo folga.
- O uso de memória do canal ao vivo passa a ter um teto, independentemente de quantas pessoas ou sessões existam.
- Os limites são constantes no código. Os testes reduzem os de conexão pela configuração do `LiveHub`, para não abrir centenas de sockets.
- **Pendente:** separar o limite de leituras do limite de alterações. Hoje ambos compartilham o limite por sessão.
