# Painel — Visual com Tailwind e shadcn/ui: Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar o visual do app do painel por Tailwind e shadcn/ui. O trabalho tem quatro partes:

- tema claro e escuro, com cores na regra 60-30-10 e amber de destaque;
- layout com menu lateral agrupado e indicador de conexão;
- notificações depois das ações e busca e ordenação nas tabelas;
- CSP com nonce de estilo por requisição.

**Architecture:**

- **Servidor:** o servidor do painel monta o `index.html` por requisição, com um nonce novo na `<meta name="csp-nonce">` e na CSP (`style-src 'self' 'nonce-…'`).
- **App:** o app lê o nonce ao iniciar e o entrega ao Radix (`setNonce`). As telas passam a usar componentes do shadcn copiados para `src/components/ui/`, estilizados com Tailwind 4 e tokens em variáveis CSS.
- **Comportamento:** a API, as permissões e os textos não mudam.

**Tech Stack:**

- **O que já existe:** React 19, React Router 8, TanStack Query 5, Motion 14, Vite 8 e Vitest 5 no app; Fastify 5 no servidor.
- **O que entra:**

  | Pacote                     | Versão  | Para quê                             |
  | -------------------------- | ------- | ------------------------------------ |
  | `tailwindcss`              | ^4.3.5  | estilo                               |
  | `@tailwindcss/vite`        | ^4.3.5  | Tailwind no build do Vite            |
  | `tw-animate-css`           | ^1.4.0  | animações do shadcn                  |
  | `radix-ui`                 | ^1.8.1  | primitivos dos componentes e o Toast |
  | `get-nonce`                | ^1.0.1  | entregar o nonce ao Radix            |
  | `lucide-react`             | ^1.81.0 | ícones                               |
  | `@tanstack/react-table`    | ^9.3.1  | busca e ordenação nas tabelas        |
  | `class-variance-authority` | ^0.7.1  | variantes dos componentes            |
  | `clsx`                     | ^2.1.1  | composição de classes                |
  | `tailwind-merge`           | ^3.7.1  | composição de classes                |

**Spec:** [`docs/specs/2026-11-26-painel-visual-shadcn.md`](../specs/2026-11-26-painel-visual-shadcn.md). Decisões aplicadas: [0019](../decisions/0019-panel-stack.md), [0021](../decisions/0021-panel-hosting.md) e [0025](../decisions/0025-panel-ui-kit.md).

## Global Constraints

- **CSP:** nunca `'unsafe-inline'`. O `style-src` com nonce só existe na resposta do `index.html`. API e arquivos estáticos continuam com a CSP atual. O critério é zero violações de CSP no console.
- **Textos:** textos, rótulos, mensagens de erro e nomes acessíveis continuam iguais. As exceções são duas:
  - o item de menu `/moderacao` passa de "Moderação" para "Configuração", dentro do grupo "Moderação";
  - os textos novos desta spec.
- **Cores**, nos tokens do shadcn em `src/index.css`:

  | Parte | Claro                                                                          | Escuro                                     |
  | ----- | ------------------------------------------------------------------------------ | ------------------------------------------ |
  | 60%   | `--background` branco                                                          | zinc-950                                   |
  | 30%   | `--card`, `--sidebar`, `--muted`, `--input` e `--border` de zinc-50 a zinc-200 | de zinc-900 a zinc-800                     |
  | 10%   | `--primary` amber-500, `--primary-foreground` zinc-950                         | amber-400, `--primary-foreground` zinc-950 |
  - `--ring` usa a mesma cor do `--primary`.
  - Links usam amber-700 no claro e amber-400 no escuro.
  - `--destructive` é red-600 no claro e red-500 no escuro.
  - Todo par de texto e fundo passa no WCAG AA (4,5:1).

- **Tema:**
  - `THEME_STORAGE_KEY = 'sunflower-theme'`, com valores `light`, `dark` e `system`;
  - o tema é aplicado pela classe `dark` no `<html>`;
  - nada de script inline;
  - um `localStorage` que lança erro equivale a `system`.
- **Menu recolhido:** guardado em `localStorage`, na chave `sunflower-sidebar`, com valores `expanded` ou `collapsed`. O cookie que o `Sidebar` do shadcn grava é trocado por essa chave.
- **Imports:** relativos e com extensão (`../lib/utils.ts`), como no resto do app. Sem alias `@/`. Os componentes do shadcn são adaptados a isso ao serem copiados.
- **Toasts:** ficam a cargo do `Toast` do Radix (`radix-ui`), não do Sonner. O Sonner 2.0.8 injeta um `<style>` ao ser importado, sem nonce, o que viola a CSP. Isso foi verificado no pacote, e a spec §7 prevê essa troca. Os toasts duram 4 s, ficam no canto inferior direito no computador e no topo no celular.
- **Busca nas tabelas:** `normalizeSearch(text) = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`, aplicado ao termo e às células.
- **Celular:** abaixo de 768 px (`MOBILE_BREAKPOINT = 768`), o menu vira `Sheet`.
- **Git:**
  - commits com `git -c user.email=<id>+<usuário>@users.noreply.github.com commit`, com o e-mail noreply ([GIT.md §8](../GIT.md#8-higiene-do-repositório)), sem rodapé `Co-Authored-By` nem "Generated with";
  - `git add` só com caminhos explícitos, nunca `.env` nem `.env.example`.
- **Verificação:** `npm run check` passa ao fim de cada task.

## Review Focus

1. **Diálogo dentro da gaveta:** "Reverter" no detalhe do caso abre um `AlertDialog` por cima do `Sheet`. Esc fecha só o diálogo, e o foco volta ao botão dentro do `Sheet`. Teste na Task 5.
2. **`index.html` em cache com nonce velho:** a resposta precisa de `Cache-Control: no-store`. `HEAD /` e `GET /index.html` também recebem nonce. Teste na Task 1.
3. **Menu recolhido e gaveta do celular:**
   - recolhido, cada item continua com nome acessível;
   - no celular, escolher uma tela fecha a gaveta.

   Teste na Task 3.

4. **Busca e ordenação:**
   - "dominio" encontra "Domínio";
   - "ABC" encontra "abc";
   - a terceira ordenação volta à ordem do servidor;
   - a busca sem resultado mostra o texto próprio, distinto do texto de lista vazia.

   Teste na Task 9.

5. **Armazenamento indisponível:** o `localStorage` lança erro, de navegação privada ou bloqueio. Tema e menu continuam funcionando com os padrões, sem erro na tela. Teste na Task 2 e na Task 3.

## Entrega em Pull Requests

| PR  | Branch                               | Tasks | Título                                                         |
| --- | ------------------------------------ | ----- | -------------------------------------------------------------- |
| Q   | `feature/dashboard-ui-base`          | 1–4   | `feat(dashboard): add the shadcn base, layout and style nonce` |
| R   | `feature/dashboard-ui-screens`       | 5–7   | `feat(dashboard): move the panel screens to shadcn components` |
| S   | `feature/dashboard-ui-tables-toasts` | 8–10  | `feat(dashboard): add toasts and searchable tables`            |

Cada PR parte da `main` atualizada, depois do merge do anterior.

## PR Q

### Task 1: Nonce de estilo no servidor

**Files:**

- Modify:
  - `interfaces/dashboard/server.ts`
  - `interfaces/dashboard/app/index.html`, que ganha `<meta name="csp-nonce" content="__CSP_NONCE__" />` no `<head>`
- Test: `interfaces/dashboard/server.test.ts`

**Interfaces:**

- Produces, exportados de `server.ts`:
  - `STYLE_NONCE_PLACEHOLDER = '__CSP_NONCE__'`;
  - `cspWithStyleNonce(nonce: string): string`, que devolve a CSP atual seguida de `; style-src 'self' 'nonce-<nonce>'`;
  - `renderIndex(html: string, nonce: string): string`, que troca todas as ocorrências do marcador.
- **Geração:** o nonce sai de `randomBytes(16).toString('base64')`.

- [ ] **Step 1: Testes que falham** em `server.test.ts`, com um `staticDir` temporário cujo `index.html` tem o marcador:
  - **Nonce novo:** duas chamadas a `GET /` dão nonces diferentes. O valor da `<meta>` é igual ao da CSP e casa com `^[A-Za-z0-9+/]{22}==$`.
  - **Caminhos:** `GET /index.html`, `GET /casos` e `HEAD /` recebem nonce. Nenhum corpo contém `__CSP_NONCE__`.
  - **(Review Focus 2) Cache:** as respostas do `index.html` têm `cache-control: no-store`.
  - **Outras respostas sem nonce:** `GET /api/me` sem sessão e um arquivo estático, como `GET /assets/x.js` criado no diretório temporário, têm a CSP sem `style-src`.
  - **Painel não compilado:** sem `index.html`, a resposta continua 503 com `Painel não compilado.`.
- [ ] **Step 2: Rodar.** `npx vitest run interfaces/dashboard/server.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
  - **Static:** `fastifyStatic` ganha `index: false` e `allowedPath: (path) => path !== '/index.html'`. Assim o `index.html` só sai pelo `setNotFoundHandler`.
  - **Handler:** gera o nonce, chama `renderIndex` e `reply.header('content-security-policy', cspWithStyleNonce(nonce))`, que sobrescreve o valor do hook `onRequest`, e define `cache-control: no-store`.
  - **Cache do arquivo:** o arquivo continua lido uma vez, mas agora como string.
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): serve the panel index with a per-request style nonce`

### Task 2: Tailwind, tokens, tema, nonce no app e componentes base

**Files:**

- Modify:
  - `interfaces/dashboard/app/package.json` e `package-lock.json`, com as dependências do Tech Stack
  - `vite.config.ts`, com o plugin `tailwindcss()` do `@tailwindcss/vite`
  - `src/main.tsx`
  - `src/test-setup.ts`
- Create:
  - `src/index.css`:
    - `@import "tailwindcss"` e `@import "tw-animate-css"`;
    - `@custom-variant dark (&:is(.dark *))`;
    - os tokens das Global Constraints em `:root` e em `.dark`;
    - o `@theme inline` do shadcn.
  - `src/lib/utils.ts`, com `cn(...inputs: ClassValue[]): string`
  - `src/style-nonce.ts`
  - `src/theme.ts`
  - em `src/components/ui/`: `button.tsx`, `card.tsx`, `badge.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx`, `native-select.tsx`, `switch.tsx`, `skeleton.tsx`, `separator.tsx`, `sheet.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`, `sidebar.tsx`, `table.tsx` e `toast.tsx`, vindos do registro do shadcn (estilo "new-york")
  - testes: `src/theme.test.ts` e `src/style-nonce.test.ts`

**Interfaces:**

- Produces:
  - **`style-nonce.ts`:**
    - `readStyleNonce(doc: Document = document): string | null` devolve o `content` da `<meta name="csp-nonce">`, ou `null` se faltar, estiver vazio ou for o marcador (servidor de desenvolvimento do Vite);
    - `installStyleNonce(doc?: Document): void` chama `setNonce` de `get-nonce` quando há valor.
  - **`theme.ts`:**
    - `type ThemeChoice = 'light' | 'dark' | 'system'`;
    - `readThemeChoice(): ThemeChoice`, que devolve `system` em erro ou valor desconhecido;
    - `resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark'`;
    - `applyTheme(choice: ThemeChoice, doc?: Document): void`, que põe ou tira a classe `dark` do `<html>`;
    - `useTheme(): { choice: ThemeChoice; setChoice(next: ThemeChoice): void }`. `setChoice` grava sem quebrar se o armazenamento falhar. Em `system`, o hook segue mudanças de `prefers-color-scheme`.
  - **`main.tsx`:** chama `installStyleNonce()` e `applyTheme(readThemeChoice())` antes do `createRoot`, e importa `./index.css` antes de `./styles.css`. O `styles.css` antigo continua até a Task 7.
  - **Componentes de `components/ui/`:** usados pelas Tasks 3 a 9 com a API do shadcn. `button.tsx` exporta `Button` e `buttonVariants`, com as variantes `default`, `secondary`, `ghost`, `outline` e `destructive`.
  - **`test-setup.ts`:** polyfills para o jsdom, que não traz estas APIs e o Radix e o `Sidebar` as usam: `ResizeObserver`, `matchMedia` (padrão sem correspondência), `Element.prototype.hasPointerCapture`, `releasePointerCapture` e `scrollIntoView`.

- [ ] **Step 1: Testes que falham:**
  - **`readStyleNonce`:** devolve o valor da `<meta>`; `null` sem `<meta>`, com valor vazio e com `__CSP_NONCE__`.
  - **`resolveTheme`:** `system` segue `prefersDark`; `light` e `dark` ignoram `prefersDark`.
  - **`readThemeChoice` (Review Focus 5):** devolve `system` quando `localStorage.getItem` lança erro e quando o valor é desconhecido.
  - **`applyTheme`:** `dark` põe a classe e `light` tira.
  - **`useTheme`:** `setChoice('dark')` grava `sunflower-theme=dark` e aplica a classe. Um `setItem` que lança erro não quebra e ainda aplica o tema.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.** Instale as dependências com `npm install --prefix interfaces/dashboard/app`, nas versões do Tech Stack, e copie os componentes adaptando os imports.
- [ ] **Step 4: Rodar.** `npm run check` → PASS. Os testes atuais continuam passando.
- [ ] **Step 5: Commit.** `feat(dashboard): add tailwind, shadcn components, theme and style nonce to the app`

### Task 3: Layout — menu lateral, cabeçalho e conexão

**Files:**

- Create em `src/components/`: `AppSidebar.tsx`, `AppHeader.tsx`, `ConnectionIndicator.tsx`, `AccountMenu.tsx`, `navigation.ts` e `AppSidebar.test.tsx`
- Modify:
  - `src/App.tsx`
  - `src/components/PresenceList.tsx`, que passa a usar só classes do Tailwind
  - `src/routes/Login.tsx` e `src/routes/NoPermission.tsx`, num `Card` centralizado sem menu
  - `src/components/ui/sidebar.tsx`, com a troca de cookie por `localStorage` das Global Constraints
  - os testes do app que procuram o link "Moderação" ou o texto do selo antigo
- Delete: `src/components/Menu.tsx` e `src/components/ReconnectBanner.tsx`

**Interfaces:**

- Consumes: `useCurrentMe`, `useLogout`, `useLive` e `useTheme` (Task 2).
- Produces:
  - **`navigation.ts`:**
    - `interface NavItem { to: string; label: string; icon: LucideIcon; visible(me: Me): boolean }`;
    - `interface NavGroup { label: string; items: NavItem[] }`;
    - `NAV_GROUPS: NavGroup[]`, na ordem e com os rótulos da spec §3. As regras de `visible` são exatamente as do `Menu.tsx` atual.
    - `visibleGroups(me: Me): NavGroup[]` remove os itens sem permissão e os grupos que ficam vazios.
    - `currentTrail(pathname: string): { group: string; label: string } | null`.
  - **`AppHeader`:**
    - `SidebarTrigger`;
    - `<nav aria-label="Você está em">` com "Grupo › Tela", a partir de `currentTrail`. Ruling: o `<h1>` de cada tela continua na tela, e o cabeçalho mostra a trilha em vez de repetir o título.
    - `ConnectionIndicator` à direita.
  - **`ConnectionIndicator`:**
    - um `role="status"` sempre presente;
    - ponto amber e "Ao vivo" quando `reconnecting` é falso;
    - ponto `muted` e "Reconectando…" quando é verdadeiro.
  - **`AccountMenu`:** `DropdownMenu` com avatar, nome, "Tema" (opções "Claro", "Escuro" e "Sistema", como `DropdownMenuRadioGroup`) e "Sair". O erro de saída continua com o texto atual, num `role="alert"`.
  - **`AppSidebar`:** `SeedMark` no topo, os grupos e, no rodapé, `PresenceList` e `AccountMenu`.
  - **`App.tsx`:** `SidebarProvider` › `AppSidebar` + `SidebarInset` (`AppHeader` + `<main>` com a mesma animação do Motion). O `<main>` tem margem de 24 px (`p-6`) e 16 px no celular (`p-4`).

- [ ] **Step 1: Testes que falham:**
  - **Grupos:** com `me` de cada nível, aparecem os grupos e itens certos. Um membro vê só "Geral › Meu perfil", sem os grupos "Moderação" e "Administração". O dono com todas as permissões vê os três grupos.
  - **Item renomeado:** `/moderacao` aparece como "Configuração".
  - **Trilha:** em `/casos`, a `nav` "Você está em" mostra "Moderação" e "Casos".
  - **Indicador:** mostra "Ao vivo". Com a conexão fechada pelo `fake-websocket`, mostra "Reconectando…".
  - **(Review Focus 3)** recolher com o `SidebarTrigger` grava `sunflower-sidebar=collapsed`, e cada link continua com nome acessível.
  - **(Review Focus 3)** com `matchMedia` simulando menos de 768 px, o trigger abre a gaveta, e clicar em "Casos" navega e fecha a gaveta.
  - **(Review Focus 5)** com `localStorage` que lança erro, o menu abre expandido sem erro.
  - **Tema:** escolher "Escuro" no menu da conta põe a classe `dark` no `<html>`.
  - **Sair:** chama o logout, como no teste atual.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add the grouped sidebar, header and connection indicator`

### Task 4: Documentação do PR Q

**Files:** `README.md`, `docs/decisions/0025-panel-ui-kit.md`, `docs/specs/2026-11-26-painel-visual-shadcn.md`, `docs/specs/2026-11-24-fase-3-painel.md` e `CHANGELOG.md`.

- [ ] **Step 1: Documentação.**
  - **README, seção "Painel", em "Hospedagem":**
    - "O túnel ou proxy precisa repassar o cabeçalho `Origin` sem alteração. Sem isso, o painel abre, mas o canal ao vivo fica em `Reconectando…`."
    - "O `index.html` do painel não é guardado em cache, porque leva um nonce novo a cada carregamento."
  - **Nota datada de 2026-11-26** na 0025 e na spec §6.1 e §8: os toasts usam o `Toast` do Radix, porque o Sonner 2.0.8 injeta `<style>` sem nonce.
  - **Spec da Fase 3, §6:** nota datada dizendo que a regra "sem estilos inline" vale para o HTML entregue, que estilo definido por JavaScript é permitido e que o nonce é o da 0025.
  - **CHANGELOG:** entradas do PR Q em `Unreleased`.
- [ ] **Step 2: Rodar.** `npm run check` → PASS.
- [ ] **Step 3: Commit.** `docs: document the panel style nonce and tunnel requirements`

## PR R

### Task 5: Diálogo, gaveta do caso e telas de casos, ações, perfil e visão geral

**Files:**

- Modify:
  - `src/components/ConfirmDialog.tsx`, por dentro sobre `AlertDialog`, com as mesmas props
  - `src/components/CaseDetail.tsx`, que passa a ser um `Sheet` à direita
  - em `src/routes/`: `Cases.tsx`, `Actions.tsx`, `Profile.tsx` e `Overview.tsx`
  - os testes dessas telas, só onde a estrutura mudou, com registro no PR
- Test: `src/components/ConfirmDialog.test.tsx` (novo)

**Interfaces:**

- Consumes: `ui/alert-dialog`, `ui/sheet`, `ui/button`, `ui/badge`, `ui/card`, `ui/input`, `ui/label`, `ui/native-select` e `ui/skeleton`.
- Produces:
  - **`ConfirmDialog`:** a interface de props de hoje (`title`, `confirmLabel`, `onConfirm`, `onCancel`, `pending`, `error`, `returnFocusRef` e `children`), sem mudança para quem usa. O botão de confirmar usa a variante `destructive`.
  - **`Badge`:** situação do caso com `caseStatusLabel` e nível com `levelLabel`, sem texto novo.
  - **Cases:** os filtros e o `Carregar mais` não mudam de comportamento.
  - **Actions:** o texto de resultado continua visível.

- [ ] **Step 1: Testes que falham:**
  - **`ConfirmDialog`:**
    - o foco começa em Cancelar;
    - Esc chama `onCancel`;
    - com `pending`, os dois botões ficam desligados;
    - `error` aparece num `role="alert"` dentro do diálogo;
    - ao fechar, o foco vai para `returnFocusRef` ou volta para quem abriu.
  - **(Review Focus 1)** em Casos, ao abrir o detalhe (`dialog` do `Sheet`) e depois "Reverter", Esc fecha só a confirmação, o detalhe continua aberto e o foco volta ao botão "Reverter".
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): move cases, actions, profile and overview to shadcn`

### Task 6: Telas de domínios e configuração da moderação

**Files:**

- Modify: `src/routes/Domains.tsx`, `src/routes/ModerationConfig.tsx` e os testes delas, só onde a estrutura mudou.

**Interfaces:**

- **ModerationConfig:**
  - cada seção vira um `Card` com o título em `CardTitle`, mantendo o `<h2>` e o `id` do `aria-labelledby`;
  - o texto de conflito e o botão `Recarregar` não mudam;
  - largura máxima de 640 px (`max-w-2xl`).
- **Domains:** os dois blocos (bloqueados e permitidos) viram `Card`, com `Input` e `Button`.

- [ ] **Step 1: Testes que falham:** em Configuração, o botão salvar de cada seção continua desligado sem alterações e ligado com alterações. O teste existente vale, e só é ajustado se o seletor mudar.
- [ ] **Step 2: Rodar.** `npm run app:check`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): move domains and moderation config to shadcn`

### Task 7: Telas de administração e remoção do CSS antigo

**Files:**

- Modify:
  - em `src/routes/`: `Grants.tsx`, `Developers.tsx`, `Modules.tsx`, `Logs.tsx`, `Sessions.tsx` e os testes delas
  - `src/main.tsx`, que deixa de importar `./styles.css`
  - `CHANGELOG.md`
- Delete: `src/styles.css`

**Interfaces:**

- **Modules:**
  - `Ligar` e `Desligar` viram um `Switch` com o mesmo nome acessível do botão atual;
  - `Desligar` continua pedindo confirmação;
  - a situação aparece num `Badge`, com `moduleStateLabel`.
- **Logs:** o nível aparece num `Badge`. A tabela vira o `Table` do shadcn dentro de um contêiner `overflow-x-auto`. A busca entra na Task 9.
- **Grants, Developers e Sessions:** passam a usar `Card`, `Input`, `Button` e `NativeSelect`, com a mesma estrutura de lista. Elas viram tabela na Task 9.
- **CSS:** nenhuma classe do `styles.css` antigo sobra no código. Conferir com `grep -rn "className=\"[a-z-]*\"" src`, que deve mostrar só classes do Tailwind.

- [ ] **Step 1: Testes que falham:** em Módulos, o `Switch` de um módulo ligado está marcado. Ao desligá-lo, a confirmação aparece e, depois dela, a operação envia `{ moduleId, enabled: false }`.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS. `src/styles.css` não existe mais.
- [ ] **Step 5: Commit.** `feat(dashboard): move administration screens to shadcn and drop the old stylesheet`

## PR S

### Task 8: Notificações

**Files:**

- Create: `src/components/Toaster.tsx`, `src/toast.ts` e `src/toast.test.tsx`
- Modify:
  - `src/App.tsx`, que põe o `Toaster` no shell
  - as telas da tabela da spec §6.1 e os testes delas

**Interfaces:**

- Produces:
  - **`toast.ts`:** `notify(message: string): void`, um emissor simples consumido pelo `Toaster`. Testes podem chamar `resetToasts()`.
  - **`Toaster`:**
    - `Toast.Provider` com `duration={4000}`, `Toast.Viewport` no canto inferior direito, ou no topo abaixo de 768 px;
    - cada toast tem botão de fechar com o nome "Fechar";
    - o Radix anuncia o toast a leitores de tela.
- **Quando chamar:** cada `onSuccess` das mutações da spec §6.1 chama `notify` com o texto exato da tabela. Em Ações, o texto do toast é o mesmo texto de resultado que a tela já mostra.

- [ ] **Step 1: Testes que falham:**
  - **Textos:** para cada linha da tabela §6.1, a ação bem-sucedida mostra um `role="status"` com o texto exato. Exemplos: "Domínio adicionado.", "Sessão revogada." e "Configuração salva.".
  - **Erros:** um erro não gera toast e continua no texto de erro da tela.
  - **Duração:** com timers falsos, o toast some depois de 4 s.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add toasts after successful actions`

### Task 9: Tabelas com busca e ordenação

**Files:**

- Create: `src/components/DataTable.tsx`, `src/search.ts`, `src/search.test.ts` e `src/components/DataTable.test.tsx`
- Modify:
  - em `src/routes/`: `Logs.tsx`, `Sessions.tsx`, `Domains.tsx`, `Developers.tsx`, `Grants.tsx` e `Modules.tsx`
  - os testes dessas telas, cujas linhas passam de `listitem` a `row`, com registro no PR

**Interfaces:**

- Produces:
  - **`search.ts`:** `normalizeSearch(text: string): string`, com a fórmula das Global Constraints.
  - **`DataTable`:**
    - assinatura `DataTable<T>({ columns, data, searchLabel = 'Buscar', emptyText, noResultsText = 'Nenhum resultado para a busca.' })`, em que `columns: ColumnDef<T>[]` vem do `@tanstack/react-table`;
    - a busca global usa `normalizeSearch`;
    - a ordenação clicável alterna entre crescente, decrescente e original (`enableSortingRemoval`);
    - o `<th>` ordenável tem `aria-sort` (`ascending`, `descending` ou `none`) e um `<button>` com o nome da coluna;
    - a tabela fica num contêiner `overflow-x-auto`.
- **Ordem inicial:** a do servidor.
- **Logs:**
  - as colunas "Mensagem" e "Campos" têm `break-words` e `whitespace-pre-wrap`, sem `truncate`;
  - o filtro de nível e o botão `Atualizar` não mudam.
- **Domínios:** uma `DataTable` para bloqueados e outra para permitidos.
- **Botões de ação por linha:** Encerrar, Remover e o `Switch` do módulo ficam numa coluna final, sem ordenação.

- [ ] **Step 1: Testes que falham:**
  - **(Review Focus 4)** `normalizeSearch('Domínio')` é igual a `normalizeSearch('dominio')`, e `normalizeSearch('ABC')` é igual a `'abc'`.
  - **(Review Focus 4)** na `DataTable`:
    - buscar "dominio" mantém a linha "Domínio";
    - a busca sem resultado mostra "Nenhum resultado para a busca.";
    - sem dados, aparece o `emptyText`;
    - três cliques no cabeçalho passam por `ascending`, `descending` e `none`, e voltam à ordem do servidor.
  - **Logs:** uma mensagem de 300 caracteres sem espaço aparece inteira no texto da célula.
  - **Sessões:** buscar pelo usuário filtra as linhas, e "Encerrar" na linha filtrada envia o `ref` certo.
- [ ] **Step 2: Rodar.** `npm run app:check` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat(dashboard): add searchable and sortable tables`

### Task 10: Conferência no navegador e fechamento

**Files:** `README.md`, `docs/ROADMAP.md`, `CHANGELOG.md` e a spec, que fica com `Status: Implementada`.

- [ ] **Step 1: Conferência**, feita pelo controlador com o painel do navegador:
  - servir o build com `buildDashboard` real, o que inclui a CSP e o nonce, e dependências falsas, num script fora do repositório, como nas etapas anteriores;
  - percorrer as 11 rotas e o login em 1440, 1024 e 375 px, nos temas claro e escuro;
  - abrir uma confirmação, o detalhe do caso, a gaveta do celular e um toast;
  - **zero** violações de CSP em `read_console_messages`;
  - nenhuma rolagem horizontal da página (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] **Step 2: Documentação.**
  - **README:** o visual novo e as telas.
  - **ROADMAP:** o visual do painel está concluído, e o teste manual no servidor real continua pendente.
  - **CHANGELOG:** entradas do PR S.
- [ ] **Step 3: Rodar.** `npm run check` → PASS.
- [ ] **Step 4: Commit.** `docs: close the panel redesign`
