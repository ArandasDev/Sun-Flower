# 🌻 Sun Flower — Roadmap

Este documento define as fases do projeto, a ordem em que são executadas e o que significa concluir cada uma.

## Estado atual

| Fase atual                         | Situação                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fase 0 — Base do repositório**   | Concluída: ruleset `main-protection` ativo na `main`, com a CI obrigatória.                                                                                      |
| **Fase 1 — Core + Discord mínimo** | Concluída: `/ping` verificado no servidor real e diretrizes de CONTRIBUTING revisadas; release `v0.1.0` pendente.                                                |
| **Fase 2 — Moderação**             | Concluída: etapas 1 (phishing e ações manuais) e 2 (spam e flood) implementadas e verificadas no servidor real; release `v0.2.0` pendente.                       |
| **Fase 3 — Painel administrativo** | Em andamento: etapas 1 (base segura), 2 (moderação) e 3 (administração) implementadas, revisão ofensiva concluída (correções no PR O), testes manuais pendentes. |

Ao concluir uma fase, atualize esta tabela e marque a fase como concluída, no mesmo Pull Request que a encerra.

## Como uma fase é executada

1. Resolver as **decisões pendentes** da fase, cada uma registrada em `docs/decisions/`.
2. Escrever a **spec de design** da fase em `docs/specs/AAAA-MM-DD-<tema>.md` e obter aprovação da pessoa mantenedora.
3. Escrever o **plano de implementação** a partir da spec.
4. Implementar por Pull Requests pequenos, conforme [CONTRIBUTING.md](../CONTRIBUTING.md).
5. Verificar todos os **critérios de conclusão**.
6. Publicar a **release** da fase, conforme [GIT.md §6](GIT.md#6-tags-e-releases).

As recomendações listadas nas decisões pendentes são sugestões de partida. Elas só valem depois de registradas como decisão aceita.

---

## Fase 0 — Base do repositório

**Situação:** concluída.

**Objetivo:** repositório pronto para receber código com qualidade verificada automaticamente.

**Entregas:**

- Commit inicial da documentação na `main`.
- Proteções da `main` configuradas no GitHub ([GIT.md §2.1](GIT.md#21-branch-permanente)).
- Projeto Node.js + TypeScript com `tsconfig` em modo `strict`.
- Lint, formatação, checagem de tipos e testes executáveis por comandos documentados no [README](../README.md).
- CI executando lint, checagem de tipos e testes em todo Pull Request.
- `.gitignore` e `.env.example` com `DISCORD_TOKEN` e `DISCORD_GUILD_ID`.

**Decisões:** resolvidas em [0004](decisions/0004-tooling.md): Node.js 26, npm, Vitest, ESLint + Prettier, GitHub Actions.

**Spec:** [2026-11-16-fase-0-base-do-repositorio.md](specs/2026-11-16-fase-0-base-do-repositorio.md).

**Critérios de conclusão:**

- [x] Um Pull Request de teste executa a CI e ela passa.
- [x] Um push direto na `main` é bloqueado.
- [x] Os comandos de verificação estão documentados no README e funcionam em uma cópia nova do repositório.

**Release:** nenhuma.

---

## Fase 1 — Core + Discord mínimo

**Objetivo:** o Sun Flower conecta ao servidor, carrega módulos pelo contrato de [MODULES.md](MODULES.md) e responde a um comando de exemplo.

**Entregas:**

- Contrato de módulo e tipos em `shared/contracts`.
- Module Registry: descoberta, validação de manifesto, resolução de dependências e ciclo de vida completo ([MODULES.md §6](MODULES.md#6-ciclo-de-vida)).
- Event Bus local.
- Serviço de permissões (RBAC).
- Serviço de configuração por módulo.
- Logs estruturados centralizados.
- Interface Discord com `discord.js`: conexão, registro de comandos no servidor e restrição ao servidor `DISCORD_GUILD_ID` ([decisão 0003](decisions/0003-single-guild.md)).
- Módulo de exemplo `ping` com o comando `/ping`.

**Decisões:** resolvidas em [0005](decisions/0005-runtime-and-persistence.md) (TypeScript executado diretamente e SQLite embutido), [0006](decisions/0006-permission-model.md) (desenvolvedores do bot e cargos do servidor), [0007](decisions/0007-event-bus-delivery.md) (Event Bus assíncrono e isolado), [0008](decisions/0008-logging-and-validation.md) (pino e zod) e [0009](decisions/0009-api-version-compatibility.md) (`apiVersion` por SemVer completo).

**Spec:** [2026-11-16-fase-1-core-discord.md](specs/2026-11-16-fase-1-core-discord.md).

**Critérios de conclusão:**

- [x] O bot conecta ao servidor e `/ping` responde.
- [x] O bot ignora interações de outro servidor e de mensagens diretas ([decisão 0010](decisions/0010-stay-in-other-guilds.md)).
- [x] Um módulo com manifesto inválido não é iniciado, e os demais continuam funcionando.
- [x] Uma dependência circular é rejeitada.
- [x] Uma operação sem permissão é negada.
- [x] Os testes de ciclo de vida de [MODULES.md §14.4](MODULES.md#144-testes-de-ciclo-de-vida) passam.
- [x] As diretrizes de [CONTRIBUTING.md](../CONTRIBUTING.md) foram revisadas ([CONTRIBUTING.md §9](../CONTRIBUTING.md#9-governança)).

**Release:** `v0.1.0`.

---

## Fase 2 — Moderação

**Objetivo:** módulo `moderation` protegendo o servidor conforme [ARCHITECTURE.md §3.1](ARCHITECTURE.md#31-moderação-e-segurança).

**Entregas:**

- Detecção de spam em múltiplos canais e controle de frequência de mensagens.
- Identificação de links suspeitos e tentativas de phishing.
- Níveis de suspeita, diferenciando comportamento suspeito de violação confirmada.
- Ações: advertência, silenciamento (timeout), expulsão e banimento, cada uma com permissão própria.
- Registro de ocorrências e de decisões automatizadas.
- Revisão e reversão de ações pela equipe.
- Regras configuráveis pela administração.

**Decisões:** resolvidas em [0011](decisions/0011-discord-events.md) (eventos do Discord no Event Bus), [0012](decisions/0012-guild-actions.md) (ações no servidor por capacidades), [0013](decisions/0013-module-storage.md) (persistência dos módulos), [0014](decisions/0014-command-options-and-runtime-config.md) (opções de comando e configuração em tempo de execução) e [0015](decisions/0015-phishing-policy.md) (detecção de phishing local e ações automáticas ativas).

**Etapas:**

1. Phishing e ações manuais: spec [2026-11-17-fase-2-moderacao-phishing.md](specs/2026-11-17-fase-2-moderacao-phishing.md).
2. Spam e flood: spec [2026-11-18-fase-2-moderacao-spam.md](specs/2026-11-18-fase-2-moderacao-spam.md) e decisão [0016](decisions/0016-bulk-message-deletion.md) (exclusão de mensagens em lote).

**Critérios de conclusão:**

- [x] Cada regra de detecção tem testes com casos positivos e negativos (falsos positivos).
- [x] Toda ação automática fica registrada e pode ser revertida.
- [x] Nenhuma ação é executada sem a permissão correspondente.

**Release:** `v0.2.0`.

---

## Fase 3 — Painel administrativo

**Objetivo:** interface `dashboard` e módulo `administration` conforme [ARCHITECTURE.md §3.4](ARCHITECTURE.md#34-painel-administrativo).

**Entregas:**

- API do Core consumida pelo painel.
- Login no painel.
- Ativação e desativação de módulos.
- Edição das configurações dos módulos, incluindo as regras de moderação.
- Consulta de logs, histórico e estado dos módulos.
- Módulo `administration`: gestão da lista de desenvolvedores do bot e da associação de permissões aos cargos ([0006](decisions/0006-permission-model.md), [0023](decisions/0023-administration-module.md)).
- Níveis de acesso: desenvolvedores, dono do servidor, equipe e membros, que veem só o próprio perfil ([0017](decisions/0017-access-levels.md)).
- Atualizações em tempo real e presença de quem está no painel.

**Decisões:** resolvidas em [0017](decisions/0017-access-levels.md) (níveis de acesso, substituindo parte da 0006), [0018](decisions/0018-panel-authentication.md) (login com Discord OAuth2 e sessões), [0019](decisions/0019-panel-stack.md) (Fastify, React e Vite), [0020](decisions/0020-panel-realtime.md) (WebSocket filtrado por permissão), [0021](decisions/0021-panel-hosting.md) (mesmo processo, atrás de um proxy HTTPS), [0022](decisions/0022-module-operations.md) (operações de módulo), [0023](decisions/0023-administration-module.md) (módulo `administration`) e [0024](decisions/0024-panel-session-limits.md) (limites de sessões e de conexões ao vivo).

**Etapas:** spec [2026-11-24-fase-3-painel.md](specs/2026-11-24-fase-3-painel.md).

1. Base segura: níveis de acesso, login, sessão, tempo real com presença e perfil. **Implementada** (PRs H, I e J); o teste manual do [README](../README.md#painel) está pendente.
2. Moderação pelo painel: casos, ações manuais, domínios e configuração, com atualização ao vivo e "Meus casos" para todos. **Implementada** (PRs K e L); o teste manual do [README](../README.md#painel) está pendente. Limites: ainda não é possível limpar o canal de alertas nem editar os termos de isca (`baitTerms`), nem no painel nem no `/mod`.
3. Administração: desenvolvedores, permissões dos cargos, módulos, logs e sessões. **Implementada** (PRs M e N); o teste manual do [README](../README.md#painel) antes da `v0.3.0` está pendente. A revisão ofensiva (spec §11.4) foi concluída, com as correções no PR O e o registro em [docs/security](security/2026-11-25-revisao-ofensiva-fase-3.md); falta só conferir com o suporte do GitHub as cópias em cache do ID vazado antes. Limites: um módulo dependente que falhou com a dependência desligada fica `FAILED` até ser ligado; cargos e usuários são digitados como ID; os logs em memória se perdem ao reiniciar; as leituras das telas contam no limite de alterações, e separá-las depende da pessoa mantenedora.

**Critérios de conclusão:**

- [ ] Toda operação da API verifica permissão no backend.
- [ ] Quem não é membro do servidor, inclusive um desenvolvedor, não acessa o painel, e um membro sem permissões vê só o próprio perfil.
- [ ] Uma alteração de configuração pelo painel tem efeito sem reiniciar a aplicação.
- [ ] **Revisão ofensiva:** três subagentes independentes atacam o projeto como invasores, um focado em autenticação e permissões, um na API e em injeção, e um em vazamento de informações e segredos. Todas as falhas encontradas são corrigidas ou registradas como aceitas pela pessoa mantenedora antes da release. A revisão está concluída e as correções estão no PR O; falta conferir as cópias em cache no GitHub (C-6), com a pessoa mantenedora.

**Release:** `v0.3.0`.

---

## Fase 4 — Social

**Objetivo:** módulo `social` conforme [ARCHITECTURE.md §3.2](ARCHITECTURE.md#32-funcionalidades-sociais).

**Entregas:**

- Lista de desejos por membro.
- Visibilidade pública, privada ou restrita.
- Gestão de amizades e de quem pode visualizar cada lista.

**Critérios de conclusão:**

- [ ] Uma lista privada ou restrita nunca é exibida a quem não tem acesso, em nenhuma interface.

**Release:** `v0.4.0`.

---

## Fase 5 — Música

**Objetivo:** módulo `music` conforme [ARCHITECTURE.md §3.3](ARCHITECTURE.md#33-sistema-musical).

**Entregas:**

- Reprodução em canais de voz com fila compartilhada.
- Adicionar, remover e reordenar músicas; pausar, retomar, avançar, parar e ajustar volume.
- Controle pelo Discord e pelo painel, usando a mesma camada de gerenciamento.
- Permissões de uso dos comandos.

**Decisões pendentes:**

| Decisão                 | Recomendação                                                            |
| ----------------------- | ----------------------------------------------------------------------- |
| Fontes de áudio         | Decidir na spec da fase, verificando os termos de uso de cada fonte.    |
| Mecanismo de reprodução | Lavalink, para manter o processamento de áudio fora do processo do bot. |

**Critérios de conclusão:**

- [ ] Comandos do Discord e do painel produzem o mesmo resultado sobre a mesma fila.
- [ ] As fontes de áudio utilizadas têm termos de uso compatíveis com o projeto.

**Release:** `v0.5.0`.

---

## Versão 1.0.0

Publicada após a Fase 5, quando a superfície pública ([GIT.md §5.1](GIT.md#51-superfície-pública)) for declarada estável.
