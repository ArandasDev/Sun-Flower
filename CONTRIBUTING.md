# 🌻 Sun Flower — Contributing Guidelines

## 1. Introdução

Este documento descreve **como contribuir** com o Sun Flower: o que ler antes, o fluxo de trabalho, os requisitos de qualidade, as regras de documentação e segurança, e as regras para agentes de IA.

As regras de branches, commits, Pull Requests, versionamento, releases e changelog estão **somente** em [`docs/GIT.md`](docs/GIT.md).

Estas regras valem igualmente para pessoas desenvolvedoras e agentes de inteligência artificial.

## 2. Antes de contribuir

Leia, nesta ordem:

| Documento                                      | Conteúdo                                              |
| ---------------------------------------------- | ----------------------------------------------------- |
| [`README.md`](README.md)                       | O que é o projeto e seu estado atual.                 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)           | Fases, fase atual e próxima entrega.                  |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Visão arquitetural e domínios funcionais.             |
| [`docs/MODULES.md`](docs/MODULES.md)           | Contrato técnico dos módulos.                         |
| [`docs/GIT.md`](docs/GIT.md)                   | Branches, commits, Pull Requests, versões e releases. |
| [`docs/decisions/`](docs/decisions/)           | Decisões já tomadas e seus motivos.                   |

Uma contribuição que contrarie uma decisão registrada em `docs/decisions/` precisa primeiro de uma nova decisão que a substitua.

## 3. Princípios

- **Consistência:** seguir os padrões de nomenclatura, organização e implementação existentes.
- **Rastreabilidade:** toda alteração tem um histórico identificável (branch, commits, Pull Request).
- **Isolamento:** cada Pull Request trata de uma única funcionalidade ou correção.
- **Qualidade:** código novo vem acompanhado de testes.
- **Compatibilidade:** alterações incompatíveis só entram quando justificadas e documentadas.
- **Documentação:** a documentação afetada é atualizada no mesmo Pull Request.
- **Revisão:** nada entra na `main` sem Pull Request.

## 4. Fluxo de trabalho

1. Escolher a tarefa a partir da fase atual do [ROADMAP](docs/ROADMAP.md).
2. Se a tarefa criar um módulo, um subsistema do Core ou alterar a superfície pública, escrever antes uma spec de design em `docs/specs/` e obter aprovação da pessoa mantenedora.
3. Criar a branch conforme [GIT.md §2](docs/GIT.md#2-branches).
4. Implementar, escrevendo os testes junto com o código.
5. Executar todas as verificações da seção 5.
6. Fazer commits conforme [GIT.md §3](docs/GIT.md#3-commits).
7. Abrir o Pull Request conforme [GIT.md §4](docs/GIT.md#4-pull-requests).
8. Corrigir os apontamentos e aguardar a CI.
9. A pessoa mantenedora integra com Squash and merge.

## 5. Qualidade e testes

Toda contribuição de código inclui:

- Testes unitários para regras de negócio.
- Testes de integração para comunicação entre componentes (Core, Event Bus, persistência, Discord).
- Teste de regressão para toda correção de defeito.
- Testes de permissão para toda operação protegida.
- Testes de condições de erro.

Os tipos de teste exigidos de cada módulo estão em [MODULES.md §14](docs/MODULES.md#14-testes).

Verificação obrigatória antes de abrir um Pull Request: **`npm run check`**, que executa formatação, lint, checagem de tipos e testes. É o mesmo comando executado pela CI. Os comandos individuais estão no [README](README.md#desenvolvimento).

Um teste só é declarado aprovado se foi efetivamente executado. Quando um teste não puder ser executado, isso é dito explicitamente no Pull Request, com o motivo.

## 6. Documentação

Atualize no mesmo Pull Request o documento correspondente à alteração:

| Alteração                                            | Documento                |
| ---------------------------------------------------- | ------------------------ |
| Visão geral, domínios ou princípios arquiteturais    | `docs/ARCHITECTURE.md`   |
| Contrato de módulo, manifesto, eventos, permissões   | `docs/MODULES.md`        |
| Regras de Git, versão ou release                     | `docs/GIT.md`            |
| Regras de colaboração                                | `CONTRIBUTING.md`        |
| Escopo, ordem ou conclusão de fases                  | `docs/ROADMAP.md`        |
| Uso, instalação ou configuração                      | `README.md`              |
| Funcionamento de um módulo                           | `modules/<id>/README.md` |
| Qualquer alteração relevante para quem usa o projeto | `CHANGELOG.md`           |

### 6.1. Registros de decisão

Toda decisão que escolha uma tecnologia, altere a arquitetura, altere um contrato entre módulos ou resolva uma decisão pendente do ROADMAP gera um registro em `docs/decisions/NNNN-titulo.md`, com as seções **Status**, **Contexto**, **Decisão** e **Consequências**.

Uma decisão aceita não é editada: ela é substituída por uma nova, e a antiga passa ao status `Substituída por NNNN`.

## 7. Segurança

É proibido:

- Publicar tokens, senhas ou credenciais.
- Armazenar segredos no código; eles vêm de variáveis de ambiente.
- Ignorar ou contornar verificações de autorização.
- Expor dados do servidor ou de seus membros fora dos canais e interfaces autorizados.
- Introduzir dependências sem justificar a necessidade no Pull Request.
- Desabilitar proteções existentes sem autorização da pessoa mantenedora.

Vulnerabilidades são comunicadas diretamente à pessoa mantenedora, nunca em issues ou canais públicos, até serem corrigidas.

### 7.1. Informações não públicas

O repositório é **público**. Tudo o que entra nele (arquivos, mensagens de commit, metadados de autor, títulos, descrições e comentários de Pull Requests e issues) deve ser considerado publicado para sempre.

As informações abaixo nunca entram no repositório, em nenhum desses lugares:

| Categoria                  | Exemplos                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Identificadores do Discord | IDs de servidor, canal, cargo, usuário, mensagem ou aplicação.                         |
| Credenciais                | Tokens, senhas, chaves de API, client secrets, webhooks.                               |
| Dados pessoais             | E-mails, nomes reais, telefones, endereços, nomes de usuário de membros.               |
| Infraestrutura             | IPs, hostnames internos, URLs privadas, caminhos locais da máquina de desenvolvimento. |
| Conteúdo do servidor       | Mensagens, nomes de canais ou cargos privados, dados de membros.                       |

Esses valores ficam somente no `.env` local ou no ambiente de execução. Documentação, exemplos e testes usam o nome da variável de ambiente (`DISCORD_GUILD_ID`) ou valores fictícios claramente falsos (`000000000000000000`).

Commits usam como e-mail de autor o endereço _noreply_ do GitHub ([GIT.md §8](docs/GIT.md#8-higiene-do-repositório)).

### 7.2. Verificação de vazamento antes do Pull Request

Antes de abrir ou atualizar um Pull Request, é obrigatório verificar se há informação não pública em:

1. Todos os arquivos alterados e o conteúdo completo dos arquivos novos.
2. As mensagens de todos os commits da branch.
3. Os e-mails de autor e committer de todos os commits da branch.
4. O título e a descrição do Pull Request.

Quando a contribuição é feita por agente de IA, essa verificação é executada por **subagentes revisores independentes**, sem acesso ao contexto da implementação, e o resultado é informado na seção **Validação** do Pull Request. Uma ocorrência encontrada bloqueia o Pull Request até ser removida da branch, inclusive do histórico dos commits.

Se uma informação não pública chegar a um commit já publicado, siga o procedimento de [GIT.md §8](docs/GIT.md#8-higiene-do-repositório) para segredos vazados.

As regras de higiene do repositório (`.env`, `.env.example`, segredos vazados) estão em [GIT.md §8](docs/GIT.md#8-higiene-do-repositório).

## 8. Agentes de IA

Agentes de IA seguem todas as regras deste documento e de `docs/GIT.md`, mais as abaixo.

**Autorização explícita** significa um pedido direto da pessoa mantenedora, na tarefa atual, para aquela ação específica. Uma autorização não vale para tarefas seguintes nem para ações diferentes.

### 8.1. O agente sempre

- Lê os documentos da seção 2 antes de alterar o projeto.
- Trabalha em uma branch de trabalho, nunca diretamente na `main`.
- Limita as alterações ao escopo solicitado e justifica qualquer arquivo alterado fora dele.
- Identifica impactos em outros módulos.
- Executa os testes disponíveis e informa os comandos e os resultados reais.
- Informa limitações, suposições e pontos que exigem revisão humana.
- Sinaliza código gerado, migrações, mudanças de schema e impactos de segurança.
- Identifica sua participação somente na seção **Uso de IA** do Pull Request, sem rodapé `Co-Authored-By:` nos commits ([GIT.md §3.6](docs/GIT.md#36-commits-com-participação-de-ia)).

### 8.2. O agente nunca, sem autorização explícita

- Faz commit, push, merge, tag ou release.
- Executa comandos destrutivos (`git reset --hard`, `git clean -fd`, force push, exclusão de branches ou arquivos de outras pessoas).
- Altera configurações protegidas, workflows de CI, permissões ou dependências.

### 8.3. O agente nunca, em nenhuma hipótese

- Inventa resultados de testes, validações ou revisões.
- Afirma que algo funciona sem ter executado ou validado.
- Remove testes ou reduz verificações para fazer uma alteração passar.

A revisão humana é responsável por aceitar ou rejeitar a contribuição. Código produzido por IA não recebe tratamento especial nem dispensa testes.

## 9. Governança

Alterações nestas regras são feitas por Pull Request, com justificativa, e aprovadas pela pessoa mantenedora.

Estas diretrizes são revisadas ao fim da Fase 1 do [ROADMAP](docs/ROADMAP.md), para corrigir regras que se mostrarem difíceis de aplicar.

---

**Sun Flower Development Team**

_Contribuir é construir de maneira consistente, organizada e sustentável._
