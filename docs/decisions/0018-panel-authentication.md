# 0018 — Autenticação do painel: Discord OAuth2 e sessões no servidor

**Status:** Aceita
**Data:** 2026-11-24

## Contexto

O painel da Fase 3 fica acessível pela internet. As pessoas que o usam já têm conta no Discord e precisam ser membros do servidor ([0017](0017-access-levels.md)). Senhas próprias seriam mais um segredo para guardar e proteger.

## Decisão

- O login usa o fluxo de código do Discord OAuth2, com o escopo `identify`, um `state` aleatório e PKCE (`S256`), presos a um cookie temporário de 10 minutos.
- O servidor troca o código pelo token, lê só o ID do usuário e descarta o token do Discord na hora. Nenhum token do Discord é guardado.
- O bot verifica se a pessoa é membro pelo próprio cache. Quem não é membro, ou cuja consulta falhou, não entra.
- A sessão é um ID aleatório de 256 bits no cookie `__Host-sf_session` (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`).
  - O banco guarda só o hash `sha256` do ID.
  - Cada login cria um ID novo.
  - A sessão expira após 12 horas sem uso e em 7 dias no máximo.
- Toda requisição que altera estado exige um token CSRF, além do `SameSite`.
- O nível e as permissões são recalculados a cada requisição, nunca guardados na sessão.
- O login tem limite de tentativas por IP.

## Consequências

- O painel não guarda senhas nem tokens do Discord. Um vazamento do banco não dá acesso a sessões.
- Perder o cargo ou sair do servidor tem efeito na próxima requisição.
- O bot precisa de `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`, e o endereço de retorno precisa estar cadastrado no Discord Developer Portal.
- O login depende do Discord. Se ele estiver fora do ar, o painel também fica, e `npm run staff` continua como acesso de emergência.
