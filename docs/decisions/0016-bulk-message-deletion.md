# 0016 — Exclusão de mensagens em lote

**Status:** Aceita
**Data:** 2026-11-18

## Contexto

As regras de spam e flood da Fase 2 (etapa 2) apagam as mensagens recentes de uma pessoa, muitas vezes dezenas de uma vez. O serviço `guild` ([0012](0012-guild-actions.md)) só tinha `deleteMessage`, que apaga uma mensagem por chamada. Apagar um surto de 30 mensagens assim leva vários segundos por causa dos limites de taxa do Discord.

A exclusão em lote do Discord tem limites próprios: no máximo 100 mensagens por chamada, só mensagens com menos de 14 dias e pelo menos 2 mensagens por chamada.

## Decisão

- O serviço `guild` ganha `bulkDeleteMessages(channelId, messageIds)`, liberado pela capacidade `guild.moderate`.
- A chamada recebe de 1 a 100 IDs de mensagens de um único canal. IDs repetidos são descartados. Uma lista vazia ou com mais de 100 IDs devolve `failed` sem chamar o Discord.
- A interface Discord tenta primeiro a exclusão em lote do Discord. As mensagens que o lote não apagou são apagadas **uma por uma** com a exclusão normal:
  - mensagens com mais de 14 dias, que o Discord ignora no lote;
  - uma lista de um único ID;
  - um lote que falhou por erro temporário ou por limite de tempo.
- A exclusão uma por uma não é tentada quando o lote é recusado por um caso terminal: falta de permissão (50013), falta de acesso (50001) ou tópico arquivado (50083), todos `forbidden`, ou canal inexistente (10003), `not_found`. Os mesmos casos interrompem a exclusão individual já em andamento e devolvem o que foi apagado até ali.
- A exclusão individual também para após 3 falhas consecutivas, devolvendo o que já foi apagado (ou `failed` se nada foi). Isso limita o pior caso de um lote de 100 mensagens com falhas repetidas.
- Mensagens que já não existem (`not_found`, exceto canal inexistente) contam como já apagadas.
- O resultado informa quantas mensagens foram apagadas e quantas foram pela exclusão individual.
- O log do Core registra o módulo, a ação e as contagens, sem IDs.
- `CORE_API_VERSION` passa para `1.2.0`. A mudança é aditiva.

## Consequências

- Um surto é apagado em uma ou poucas chamadas, sem esperar pelos limites de taxa.
- Quando o lote não serve, a exclusão ainda acontece, ao custo de mais requisições e mais tempo.
- Os módulos com `apiVersion` `1.0.0` ou `1.1.0` continuam compatíveis ([0009](0009-api-version-compatibility.md)).
