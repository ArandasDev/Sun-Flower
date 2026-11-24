# 0020 — Tempo real no painel: WebSocket filtrado por permissão

**Status:** Aceita
**Data:** 2026-11-24

## Contexto

Algumas mudanças precisam aparecer na hora, na tela de todos que estão no painel:

- configuração alterada;
- estado do bot;
- quem está no painel e em qual tela;
- casos novos.

Server-Sent Events só enviam do servidor ao navegador. A presença precisa que o navegador também informe em qual tela está.

## Decisão

- O painel usa uma conexão WebSocket em `/api/live`, na mesma origem.
- A conexão só abre com sessão válida e com `Origin` igual a `PANEL_PUBLIC_URL`. Isso bloqueia o sequestro da conexão a partir de outro site.
- **Do servidor ao navegador:** a interface web escuta o Event Bus. Cada evento tem uma permissão exigida, e cada conexão só recebe os eventos que as permissões atuais da pessoa permitem.
- **Do navegador ao servidor:** só mensagens de presença, validadas com zod, com tamanho máximo e limite de frequência. **Nenhuma ação passa pelo WebSocket.** As alterações usam a API HTTP, com CSRF.
- As permissões são recalculadas a cada evento entregue. Se a sessão expira, se a pessoa sai do servidor ou se a sessão é derrubada, o servidor fecha a conexão.
- A presença fica só em memória e se perde ao reiniciar.
- O navegador reconecta sozinho e busca o estado de novo ao voltar.

## Consequências

- A presença e as atualizações ao vivo funcionam sem consultas repetidas ao servidor.
- O canal ao vivo não vira uma segunda porta de ações, e a superfície de ataque se limita a receber eventos e a enviar presença.
- O proxy HTTPS precisa repassar o upgrade de WebSocket.
