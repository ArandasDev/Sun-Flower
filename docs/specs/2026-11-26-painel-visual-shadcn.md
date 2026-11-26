# Spec — Painel: visual com Tailwind e shadcn/ui

**Status:** Aprovada em 2026-11-26
**Fase:** [ROADMAP — Fase 3](../ROADMAP.md#fase-3--painel-administrativo), antes do teste manual do painel
**Decisões aplicadas:** [0019](../decisions/0019-panel-stack.md), [0021](../decisions/0021-panel-hosting.md), [0025](../decisions/0025-panel-ui-kit.md)

## 1. Objetivo

Trocar o visual do painel pelo padrão de painéis administrativos, com Tailwind e shadcn/ui, tema claro e escuro e cores na regra 60-30-10 com amber de destaque. O trabalho também corrige a organização das telas e acrescenta duas melhorias de uso: notificações depois das ações e busca e ordenação nas tabelas.

**Fora do escopo:**

- os seletores de cargo e de usuário no lugar da digitação de IDs, que ficam numa spec própria porque exigem operações novas no bot;
- qualquer mudança na API, nas permissões ou nos textos das telas.

## 2. Situação atual

- **Layout:** o conteúdo fica numa coluna estreita, que deixa metade da tela vazia em monitores largos.
- **Tabelas:** a de Logs corta a coluna "Campos".
- **Conexão:** o aviso de reconexão aparece como um selo solto no topo da página.
- **Estilo:** cerca de 970 linhas de CSS próprio (`app/src/styles.css`), com uma paleta verde e amarela.

## 3. Layout

- **Menu lateral** (`Sidebar` do shadcn), recolhível, com ícones do lucide e agrupado por assunto:

  | Grupo         | Itens (rota)                                                                                                                 |
  | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
  | Geral         | Meu perfil (`/`), Visão geral (`/visao-geral`)                                                                               |
  | Moderação     | Casos (`/casos`), Ações (`/acoes`), Domínios (`/dominios`), Configuração (`/moderacao`)                                      |
  | Administração | Permissões (`/permissoes`), Desenvolvedores (`/desenvolvedores`), Módulos (`/modulos`), Logs (`/logs`), Sessões (`/sessoes`) |
  - Cada item segue a mesma regra de permissão de hoje. Um grupo sem itens visíveis não aparece.
  - O item "Moderação" passa a se chamar "Configuração", dentro do grupo Moderação. É a única mudança de texto do menu.
  - No rodapé do menu ficam a lista de quem está online, com a presença atual, e o menu da conta. Esse menu tem o avatar, o nome, a escolha de tema (Claro, Escuro, Sistema) e o botão Sair.
  - Recolhido, o menu mostra só os ícones, com o nome em dica. O estado fica guardado no navegador.

- **Cabeçalho fixo:**
  - à esquerda, o botão de recolher o menu e o título da tela;
  - à direita, o indicador da conexão ao vivo: um ponto amber com "Ao vivo" quando conectado, e cinza com "Reconectando…" durante a espera. O indicador substitui o selo atual e tem `role="status"`.
- **Conteúdo** na largura toda, com margem lateral de 24 px no computador e 16 px no celular:
  - formulários e cartões de configuração têm no máximo 640 px de largura;
  - tabelas ocupam a largura disponível e, quando não cabem, rolam na horizontal dentro do próprio contêiner, nunca a página inteira.
- **Celular** (menos de 768 px): o menu vira uma gaveta (`Sheet`) aberta pelo botão do cabeçalho, que se fecha ao escolher uma tela.
- **Login, sem acesso e erro:** um cartão centralizado, sem o menu lateral.

> **Atualização (2026-11-26):** o indicador de conexão ganha um terceiro estado, "Conectando…", mostrado enquanto a primeira conexão ainda não foi feita. "Ao vivo" e "Reconectando…" seguem como descritos.

## 4. Cores e tema

- **Tokens:** as cores são os tokens do shadcn (`--background`, `--card`, `--primary` e outros), em variáveis CSS, nas variantes clara e escura.

  | Parte                      | Uso                                                                       | Claro                             | Escuro                    |
  | -------------------------- | ------------------------------------------------------------------------- | --------------------------------- | ------------------------- |
  | 60% (neutro)               | fundo da página e do conteúdo                                             | branco                            | zinc-950                  |
  | 30% (neutro de superfície) | menu lateral, cartões, cabeçalho das tabelas, campos, bordas              | zinc-50 a zinc-200                | zinc-900 a zinc-800       |
  | 10% (amber)                | botão principal, item ativo do menu, anel de foco, links, ponto "Ao vivo" | amber-500, texto zinc-950 em cima | amber-400, texto zinc-950 |

- **Texto em amber:** sobre fundo claro, como em links, usa amber-700.
- **Vermelho:** usado só em botões destrutivos (banir, expulsar, revogar, desligar módulo, remover) e em mensagens de erro.
- **Contraste:** todas as combinações de texto e fundo passam no WCAG AA (4,5:1 para texto normal).
- **Escolha do tema:** começa por `prefers-color-scheme`. A escolha manual fica no `localStorage`, na chave `sunflower-theme`, com os valores `light`, `dark` ou `system`. O tema é aplicado pela classe `dark` no `<html>`, definida em `main.tsx` antes da primeira renderização, sem script inline. Um `localStorage` inacessível cai no tema do sistema, sem erro.
- **Marca:** o logo (`SeedMark`) continua no topo do menu. A animação continua respeitando `prefers-reduced-motion`.

## 5. Componentes

- **Origem:** os componentes do shadcn ficam em `app/src/components/ui/`, como código do projeto.

  | Hoje                                           | Passa a ser                                                                        |
  | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
  | `ConfirmDialog`                                | `AlertDialog`, com a mesma interface de props e o mesmo comportamento              |
  | painel lateral do `CaseDetail`                 | `Sheet` à direita                                                                  |
  | botões                                         | `Button`, com as variantes `default` (amber), `secondary`, `ghost` e `destructive` |
  | seções de configuração                         | `Card`                                                                             |
  | estado do caso, nível do log, estado do módulo | `Badge`                                                                            |
  | campos                                         | `Input`, `Label`, `Textarea` e `NativeSelect`                                      |
  | ligar e desligar módulo                        | `Switch`, com o mesmo nome acessível do botão atual                                |
  | carregamento                                   | `Skeleton`                                                                         |
  | tabelas                                        | `Table` (seção 6.2)                                                                |

- **Comportamento do `AlertDialog`:** o mesmo do `ConfirmDialog`. O foco começa em Cancelar, Esc e o clique fora cancelam, e o foco volta para quem abriu ou para `returnFocusRef`. Os dois botões ficam desligados enquanto a ação roda, e o erro aparece dentro do diálogo.
- **Textos:** todos os textos, rótulos, mensagens de erro e nomes acessíveis continuam iguais, salvo o item do menu da seção 3.

## 6. Melhorias de uso

### 6.1. Notificações (toasts)

> **Atualização (2026-11-26):** os toasts usam o `Toast` do Radix, não o Sonner, porque o Sonner 2.0.8 injeta um `<style>` sem nonce. Ver a [0025](../decisions/0025-panel-ui-kit.md).

- **Onde:** um `Toaster` do Sonner no canto inferior direito, ou no topo no celular. Ele mostra uma confirmação curta depois de uma ação que deu certo:

  | Tela            | Ação                 | Texto                                                   |
  | --------------- | -------------------- | ------------------------------------------------------- |
  | Casos           | reverter / descartar | "Caso revertido." / "Caso descartado."                  |
  | Ações           | qualquer ação        | o texto de resultado que a tela já mostra               |
  | Domínios        | adicionar / remover  | "Domínio adicionado." / "Domínio removido."             |
  | Configuração    | salvar seção         | "Configuração salva."                                   |
  | Permissões      | conceder / remover   | "Permissão concedida." / "Permissão removida."          |
  | Desenvolvedores | adicionar / remover  | "Desenvolvedor adicionado." / "Desenvolvedor removido." |
  | Módulos         | ligar / desligar     | "Módulo ligado." / "Módulo desligado."                  |
  | Sessões         | revogar              | "Sessão revogada."                                      |

- **Erros:** não viram toast. Continuam na tela, perto do que falhou, como hoje, inclusive o texto de conflito com `Recarregar`.
- **Duração:** o toast some sozinho em 4 s, pode ser fechado e é anunciado a leitores de tela.
- **Resultado em Ações:** o texto de resultado da tela continua visível. O toast é um reforço, não substitui esse texto.

### 6.2. Tabelas

- **Quais:** Logs, Sessões, Domínios, Desenvolvedores, Permissões e Módulos usam TanStack Table, todas com dados que já chegam inteiros ao navegador.
- **Busca:** um campo "Buscar" acima da tabela filtra por qualquer coluna de texto, sem diferenciar maiúsculas nem acentos.
- **Ordenação:** clicar no cabeçalho alterna entre crescente, decrescente e a ordem original. O cabeçalho tem `aria-sort`. A ordem inicial é a que o servidor manda.
- **Sem resultado:** a busca vazia mostra "Nenhum resultado para a busca.", e a tabela sem dados mantém o texto de vazio de hoje.
- **Valores longos:** em Logs, "Mensagem" e "Campos" quebram linha (`break-words`) e nunca são cortados.
- **Casos:** muda só o visual. A tela continua com os filtros do servidor e `Carregar mais`, porque ordenar só a parte carregada daria um resultado enganoso.

## 7. Segurança: nonce de estilo ([0025](../decisions/0025-panel-ui-kit.md))

- **Marcador no build:** o `index.html` do app traz `<meta name="csp-nonce" content="__CSP_NONCE__">`.
- **Entrega pelo servidor** (`interfaces/dashboard/server.ts`):
  - o arquivo é lido uma vez;
  - a cada resposta com o `index.html`, o servidor gera um nonce de 16 bytes aleatórios (`crypto.randomBytes`) em base64 e troca o marcador por ele;
  - a CSP dessa resposta é a atual com `style-src 'self' 'nonce-<valor>'`.
- **Caminhos:** `/`, `/index.html` e qualquer rota do app (o fallback do roteamento) passam por esse caminho. O `@fastify/static` não entrega mais o `index.html` cru.
- **Demais respostas:** API e arquivos estáticos continuam com a CSP atual, sem `style-src` extra.
- **Uso no app:** em `main.tsx`, antes de renderizar, o app lê a `<meta>` e repassa o valor aos componentes que criam `<style>`. Para o Radix, isso é feito com `setNonce` de `get-nonce`. O Sonner precisa trazer o estilo de um arquivo CSS estático ou aceitar o nonce. Se não der, a notificação é feita com o `Toast` do Radix.
- **Critério:** nenhuma violação de CSP no console em nenhuma tela, nos dois temas, abrindo diálogos, gavetas e toasts.
- **`style="…"` via JavaScript:** os componentes podem definir estilo pelo JavaScript, como o React faz. Isso não é bloqueado pela CSP. Continua proibido gerar `<style>` ou atributos `style` no HTML entregue.

## 8. Dependências (só no app)

> **Atualização (2026-11-26):** o `sonner` sai da lista. Os toasts usam o `Toast` do Radix, porque o Sonner 2.0.8 injeta um `<style>` sem nonce. Ver a [0025](../decisions/0025-panel-ui-kit.md).

- `tailwindcss` e `@tailwindcss/vite`;
- os pacotes do Radix usados pelos componentes copiados (`radix-ui` ou `@radix-ui/react-*`);
- `get-nonce`, `lucide-react`, `sonner` e `@tanstack/react-table`;
- `class-variance-authority`, `clsx` e `tailwind-merge`.

Sai o `styles.css` escrito à mão. O `motion` continua. A versão de cada dependência é fixada no plano pela versão estável mais recente, com o `package-lock.json` commitado.

## 9. Testes

- **Testes atuais:** os do app continuam passando. Eles procuram por papel, nome acessível e texto, não por classe CSS. Um teste só pode mudar onde a estrutura mudou de fato. Por exemplo, o painel do caso passa a ser um `dialog` do `Sheet`. A mudança fica registrada no PR.
- **Testes novos do app:**
  - **menu:** agrupamento, grupo sem itens escondido, recolher e expandir, e gaveta no celular;
  - **tema:** valor inicial pelo sistema, escolha guardada, `localStorage` inacessível;
  - **indicador de conexão:** "Ao vivo" e "Reconectando…";
  - **toasts:** um por ação da tabela 6.1;
  - **tabelas:** busca sem acento e sem maiúsculas, ordenação com `aria-sort`, texto de sem resultado e valores longos sem corte em Logs;
  - **`AlertDialog`:** foco inicial, Esc, retorno do foco e botões desligados durante a ação.
- **Testes novos do servidor:**
  - o nonce muda a cada requisição e aparece igual na `<meta>` e na CSP;
  - `/`, `/index.html` e uma rota do app recebem nonce;
  - nenhuma resposta sai com o marcador `__CSP_NONCE__`;
  - a API e os arquivos estáticos não ganham `style-src` extra.
- **Conferência no navegador**, com o build e a CSP reais:
  - larguras de 1440, 1024 e 375 px;
  - tema claro e escuro;
  - todas as telas, um diálogo, a gaveta do celular e um toast;
  - zero violações de CSP no console.

## 10. Divisão em Pull Requests

1. **PR P — documentação:** esta spec, a decisão 0025 e a correção do ROADMAP, do README e do CHANGELOG. O teste manual do painel não foi feito antes da `v0.3.0` e continua pendente.
2. **PR Q — base:**
   - Tailwind, shadcn e os tokens de cor;
   - tema claro e escuro;
   - `Sidebar`, cabeçalho, indicador de conexão e gaveta do celular;
   - login e sem acesso;
   - nonce no servidor e no app.

   Depois do PR Q, as telas ainda sem o visual novo podem ficar com o estilo antigo, desde que funcionem.

3. **PR R — telas:** as 10 telas e o `CaseDetail` passam aos componentes da seção 5, e o `styles.css` sai.
4. **PR S — melhorias:** os toasts da seção 6.1 e as tabelas da seção 6.2.

## 11. Documentação

- **README, seção "Painel":**
  - o visual, o tema e o build continuam com os mesmos comandos;
  - uma nota de que o túnel ou proxy precisa repassar o cabeçalho `Origin` sem alterar, porque sem isso o canal ao vivo fica em "Reconectando…".
- **Spec da Fase 3, §6:** nota datada apontando para esta spec e para a 0025, porque a regra "sem estilos inline" ficou mais precisa.
- **`CHANGELOG.md`** em cada PR.

## 12. Critérios de conclusão

- O painel tem tema claro e escuro, com a regra 60-30-10 da seção 4, e passa no WCAG AA de contraste.
- Nenhuma tela corta conteúdo ou deixa a página rolar na horizontal em 1440, 1024 e 375 px.
- Os toasts da seção 6.1 e a busca e ordenação da seção 6.2 funcionam.
- Nenhuma violação de CSP no console, sem `'unsafe-inline'`.
- `npm run check` passa, com os testes atuais e os novos.
