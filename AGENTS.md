# Instruções para agentes de IA

Este arquivo resume o que todo agente de IA precisa saber antes de alterar o Sun Flower. As regras completas estão em [CONTRIBUTING.md](CONTRIBUTING.md) e prevalecem sobre este resumo.

## Leia antes de alterar

1. [docs/ROADMAP.md](docs/ROADMAP.md): fase atual e o que está decidido ou pendente.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/MODULES.md](docs/MODULES.md): arquitetura e contrato de módulo.
3. [docs/GIT.md](docs/GIT.md): branches, commits e Pull Requests.
4. [docs/decisions/](docs/decisions/): decisões já tomadas.

## Fatos do projeto

- **Servidor único:** o bot atua somente no servidor Discord definido por `DISCORD_GUILD_ID`. Não projete nada para vários servidores.
- **Informação não pública nunca entra no repositório** ([CONTRIBUTING.md §7.1](CONTRIBUTING.md#71-informações-não-públicas)): IDs do Discord, e-mails, tokens, endereços internos. Antes de abrir um Pull Request, faça a verificação de vazamento de [CONTRIBUTING.md §7.2](CONTRIBUTING.md#72-verificação-de-vazamento-antes-do-pull-request).
- **Stack:** TypeScript (`strict`) + Node.js + `discord.js`.
- **Arquitetura:** Modular Monolith; módulos só se comunicam pelo Event Bus e por contratos do Core.
- **Idioma:** código, branches e commits em inglês; documentação em português.

## Regras

- Trabalhe em branch de trabalho; nunca altere a `main` diretamente.
- Sem autorização explícita da pessoa mantenedora, na tarefa atual, não faça commit, push, merge, tag, release, comandos destrutivos nem alterações em CI, dependências ou permissões.
- Execute os testes e informe os comandos e resultados reais. Nunca invente resultados.
- Decisões de tecnologia, arquitetura ou contrato geram um registro em `docs/decisions/` antes da implementação.
- Atualize no mesmo Pull Request a documentação afetada e o `CHANGELOG.md`.
- **Nunca** adicione o rodapé `Co-Authored-By:` aos commits; ele não é autorizado. Informe sua participação somente na seção **Uso de IA** do Pull Request.
