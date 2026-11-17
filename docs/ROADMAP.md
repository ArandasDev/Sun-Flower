# 🌻 Sun Flower — Roadmap

Este documento define as fases do projeto, a ordem em que são executadas e o que significa concluir cada uma.

## Estado atual

| Fase atual                         | Situação                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fase 0 — Base do repositório**   | Em andamento: projeto TypeScript e CI em revisão; falta importar o ruleset da `main`.                                                       |
| **Fase 1 — Core + Discord mínimo** | Em revisão: Core, interface Discord, comando `staff` e módulo `ping` implementados; falta a verificação manual de `/ping` no servidor real. |

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

- [ ] Um Pull Request de teste executa a CI e ela passa.
- [ ] Um push direto na `main` é bloqueado.
- [ ] Os comandos de verificação estão documentados no README e funcionam em uma cópia nova do repositório.

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

- [ ] O bot conecta ao servidor e `/ping` responde.
- [ ] O bot ignora eventos de outro servidor e sai dele quando adicionado.
- [ ] Um módulo com manifesto inválido não é iniciado, e os demais continuam funcionando.
- [ ] Uma dependência circular é rejeitada.
- [ ] Uma operação sem permissão é negada.
- [ ] Os testes de ciclo de vida de [MODULES.md §14.4](MODULES.md#144-testes-de-ciclo-de-vida) passam.
- [ ] As diretrizes de [CONTRIBUTING.md](../CONTRIBUTING.md) foram revisadas ([CONTRIBUTING.md §9](../CONTRIBUTING.md#9-governança)).

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

**Decisões pendentes:**

| Decisão                                   | Recomendação                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Fonte de detecção de phishing             | Lista de domínios mantida localmente e atualizável, sem dependência obrigatória de serviço externo. |
| Ações automáticas na configuração inicial | Desativadas: o módulo apenas registra e alerta até a administração ativá-las.                       |

**Critérios de conclusão:**

- [ ] Cada regra de detecção tem testes com casos positivos e negativos (falsos positivos).
- [ ] Toda ação automática fica registrada e pode ser revertida.
- [ ] Nenhuma ação é executada sem a permissão correspondente.

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
- Módulo `administration`: gestão da lista de desenvolvedores do bot e da associação de permissões aos cargos ([0006](decisions/0006-permission-model.md)).

**Decisões pendentes:**

| Decisão                | Recomendação                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Autenticação do painel | Login com Discord (OAuth2), permitido apenas a desenvolvedores do bot ([0006](decisions/0006-permission-model.md)). |
| Framework do painel    | Decidir na spec da fase.                                                                                            |
| Hospedagem do painel   | Mesmo processo do bot, servindo a API e o painel.                                                                   |

**Critérios de conclusão:**

- [ ] Toda operação da API verifica permissão no backend.
- [ ] Um membro sem permissão não acessa o painel.
- [ ] Uma alteração de configuração pelo painel tem efeito sem reiniciar a aplicação.
- [ ] **Revisão ofensiva:** três subagentes independentes atacam o projeto como invasores, um focado em autenticação e permissões, um na API e em injeção, e um em vazamento de informações e segredos. Todas as falhas encontradas são corrigidas ou registradas como aceitas pela pessoa mantenedora antes da release.

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
