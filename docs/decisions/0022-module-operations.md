# 0022 — Operações de módulo: um contrato para o Discord e para o painel

**Status:** Aceita
**Data:** 2026-11-24

## Contexto

Hoje as ações do `/mod` estão nos handlers do comando, presos à interação do Discord. O painel não pode chamar o código interno dos módulos ([ARCHITECTURE.md §3.4](../ARCHITECTURE.md#34-painel-administrativo)). Também não pode reimplementar as ações, porque cada cópia é um lugar a mais para uma proteção faltar.

## Decisão

- O contexto do módulo ganha `operations.register(definition)`. Uma operação tem:
  - nome no prefixo do módulo, por exemplo `moderation.cases.revert`;
  - permissão exigida, declarada no manifesto;
  - schema zod da entrada;
  - um handler `(actor, input) => Promise<OperationResult>`, sem dependência do Discord.
- O Core expõe as operações às interfaces. Antes do handler, o Core checa a permissão e valida a entrada. Uma falha em qualquer etapa devolve um erro tipado, sem executar nada.
- O `OperationResult` é um dado serializável (`{ ok: true, data }` ou `{ ok: false, error: { code, message } }`). Cada interface decide como mostrá-lo.
- Os subcomandos do `/mod` passam a chamar as operações, e as rotas do painel chamam as mesmas operações. As proteções do `/mod` ficam num lugar só.
- Leituras (listar casos, ver configuração) também são operações, com a permissão de leitura correspondente.
- `CORE_API_VERSION` passa para `1.3.0`, de forma aditiva.

## Consequências

- Uma regra nova de proteção vale ao mesmo tempo para o Discord e para o painel.
- Os testes das ações passam a testar as operações direto, sem simular a interação do Discord.
- Os módulos que não registram operações continuam compatíveis ([0009](0009-api-version-compatibility.md)).
