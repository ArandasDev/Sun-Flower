# 🌻 Sun Flower

Bot Discord modular e dedicado, que reúne moderação, funcionalidades sociais, música e um painel administrativo para **um único servidor Discord**.

## Estado atual

- **Fase 0 — Base do repositório (em andamento).** Projeto TypeScript e CI prontos; falta importar o ruleset da `main` (`.github/rulesets/main.json`) no GitHub.
- **Fase 1 — Core + Discord mínimo (em revisão).** O Core carrega os módulos, a interface Discord atua só no servidor configurado e o módulo de exemplo `ping` responde a `/ping`.

Veja o [ROADMAP](docs/ROADMAP.md).

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

O `cp .env.example .env` cria o `.env` a partir do modelo. Preencha-o com os valores reais. Ele não é versionado e nunca deve ser commitado.

**Como obter os IDs do Discord:** em **Configurações do usuário → Avançado**, ative o **Modo de desenvolvedor**. Depois, clique com o botão direito no seu nome e escolha **Copiar ID do usuário**, ou no ícone do servidor e escolha **Copiar ID do servidor** (no Discord em inglês: _Developer Mode_, _Copy User ID_ e _Copy Server ID_). O ID do servidor vai em `DISCORD_GUILD_ID`.

**Convite do bot:** ao gerar o link de convite no Discord Developer Portal, marque os escopos `bot` e `applications.commands`. Sem `applications.commands`, os comandos de barra não aparecem no servidor.

**Primeiro desenvolvedor:** cadastre o seu ID de usuário do Discord como desenvolvedor do bot, o que libera as permissões `core.*`:

```bash
npm run staff -- add <seu ID de usuário>
```

Substitua `<seu ID de usuário>` pelo seu próprio ID, sem os sinais `<` e `>`.

Os IDs do Discord (usuários e servidor) ficam somente no banco local (`SUNFLOWER_DB_PATH`, padrão `data/sun-flower.db`) e no `.env`. Nenhum dos dois é versionado, e nenhum ID real deve entrar no repositório.

**Execução:**

> [!WARNING]
> Ao iniciar, o bot **sai de todos os servidores diferentes de `DISCORD_GUILD_ID`** ([0003](docs/decisions/0003-single-guild.md)). Um valor errado faz o bot deixar servidores onde ele deveria ficar. Confira `DISCORD_GUILD_ID` antes do primeiro `npm start` e teste `/ping` no servidor configurado antes de adicionar o bot a qualquer outro servidor.

```bash
npm start
```

O bot conecta ao Discord, sai de qualquer servidor diferente de `DISCORD_GUILD_ID` e registra os comandos dos módulos nesse servidor. `Ctrl+C` encerra o bot de forma controlada.

**Comandos:**

| Comando                        | Faz                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `npm start`                    | Inicia o bot com as variáveis do `.env`.                                         |
| `npm run staff -- add <ID>`    | Adiciona um desenvolvedor do bot.                                                |
| `npm run staff -- remove <ID>` | Remove um desenvolvedor do bot.                                                  |
| `npm run staff -- list`        | Lista os desenvolvedores do bot.                                                 |
| `npm run typecheck`            | Checa os tipos sem gerar arquivos.                                               |
| `npm run lint`                 | Executa o ESLint.                                                                |
| `npm run format`               | Formata todos os arquivos com o Prettier.                                        |
| `npm run format:check`         | Verifica a formatação sem alterar arquivos.                                      |
| `npm test`                     | Executa os testes com o Vitest.                                                  |
| `npm run check`                | Executa `format:check`, `lint`, `typecheck` e `test`, parando na primeira falha. |

`npm run check` é obrigatório antes de abrir um Pull Request e é o que a CI executa.

## Documentação

| Documento                          | Conteúdo                         |
| ---------------------------------- | -------------------------------- |
| [docs/README.md](docs/README.md)   | Índice completo da documentação. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Como contribuir.                 |
| [AGENTS.md](AGENTS.md)             | Instruções para agentes de IA.   |
| [CHANGELOG.md](CHANGELOG.md)       | Histórico de alterações.         |
