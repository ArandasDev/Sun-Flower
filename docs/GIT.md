# 🌻 Sun Flower — Git, Versionamento e Releases

> Este documento é a **fonte única** das regras de branches, commits, Pull Requests, versionamento, tags, releases e changelog.
> O fluxo de trabalho geral está em [`CONTRIBUTING.md`](../CONTRIBUTING.md), que remete para cá.
> Mudanças nestas regras são feitas por Pull Request.

**Nomenclatura do projeto:** o nome do produto é **Sun Flower**. O identificador técnico, usado no repositório e nos nomes de releases, é **`Sun-Flower`**.

**Idioma:** nomes técnicos (branches, commits, código) em inglês. Documentação e comunicação em português.

## 1. Princípios

1. `main` é estável e sempre representa uma versão utilizável do projeto.
2. Nenhuma alteração entra em `main` por push direto: toda mudança passa por Pull Request.
3. Cada Pull Request tem um único objetivo e escopo pequeno o suficiente para ser revisado.
4. Versões publicadas seguem **Semantic Versioning (SemVer)**.
5. Pessoas e agentes de IA seguem exatamente as mesmas regras.
6. Segredos, credenciais, tokens e dados pessoais nunca entram no Git.

## 2. Branches

### 2.1. Branch permanente

| Branch | Finalidade |
|---|---|
| `main` | Código estável, revisado e pronto para uso ou publicação. |

Não existe branch `develop`. Ela só será criada se uma etapa permanente de homologação se tornar necessária, por decisão registrada em `docs/decisions/`.

Proteções obrigatórias de `main` no GitHub:

- Bloquear push direto, force push e exclusão.
- Exigir Pull Request para integração.
- Exigir que as verificações automatizadas (CI) passem.
- Exigir resolução das conversas de revisão antes do merge.
- Exigir a aprovação de uma pessoa mantenedora **a partir do momento em que o projeto tiver mais de uma pessoa mantenedora**. Enquanto houver apenas uma, a aprovação é dispensada, mas a CI continua obrigatória.

### 2.2. Branches de trabalho

Toda branch de trabalho parte da versão atualizada de `main`.

| Prefixo | Quando utilizar |
|---|---|
| `feature/` | Nova funcionalidade ou comportamento. |
| `fix/` | Correção de defeito sem caráter emergencial. |
| `hotfix/` | Correção crítica que precisa chegar rapidamente à `main`. |
| `docs/` | Alterações exclusivamente de documentação. |
| `refactor/` | Reorganização interna sem mudança intencional de comportamento. |
| `test/` | Criação ou ajuste de testes, sem alterar código de produção. |
| `chore/` | Dependências, configurações, scripts e manutenção geral. |
| `ci/` | Pipelines e automações de integração contínua. |
| `perf/` | Melhoria de desempenho. |
| `build/` | Sistema de build e empacotamento. |

Regras de nome:

- Letras minúsculas, palavras separadas por hífen (`kebab-case`).
- Sem espaços, acentos ou caracteres especiais.
- Descrever a intenção, nunca a pessoa responsável.
- Quando a alteração pertencer a um módulo, começar a descrição pelo id do módulo.

Exemplos:

```text
feature/core-module-registry
feature/moderation-spam-detection
fix/core-manifest-validation
hotfix/discord-guild-guard
docs/roadmap
refactor/core-event-bus
test/core-lifecycle-contracts
chore/update-dependencies
ci/add-test-workflow
perf/moderation-rate-tracking
build/typescript-config
```

Nomes proibidos por serem genéricos: `feature/new-feature`, `fix/bug`, `update`, `development`, `test-branch`.

### 2.3. Ciclo de vida de uma branch

1. Atualizar a referência local de `main`.
2. Criar a branch a partir de `main`.
3. Implementar uma alteração por objetivo.
4. Executar os testes e verificações.
5. Fazer commits seguindo a seção 3.
6. Publicar a branch e abrir um Pull Request para `main`.
7. Corrigir os apontamentos da revisão e aguardar a CI.
8. Integrar com **Squash and merge**.
9. Excluir a branch após o merge.

Uma branch não é reutilizada para outro objetivo. Se o escopo mudar substancialmente, cria-se uma nova branch.

### 2.4. Hotfix

Uma `hotfix/*` também parte de `main` e é integrada por Pull Request. Mesmo urgente, exige CI verde e o registro da motivação na descrição do Pull Request. Se a correção afetar uma versão já publicada, é publicada uma nova versão `PATCH` logo após o merge.

## 3. Commits

O Sun Flower utiliza **Conventional Commits**.

### 3.1. Estrutura

```text
<tipo>[(escopo)][!]: <descrição>

[corpo]

[rodapés]
```

A descrição:

- Começa com letra minúscula.
- Está no imperativo, em inglês (`add`, `fix`, `remove`).
- Não termina com ponto final.
- Diz o que o commit faz, não qual arquivo foi alterado.

### 3.2. Tipos

| Tipo | Uso |
|---|---|
| `feat` | Adiciona uma funcionalidade. |
| `fix` | Corrige um defeito. |
| `docs` | Altera documentação. |
| `style` | Altera formatação sem mudar lógica. |
| `refactor` | Reorganiza código sem adicionar funcionalidade nem corrigir defeito. |
| `perf` | Melhora desempenho. |
| `test` | Adiciona ou corrige testes. |
| `build` | Altera build, empacotamento ou dependências de build. |
| `ci` | Altera pipelines de integração contínua. |
| `chore` | Manutenção que não se encaixa nos tipos anteriores. |
| `revert` | Reverte um commit anterior. |

### 3.3. Escopos

Escopos oficiais:

| Escopo | Área |
|---|---|
| `core` | Núcleo da aplicação (registry, ciclo de vida, Event Bus, permissões, configuração, logs). |
| `discord` | Interface com o Discord. |
| `dashboard` | Interface do painel web. |
| `api` | API consumida pelo painel e por integrações. |
| `moderation` | Módulo de moderação. |
| `social` | Módulo social. |
| `music` | Módulo musical. |
| `administration` | Módulo administrativo. |
| `shared` | Contratos, tipos e utilitários compartilhados. |
| `deps` | Dependências. |
| `docs` | Documentação geral. |

Regra: o escopo é **obrigatório** quando a alteração afeta uma única área da tabela e **omitido** quando afeta várias. Um novo módulo adiciona seu id a esta tabela no mesmo Pull Request que o cria.

### 3.4. Exemplos

```text
feat(core): add module manifest validation
feat(moderation): detect multi-channel spam
feat(music): implement shared playback queue
fix(discord): ignore events from other guilds
fix(core): reject circular module dependencies
docs(docs): add project roadmap
refactor(core): isolate event dispatcher
test(moderation): cover rate limit rules
chore(deps): update discord.js
ci: add lint and test workflow
```

### 3.5. Alterações incompatíveis (Breaking Changes)

Uma alteração é incompatível quando quebra algum item da **superfície pública** definida na seção 5.1. Ela é sinalizada com `!` e explicada em um rodapé `BREAKING CHANGE:` com o impacto e o procedimento de migração:

```text
feat(core)!: change module registration contract

BREAKING CHANGE: register() now receives a ModuleContext instead of the raw client.
Modules must read the Discord client from context.discord.
```

Refatorações internas que não afetam a superfície pública não são marcadas como incompatíveis.

### 3.6. Commits com participação de IA

O rodapé `Co-Authored-By:` **não é autorizado** em nenhum commit do Sun Flower, inclusive para identificar agentes de IA. Commits com esse rodapé não são integrados.

A participação de IA é informada exclusivamente na seção **Uso de IA** da descrição do Pull Request ([seção 4.2](#42-descrição)).

### 3.7. Boas práticas

- Não usar mensagens genéricas (`update`, `changes`, `ajustes`, `fix stuff`, `final`).
- Não misturar alterações independentes em um único commit.
- Não versionar arquivos gerados, dependências instaladas ou artefatos locais.
- Revisar `git status` e `git diff` antes de cada commit.

## 4. Pull Requests

### 4.1. Título

O título segue Conventional Commits, pois se torna a mensagem do commit de squash:

```text
feat(core): add module manifest validation
```

### 4.2. Descrição

Toda descrição contém as seções abaixo. Uma seção que não se aplica recebe o texto `Não se aplica`.

- **Contexto:** problema ou necessidade que motivou a mudança.
- **Alterações:** o que foi implementado e os principais arquivos modificados.
- **Validação:** comandos de teste executados e seus resultados reais.
- **Impactos:** efeitos em outros módulos, superfície pública, configuração, persistência ou segurança.
- **Uso de IA:** quais partes foram produzidas ou modificadas com auxílio de IA.
- **Referências:** issue, fase do [ROADMAP](ROADMAP.md) ou spec relacionada.

### 4.3. Critérios para merge

- [ ] O escopo é único e não há alterações sem relação com o objetivo.
- [ ] O código respeita [ARCHITECTURE.md](ARCHITECTURE.md) e [MODULES.md](MODULES.md).
- [ ] Testes relevantes foram adicionados ou atualizados.
- [ ] A CI passou.
- [ ] A documentação afetada e o `CHANGELOG.md` foram atualizados.
- [ ] Não há segredos, credenciais ou dados sensíveis.
- [ ] Alterações incompatíveis estão marcadas e documentadas.
- [ ] Todas as conversas de revisão foram resolvidas.

### 4.4. Merge

O método de integração é **Squash and merge**. Outro método só é usado com aprovação explícita de uma pessoa mantenedora, registrada no Pull Request.

## 5. Versionamento (SemVer)

Formato: `MAJOR.MINOR.PATCH`.

### 5.1. Superfície pública

A versão do Sun Flower reflete a compatibilidade da sua superfície pública, composta por:

- O contrato de módulo e o formato do `manifest.json` ([MODULES.md](MODULES.md)).
- Os nomes e formatos dos eventos do Event Bus.
- Os nomes das permissões.
- Os comandos do Discord disponíveis aos membros.
- A API consumida pelo painel.
- As variáveis de ambiente e chaves de configuração.

### 5.2. Regras a partir da 1.0.0

| Incremento | Quando | Exemplo |
|---|---|---|
| `MAJOR` | Alteração incompatível na superfície pública. | `1.4.2 → 2.0.0` |
| `MINOR` | Nova funcionalidade compatível. Zera `PATCH`. | `1.4.2 → 1.5.0` |
| `PATCH` | Correção compatível, sem nova funcionalidade. | `1.4.2 → 1.4.3` |

### 5.3. Regras antes da 1.0.0

Enquanto o projeto estiver em `0.y.z`:

- Alteração incompatível **ou** nova funcionalidade incrementa `y` e zera `z`: `0.2.1 → 0.3.0`.
- Correção compatível incrementa `z`: `0.3.0 → 0.3.1`.
- Alterações incompatíveis continuam sendo marcadas com `!` e documentadas.

A `1.0.0` é publicada quando as fases 1 a 5 do [ROADMAP](ROADMAP.md) estiverem concluídas e a superfície pública for declarada estável.

### 5.4. Versão dos módulos

Cada módulo tem versão SemVer própria no seu `manifest.json`, independente da versão do Sun Flower. As regras estão em [MODULES.md](MODULES.md#16-versionamento-e-compatibilidade).

## 6. Tags e Releases

### 6.1. Formatos

| Item | Formato | Exemplo |
|---|---|---|
| Tag Git (anotada) | `vMAJOR.MINOR.PATCH` | `v0.1.0` |
| Mensagem da tag | `Sun-Flower vMAJOR.MINOR.PATCH` | `Sun-Flower v0.1.0` |
| Nome da Release | `Sun-Flower vMAJOR.MINOR.PATCH` | `Sun-Flower v0.1.0` |
| Pré-release | `vMAJOR.MINOR.PATCH-<estágio>.<n>` | `v1.0.0-rc.1` |

Estágios de pré-release:

- `alpha`: funcionalidades ainda incompletas.
- `beta`: funcionalidades principais presentes; foco em estabilização.
- `rc`: candidata à versão final, sem problemas conhecidos que impeçam a publicação.

Pré-releases são marcadas como **pre-release** no GitHub.

### 6.2. Conteúdo da Release

1. Resumo das principais mudanças.
2. Novas funcionalidades.
3. Correções relevantes.
4. Alterações incompatíveis e instruções de migração.
5. Alterações de configuração ou variáveis de ambiente.
6. Problemas conhecidos.

Uma Release só anuncia o que está presente no código publicado.

### 6.3. Processo de publicação

Somente uma pessoa mantenedora publica releases.

1. Confirmar que os Pull Requests da versão estão integrados à `main` e que a CI passou.
2. Definir o número da versão pelas regras da seção 5.
3. Mover o conteúdo de `Unreleased` do `CHANGELOG.md` para a nova versão, com a data do dia da publicação, por Pull Request.
4. Criar a tag anotada no commit exato que será publicado:

   ```bash
   git switch main
   git pull origin main
   git tag -a v0.1.0 -m "Sun-Flower v0.1.0"
   git push origin v0.1.0
   ```

5. Criar a Release no GitHub com o mesmo número da tag.

Uma tag publicada nunca é movida. Um erro em uma release é corrigido com uma nova versão.

## 7. Changelog

O `CHANGELOG.md` fica na raiz do repositório e segue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Regras:

1. Toda alteração relevante para quem usa, administra ou integra o Sun Flower é registrada em `Unreleased` no mesmo Pull Request que a introduz.
2. As entradas são agrupadas nas categorias `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` e `Security`. Categorias vazias não aparecem.
3. Cada entrada é uma frase objetiva e, quando houver, cita o módulo afetado.
4. Alterações incompatíveis começam com **BREAKING:**.
5. Versões aparecem da mais recente para a mais antiga, e o histórico de versões anteriores nunca é editado.
6. Alterações internas sem efeito para quem usa o projeto não entram no changelog.

## 8. Higiene do repositório

- Nenhuma informação não pública entra no repositório ([CONTRIBUTING.md §7.1](../CONTRIBUTING.md#71-informações-não-públicas)).
- O e-mail de autor e committer de todo commit é o endereço *noreply* do GitHub (`<id>+<usuário>@users.noreply.github.com`), configurado com `git config user.email` no repositório local. A opção **Block command line pushes that expose my email** fica ativada nas configurações de e-mail da conta GitHub.
- `.env`, credenciais, tokens, chaves privadas e arquivos locais ficam fora do versionamento (`.gitignore`).
- O repositório mantém um `.env.example` com os nomes das variáveis e valores vazios ou fictícios.
- Dependências novas têm licença verificada e necessidade justificada no Pull Request.
- Dumps de banco, logs com dados pessoais e arquivos temporários não são versionados.
- Se um segredo for enviado ao repositório, a credencial é **revogada ou rotacionada imediatamente**; removê-la do histórico não basta.
- Se uma informação não pública que não pode ser trocada (como um ID) for enviada, ela é removida da branch e do histórico reescrito, e a pessoa mantenedora avalia pedir ao GitHub Support a remoção das referências restantes (Pull Requests fechados e caches).

## 9. Referências

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning 2.0.0](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [Git documentation](https://git-scm.com/doc)
