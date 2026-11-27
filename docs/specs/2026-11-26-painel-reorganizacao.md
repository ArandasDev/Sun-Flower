# Spec — Painel: reorganização estrutural

**Status:** Implementada em 2026-11-26. Aprovada em 2026-11-26, por pedido direto da pessoa mantenedora ("reorganização estrutural para melhorar hierarquia visual, navegação, distribuição de informações e consistência dos componentes").
**Base:** [2026-11-26-painel-visual-shadcn.md](2026-11-26-painel-visual-shadcn.md) e [0025](../decisions/0025-panel-ui-kit.md). Não há tecnologia nova, então não há decisão nova.

## 1. Problemas encontrados

Conferidos no navegador, com o build e dados falsos:

1. **Larguras desiguais.** Visão geral, Ações e Configuração ocupam metade da tela. Permissões, Desenvolvedores e Domínios ocupam a largura toda.
2. **Cabeçalhos de página diferentes.** Casos, Ações e Visão geral não têm descrição, e nenhuma tela tem lugar para a ação principal.
3. **Formulários de adicionar soltos.** Em Desenvolvedores, Permissões e Domínios, eles ficam como um bloco à parte acima da tabela, com o mesmo peso dela.
4. **Botões vermelhos sólidos em cada linha.** "Remover" e "Encerrar" competem com o conteúdo. Sessões tem dois botões vermelhos por linha.
5. **Título e trilha divergentes.** Em `/moderacao`, a trilha diz "Configuração" e o título diz "Moderação".
6. **Visão geral pobre.** Ela traz só dois valores e repete a lista de módulos da tela Módulos.
7. **Casos fora do padrão.** A lista é de linhas de texto, enquanto as outras listas são tabelas.
8. **Estados vazios e avisos inconsistentes.** Cada tela usa um texto solto diferente, e erros, conflitos e resultados têm estilos próprios.

## 2. Estrutura de página

Toda tela do painel segue a mesma estrutura:

- **Contêiner:** `mx-auto w-full max-w-6xl`, com espaço de 24 px entre os blocos.
- **`PageHeader`:** o título (`h1`) é igual ao item do menu. Abaixo dele vem uma descrição de uma linha, e à direita fica a ação principal da tela, quando houver. No celular, a ação desce para baixo do texto.
- **Blocos:** cada bloco é um `Card`, com `CardHeader`, que traz título e descrição, e uma barra de ferramentas à direita (busca, filtros e "Atualizar"). O conteúdo vem em `CardContent`, e o rodapé (`CardFooter`), quando há, traz "Salvar" ou "Carregar mais".
- **Formulários:** ficam num `Card` com no máximo 768 px (`max-w-3xl`). Tabelas ocupam o contêiner todo.

**Títulos e descrições:**

| Rota               | Título          | Descrição                                                                 |
| ------------------ | --------------- | ------------------------------------------------------------------------- |
| `/`                | Meu perfil      | Seus dados no servidor e os casos de moderação sobre você.                |
| `/visao-geral`     | Visão geral     | Estado do bot, dos módulos e de quem está no painel.                      |
| `/casos`           | Casos           | Ocorrências registradas pela moderação automática e pela equipe.          |
| `/acoes`           | Ações           | Advertir, silenciar, expulsar ou banir um membro. Cada ação vira um caso. |
| `/dominios`        | Domínios        | Texto atual.                                                              |
| `/moderacao`       | Configuração    | Regras da moderação automática. Cada seção é salva separadamente.         |
| `/permissoes`      | Permissões      | Texto atual.                                                              |
| `/desenvolvedores` | Desenvolvedores | Texto atual.                                                              |
| `/modulos`         | Módulos         | Texto atual.                                                              |
| `/logs`            | Logs            | Texto atual.                                                              |
| `/sessoes`         | Sessões         | Texto atual.                                                              |

## 3. Distribuição por tela

- **Visão geral:**
  - uma grade de quatro indicadores ("Conexão", "Tempo no ar", "Módulos ativos", com o valor "N de M", e "No painel agora", com o número de pessoas da presença);
  - abaixo dela, um `Card` "Módulos" com a situação de cada um e o link "Gerenciar módulos" para `/modulos`. O link só aparece para quem tem `core.modules.manage`.
- **Meu perfil:** um `Card` de identificação (avatar, nome, nível e ID) e, abaixo dele, o `Card` "Meus casos" como tabela, com as colunas Caso, Data, Tipo, Ação e Situação.
- **Casos:**
  - os filtros ficam na barra de ferramentas do `Card`;
  - o resultado é uma tabela com as colunas Caso, Data, Tipo, Ação, Situação e Alvo, em que cada linha abre o detalhe, como hoje;
  - "Carregar mais" vai no rodapé;
  - o nome acessível de cada linha continua o mesmo.
- **Ações:** as abas e o formulário ficam num `Card` (`max-w-3xl`). O resultado aparece num `Alert` abaixo do formulário, com o mesmo texto de hoje.
- **Configuração:**
  - em telas largas (`lg`), uma navegação fixa à esquerda (`<nav aria-label="Seções da configuração">`) leva a cada seção por âncora;
  - cada seção é um `Card` com "Salvar" e o estado ("Alterações não salvas." ou "Salvo.") no rodapé;
  - o aviso de conflito vira um `Alert` com "Recarregar".
- **Domínios:** dois `Card`s, Bloqueados e Permitidos, lado a lado a partir de `lg`.
  - Cada um tem o botão "Adicionar" no cabeçalho, que abre um `Dialog`: "Adicionar domínio bloqueado" ou "Adicionar domínio permitido", com o campo "Domínio" e o botão "Adicionar".
  - A busca fica na barra do `Card`.
- **Desenvolvedores:** a ação principal "Adicionar desenvolvedor" abre um `Dialog` com o campo "ID da pessoa" e o botão "Adicionar".
- **Permissões:** a ação principal "Associar permissão" abre um `Dialog` com os campos "Permissão" e "ID do cargo" e o botão "Associar". Os grupos por permissão continuam, cada um num `Card`.
- **Módulos, Logs e Sessões:** a busca, o filtro de nível e "Atualizar" passam para a barra do `Card`.
  - Em Sessões, as ações de cada linha ficam num menu ("Ações da sessão de {pessoa}") com "Encerrar" e "Encerrar todas desta pessoa".

## 4. Componentes

- **Novos em `components/`:**
  - `PageHeader`;
  - `EmptyState`, com ícone, texto e descrição opcional, que é o único formato de lista vazia;
  - `RowActions`, um menu de ações por linha (`DropdownMenu`) com gatilho nomeado;
  - `StatusBadge`, que leva situação a um selo `outline` com o texto normal e um ponto à esquerda, para o âmbar ficar só na ação principal e no item ativo:
    - ativo ou ligado: ponto `bg-primary`;
    - parado, descartado ou revertido: ponto `bg-muted-foreground`;
    - falha ou desconectado: ponto e texto `destructive`;
    - em transição: ponto vazado, só com contorno.
- **Novos em `components/ui/`:** `alert.tsx` e `dialog.tsx`, do shadcn, adaptados como os outros.
- **Ações destrutivas por linha** ("Remover"): botão `ghost` com texto `text-destructive` e ícone de lixeira, com o mesmo nome. O botão vermelho sólido fica só dentro das confirmações.
- **Avisos:** erros de tela, conflitos e resultados usam `Alert`. Erros de campo continuam abaixo do campo.
- **Textos:** os textos e nomes acessíveis atuais continuam iguais, exceto:
  - o título de `/moderacao`;
  - as descrições novas;
  - os textos de indicadores, `Dialog`s e menus desta seção.

## 5. Testes e verificação

- **Testes atuais:** passam. Um teste só muda onde o fluxo mudou de fato, por exemplo para abrir o `Dialog` antes de preencher o formulário de adicionar, e cada mudança fica registrada no PR.
- **Testes novos:**
  - `PageHeader`, `EmptyState`, `RowActions` e `StatusBadge`;
  - os indicadores da Visão geral;
  - a tabela de Casos (colunas e abertura do detalhe);
  - a navegação por seções da Configuração;
  - cada `Dialog` de adicionar (abrir, enviar, fechar no sucesso, manter aberto e mostrar o erro na falha);
  - o menu de ações de Sessões.
- **Navegador:** com o servidor real do painel, em 1440, 1024 e 375 px, nos dois temas, as 11 telas não podem ter rolagem horizontal nem violação de CSP. Os `Dialog`s e menus também são conferidos.

## 6. Implementação

**Conferência no navegador.** O build foi servido com o servidor real do painel (CSP com nonce de estilo) e dados falsos. As 11 rotas foram conferidas em 1440, 1024 e 375 px, nos temas claro e escuro, sem rolagem horizontal da página. O `Dialog` de adicionar e o menu de linha de Sessões abriram, com zero violações de CSP. O teste manual no servidor real continua pendente.

**Decisões tomadas durante a implementação:**

- `StatusBadge` é um selo com contorno e um ponto colorido, e não uma pílula amber cheia, para manter o amber em 10%.
- A busca de Domínios e de Desenvolvedores também foi para a barra do cartão.
- Desenvolvedores mostra um `EmptyState` quando a lista está vazia.
- Módulos não tem `EmptyState`: a lista sempre tem o módulo de administração.
- Os erros de tela usam `Alert` nas telas com tabela e formulário. Visão geral e Meu perfil seguem com `role="alert"` em texto simples.
- `PageHeader` aceita um `ref` opcional no título, para devolver o foco depois de uma confirmação.
- Os ids das seções de Configuração são fixos (`config-<id>`), para as âncoras.
