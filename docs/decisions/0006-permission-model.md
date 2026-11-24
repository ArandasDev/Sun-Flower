# 0006 — Modelo de permissões: desenvolvedores do bot e cargos do servidor

**Status:** Aceita, substituída em parte por [0017](0017-access-levels.md) (permissões automáticas do dono e dos desenvolvedores)
**Data:** 2026-11-16

## Contexto

O Sun Flower é uma unidade autossuficiente. A equipe que opera o bot (desenvolvimento) é diferente da equipe que administra a comunidade, e ser dono ou administrador do servidor Discord não deve dar controle sobre o bot.

## Decisão

O controle de acesso tem duas camadas independentes:

1. **Desenvolvedores do bot.** Uma lista de IDs de usuário, mantida no banco do bot (tabela `developers`). Somente desenvolvedores recebem as permissões do Core (`core.*`), que operam o bot: módulos, configurações, mapeamento de permissões e a própria lista de desenvolvedores. Permissões `core.*` nunca podem ser associadas a cargos do servidor.
2. **Cargos do servidor.** As permissões dos módulos (por exemplo, `moderation.actions.ban`) são associadas a cargos do servidor pela tabela `permission_grants`, configurada pelos desenvolvedores. Qualquer membro, incluindo desenvolvedores, recebe permissões de módulo somente pelos seus cargos.

Regras gerais:

- A ausência de permissão resulta em negação.
- O dono do servidor e membros com a permissão de Administrador do Discord não recebem nenhuma permissão automática.
- Um módulo só pode verificar as permissões que declarou no próprio manifesto.
- Na Fase 1, a lista de desenvolvedores é gerida por um comando local (`npm run staff`), executado na máquina onde o bot roda. A partir da Fase 3, ela também é gerida pelo painel administrativo; o comando local permanece como acesso de emergência.

## Consequências

- Perder acesso ao servidor Discord não tira o controle do bot dos desenvolvedores, e a equipe da comunidade não consegue alterar o bot.
- Um desenvolvedor que também atua na moderação precisa do cargo correspondente no servidor.
- O primeiro desenvolvedor só pode ser cadastrado por quem tem acesso à máquina onde o bot executa.
- IDs de desenvolvedores e de cargos ficam apenas no banco local, nunca no repositório.
