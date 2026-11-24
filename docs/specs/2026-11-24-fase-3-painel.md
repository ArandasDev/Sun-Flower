# Spec — Fase 3: painel administrativo

**Status:** Aprovada em 2026-11-24
**Fase:** [ROADMAP — Fase 3](../ROADMAP.md#fase-3--painel-administrativo)
**Decisões aplicadas:** [0006](../decisions/0006-permission-model.md), [0009](../decisions/0009-api-version-compatibility.md), [0017](../decisions/0017-access-levels.md), [0018](../decisions/0018-panel-authentication.md), [0019](../decisions/0019-panel-stack.md), [0020](../decisions/0020-panel-realtime.md), [0021](../decisions/0021-panel-hosting.md), [0022](../decisions/0022-module-operations.md), [0023](../decisions/0023-administration-module.md)

## 1. Objetivo

Um painel web, acessível pela internet, em que cada pessoa do servidor faz o que o seu nível permite:

- **desenvolvedores** operam o bot;
- **o dono** gere a comunidade;
- **a equipe** modera;
- **os membros** veem o próprio perfil.

Mudanças aparecem na hora para todos, com uma interface fluida e animada.

A fase tem três etapas, cada uma com o próprio plano de implementação:

1. **Base segura:** níveis de acesso, login, sessão, WebSocket com presença e estado do bot, e o perfil.
2. **Moderação:** operações de módulo, casos ao vivo, domínios, ações manuais e configuração sincronizada.
3. **Administração:** módulo `administration`, ligar e desligar módulos em tempo de execução, logs técnicos e sessões.

**Fora do escopo:**

- lista de desejos e música no perfil, que ficam para as Fases 4 e 5;
- métricas e gráficos de uso;
- gestão de canais e cargos do Discord pelo painel;
- notificações por e-mail ou push;
- vários servidores ([0003](../decisions/0003-single-guild.md)).

## 2. Componentes

```text
shared/contracts/
├── commands.ts         Actor ganha isOwner
├── module.ts           operations.register, capacidade core.admin, CORE_API_VERSION 1.3.0
├── operations.ts       OperationDefinition, OperationResult, OperationError (novo)
└── admin.ts            Serviço admin da capacidade core.admin (novo)
core/
├── permissions/        Níveis da 0017: desenvolvedor, dono, equipe
├── operations/         Registro de operações, checagem de permissão e validação (novo)
├── sessions/           Sessões do painel com hash do ID (novo)
├── module-registry/    Ligar e desligar módulos em tempo de execução (etapa 3)
├── infrastructure/     Migração 0003-panel.sql; memória de logs recentes (etapa 3)
└── configuration/      Variáveis do painel; versão da configuração de cada módulo
interfaces/
├── discord/            isOwner no Actor; eventos de conexão; ressincroniza comandos
└── dashboard/          Fastify: OAuth, sessão, CSRF, rotas, WebSocket, estáticos (novo)
    └── app/            App React + Vite, com package.json próprio (novo)
modules/
├── moderation/         Ações do /mod viram operações (etapa 2)
└── administration/     Operações sobre o serviço admin (novo, etapa 3)
```

## 3. Níveis de acesso ([0017](../decisions/0017-access-levels.md))

- `Actor` passa a ser `{ userId, roleIds, isOwner }`.
  - A interface Discord preenche `isOwner` com o dono atual do servidor.
  - A interface web preenche com o mesmo dado, pelo cache do bot.
- `PermissionService.check(actor, permission)`:
  1. desenvolvedor → `true` para qualquer permissão;
  2. `core.*` → `false` para quem não é desenvolvedor;
  3. dono → `true` para qualquer permissão de módulo;
  4. demais → `true` só se um dos cargos tiver a permissão em `permission_grants`.
- `grant` passa a recusar estas permissões:
  - `administration.*`;
  - as que nenhum módulo descoberto declara. Hoje isso só gera um aviso no `npm run staff`.
- As proteções do `/mod` contra agir em desenvolvedores, cargos isentos e cargos com `moderation.*` continuam iguais. O dono não precisa de proteção extra, porque o Discord já impede agir contra ele.
- O nível mostrado no painel é o mais alto da pessoa (desenvolvedor > dono > equipe > membro). A equipe é quem tem ao menos uma permissão de módulo.

## 4. Operações de módulo ([0022](../decisions/0022-module-operations.md))

```ts
interface OperationDefinition<I = unknown, O = unknown> {
  readonly name: string; // no prefixo do módulo, ex. "moderation.cases.list"
  readonly permission: string | null; // declarada no manifesto; null = só o próprio ator
  readonly input: unknown; // schema zod, checado pelo Core em tempo de execução
  handler(actor: Actor, input: I): Promise<OperationResult<O>>;
}

type OperationResult<O> =
  { readonly ok: true; readonly data: O } | { readonly ok: false; readonly error: OperationError };

interface OperationError {
  readonly code: 'forbidden' | 'invalid' | 'not_found' | 'conflict' | 'unavailable' | 'failed';
  readonly message: string; // texto para a pessoa, sem detalhes internos
}
```

- `permission: null` só serve para operações sobre os dados do próprio ator, como `moderation.cases.mine`. O handler usa `actor.userId` e nunca recebe um ID de usuário como entrada.
- **Ordem do Core antes de chamar o handler:**
  1. o módulo está ativo;
  2. o ator tem a permissão;
  3. a entrada é validada pelo schema.

  Uma falha devolve `forbidden`, `invalid` ou `unavailable` sem executar nada. Um erro lançado pelo handler vira `failed`, e o log registra só o nome do erro.

- Cada chamada é registrada no log do Core com o módulo, a operação, a interface (`discord` ou `dashboard`), o resultado e o ator com o ID mascarado. A entrada não vai para o log.
- Quando um módulo para, as operações dele saem do registro.
- `CORE_API_VERSION` passa para `1.3.0`, de forma aditiva.

## 5. Interface web (`interfaces/dashboard/`)

### 5.1. Configuração

| Variável                | Exemplo                       | Uso                                                 |
| ----------------------- | ----------------------------- | --------------------------------------------------- |
| `PANEL_PUBLIC_URL`      | `https://painel.example.com`  | Endereço público. Liga o painel quando definido.    |
| `PANEL_PORT`            | `3000`                        | Porta local, só em `127.0.0.1`.                     |
| `DISCORD_CLIENT_ID`     | `111111111111111111`          | Aplicação OAuth2 do Discord.                        |
| `DISCORD_CLIENT_SECRET` | —                             | Segredo OAuth2. Nunca aparece em log.               |
| `SESSION_SECRET`        | 32 bytes aleatórios em base64 | Assina os cookies temporários e os tokens CSRF.     |
| `PANEL_TRUST_PROXY`     | `127.0.0.1`                   | Proxy confiável para ler o IP real. Vazio = nenhum. |

- **Painel desligado:** sem `PANEL_PUBLIC_URL`, o bot sobe sem painel.
- **Configuração incompleta:** com `PANEL_PUBLIC_URL` definido e outra variável faltando ou inválida, o painel não sobe. O log diz qual variável está errada, sem mostrar o valor, e o bot segue funcionando.
- **Endereço inválido:** `PANEL_PUBLIC_URL` precisa ser `https://` e não pode ter caminho, consulta ou fragmento.

### 5.2. Login ([0018](../decisions/0018-panel-authentication.md))

1. `GET /auth/login`:
   - gera um `state` e um `code_verifier`;
   - grava os dois num cookie temporário assinado, `__Host-sf_oauth` (`HttpOnly`, `Secure`, `SameSite=Lax`, 10 min);
   - redireciona para o Discord com `scope=identify`, PKCE `S256` e `redirect_uri=${PANEL_PUBLIC_URL}/auth/callback`.
2. `GET /auth/callback`:
   - confere o `state` e apaga o cookie temporário;
   - troca o código pelo token, com limite de 10 s;
   - chama `GET /users/@me`, guarda só o `id` e descarta o token.
3. Depois, o bot consulta os cargos da pessoa com `getMemberRoleIds`:
   - `null` → página "sem acesso". Para desenvolvedores, mostra a mensagem de segurança da [0017](../decisions/0017-access-levels.md);
   - `undefined` → página "tente de novo";
   - cargos → cria a sessão e redireciona para `/`.
4. Qualquer falha no caminho (`state` errado, código recusado, Discord fora do ar) leva à página de erro de login, sem detalhes.

O login aceita 10 tentativas por minuto por IP. Acima disso, devolve `429`.

### 5.3. Sessões (`core/sessions/`, migração `0003-panel.sql`)

```sql
CREATE TABLE panel_sessions (
  id_hash TEXT PRIMARY KEY,      -- sha256 do ID em hexadecimal
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL       -- created_at + 7 dias
);
CREATE INDEX panel_sessions_user ON panel_sessions (user_id);
```

- **Cookie:** `__Host-sf_session` com 32 bytes aleatórios em base64url, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- **Expiração:** a sessão vale por 12 h sem uso e por 7 dias no máximo. `last_seen_at` é atualizado no máximo uma vez por minuto. Uma limpeza a cada hora apaga as sessões vencidas.
- **Por requisição:** o servidor lê o cookie, calcula o hash, busca a sessão e confere as duas expirações. Em seguida recalcula o `Actor` pelo cache do bot. Se a pessoa não é mais membro, a sessão é apagada e a resposta é `401`.
- **Logout:** `POST /api/logout` apaga a sessão e o cookie.
- **CSRF:** o token é derivado da sessão por HMAC com `SESSION_SECRET`, e `GET /api/me` o entrega. Todo `POST`, `PUT`, `PATCH` e `DELETE` exige o cabeçalho `X-CSRF-Token` correto, ou recebe `403`.

### 5.4. Cabeçalhos e limites

- **Cabeçalhos de segurança** pelo plugin oficial:
  - `Content-Security-Policy`: `default-src 'self'; img-src 'self' https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, sem scripts nem estilos inline;
  - `Strict-Transport-Security`;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: same-origin`.
- **Corpo das requisições:** só JSON, com até 64 KiB.
- **Limites por sessão:** 120 requisições por minuto, das quais 30 podem ser alterações. Acima disso, `429`.
- **IP do cliente:** só é lido do cabeçalho de encaminhamento quando vem de `PANEL_TRUST_PROXY`.

### 5.5. Rotas

O formato de erro é sempre `{ "error": { "code", "message" } }`.

| Rota                         | Etapa | Permissão             | Faz                                             |
| ---------------------------- | ----- | --------------------- | ----------------------------------------------- |
| `GET /api/me`                | 1     | sessão                | ID, nome, avatar, nível, permissões, token CSRF |
| `POST /api/logout`           | 1     | sessão                | Encerra a sessão                                |
| `GET /api/status`            | 1     | desenvolvedor ou dono | Conexão com o Discord, módulos e tempo no ar    |
| `POST /api/operations/:name` | 2     | a da operação         | Executa uma operação de módulo                  |
| `GET /api/live` (WebSocket)  | 1     | sessão e `Origin`     | Eventos ao vivo e presença                      |

- **Execução de operações:** `POST /api/operations/:name` só aceita nomes registrados. Ele monta o `Actor` a partir da sessão e chama o Core, que checa a permissão e valida a entrada (§4).
- **Mapeamento de erros:** o código de erro da operação vira o status HTTP:
  - `forbidden` → 403;
  - `invalid` → 422;
  - `not_found` → 404;
  - `conflict` → 409;
  - `unavailable` → 503;
  - `failed` → 500.
- **Mensagens de erro:** `403` nunca diz qual permissão falta, e as respostas não trazem caminhos de arquivo nem rastreamento de erro.
- **Arquivos do painel:** o servidor entrega `interfaces/dashboard/app/dist` em `/`, e qualquer caminho fora de `/api` e `/auth` devolve `index.html`.

### 5.6. Tempo real ([0020](../decisions/0020-panel-realtime.md))

- **Abertura da conexão:** o upgrade só acontece com sessão válida e `Origin` igual a `PANEL_PUBLIC_URL`, e cada sessão pode ter no máximo 5 conexões. Fora disso, o servidor responde `401` ou `403` sem abrir o WebSocket.
- **Do servidor ao navegador:**
  - mensagens `{ "type", "data" }`;
  - os eventos só avisam e trazem o mínimo (IDs e versões), e os dados completos vêm de uma operação, que checa a permissão de novo;
  - a permissão é recalculada a cada envio.

| Evento enviado   | Origem                                  | Quem recebe                                  | `data`                                         |
| ---------------- | --------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `status`         | conexão com o Discord, estado de módulo | desenvolvedor ou dono                        | estado resumido                                |
| `config.changed` | `core.config.changed`                   | quem tem permissão de módulo daquele prefixo | `{ moduleId, version }`                        |
| `case.created`   | `moderation.case.created`               | `moderation.cases.read`                      | `{ caseId }`                                   |
| `case.updated`   | `moderation.case.reverted` e descarte   | `moderation.cases.read`                      | `{ caseId }`                                   |
| `presence`       | presença                                | quem tem alguma permissão nomeada            | lista de `{ userId, screen, name, avatarUrl }` |
| `session.ended`  | logout, expiração, perda de acesso      | a própria conexão, antes de fechar           | —                                              |

- **Do navegador ao servidor:** só `{ "type": "presence", "screen": "<id>" }`.
  - `screen` segue `^[a-z0-9.-]{1,40}$`, e mensagens maiores que 256 bytes são recusadas.
  - Cada conexão pode enviar no máximo 1 mensagem por segundo. Quem passa disso 10 vezes tem a conexão fechada.
  - Qualquer outro `type` fecha a conexão.
- **Presença:** só pessoas com alguma permissão nomeada aparecem e veem a presença. Membros comuns não são anunciados. A presença sai 30 s depois da última conexão da pessoa fechar.
- **Revalidação:** a cada 60 s, o servidor confere de novo a sessão e a filiação de cada conexão e fecha as inválidas.
- **Eventos do Core:** o prefixo `core.` passa a ser reservado ao Core, como `discord.`. Os eventos novos são estes:
  - `core.config.changed` `{ moduleId, version }`;
  - `core.module.state.changed` `{ moduleId, state }`;
  - `core.discord.connection.changed` `{ state }`.

### 5.7. Configuração sincronizada

- A tabela `module_config` ganha `version INTEGER NOT NULL DEFAULT 0`, incrementada a cada `setSettings`.
- As operações de configuração recebem `expectedVersion`. Se a versão atual for outra, devolvem `conflict` sem gravar, e o painel mostra "alterado por outra pessoa, recarregue".
- O `/mod config` grava sem `expectedVersion`, e a última alteração vale, como hoje.
- Cada gravação publica `core.config.changed`.

## 6. Painel (`interfaces/dashboard/app/`)

- **Pilha:** React, Vite e TypeScript `strict`, com TanStack Query para os dados do servidor e Motion para as animações. O roteamento é no navegador.
- **Menu:** é montado a partir das permissões de `GET /api/me`. Isso é só conforto visual, porque toda proteção está no servidor.
- **Dados ao vivo:** um evento ao vivo invalida a consulta correspondente do TanStack Query, que busca os dados de novo. A presença atualiza um indicador de quem está online e em qual tela.
- **Conexão:** ao perder a conexão, o painel mostra "reconectando" e tenta de novo com espera crescente, até 30 s. Ao voltar, busca tudo de novo. Com `session.ended`, volta para a tela de login.
- **Segurança no navegador:** nada de `dangerouslySetInnerHTML`, `eval` ou estilos inline (a CSP bloqueia). Textos vindos do servidor são sempre renderizados como texto.
- **Acessibilidade:** as animações respeitam `prefers-reduced-motion`, e as telas funcionam no celular.

**Telas:**

| Tela                      | Etapa | Quem vê                                  |
| ------------------------- | ----- | ---------------------------------------- |
| Login, sem acesso, erro   | 1     | qualquer pessoa                          |
| Meu perfil                | 1     | todos (casos próprios entram na etapa 2) |
| Visão geral do bot        | 1     | desenvolvedor ou dono                    |
| Casos                     | 2     | `moderation.cases.read`                  |
| Ações manuais             | 2     | `moderation.actions.*`                   |
| Domínios                  | 2     | `moderation.domains.manage`              |
| Configuração da moderação | 2     | `moderation.config.manage`               |
| Permissões dos cargos     | 3     | `administration.grants.manage`           |
| Desenvolvedores           | 3     | `core.developers.manage`                 |
| Módulos                   | 3     | `core.modules.manage`                    |
| Logs técnicos             | 3     | `core.logs.read`                         |
| Sessões                   | 3     | `core.sessions.manage`                   |

**Meu perfil:** ID, nome, avatar e nível. Os próprios casos mostram data, tipo, ação e situação. Quem moderou não aparece, para evitar retaliação.

## 7. Etapa 2: moderação

- Cada subcomando do `/mod` vira uma operação, com a mesma permissão. O handler do comando passa a ler as opções, chamar a operação e formatar o resultado.

| Operação                                                 | Permissão                   |
| -------------------------------------------------------- | --------------------------- |
| `moderation.cases.list`, `.view`                         | `moderation.cases.read`     |
| `moderation.cases.revert`, `.dismiss`                    | `moderation.cases.revert`   |
| `moderation.cases.mine`                                  | `null` (só o próprio ator)  |
| `moderation.domains.list`, `.block`, `.allow`, `.remove` | `moderation.domains.manage` |
| `moderation.config.view`, `.update`                      | `moderation.config.manage`  |
| `moderation.actions.warn`, `.timeout`, `.kick`, `.ban`   | a do subcomando             |

- **Comportamento:** as proteções, as validações e os casos gravados são os mesmos de hoje. Os testes atuais do `/mod` continuam passando sem alteração de comportamento.
- **Listagem:** `cases.list` pagina por cursor, com 50 casos por página, e filtra por situação, regra e alvo.
- **Atualização de casos:** o descarte de casos passa a publicar `moderation.case.dismissed`.
- **Configuração:** `config.update` aceita o mesmo formato parcial de `config.set` e exige `expectedVersion` (§5.7).

## 8. Etapa 3: administração ([0023](../decisions/0023-administration-module.md))

- **Serviço `admin`**, pela capacidade `core.admin`:
  - `developers.list | add | remove`;
  - `grants.list | grant | revoke`;
  - `modules.list | setEnabled`;
  - `logs.recent`;
  - `sessions.list | revoke | revokeAll`.
- **Módulo `administration`:** registra uma operação para cada função do serviço, com as permissões da [0023](../decisions/0023-administration-module.md).
- **Desenvolvedores:**
  - um desenvolvedor não remove a si mesmo pelo painel;
  - não se remove o último desenvolvedor.
- **Ligar e desligar em tempo de execução:**
  - **Desligar:** para e descarta o módulo, remove os comandos, as operações e as assinaturas dele, grava `enabled = 0` e ressincroniza os comandos no Discord. Se outro módulo ativo depende dele, a operação devolve `conflict` com a lista dos dependentes.
  - **Ligar:** cria uma instância nova pela fábrica do módulo e executa `register`, `initialize` e `start` com limite de tempo por etapa. Em seguida grava `enabled = 1` e ressincroniza os comandos. Uma falha deixa o módulo em `FAILED`, visível no painel.
  - **Exceção:** `administration` não pode ser desligado.
  - Cada mudança publica `core.module.state.changed`.
- **Logs técnicos:**
  - o Core guarda em memória as 500 entradas mais recentes, nível `info` ou acima, já com a mesma redação dos logs atuais (sem token, conteúdo nem IDs);
  - `logs.recent` lê essa memória;
  - a memória se perde ao reiniciar.
- **Sessões:** a listagem mostra usuário, criação e último uso, sem o hash. `revoke` e `revokeAll` apagam sessões e fecham as conexões ao vivo delas.

## 9. Erros

| Situação                                     | Comportamento                                                       |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Variáveis do painel incompletas ou inválidas | Painel não sobe, o log diz qual variável, o bot segue.              |
| Porta ocupada                                | Painel não sobe, o log registra, o bot segue.                       |
| Discord fora do ar no login                  | Página de erro de login; nenhuma sessão é criada.                   |
| Consulta de membro falha                     | "Tente de novo"; nunca libera na dúvida.                            |
| Sessão vencida ou pessoa saiu do servidor    | `401`, cookie apagado, conexão ao vivo fechada com `session.ended`. |
| Sem permissão                                | `403` genérico; o painel mostra "sem permissão".                    |
| Entrada inválida                             | `422` com os campos inválidos, sem ecoar o valor enviado.           |
| Configuração alterada por outra pessoa       | `409`; o painel pede para recarregar.                               |
| Ação recusada pelo Discord                   | O resultado da operação traz a mesma mensagem que o `/mod` daria.   |
| Erro inesperado num handler                  | `500` genérico; o log registra o nome do erro.                      |
| WebSocket com mensagem inválida ou excesso   | A conexão é fechada.                                                |
| Falha ao ligar um módulo                     | Módulo em `FAILED`, mensagem no painel, os outros módulos seguem.   |

## 10. Divisão em Pull Requests

**Etapa 1:**

1. **PR G — spec e decisões:** esta spec, as decisões 0017 a 0023, o ROADMAP e o `CHANGELOG.md`.
2. **PR H — Core:**
   - níveis de acesso (`isOwner`, `check`, `grant`);
   - sessões e migração `0003`;
   - prefixo `core.` reservado e eventos de conexão;
   - versão da configuração;
   - variáveis do painel.
3. **PR I — interface web:**
   - Fastify;
   - OAuth;
   - sessão e CSRF;
   - cabeçalhos e limites;
   - `/api/me`, `/api/logout` e `/api/status`;
   - WebSocket com presença e `status`;
   - entrega dos estáticos.
4. **PR J — painel base:**
   - `interfaces/dashboard/app/` com login, perfil e visão geral;
   - conexão ao vivo e presença;
   - build e testes no `npm run check` e na CI.

**Etapa 2:**

5. **PR K — operações:** contrato e registro no Core, `CORE_API_VERSION` `1.3.0`, `/mod` migrado para operações e `moderation.case.dismissed`.
6. **PR L — moderação no painel:** rota de operações, eventos de casos e de configuração, e as telas de casos, ações, domínios e configuração.

**Etapa 3:**

7. **PR M — Core e módulo:** serviço `admin`, ligar e desligar em tempo de execução, memória de logs e o módulo `administration`.
8. **PR N — telas de administração.**

**Fechamento:** depois do PR N vem a revisão ofensiva (§11.4). As correções entram em PRs próprios antes da `v0.3.0`.

Um PR que crescer demais se divide, mantendo a ordem.

## 11. Testes

### 11.1. Core

- `check`, nos quatro níveis:
  - o desenvolvedor tem tudo;
  - o dono tem as permissões de módulo e nunca `core.*`;
  - a equipe só tem as dos próprios cargos;
  - o membro não tem nenhuma.
- **Mudanças de estado:** a perda de cargo e a transferência de dono têm efeito imediato.
- **`grant`:** recusa `core.*`, `administration.*` e permissões que nenhum módulo declara.
- **Operações:**
  - com o módulo inativo, devolvem `unavailable`;
  - sem permissão, devolvem `forbidden` e o handler não roda;
  - com entrada inválida, devolvem `invalid` e o handler não roda;
  - um erro no handler vira `failed`, e o log não traz a entrada;
  - `permission: null` usa o próprio ator.
- **Sessões:**
  - o banco guarda só o hash;
  - as duas expirações são respeitadas;
  - a limpeza apaga as vencidas;
  - cada login gera um ID novo.
- **Configuração:** a versão incrementa a cada gravação, e uma `expectedVersion` errada devolve `conflict`.
- **Ligar e desligar** (etapa 3):
  - desligar remove os comandos e as operações;
  - não se desliga um módulo com dependentes;
  - ligar cria uma instância nova;
  - uma falha ao ligar deixa o módulo em `FAILED`;
  - `administration` não pode ser desligado.

### 11.2. Interface web

Os testes usam o `inject` do Fastify e o WebSocket em `127.0.0.1` numa porta aleatória, sem acesso à internet.

- **OAuth**, com um falso Discord:
  - recusa `state` errado ou ausente, `code_verifier` errado e cookie temporário vencido;
  - recusa quem não é membro, inclusive desenvolvedores, com a mensagem de segurança;
  - mostra "tente de novo" quando a consulta falha;
  - em caso de sucesso, cria a sessão e não guarda token.
- **Rotas, com cada nível:** todas as rotas e operações recebem pedidos de pessoas sem e com permissão, e as recusas são checadas tanto quanto os acessos.
- **CSRF:** a falta do token ou um token de outra sessão dão `403`.
- **Cabeçalhos:** CSP, HSTS e `nosniff` estão em todas as respostas.
- **Limites:**
  - o 11º login no minuto dá `429`;
  - um corpo acima de 64 KiB é recusado;
  - `X-Forwarded-For` só é lido quando a requisição vem do proxy confiável.
- **WebSocket:**
  - sem sessão ou com `Origin` errado, não abre;
  - sem a permissão, a pessoa não recebe `case.created`;
  - perder o cargo no meio da conexão corta os eventos;
  - uma mensagem inválida ou o excesso de mensagens fecham a conexão;
  - membros comuns não aparecem na presença;
  - com sessão revogada, recebe `session.ended` e a conexão fecha.
- **Painel opcional:** sem variáveis, o bot sobe sem painel. Com variáveis incompletas, o log não mostra os valores.

### 11.3. Painel

Vitest e Testing Library:

- o menu muda com as permissões;
- a tela de conflito aparece com `409`;
- um evento ao vivo invalida a consulta certa;
- "reconectando" aparece quando a conexão cai;
- `session.ended` leva ao login;
- nenhum componente usa `dangerouslySetInnerHTML`, com uma regra de lint.

### 11.4. Revisão ofensiva

Três subagentes independentes atacam o projeto, cada um com acesso só ao repositório:

1. **Autenticação e permissões:** fixação e roubo de sessão, `state` e PKCE, escalada de nível (membro → equipe → dono → desenvolvedor), sequestro de WebSocket, `grant` em `administration.*`.
2. **API e injeção:** entrada maliciosa nas operações, CSRF, XSS, abuso de limites, conflitos de versão e caminhos para fora de `interfaces/dashboard/app/dist`.
3. **Vazamento:** segredos no build do front, IDs e tokens em logs e respostas, eventos ao vivo para quem não pode ver, mensagens de erro reveladoras.

Cada falha é corrigida ou registrada como aceita pela pessoa mantenedora antes da release.

### 11.5. Teste manual

Atrás de um proxy HTTPS, no servidor real:

1. Uma conta de membro comum entra e vê só o perfil.
2. Uma conta de equipe vê os casos. Quando um caso novo é criado no Discord, ele aparece na hora.
3. Duas abas editam a mesma configuração, e a segunda recebe o conflito.
4. Tirar o cargo da conta de equipe fecha o acesso dela.
5. O dono associa uma permissão a um cargo.
6. Um desenvolvedor desliga e liga um módulo, e o comando some e volta no Discord.

## 12. Documentação

- `README.md`:
  - variáveis do painel;
  - cadastro do endereço de retorno no Discord Developer Portal;
  - os dois caminhos de hospedagem (VPS com Caddy ou Nginx, e túnel) e o valor de `PANEL_TRUST_PROXY` em cada um;
  - a regra de que desenvolvedores precisam ser membros, com o motivo;
  - o teste manual.
- `CONTRIBUTING.md`: a mesma regra de filiação dos desenvolvedores, explicada para quem quer participar.
- `docs/ARCHITECTURE.md` §3.4 e §6: os níveis da [0017](../decisions/0017-access-levels.md), a interface web e o tempo real.
- `docs/MODULES.md`: operações, `Actor.isOwner`, prefixo `core.` reservado e capacidade `core.admin`.
- `modules/moderation/README.md` (operações) e `modules/administration/README.md`.
- `ROADMAP.md`: decisões pendentes da Fase 3 resolvidas, etapas com link para esta spec, critérios marcados depois do teste manual.
- `CHANGELOG.md` em cada PR.

## 13. Critérios de conclusão da fase

- [ ] Toda rota e toda operação verificam permissão no backend, com testes para cada nível.
- [ ] Quem não é membro do servidor, inclusive um desenvolvedor, não acessa o painel.
- [ ] Um membro sem permissões vê só o próprio perfil.
- [ ] Uma alteração de configuração pelo painel tem efeito sem reiniciar e aparece na hora para quem está na mesma tela.
- [ ] Um caso novo aparece ao vivo só para quem tem `moderation.cases.read`.
- [ ] Ligar e desligar um módulo pelo painel funciona sem reiniciar.
- [ ] Nenhum token do Discord, segredo ou ID de sessão aparece em log, banco (exceto o hash), resposta ou build do front.
- [ ] Revisão ofensiva concluída, com as falhas corrigidas ou aceitas pela pessoa mantenedora.
