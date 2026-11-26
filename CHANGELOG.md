# 🌻 Sun Flower — Changelog

Todas as alterações relevantes do Sun Flower são registradas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) e o projeto usa [Semantic Versioning](https://semver.org/). As regras de atualização estão em [docs/GIT.md §7](docs/GIT.md#7-changelog).

## [Unreleased]

### Added

- Decisão [0025](docs/decisions/0025-panel-ui-kit.md) (Tailwind CSS e shadcn/ui no painel, com nonce de estilo na CSP) e spec do novo visual do painel ([2026-11-26-painel-visual-shadcn.md](docs/specs/2026-11-26-painel-visual-shadcn.md)).
- Painel, novo visual (parte 1 de 2):
  - Tailwind CSS 4 e componentes do shadcn/ui (Radix), com tokens na regra 60-30-10 e destaque amber;
  - tema claro, escuro ou do sistema, guardado no navegador (`sunflower-theme`);
  - menu lateral agrupado (Geral, Moderação e Administração), que recolhe (estado em `sunflower-sidebar`) e vira gaveta abaixo de 768 px;
  - cabeçalho com o caminho "Você está em" e o indicador de conexão ("Conectando…", "Ao vivo" e "Reconectando…"), no lugar do aviso flutuante;
  - menu da conta com a escolha de tema e o botão Sair;
  - login, sem acesso, carregando e erro como um cartão centralizado.

### Removed

- O CSS escrito à mão do painel (`styles.css`) e a camada legada: nenhuma tela depende mais dele.

### Changed

- O item de menu `/moderacao` do painel passa a se chamar "Configuração", dentro do grupo Moderação.
- Painel, novo visual (parte 2 de 2), telas em componentes do shadcn/ui:
  - confirmações como `AlertDialog` e detalhe do caso em um `Sheet` lateral;
  - módulos ligados e desligados com um `Switch` (desligar continua pedindo confirmação);
  - tabela de Logs com o nível num `Badge` e quebra de valores longos, sem cortá-los;
  - `Skeleton` enquanto as listas carregam.
- Os toasts do painel usarão o `Toast` do Radix, não o Sonner, porque o Sonner 2.0.8 injeta um `<style>` sem nonce.

### Security

- O `index.html` do painel é entregue com um nonce de estilo novo a cada requisição (`<meta name="csp-nonce">` e `style-src 'self' 'nonce-…'`, só nessa resposta), com `Cache-Control: no-store`. `/` e `/index.html` não são mais servidos direto pelo plugin de arquivos estáticos. A CSP não usa `'unsafe-inline'`.

### Fixed

- Documentação da `v0.3.0` (ROADMAP, README e CHANGELOG): o teste manual do painel no servidor real não foi feito antes da release, ao contrário do que ela dizia. Os critérios do painel voltam a ficar abertos até esse teste.

## [0.3.0] - 2026-11-26

### Added

- Registros de decisão 0017 a 0023 (níveis de acesso com dono automático e desenvolvedores com todas as permissões, login do painel com Discord OAuth2 e sessões, Fastify, React e Vite, tempo real por WebSocket filtrado por permissão, hospedagem atrás de um proxy HTTPS, operações de módulo e módulo `administration`) e spec da Fase 3 (painel administrativo).
- Níveis de acesso (desenvolvedor, dono, equipe e membro) no serviço de permissões.
- Sessões do painel guardadas pelo sha256 do token (migração 0003).
- Eventos `core.*` e `subscribe` para as interfaces.
- Versão das configurações de módulo, com detecção de conflito.
- Validação das variáveis do painel (`PANEL_*`, `DISCORD_CLIENT_*` e `SESSION_SECRET`).
- Interface `dashboard`, iniciada com o bot quando `PANEL_PUBLIC_URL` está definida:
  - servidor Fastify só em `127.0.0.1`, com cabeçalhos de segurança, limites de requisições e corpo só em JSON;
  - login com Discord OAuth2 e PKCE, sessões com CSRF, `GET /api/me` e `POST /api/logout`;
  - `GET /api/status` (conexão com o Discord, módulos e tempo no ar) para desenvolvedores e o dono;
  - canal ao vivo `/api/live` (WebSocket) com presença e estado do bot, filtrado pelas permissões de cada pessoa.
- Diretório de membros e estado da conexão na interface Discord, que publica `core.discord.connection.changed`.
- App React do painel: login, perfil, visão geral, conexão ao vivo com reconexão automática (a espera só volta a 1 s depois de uma conexão estável) e presença de quem está no painel.
- Documentação de hospedagem do painel (Caddy, Nginx e túnel), das variáveis, do endereço de retorno no Discord e do teste manual da etapa 1.
- Core 1.3.0: operações de módulo (`ctx.operations`), com checagem de módulo, permissão e entrada antes do handler, erros tipados e log sem dados.
- O módulo `moderation` expõe operações de configuração, domínios, casos e ações manuais (`moderation.config.*`, `moderation.domains.*`, `moderation.cases.*`, `moderation.actions.*`), e o `/mod` passou a usá-las, com as respostas inalteradas.
- Evento `moderation.case.dismissed`, publicado quando um caso é descartado.
- Rota `POST /api/operations/:name` do painel, que executa operações de módulo com sessão e CSRF, valida o nome e usa o ator da sessão, com `source` `dashboard`; erros no formato padrão (403, 404, 409, 422, 500 e 503).
- Eventos ao vivo `case.created` e `case.updated`, enviados só a quem tem `moderation.cases.read`, com a permissão checada a cada envio.
- Telas de moderação do painel, cada uma visível só a quem tem a permissão:
  - Casos (`/casos`): filtros mantidos no endereço, `Carregar mais`, detalhe lateral e Reverter e Descartar com confirmação.
  - Ações (`/acoes`): aviso, timeout, expulsão e banimento, com confirmação para expulsão e banimento.
  - Domínios (`/dominios`).
  - Moderação (`/moderacao`): um botão de salvar por seção, ativo só com alterações não salvas, com `expectedVersion` e texto de conflito com `Recarregar`, mostrado também quando outra pessoa altera a configuração durante uma edição.
  - "Meus casos" em "Meu perfil", visível a todos.
- Eventos ao vivo de caso atualizam cada consulta no máximo uma vez a cada 5 s, sempre aplicando o último; um caso novo recarrega só a primeira página da lista.
- Uma resposta 401 de qualquer operação do painel leva ao login, como já acontecia com as consultas.
- Teste manual da etapa 2 e limites conhecidos no README: ainda não é possível limpar o canal de alertas (no painel, campo vazio mantém o atual) nem editar os `baitTerms`, nem no painel nem no `/mod`.
- Core 1.4.0 (aditivo), PR M da etapa 3 do painel:
  - capacidade `core.admin`, que libera `context.admin` e é a única a poder declarar permissões `core.*`;
  - ligar e desligar módulos em tempo de execução, em fila, com recusa de módulos com `core.admin` e de dependências ativas, e ressincronização dos comandos no Discord; uma falha ao ligar deixa o módulo ligado, e o log de alteração a registra com `result: 'failed'`;
  - logs recentes em memória (500 entradas de nível `info` ou acima, com redação de IDs, também em nomes de campo e números, e de campos sensíveis);
  - listagem de sessões do painel por referência opaca, sem o hash;
  - serviço `admin` (desenvolvedores, permissões de cargos, módulos, logs e sessões), com log de alteração de IDs mascarados.
- Módulo `administration` (decisão 0023), com uma operação para cada função do serviço `admin` (`administration.grants.*`, `developers.*`, `modules.*`, `logs.recent` e `sessions.*`), não desligável pelo painel.
- Telas de administração do painel, cada uma visível só a quem tem a permissão:
  - Permissões (`/permissoes`) e Desenvolvedores (`/desenvolvedores`), com confirmação para remover um desenvolvedor.
  - Módulos (`/modulos`), para ligar e desligar com o bot em execução, com confirmação para desligar.
  - Logs (`/logs`), com os registros recentes de IDs mascarados e o botão `Atualizar`.
  - Sessões (`/sessoes`), para encerrar uma sessão ou todas as de uma conta, com confirmação.
  - As telas buscam os dados ao abrir e depois de cada alteração, sem consulta periódica e sem recarregar quando a janela volta ao foco.
- Encerrar uma sessão fecha a conexão ao vivo dela na hora.
- Teste manual da etapa 3 e limites conhecidos no README: um módulo dependente que falhou fica `FAILED` até ser ligado, cargos e usuários são digitados como ID, os logs em memória se perdem ao reiniciar, as leituras das telas contam no limite de alterações e as leituras também entram no log em memória. As telas foram conferidas em um navegador, em 1024 px e em 375 px de largura, com a CSP real; o teste manual do painel no servidor real continua pendente.

### Changed

- Decisão 0006 substituída em parte pela 0017: o dono do servidor recebe as permissões de todos os módulos, e os desenvolvedores, todas as permissões.
- ROADMAP: decisões da Fase 3 resolvidas, etapas definidas e critério de acesso ajustado, porque membros sem permissões passam a ver o próprio perfil.
- Desenvolvedores recebem todas as permissões e o dono do servidor, todas as de módulo (decisão 0017).
- `npm run staff -- grant` recusa permissões que nenhum módulo declara e qualquer `administration.*`.
- A presença enviada pelo canal ao vivo passa a trazer o nome e o avatar de cada pessoa, além do ID e da tela.
- ROADMAP: revisão ofensiva da Fase 3 concluída, com o item C-6 resolvido. O teste manual do painel no servidor real ficou pendente.

### Security

Correções da revisão ofensiva da Fase 3 (PR O). O registro está em [docs/security](docs/security/2026-11-25-revisao-ofensiva-fase-3.md).

- Limites do painel ([0024](docs/decisions/0024-panel-session-limits.md)): no máximo 5 sessões por pessoa (a sexta apaga a menos usada e fecha a conexão ao vivo dela), 10 conexões ao vivo por pessoa e 500 no total.
- O limite de login e o limite sem sessão do painel passam a contar cada bloco IPv6 `/64` como um cliente, e um IPv6 que representa um IPv4 conta como o IPv4.
- Um upgrade ao vivo de uma sessão revogada durante o handshake é fechado.
- A mescla de configurações é em profundidade: uma alteração parcial de objeto aninhado não zera mais os campos vizinhos.
- Mais caracteres parecidos são reconhecidos no sinal de imitação, e uma regra nova sinaliza rótulo não ASCII a distância 1 ou menos de um domínio conhecido.
- `moderation.domains.allow` e a reversão de caso com "permitir domínios" recusam sufixos públicos e domínios que imitam um conhecido.
- Motivos com caracteres de controle de direção são recusados.
- O motivo das ações de moderação não vai mais para os logs, que trazem só `hasReason`.
- A redação dos logs cobre também `accessToken`, `refreshToken`, `clientSecret`, `access_token`, `refresh_token`, `client_secret`, `id_token`, `cookie`, `csrfToken` e `secret`, e os campos dos logs recentes não têm protótipo.
- `.gitignore` cobre `.superpowers/`, `.env.*` (menos `.env.example`) e arquivos de banco `*.db`, `*.db-wal` e `*.db-shm`.
- README: nota sobre manter `data/` fora de pastas sincronizadas e com permissão restrita.

## [0.2.0] - 2026-11-18

### Atenção: ação necessária antes de atualizar

- O bot passa a solicitar os intents privilegiados **Server Members** e **Message Content**. Ative-os no Discord Developer Portal (**Bot → Privileged Gateway Intents**) antes de atualizar; sem isso o login falha com `DisallowedIntents`.
- O módulo `moderation` começa ativo e age automaticamente: em violação confirmada, apaga a mensagem e aplica timeout sem revisão da equipe. Logo após atualizar, associe as permissões `moderation.*` aos cargos da equipe (`npm run staff -- grant`) e defina o canal de alertas com `/mod config alert-channel`; até lá, os casos são gravados sem alerta. Isente também o cargo da equipe das regras automáticas com `/mod config exempt-role <cargo da equipe> add`: as permissões `moderation.*` protegem só das ações manuais.

### Added

- Módulo `moderation`: detecção de spam e flood (regras `flood`, `repeat` e `mentions`) com exclusão em lote das mensagens do autor, punição configurável por regra e escalada para quem reincide (padrão `10m,1h,ban`). A exclusão em lote roda sempre em paralelo com a punição, inclusive no banimento; um banimento recusado aplica como plano B a punição mais grave das regras que não é `ban`. Novos comandos `/mod config spam-rule`, `spam-escalation` e `spam-ignore`, e resumo de spam em `/mod config view`.
- Core 1.2.0 (aditivo): `bulkDeleteMessages` no serviço `guild` (capacidade `guild.moderate`), que apaga até 100 mensagens em lote e, quando o Discord recusa algumas (mais de 14 dias) ou o lote falha, apaga as restantes uma a uma. Devolve o total apagado e quantas saíram individualmente (decisão 0016).
- Registros de decisão 0011 a 0015 (eventos do Discord no Event Bus, ações no servidor por capacidades, persistência dos módulos, opções de comando e configuração em tempo de execução, detecção de phishing) e spec da Fase 2, etapa 1 (moderação contra phishing).
- Registro de decisão 0016 (exclusão de mensagens em lote) e spec da Fase 2, etapa 2 (moderação contra spam e flood).
- Core da Fase 2, etapa 1:
  - Eventos `discord.message.created` e `discord.message.updated` publicados pela interface; o prefixo `discord.` é reservado ao Core.
  - Capacidades `guild.moderate` e `guild.message` no manifesto e serviço `guild` do contexto do módulo (apagar mensagem, castigo, expulsão, banimento, mensagens), com recusa registrada quando a capacidade não foi declarada. O log do Core registra o motivo de cada ação com os IDs do Discord mascarados como `[id]`; o motivo enviado ao Discord não muda.
  - Serviço `storage` e migrações SQL por módulo, com tabelas no prefixo `<id>_`.
  - Opções de comando (`options`, incluindo `choices` para texto) e `config.set` para alterar configurações em tempo de execução.
  - `npm run staff -- grant|revoke <permissão> <ID do cargo>` e `grants` para gerenciar as permissões dos cargos, com aviso quando nenhum módulo declara a permissão.
- Interface Discord da Fase 2: ações no servidor (apagar mensagem, castigo, expulsão, banimento, desbanimento, mensagens no canal e diretas, cargos do membro, com `null` para quem não é membro e `undefined` quando a consulta falha) com recusa de ações contra o próprio bot, erros mapeados para `forbidden`, `not_found` e `failed`, limite de 10 s por chamada e mensagens sem menções. O README documenta os intents privilegiados e as permissões do convite.
- Módulo `moderation`, detecção de phishing e resposta automática (Fase 2, etapa 1):
  - Extração e normalização de links como num navegador, com marcas protegidas (`discord`, `steam`) e detecção de imitações por esqueleto de caracteres parecidos e distância de edição.
  - Pontuação por sinais (`blocked`, `lookalike`, `masked`, `multiChannel`, `bait`, `massMention`, `newAccount`) com pesos e limites configuráveis, níveis `confirmed` e `suspicious` e isenção de cargos e desenvolvedores do bot.
  - Listas de domínios bloqueados e permitidos, com os domínios oficiais e os domínios conhecidos como seguros (`discord.js.org`, `steamdb.info` e outros) inseridos a cada início, e registro de casos sem o conteúdo das mensagens.
  - Proteção contra falsos positivos: nomes das marcas não contam como isca, domínios sem esquema só contam com TLD de país ou TLD genérico comum, e todo link não permitido é avaliado, sem teto de candidatos, para que links de enchimento não escondam o link real. O caso guarda até 20 domínios, primeiro os que produziram sinal.
  - Resposta automática: em `confirmed`, apaga a mensagem e aplica timeout de forma independente; grava o caso, publica `moderation.case.created` e alerta a equipe no canal `alertChannelId`, com o resultado de cada etapa e o link da mensagem quando ela não foi apagada. Em `suspicious`, apenas alerta.
- Módulo `moderation`, comando `/mod` (Fase 2, etapa 1), com respostas efêmeras e uma permissão por subcomando, checada antes de qualquer outra coisa:
  - `config view | alert-channel | timeout | thresholds | exempt-role` para a configuração em tempo de execução.
  - `domain block | allow | remove | list` para as listas de domínios, com normalização do domínio informado.
  - `case view | list | revert | dismiss` para consultar, reverter (remover timeout, desbanir e, opcionalmente, permitir os domínios do caso, exceto imitações de marcas) e descartar casos.
  - Ações manuais `warn`, `timeout`, `kick` e `ban`, que gravam um caso `manual`; `warn` envia mensagem direta ao membro. Recusam agir contra a própria pessoa, o próprio bot, desenvolvedores do bot, cargos isentos e cargos com permissão `moderation.*`; `warn`, `timeout` e `kick` exigem um membro do servidor. Se o Discord recusar a ação, ou se a consulta dos cargos do alvo falhar, nenhum caso é gravado.
- README: seção "Moderação" com as permissões a associar e o passo a passo do teste manual no servidor real.

### Changed

- Interface Discord: o adiamento automático de respostas lentas passa a ser efêmero, então uma resposta lenta nunca fica pública.
- ROADMAP: Fase 0 concluída (ruleset `main-protection` ativo, CI obrigatória).
- `CORE_API_VERSION` passa para 1.1.0, de forma aditiva: módulos com `apiVersion` 1.0.0 continuam compatíveis.
- ROADMAP: Fases 1 e 2 concluídas, com `/ping` e a moderação (phishing, spam e flood) verificados no servidor real.
- CONTRIBUTING revisado ao fim da Fase 1: autorização ao executar um plano aprovado, revisão independente de código produzido por agente (§8.4), regras para testes dependentes de tempo, valores fictícios para domínios, e-mails e IPs, e exclusão da própria branch de trabalho após o merge.

## [0.1.0] - 2026-11-18

### Added

- Documentação inicial do projeto:
  - `docs/ARCHITECTURE.md`: visão arquitetural, servidor de atuação e domínios funcionais (moderação, social, música, painel administrativo).
  - `docs/MODULES.md`: contrato de módulo, `manifest.json`, ciclo de vida, Event Bus, permissões, configurações e testes.
  - `docs/GIT.md`: branches, Conventional Commits, Pull Requests, Semantic Versioning, tags, releases e changelog.
  - `docs/ROADMAP.md`: fases 0 a 5, decisões pendentes e critérios de conclusão.
  - `CONTRIBUTING.md`: fluxo de trabalho, qualidade, documentação, segurança e regras para agentes de IA.
  - `AGENTS.md`: resumo para agentes de IA.
- Registros de decisão: Modular Monolith (0001), TypeScript + Node.js (0002), atuação exclusiva em um único servidor Discord (0003) e ferramentas de desenvolvimento (0004).
- Spec da Fase 0 (base do repositório).
- Projeto Node.js 26 + TypeScript (`strict`) com ESLint, Prettier e Vitest, executáveis por `npm run check`.
- CI no GitHub Actions executando `npm run check` em todo Pull Request para `main`.
- `.env.example` com as variáveis `DISCORD_TOKEN` e `DISCORD_GUILD_ID`.
- Registros de decisão 0005 a 0009 (execução direta de TypeScript e SQLite, modelo de permissões, Event Bus, pino e zod, compatibilidade do `apiVersion`) e spec da Fase 1.
- Core da Fase 1:
  - Module Registry: descoberta de módulos, validação de manifesto e de `apiVersion`, ordem por dependências e ciclo de vida completo com limite de tempo por etapa; um módulo com falha não impede os demais.
  - Event Bus local, assíncrono e isolado, com validação de prefixo e de eventos declarados no manifesto.
  - Serviço de permissões: desenvolvedores do bot para `core.*` e cargos do servidor para as permissões dos módulos, com negação por padrão.
  - Configuração: validação das variáveis de ambiente e da configuração de cada módulo pelo `configSchema`.
  - Logs estruturados com pino, sem token nem IDs do Discord.
  - Banco SQLite embutido (`SUNFLOWER_DB_PATH`) com migrações versionadas.
  - Encerramento controlado em `SIGINT`/`SIGTERM`, com prazo de 15 segundos (código 1 se for excedido), e registro `fatal` com código 1 em erros não tratados.
- Interface Discord: atuação exclusiva no servidor `DISCORD_GUILD_ID` (ignora interações de outros servidores e as mensagens diretas, sem sair dos servidores — decisão 0010), sincronização dos comandos dos módulos no servidor, adiamento automático de respostas lentas, erros sem detalhes internos e respostas sem menções. Iniciada por `npm start`.
- Comando `npm run staff -- add|remove|list` para gerenciar os desenvolvedores do bot sem conectar ao Discord.
- Módulo `ping`: comando `/ping`, que responde `Pong!`.

### Changed

- **BREAKING:** `apiVersion` do manifesto passa a ser a versão SemVer completa do contrato do Core (`"1.0.0"`), com compatibilidade por `MAJOR` igual e `MINOR.PATCH` menor ou igual ao do Core.
- Permissões em duas camadas: lista de desenvolvedores do bot para as permissões `core.*` e cargos do servidor para as permissões dos módulos; o dono e os administradores do servidor não recebem permissões automáticas.
- Fase 3 do ROADMAP passa a exigir revisão ofensiva por três subagentes antes da release.

[Unreleased]: https://github.com/ArandasDev/Sun-Flower/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ArandasDev/Sun-Flower/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ArandasDev/Sun-Flower/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ArandasDev/Sun-Flower/releases/tag/v0.1.0
