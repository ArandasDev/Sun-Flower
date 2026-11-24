# 0017 — Níveis de acesso: desenvolvedores, dono, equipe e membros

**Status:** Aceita
**Data:** 2026-11-24
**Substitui em parte:** [0006](0006-permission-model.md) (permissões automáticas do dono e dos desenvolvedores)

## Contexto

A decisão [0006](0006-permission-model.md) separou os desenvolvedores do bot da equipe da comunidade. Ela também negou qualquer permissão automática ao dono do servidor, e os desenvolvedores só recebiam permissões de módulo pelos próprios cargos.

Com o painel da Fase 3, a pessoa mantenedora definiu quatro níveis de acesso:

- os **desenvolvedores** operam o bot e acessam tudo;
- o **dono do servidor** gere a comunidade sem precisar de um desenvolvedor para cada ajuste;
- a **equipe** faz o que as permissões dos próprios cargos permitem;
- os **membros** veem só o próprio perfil.

## Decisão

As permissões efetivas de uma pessoa são a soma das camadas abaixo. A ausência de permissão continua resultando em negação.

| Nível            | Quem                                      | Permissões                                                                |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| Desenvolvedor    | Lista `developers` do Core                | Todas: `core.*` e as permissões de todos os módulos                       |
| Dono do servidor | O dono do servidor segundo o Discord      | As permissões de todos os módulos, inclusive associar permissões a cargos |
| Equipe           | Membros com cargos em `permission_grants` | As permissões de módulo associadas aos próprios cargos                    |
| Membro           | Qualquer membro do servidor               | Nenhuma permissão nomeada; só os próprios dados                           |

Regras:

- O dono nunca recebe `core.*`. A lista de desenvolvedores, a ativação de módulos, os logs técnicos e as sessões continuam exclusivos dos desenvolvedores.
- Permissões `core.*` continuam proibidas em cargos.
- Ser dono é verificado a cada uso, com o dono atual do servidor. Uma transferência de propriedade tem efeito imediato.
- Administradores do Discord continuam sem permissão automática.
- As regras valem para o Discord e para o painel, porque as duas interfaces usam o mesmo serviço de permissões.
- **Todo acesso ao painel exige ser membro do servidor, inclusive para desenvolvedores.** Isso limita o estrago se a conta de alguém de fora for invadida. O painel explica o motivo a quem for recusado, e o README e o CONTRIBUTING registram a regra.
- As proteções das ações manuais continuam valendo: não se age contra a própria pessoa, o bot, desenvolvedores, cargos isentos ou cargos com permissões `moderation.*`.

## Consequências

- O `Actor` passa a indicar se a pessoa é dona do servidor, e o serviço de permissões considera os desenvolvedores e o dono em `check`.
- O dono pode configurar a moderação e associar permissões a cargos, sem acessar a operação do bot.
- Um desenvolvedor não precisa mais de cargo para moderar, mas precisa ser membro para entrar no painel.
- Quem controla a conta do dono controla a comunidade pelo bot. Isso já acontecia no próprio Discord.
