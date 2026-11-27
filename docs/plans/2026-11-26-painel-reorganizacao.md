# Painel — Reorganização estrutural: Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar a todas as telas do painel a mesma estrutura de página, reorganizar o conteúdo de cada uma e unificar componentes (avisos, vazios, ações por linha, situação), sem mudar a API nem as permissões.

**Architecture:**

- **Componentes de layout:** `PageHeader`, `EmptyState`, `RowActions` e `StatusBadge`, mais `Alert` e `Dialog` do shadcn, são criados primeiro.
- **Telas:** cada tela passa a usá-los, conforme a spec §3.

**Tech Stack:** o mesmo da etapa anterior: React 19, Tailwind 4, shadcn/ui (Radix, pacote `radix-ui`), lucide-react, TanStack Table 9 e Vitest 5. Não há dependência nova.

**Spec:** [`docs/specs/2026-11-26-painel-reorganizacao.md`](../specs/2026-11-26-painel-reorganizacao.md). Base: [`2026-11-26-painel-visual-shadcn.md`](../specs/2026-11-26-painel-visual-shadcn.md) e [0025](../decisions/0025-panel-ui-kit.md).

## Global Constraints

- **Contêiner de página:** `mx-auto w-full max-w-6xl flex flex-col gap-6`, aplicado uma vez no `<main>` do shell (`App.tsx`). Formulários usam `max-w-3xl`.
- **Textos:** títulos e descrições exatamente como na tabela da spec §2. Os textos novos são os da spec §3. Fora disso, textos e nomes acessíveis não mudam.
- **Cores:** as regras de 0025 e da spec anterior continuam:
  - amber só na ação principal e no item ativo;
  - vermelho sólido só dentro de confirmações;
  - "Remover" por linha é `ghost` com `text-destructive`;
  - WCAG AA, com o contorno de foco existente (`ring-2 ring-ring ring-offset-2 ring-offset-background`).
- **CSP:** sem `<style>` sem nonce e sem `'unsafe-inline'`. O `Dialog` do Radix usa o mesmo nonce já instalado.
- **Imports:** relativos, com extensão e sem `@/`. Os componentes do shadcn são adaptados como os existentes.
- **Sem mudança de API:** as operações e os payloads continuam iguais. A Visão geral usa só `/api/status`, a presença (`useLive`) e `useCurrentMe`.
- **Git:**
  - commits com o e-mail noreply ([GIT.md §8](../GIT.md#8-higiene-do-repositório)), sem `Co-Authored-By` nem "Generated with";
  - `git add` só com caminhos explícitos, nunca `.env` nem `.env.example`.
- **Verificação:** `npm run check` passa ao fim de cada task.

## Review Focus

1. **`Dialog` de adicionar:**
   - no sucesso, o `Dialog` fecha, o toast aparece e o foco volta ao botão que o abriu;
   - na falha (409 ou 422), ele fica aberto com o erro num `role="alert"`;
   - Esc fecha sem enviar.

   Teste na Task 4.

2. **Tabela de Casos:** a linha continua abrindo o detalhe por clique e por teclado, e o nome acessível da linha é o mesmo de antes. Teste na Task 3.
3. **Navegação da Configuração:** cada link leva à seção, que recebe foco ou rolagem, e a navegação não aparece abaixo de `lg`. Teste na Task 3.
4. **Menu de ações de Sessões:** "Encerrar" e "Encerrar todas desta pessoa" enviam o payload da linha certa, também com a tabela filtrada. Teste na Task 5.
5. **Indicadores da Visão geral:** "Módulos ativos" conta só `RUNNING`, e "No painel agora" usa a presença. Teste na Task 2.

## Entrega

Um PR, `feat(dashboard): reorganize the panel layout and components`, no branch `feature/dashboard-ui-reorganization`. Ele parte do topo da pilha, que é o PR #30.

### Task 1: Componentes de layout

**Files:**

- Create:
  - em `src/components/`: `PageHeader.tsx`, `EmptyState.tsx`, `RowActions.tsx`, `StatusBadge.tsx` e os testes de cada um
  - em `src/components/ui/`: `alert.tsx` e `dialog.tsx`
- Modify: `src/App.tsx`, que aplica o contêiner de página no `<main>`

**Interfaces (Produces):**

- `PageHeader({ title, description, actions? })`: renderiza um `<h1>` com `title`, um `<p>` em `text-muted-foreground` e um `<div>` com as ações à direita (abaixo do texto no celular).
- `EmptyState({ icon?: LucideIcon, title, description? })`: renderiza o `title` como texto visível (`<p>`), com o ícone `aria-hidden`.
- `RowActions({ label, items: { label: string; onSelect(): void; destructive?: boolean; disabled?: boolean }[] })`: `DropdownMenu` cujo gatilho é um botão `ghost` com ícone e `aria-label={label}`. Item destrutivo leva `text-destructive`.
- `StatusBadge({ tone: 'active' | 'inactive' | 'failed' | 'pending', children })`: os tons correspondem às variantes `default`, `secondary`, `destructive` e `outline` da spec §4.

- [ ] **Step 1: Testes que falham:**
  - `PageHeader` mostra `h1`, descrição e ações;
  - `EmptyState` mostra o texto e o ícone escondido;
  - `RowActions`: abrir o menu pelo gatilho nomeado e escolher um item chama `onSelect`, e um item desligado não chama;
  - `StatusBadge` aplica a variante de cada tom.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add page layout components`

### Task 2: Visão geral e Meu perfil

**Files:** em `src/routes/`, `Overview.tsx` e `Profile.tsx`, com os testes delas.

- **Visão geral:**
  - `PageHeader` com o título e a descrição da spec;
  - uma grade (`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`) de quatro `Card`s pequenos, com o rótulo em `text-sm text-muted-foreground` e o valor em `text-2xl font-semibold`:
    - "Conexão", com `connectionLabel`;
    - "Tempo no ar";
    - "Módulos ativos", com `N de M`;
    - "No painel agora", com `presence.length`;
  - o `Card` "Módulos" com `StatusBadge` e o link "Gerenciar módulos" (`text-link`), só com `core.modules.manage`.
- **Meu perfil:**
  - `PageHeader`;
  - `Card` de identificação;
  - `Card` "Meus casos" com uma tabela (`Table` do shadcn) de colunas Caso, Data, Tipo, Ação e Situação. A situação aparece num `StatusBadge`, e o vazio, num `EmptyState` com o texto atual.

- [ ] **Step 1: Testes que falham:**
  - **(Review Focus 5)** com 3 módulos, 2 deles `RUNNING`, aparece "2 de 3"; com 2 pessoas na presença, aparece "2";
  - o link "Gerenciar módulos" aparece só com a permissão;
  - "Meus casos" tem as cinco colunas.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): reorganize overview and profile`

### Task 3: Casos, Ações e Configuração

**Files:** em `src/routes/`, `Cases.tsx`, `Actions.tsx` e `ModerationConfig.tsx`, com os testes delas.

- **Casos:**
  - `PageHeader`;
  - `Card` com os filtros atuais na barra do cabeçalho;
  - tabela com as colunas Caso, Data, Tipo, Ação, Situação e Alvo;
  - cada linha tem um botão na célula "Caso" que abre o detalhe. O botão tem o mesmo nome acessível da linha de hoje, e a linha inteira é clicável;
  - "Carregar mais" no `CardFooter`;
  - o vazio num `EmptyState`.
- **Ações:** `PageHeader` e `Card` `max-w-3xl` com as abas atuais no `CardHeader`. O resultado vai num `Alert`, com os mesmos textos e o mesmo foco.
- **Configuração:**
  - o título passa a ser "Configuração", com a descrição da spec;
  - a partir de `lg`, o layout tem duas colunas: à esquerda, uma `<nav aria-label="Seções da configuração">` fixa (`sticky top-20`) com um link `#<id da seção>` por seção, e à direita as seções;
  - cada seção tem um `CardFooter` com "Salvar" e o estado;
  - o conflito vai num `Alert` com "Recarregar".

- [ ] **Step 1: Testes que falham:**
  - **(Review Focus 2)** o detalhe abre por clique na linha e por Enter no botão, e o nome acessível da linha é o mesmo do teste atual ("keeps the row accessible name…");
  - **(Review Focus 3)** a `nav` tem um link por seção, e cada `href` aponta para um `id` existente;
  - o `h1` de `/moderacao` é "Configuração";
  - o resultado de Ações aparece dentro de um `role="alert"` ou `role="status"`, com o mesmo texto.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): reorganize cases, actions and moderation config`

### Task 4: Domínios, Desenvolvedores e Permissões com `Dialog` de adicionar

**Files:** em `src/routes/`, `Domains.tsx`, `Developers.tsx` e `Grants.tsx`, com os testes delas. Se o padrão se repetir, pode ser criado `src/components/AddDialog.tsx`, com teste.

- **Formulário de adicionar:** sai da página e vai para um `Dialog`, aberto pelo botão da spec §3:
  - em Domínios, o botão "Adicionar" fica no cabeçalho de cada `Card`;
  - em Desenvolvedores e Permissões, a ação fica no `PageHeader`.
- **Comportamento do `Dialog`:**
  - campos e validação de hoje;
  - envio desligado enquanto pendente;
  - no sucesso, fecha e chama o `notify` atual;
  - na falha, fica aberto com o erro num `role="alert"` dentro dele.
- **Tabelas:** "Remover" por linha vira `ghost` com `text-destructive` e o ícone `Trash2`, com o mesmo nome acessível. Os vazios usam `EmptyState`.

- [ ] **Step 1: Testes que falham** **(Review Focus 1)**, para cada tela:
  - abrir o `Dialog`, preencher e enviar faz o `Dialog` fechar, o toast aparecer e o foco voltar ao botão que o abriu;
  - um 409 ou 422 mantém o `Dialog` aberto com o erro;
  - Esc fecha sem enviar.

  Os testes atuais de adicionar passam a abrir o `Dialog` antes.

- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): move add forms into dialogs`

### Task 5: Módulos, Logs e Sessões

**Files:** em `src/routes/`, `Modules.tsx`, `Logs.tsx` e `Sessions.tsx`, com os testes delas. Se a busca da barra exigir, também `src/components/DataTable.tsx`.

- **Barra de ferramentas:** a busca da `DataTable`, o filtro de nível e "Atualizar" passam para a barra do `CardHeader`. Se preciso, a `DataTable` ganha uma prop `toolbar?: ReactNode`, renderizada na mesma linha da busca.
- **Sessões:** as ações de cada linha vão para um `RowActions` com o rótulo `Ações da sessão de {pessoa}`, com os itens "Encerrar" e "Encerrar todas desta pessoa". A segunda é destrutiva.
- **Módulos:** a situação aparece num `StatusBadge`, com o mesmo texto.
- **Vazios:** usam `EmptyState`.

- [ ] **Step 1: Testes que falham:**
  - **(Review Focus 4)** com a tabela filtrada por uma pessoa, abrir o menu da linha e escolher "Encerrar" envia o `ref` daquela linha, e "Encerrar todas desta pessoa" envia o `userId` dela;
  - em Logs, o filtro e "Atualizar" continuam funcionando.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): reorganize modules, logs and sessions`

### Task 6: Documentação e conferência

**Files:** `README.md` (seção "Painel"), `CHANGELOG.md` e a spec desta reorganização, que fica com `Status: Implementada`.

- [ ] **Step 1: Conferência no navegador** (feita pelo controlador): as 11 telas em 1440, 1024 e 375 px, nos dois temas, abrindo um `Dialog`, um menu de linha e a navegação da Configuração. O resultado esperado é zero rolagem horizontal e zero violação de CSP.
- [ ] **Step 2: Documentação.** No README, a estrutura das telas e os `Dialog`s de adicionar. No CHANGELOG, as entradas em `Unreleased`.
- [ ] **Step 3: Rodar.** `npm run check` → PASS.
- [ ] **Step 4: Commit.** `docs: document the panel reorganization`
