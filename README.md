# 🌻 Sun Flower

Bot Discord modular e dedicado, que reúne moderação, funcionalidades sociais, música e um painel administrativo para **um único servidor Discord**.

## Estado atual

**Fase 0 — Base do repositório (em andamento).** Projeto TypeScript e CI configurados; ainda não há código do bot. Veja o [ROADMAP](docs/ROADMAP.md).

## Decisões fundamentais

|             |                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Arquitetura | Modular Monolith ([0001](docs/decisions/0001-modular-monolith.md))                                      |
| Stack       | TypeScript + Node.js + `discord.js` ([0002](docs/decisions/0002-typescript-node.md))                    |
| Escopo      | Um único servidor Discord, definido em `DISCORD_GUILD_ID` ([0003](docs/decisions/0003-single-guild.md)) |

## Desenvolvimento

**Pré-requisito:** Node.js 26 (a versão está em `.nvmrc`).

**Instalação:**

```bash
npm install
cp .env.example .env
```

Preencha o `.env` com os valores reais. Ele não é versionado e nunca deve ser commitado.

**Comandos:**

| Comando                | Faz                                                                              |
| ---------------------- | -------------------------------------------------------------------------------- |
| `npm run typecheck`    | Checa os tipos sem gerar arquivos.                                               |
| `npm run lint`         | Executa o ESLint.                                                                |
| `npm run format`       | Formata todos os arquivos com o Prettier.                                        |
| `npm run format:check` | Verifica a formatação sem alterar arquivos.                                      |
| `npm test`             | Executa os testes com o Vitest.                                                  |
| `npm run check`        | Executa `format:check`, `lint`, `typecheck` e `test`, parando na primeira falha. |

Os comandos `npm start` e `npm run staff` chegam com a interface Discord.

`npm run check` é obrigatório antes de abrir um Pull Request e é o que a CI executa.

## Documentação

| Documento                          | Conteúdo                         |
| ---------------------------------- | -------------------------------- |
| [docs/README.md](docs/README.md)   | Índice completo da documentação. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Como contribuir.                 |
| [AGENTS.md](AGENTS.md)             | Instruções para agentes de IA.   |
| [CHANGELOG.md](CHANGELOG.md)       | Histórico de alterações.         |
