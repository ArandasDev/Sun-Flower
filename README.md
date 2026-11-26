# 🌻 Sun Flower

Bot Discord modular e dedicado, que reúne moderação, funcionalidades sociais, música e um painel administrativo para **um único servidor Discord**.

## Estado atual

- **Fase 0 — Base do repositório (concluída).** Projeto TypeScript, CI e ruleset da `main` ativos.
- **Fase 1 — Core + Discord mínimo (concluída).** O Core carrega os módulos, a interface Discord atua só no servidor configurado e o módulo de exemplo `ping` responde a `/ping`, verificado no servidor real.
- **Fase 2 — Moderação (concluída).** Etapas 1 (phishing e ações manuais) e 2 (spam e flood) implementadas e verificadas no servidor real ([Moderação](#moderação)).

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

> [!NOTE]
> A pasta `data/` guarda o banco de dados. Não a deixe dentro de uma pasta sincronizada (OneDrive, Dropbox) e deixe-a legível só pelo usuário do bot, por exemplo com `chmod 700 data` no Linux.

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

`npm run staff -- grants` lista as associações e `npm run staff -- revoke <permissão> <ID do cargo>` remove uma delas. Membros com um cargo que tenha qualquer permissão `moderation.*` ficam protegidos **somente das ações manuais** (`/mod warn`, `timeout`, `kick` e `ban`); as regras automáticas de phishing e spam continuam valendo para eles. Para que a equipe não seja punida pelas regras automáticas, isente o cargo dela com `/mod config exempt-role <cargo da equipe> add`.

**Teste manual no servidor real:**

1. Ative os intents privilegiados **Server Members** e **Message Content** no Discord Developer Portal (**Bot → Privileged Gateway Intents**).
2. Associe as permissões `moderation.*` necessárias a um cargo de teste com `npm run staff -- grant moderation.<…> <ID do cargo>`, uma por permissão, como no bloco acima.
3. Inicie o bot com `npm start` e, com uma conta que tenha o cargo, configure o canal de alertas com `/mod config alert-channel`.
4. Isente o cargo da equipe das regras automáticas com `/mod config exempt-role <cargo da equipe> add`. As permissões `moderation.*` protegem só das ações manuais; sem esta etapa, a própria equipe pode ser punida por flood ou phishing durante o teste.
5. Bloqueie um domínio de teste com `/mod domain block`.
6. Com uma conta **sem** o cargo, envie uma mensagem com um link desse domínio: a mensagem é apagada, a conta recebe timeout e o alerta aparece no canal configurado, com o número do caso.
7. Com a conta da equipe, execute `/mod case revert <número>`: o timeout é removido.

**Teste manual de spam** (depois das etapas 1 a 4 acima):

1. Com uma conta **sem** o cargo, envie 8 mensagens rápidas (por exemplo, `oi` 8 vezes em poucos segundos): as mensagens somem, a conta recebe timeout e o alerta aparece no canal configurado, com as regras que dispararam. Se o cliente do Discord segurar o envio (limite de mensagens por canal), distribua as mensagens por mais de um canal: o flood soma os canais. Uma mensagem enviada logo depois do disparo, antes de o timeout ser aplicado, pode continuar no canal.
2. Para a reincidência, **não** reverta o primeiro caso: um caso revertido não conta. Espere o timeout terminar (10 minutos no padrão) e repita o surto: o alerta mostra a reincidência 2 e a punição do segundo degrau (por padrão, timeout de 1 hora).
3. Confira a configuração com `/mod config view` e ajuste com `/mod config spam-rule`, `spam-escalation` ou `spam-ignore` se necessário.
4. Com a conta da equipe, execute `/mod case revert <número>`: o timeout é removido.

## Painel

O painel é opcional e roda no mesmo processo do bot, atrás de um proxy HTTPS ([0021](docs/decisions/0021-panel-hosting.md)). Sem `PANEL_PUBLIC_URL` ele fica desligado e o bot sobe normalmente. Na etapa 1 ele tem login com Discord, "Meu perfil", "Visão geral" (para desenvolvedores e o dono), conexão ao vivo com reconexão automática e a presença de quem está no painel. Na etapa 2 ele ganha a moderação: casos, ações manuais, domínios e configuração, cada tela visível só a quem tem a permissão correspondente, e "Meus casos" em "Meu perfil", visível a todos. Na etapa 3 ele ganha a administração: permissões dos cargos, desenvolvedores, módulos, logs e sessões.

**Variáveis** (todas no `.env`): o painel liga quando `PANEL_PUBLIC_URL` está definida, e então `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` e `SESSION_SECRET` passam a ser obrigatórias; `PANEL_PORT` (padrão `3000`) e `PANEL_TRUST_PROXY` são opcionais:

| Variável                | Conteúdo                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `PANEL_PUBLIC_URL`      | Endereço público do painel, por exemplo `https://painel.example.com`.                |
| `PANEL_PORT`            | Porta local (o servidor escuta só em `127.0.0.1`). Padrão: `3000`.                   |
| `DISCORD_CLIENT_ID`     | ID da aplicação, no Discord Developer Portal.                                        |
| `DISCORD_CLIENT_SECRET` | Segredo do OAuth2 da aplicação.                                                      |
| `SESSION_SECRET`        | Segredo para assinar cookies e tokens CSRF. Gere um com o comando do `.env.example`. |
| `PANEL_TRUST_PROXY`     | Proxies confiáveis, separados por vírgula (veja abaixo). Vazio = nenhum.             |

**Discord Developer Portal:** em **OAuth2 → Redirects**, cadastre `https://painel.example.com/auth/callback` (o endereço de `PANEL_PUBLIC_URL` seguido de `/auth/callback`).

**Build do painel** (necessário antes de iniciar o bot com o painel ligado):

```bash
npm run app:install
npm run build --prefix interfaces/dashboard/app
```

**Hospedagem.** O bot não abre portas para a internet: coloque um proxy HTTPS na frente da porta local. O proxy precisa repassar o WebSocket de `/api/live`.

- **Caddy** (o WebSocket não pede diretivas extras; o IP do cliente só é lido corretamente com `PANEL_TRUST_PROXY=127.0.0.1`):

  ```caddyfile
  painel.example.com {
    reverse_proxy 127.0.0.1:3000
  }
  ```

- **Nginx** (com HTTPS configurado à parte):

  ```nginx
  server {
    server_name painel.example.com;

    location / {
      proxy_pass http://127.0.0.1:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/live {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_read_timeout 1h;
    }
  }
  ```

- **Túnel** (por exemplo, Cloudflare Tunnel): sem abrir portas, apontando o domínio público para `http://127.0.0.1:3000`.

**`PANEL_TRUST_PROXY`:** com um proxy na mesma máquina (Caddy ou Nginx), use `PANEL_TRUST_PROXY=127.0.0.1`. Com um túnel, use o IP de onde o conector (por exemplo, `cloudflared`) se conecta ao painel. Se ficar vazio, o painel avisa na inicialização e todos os clientes parecem vir do proxy: dividem os mesmos limites de requisições, e uma pessoa pode bloquear o login de todas. Um valor errado anula o limite por IP.

**Quem pode entrar:** só membros do servidor. Desenvolvedores do bot também precisam ser membros. Um desenvolvedor que não é membro vê esta mensagem na tela de login: "Desenvolvedores precisam ser membros do servidor para acessar o painel. Isso faz parte da segurança do projeto: limita o estrago se uma conta for invadida." Quem não é membro e não é desenvolvedor vê "Só membros do servidor podem acessar o painel."

**Teste manual da etapa 1** (pessoa mantenedora), atrás de um proxy HTTPS:

1. Um membro comum entra e vê só "Meu perfil".
2. Uma conta que não é membro recebe a mensagem "Só membros do servidor podem acessar o painel.".
3. O dono vê a "Visão geral".
4. Duas abas da mesma pessoa aparecem como uma só na presença.
5. Desconectar a rede mostra `Reconectando…`, e a conexão volta sozinha quando a rede volta.
6. O logout em uma aba leva a outra para o login.

**Telas de moderação (etapa 2).** As operações passam pelo mesmo caminho dos comandos `/mod`, com as mesmas permissões, e o painel mostra cada tela só a quem pode usá-la:

| Tela       | Endereço     | O que faz                                                                                                                                                                                   |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Casos      | `/casos`     | Lista os casos com filtros mantidos no endereço, `Carregar mais` e um detalhe lateral. Reverter e Descartar pedem confirmação. Um caso novo ou alterado aparece na hora para quem pode ver. |
| Ações      | `/acoes`     | Aviso, timeout, expulsão e banimento. Expulsão e banimento pedem confirmação.                                                                                                               |
| Domínios   | `/dominios`  | Listas de domínios bloqueados e permitidos.                                                                                                                                                 |
| Moderação  | `/moderacao` | Configuração da moderação, com um botão de salvar por seção.                                                                                                                                |
| Meus casos | `/`          | Os casos da própria pessoa, em "Meu perfil", visíveis a todos.                                                                                                                              |

Cada seção da configuração é salva com a versão que a pessoa viu (`expectedVersion`). Se outra pessoa salvou antes, o painel recusa a gravação, mostra o texto do conflito com o botão `Recarregar`. Quando outra pessoa altera a configuração com a tela aberta, o painel mostra o mesmo aviso se houver alterações não salvas; sem alterações, carrega a nova versão sem aviso.

Cada evento ao vivo de caso atualiza a lista e o detalhe no máximo uma vez a cada 5 s, e o último evento sempre é aplicado. Um caso novo recarrega só a primeira página da lista; as páginas extras carregadas com `Carregar mais` se fecham. Assim, uma onda de casos não esgota o limite de requisições da sessão.

**Limites conhecidos da etapa 2:**

- Ainda não é possível limpar o canal de alertas, nem no painel nem no `/mod`. No painel, um campo vazio mantém o canal atual.
- Ainda não é possível editar os termos de isca (`baitTerms`), nem no painel nem no `/mod`. Eles mantêm o valor padrão ou o valor gravado.
- O layout foi conferido em um navegador na revisão, em 1024 px e em 375 px de largura, e o teste manual abaixo passou no servidor real.

**Teste manual da etapa 2** (pessoa mantenedora), atrás de um proxy HTTPS e com um usuário de teste:

1. Uma conta da equipe, com `/casos` aberta, vê um caso novo aparecer na hora.
2. Ela reverte o caso, com confirmação.
3. Duas abas salvam a mesma seção em `/moderacao`, e a segunda recebe o conflito com `Recarregar`.
4. O dono, sem cargo, bane o usuário de teste em `/acoes`.
5. Um membro comum vê só "Meus casos" em "Meu perfil".

**Telas de administração (etapa 3).** As operações passam pelo módulo `administration` ([0023](docs/decisions/0023-administration-module.md)), com as mesmas checagens de permissão das demais, e o painel mostra cada tela só a quem pode usá-la:

| Tela            | Endereço           | O que faz                                                                                                                  |
| --------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Permissões      | `/permissoes`      | Associa e remove permissões de módulo de cada cargo do servidor.                                                           |
| Desenvolvedores | `/desenvolvedores` | Lista, adiciona e remove desenvolvedores do bot. Remover pede confirmação.                                                 |
| Módulos         | `/modulos`         | Liga e desliga módulos com o bot em execução, e os comandos são ressincronizados no Discord. Desligar pede confirmação.    |
| Logs            | `/logs`            | Os 200 registros mais recentes (de 500 guardados), de nível `info` ou acima, com IDs mascarados, e o botão `Atualizar`.    |
| Sessões         | `/sessoes`         | Lista as sessões do painel e encerra uma delas ou todas as de uma conta, com confirmação. A conexão ao vivo fecha na hora. |

As telas buscam os dados ao abrir e depois de cada alteração, sem consulta periódica e sem recarregar quando a janela volta ao foco; só a reconexão ao vivo recarrega a tela aberta. Ao encerrar uma sessão, a conexão ao vivo dela fecha na hora, e aquele navegador volta para o login. O `npm run staff` continua funcionando como acesso de emergência: se o painel ficar inacessível, ou se ninguém tiver mais permissão para administrá-lo, use os comandos da seção [Desenvolvimento](#desenvolvimento).

**Limites conhecidos da etapa 3:**

- Cada pessoa mantém no máximo 5 sessões do painel: o sexto login encerra a sessão menos usada, e aquele navegador volta para o login. Veja a decisão [0024](docs/decisions/0024-panel-session-limits.md).
- Um módulo dependente que falhou porque a dependência estava desligada continua em `FAILED` até ser ligado.
- Cargos e usuários são digitados como IDs, sem seletor do Discord.
- A memória de logs se perde quando o bot reinicia.
- As leituras das telas de administração contam no limite de 30 por minuto das alterações; separá-las é uma decisão pendente com a pessoa mantenedora.
- Com várias abas em Módulos enquanto módulos mudam, as leituras podem chegar ao limite de 30 por minuto das alterações, e as telas passam a receber erro de excesso de requisições. Separar as leituras desse limite é uma decisão pendente.
- Cada leitura das telas de administração também entra no log em memória, e pode empurrar registros mais antigos para fora das 500 guardadas.
- As telas foram conferidas em um navegador, em 1024 px e em 375 px de largura, com a política de segurança (CSP) real, e o teste manual abaixo passou no servidor real.

**Teste manual da etapa 3** (pessoa mantenedora), atrás de um proxy HTTPS e com contas de teste:

1. O dono associa uma permissão a um cargo, e a pessoa com o cargo passa a ver a tela correspondente.
2. Um desenvolvedor desliga e liga um módulo, e o comando some e volta no Discord.
3. Um desenvolvedor encerra a sessão de outra conta, que volta para o login na hora.
4. Os logs mostram a alteração do item 1, com os IDs mascarados.

## Documentação

| Documento                          | Conteúdo                         |
| ---------------------------------- | -------------------------------- |
| [docs/README.md](docs/README.md)   | Índice completo da documentação. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Como contribuir.                 |
| [AGENTS.md](AGENTS.md)             | Instruções para agentes de IA.   |
| [CHANGELOG.md](CHANGELOG.md)       | Histórico de alterações.         |
