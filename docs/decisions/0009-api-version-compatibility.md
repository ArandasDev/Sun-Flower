# 0009 — Compatibilidade do contrato por SemVer completo

**Status:** Aceita
**Data:** 2026-11-16

## Contexto

O `apiVersion` do manifesto continha apenas a versão `MAJOR` do contrato do Core. Isso não permite que um módulo declare depender de um recurso adicionado em uma versão `MINOR` ou de uma correção `PATCH`.

## Decisão

- O Core expõe a versão do contrato de módulo como SemVer completo (`CORE_API_VERSION`, iniciando em `1.0.0`): `MAJOR` para alterações incompatíveis do contrato, `MINOR` para recursos compatíveis adicionados ao `ModuleContext`, `PATCH` para correções.
- O `apiVersion` do manifesto é a versão SemVer completa do contrato que o módulo utiliza.
- O módulo é aceito somente se o `MAJOR` for igual ao do Core **e** o par `MINOR.PATCH` do módulo for menor ou igual ao do Core.

| Core    | Módulo  | Resultado |
| ------- | ------- | --------- |
| `1.3.0` | `1.2.0` | aceito    |
| `1.3.0` | `1.3.0` | aceito    |
| `1.3.0` | `1.4.0` | rejeitado |
| `1.3.0` | `1.3.1` | rejeitado |
| `1.3.0` | `2.0.0` | rejeitado |
| `2.0.0` | `1.3.0` | rejeitado |

## Consequências

- Um módulo nunca é iniciado em um Core que não possui os recursos de que ele precisa.
- A rejeição ocorre na etapa Manifest Validation e informa as duas versões.
- Substitui a regra de [MODULES.md §16](../MODULES.md#16-versionamento-e-compatibilidade) que comparava somente o `MAJOR`.
