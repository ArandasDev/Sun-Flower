# 0001 — Arquitetura Modular Monolith

**Status:** Aceita
**Data:** 2026-11-15

## Contexto

O Sun Flower reúne domínios independentes (moderação, social, música, administração) que precisam evoluir separadamente, mas é mantido por uma equipe pequena e atende um único servidor Discord. Microsserviços trariam custo de operação e implantação sem benefício proporcional.

## Decisão

O Sun Flower é um **Modular Monolith**: todos os módulos rodam no mesmo processo Node.js, cada um com domínio, manifesto, configurações, permissões e dados próprios, comunicando-se apenas pelo Event Bus e por contratos explícitos do Core. As regras estão em [MODULES.md](../MODULES.md).

## Consequências

- Implantação e depuração simples: um único processo.
- Os limites entre módulos dependem de disciplina e revisão, não de isolamento de processo.
- Uma falha fatal, vazamento de memória ou bloqueio do event loop afeta todos os módulos ([MODULES.md §11](../MODULES.md#11-isolamento-e-tolerância-a-falhas)).
- Um módulo que exija isolamento ou desempenho específico poderá ser extraído para um serviço separado no futuro, por uma nova decisão.
