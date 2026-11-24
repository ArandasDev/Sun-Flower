# 0021 — Hospedagem do painel: mesmo processo, atrás de um proxy HTTPS

**Status:** Aceita
**Data:** 2026-11-24

## Contexto

O painel fica acessível pela internet, e o lugar onde o bot vai rodar ainda não foi decidido. A solução precisa funcionar numa VPS ou num computador com túnel.

## Decisão

- O painel roda no mesmo processo do bot ([0001](0001-modular-monolith.md)) e escuta só em `127.0.0.1`, na porta `PANEL_PORT`.
- O acesso pela internet passa sempre por um proxy HTTPS. A documentação cobre dois caminhos:
  - **VPS:** Caddy ou Nginx com certificado automático;
  - **Túnel:** por exemplo o Cloudflare Tunnel, sem abrir portas no roteador.
- O painel nunca serve HTTP diretamente para a internet. Os cookies `Secure` e `__Host-` exigem HTTPS.
- O IP real do cliente só é lido do cabeçalho do proxy quando `PANEL_TRUST_PROXY` indica o proxy confiável. Sem isso, os cabeçalhos de encaminhamento são ignorados.
- O painel é opcional. Sem as variáveis do painel, o bot sobe sem ele. Um erro ao iniciar o painel é registrado e não derruba o bot.

## Consequências

- A hospedagem pode ser escolhida depois, sem mudar o código.
- Não é preciso gerenciar certificados no código do bot.
- Uma configuração errada de `PANEL_TRUST_PROXY` anula o limite de tentativas por IP. A documentação explica o valor certo para cada caminho.
