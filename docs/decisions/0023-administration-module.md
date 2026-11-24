# 0023 — Módulo `administration` e capacidade `core.admin`

**Status:** Aceita
**Data:** 2026-11-24

## Contexto

O ROADMAP prevê o módulo `administration` para gerir pelo painel estes itens:

- a lista de desenvolvedores;
- a associação de permissões a cargos;
- a ativação de módulos;
- os logs técnicos;
- as sessões.

Esses dados pertencem ao Core, e um módulo comum não tem acesso a eles. Pela [0017](0017-access-levels.md), o dono associa permissões a cargos, mas nunca recebe `core.*`.

## Decisão

- Nova capacidade `core.admin`, que libera no contexto o serviço `admin`. Ele permite:
  - listar, adicionar e remover desenvolvedores;
  - listar, associar e remover permissões de cargos;
  - ligar e desligar módulos;
  - ler os logs técnicos recentes;
  - listar e derrubar sessões do painel.
- Só um manifesto com `core.admin` pode declarar permissões `core.*`. O Core recusa o manifesto de qualquer outro módulo que tente.
- O módulo `administration` declara estas permissões:
  - `administration.grants.manage`: associar e remover permissões de cargos. O dono e os desenvolvedores a recebem pela [0017](0017-access-levels.md).
  - `core.developers.manage`, `core.modules.manage`, `core.logs.read` e `core.sessions.manage`: só para desenvolvedores.
- **Nenhuma permissão `administration.*` pode ser associada a cargos.** Um cargo capaz de associar permissões poderia dar a si mesmo todas as outras.
- Cargos só recebem permissões declaradas por algum módulo descoberto, ativo ou desligado, e nunca `core.*` nem `administration.*`.
- O serviço `admin` registra no log do Core cada alteração, com quem fez e os IDs mascarados.
- Os comandos `npm run staff` continuam funcionando como acesso de emergência, sem depender do módulo.
- O módulo `administration` não pode ser desligado pelo painel. Desligá-lo tiraria do painel a própria administração.

## Consequências

- O painel administra o bot pelo mesmo contrato de operações dos outros módulos ([0022](0022-module-operations.md)).
- Os módulos do repositório são código confiável, e as capacidades tornam explícito quem acessa o quê. O Core não trata o código dos módulos como hostil.
- Uma revisão de Pull Request que adicione `core.admin` a outro módulo exige uma decisão própria.
