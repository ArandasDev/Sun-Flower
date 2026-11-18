# 🌻 Sun Flower

Bot Discord modular e dedicado, que reúne moderação, funcionalidades sociais, música e um painel administrativo para **um único servidor Discord**.

## Estado atual

- **Fase 0 — Base do repositório (concluída).** Projeto TypeScript, CI e ruleset da `main` ativos.
- **Fase 1 — Core + Discord mínimo (em revisão).** O Core carrega os módulos, a interface Discord atua só no servidor configurado e o módulo de exemplo `ping` responde a `/ping`; falta a verificação manual de `/ping` no servidor real.
- **Fase 2 — Moderação (em andamento).** Etapas 1 (phishing e ações manuais) e 2 (spam e flood) implementadas; falta a verificação manual no servidor real ([Moderação](#moderação)).

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

**Permissões do convite:** além dos escopos, marque as permissões que a moderação usa: `View Channels`, `Send Messages`, `Send Messages in Threads`, `Manage Messages`, `Moderate Members`, `Kick Members` e `Ban Members`. Sem elas, as ações no servidor falham e o bot registra a recusa no log. O cargo do bot também precisa estar **acima** dos cargos dos membros que ele modera; caso contrário, o Discord recusa timeout, expulsão e banimento.

**Intents privilegiados:** no Discord Developer Portal, em **Bot → Privileged Gateway Intents**, ative o _Server Members Intent_ e o _Message Content Intent_. O primeiro permite consultar os cargos dos membros; o segundo permite ler o texto das mensagens para a detecção de phishing. Sem o _Message Content Intent_, o bot não analisa as mensagens e avisa no log.

**Primeiro desenvolvedor:** cadastre o seu ID de usuário do Discord como desenvolvedor do bot, o que libera as permissões `core.*`:

```bash
npm run staff -- add <seu ID de usuário>
```

Substitua `<seu ID de usuário>` pelo seu próprio ID, sem os sinais `<` e `>`.

Os IDs do Discord (usuários e servidor) ficam somente no banco local (`SUNFLOWER_DB_PATH`, padrão `data/sun-flower.db`) e no `.env`. Nenhum dos dois é versionado, e nenhum ID real deve entrar no repositório.

**Execução:**

> [!NOTE]
> O bot só responde no servidor `DISCORD_GUILD_ID` e ignora qualquer outro servidor e as mensagens diretas, sem sair deles ([0010](docs/decisions/0010-stay-in-other-guilds.md)). Se `DISCORD_GUILD_ID` estiver errado, o bot conecta mas não registra comandos e informa no log que não está no servidor configurado.

```bash
npm start
```

O bot conecta ao Discord e registra os comandos dos módulos no servidor `DISCORD_GUILD_ID`. `Ctrl+C` encerra o bot de forma controlada.

**Comandos:**

| Comando                                             | Faz                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm start`                                         | Inicia o bot com as variáveis do `.env`.                                         |
| `npm run staff -- add <ID>`                         | Adiciona um desenvolvedor do bot.                                                |
| `npm run staff -- remove <ID>`                      | Remove um desenvolvedor do bot.                                                  |
| `npm run staff -- list`                             | Lista os desenvolvedores do bot.                                                 |
| `npm run staff -- grant <permissão> <ID do cargo>`  | Associa uma permissão de módulo a um cargo do servidor.                          |
| `npm run staff -- revoke <permissão> <ID do cargo>` | Remove a associação de uma permissão a um cargo.                                 |
| `npm run staff -- grants`                           | Lista as permissões associadas a cargos.                                         |
| `npm run typecheck`                                 | Checa os tipos sem gerar arquivos.                                               |
| `npm run lint`                                      | Executa o ESLint.                                                                |
| `npm run format`                                    | Formata todos os arquivos com o Prettier.                                        |
| `npm run format:check`                              | Verifica a formatação sem alterar arquivos.                                      |
| `npm test`                                          | Executa os testes com o Vitest.                                                  |
| `npm run check`                                     | Executa `format:check`, `lint`, `typecheck` e `test`, parando na primeira falha. |

`npm run check` é obrigatório antes de abrir um Pull Request e é o que a CI executa.

## Moderação

O módulo `moderation` detecta phishing e spam/flood, age automaticamente nas violações confirmadas e oferece o comando `/mod` para a equipe. Os comandos, as permissões e a configuração estão em [modules/moderation/README.md](modules/moderation/README.md).

Nenhuma permissão `moderation.*` é concedida por padrão: associe cada uma ao cargo da equipe que deve usá-la, substituindo `<ID do cargo>` pelo ID real, sem os sinais `<` e `>`:

```bash
npm run staff -- grant moderation.config.manage <ID do cargo>
npm run staff -- grant moderation.domains.manage <ID do cargo>
npm run staff -- grant moderation.cases.read <ID do cargo>
npm run staff -- grant moderation.cases.revert <ID do cargo>
npm run staff -- grant moderation.actions.warn <ID do cargo>
npm run staff -- grant moderation.actions.timeout <ID do cargo>
npm run staff -- grant moderation.actions.kick <ID do cargo>
npm run staff -- grant moderation.actions.ban <ID do cargo>
```

`npm run staff -- grants` lista as associações e `npm run staff -- revoke <permissão> <ID do cargo>` remove uma delas. Membros com um cargo que tenha qualquer permissão `moderation.*` ficam protegidos das ações manuais.

**Teste manual no servidor real:**

1. Ative os intents privilegiados **Server Members** e **Message Content** no Discord Developer Portal (**Bot → Privileged Gateway Intents**).
2. Associe as permissões `moderation.*` necessárias a um cargo de teste com `npm run staff -- grant moderation.<…> <ID do cargo>`, uma por permissão, como no bloco acima.
3. Inicie o bot com `npm start` e, com uma conta que tenha o cargo, configure o canal de alertas com `/mod config alert-channel`.
4. Bloqueie um domínio de teste com `/mod domain block`.
5. Com uma conta **sem** o cargo, envie uma mensagem com um link desse domínio: a mensagem é apagada, a conta recebe timeout e o alerta aparece no canal configurado, com o número do caso.
6. Com a conta da equipe, execute `/mod case revert <número>`: o timeout é removido.

**Teste manual de spam:**

1. Com uma conta **sem** o cargo, envie 8 mensagens rápidas (por exemplo, `oi` 8 vezes em poucos segundos): as mensagens somem, a conta recebe timeout e o alerta aparece no canal configurado, com as regras que dispararam.
2. Repita o surto depois do timeout: o alerta mostra a reincidência 2 e a punição do segundo degrau (por padrão, timeout de 1 hora).
3. Confira a configuração com `/mod config view` e ajuste com `/mod config spam-rule`, `spam-escalation` ou `spam-ignore` se necessário.
4. Com a conta da equipe, execute `/mod case revert <número>`: o timeout é removido.

## Documentação

| Documento                          | Conteúdo                         |
| ---------------------------------- | -------------------------------- |
| [docs/README.md](docs/README.md)   | Índice completo da documentação. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Como contribuir.                 |
| [AGENTS.md](AGENTS.md)             | Instruções para agentes de IA.   |
| [CHANGELOG.md](CHANGELOG.md)       | Histórico de alterações.         |
