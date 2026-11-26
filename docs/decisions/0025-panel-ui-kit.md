# 0025 — Tailwind CSS e shadcn/ui no painel, com nonce de estilo na CSP

**Status:** Aceita
**Data:** 2026-11-26

## Contexto

A [0019](0019-panel-stack.md) definiu React e Vite para o painel, sem biblioteca de componentes. As telas das etapas 1 a 3 usam um CSS escrito à mão, com cerca de 970 linhas. O visual tem duas origens: uma paleta própria verde e amarela e um layout em coluna estreita.

No primeiro uso real, a pessoa mantenedora pediu o visual padrão de painéis administrativos. Esse visual tem tema claro e escuro, tons neutros e uma cor de destaque. O pedido também incluiu tabelas que não cortam o conteúdo e retorno visível depois de cada ação.

A CSP do painel (`default-src 'self'`) bloqueia `<style>` criado em tempo de execução. Alguns componentes de interface criam esse elemento: o Radix o usa para travar a rolagem atrás de um diálogo, e bibliotecas de notificação injetam o próprio CSS.

## Decisão

- **Estilo:** Tailwind CSS 4, pelo plugin do Vite. O resultado é um arquivo CSS estático servido pelo próprio painel.
- **Componentes:** shadcn/ui, com o código dos componentes copiado para `interfaces/dashboard/app/src/components/ui`. Os componentes usam primitivos do Radix, e os ícones vêm do lucide. Não há pacote do shadcn em tempo de execução: o código é do projeto e passa pela mesma revisão.
- **Tabelas:** TanStack Table, para busca e ordenação no navegador.
- **Notificações:** Sonner, o componente de toasts do shadcn.
- **Listas de escolha:** seletor nativo estilizado (`NativeSelect`), não o `Select` do Radix. Ele é mais acessível no celular e mantém o comportamento atual dos formulários.
- **Tema:** claro e escuro com tokens do shadcn em variáveis CSS. As cores seguem a regra 60-30-10:
  - 60% de fundo neutro;
  - 30% de superfícies neutras (menu lateral, cartões, campos);
  - 10% de amber, a cor de destaque (ação principal, item ativo, foco).

  O vermelho fica só para ações destrutivas e erros. O tema começa pelo do sistema operacional, e a escolha manual fica no `localStorage`.

- **CSP com nonce de estilo:**
  - o servidor entrega o `index.html` com um nonce aleatório de 128 bits novo a cada requisição, inclusive pelo caminho `/index.html`;
  - a CSP dessa resposta ganha `style-src 'self' 'nonce-<valor>'`;
  - o app lê o nonce de uma `<meta>` ao iniciar e o repassa aos componentes que criam `<style>`.

  Fora isso, a CSP não muda. Em particular, não se usa `'unsafe-inline'`.

## Alternativas consideradas

- **`style-src 'unsafe-inline'`:** é mais simples, mas enfraquece a CSP logo depois da revisão ofensiva da Fase 3.
- **CSP intacta, sem componentes que criam `<style>`:** perderia o diálogo, a gaveta e os toasts do shadcn, que são a maior parte do ganho.
- **Manter o CSS próprio e só corrigir o layout:** é menor, mas não entrega o visual padrão pedido.

## Consequências

- O app ganha dependências novas, como Tailwind, Radix, lucide, Sonner e TanStack Table, além de utilitários como `clsx`, `tailwind-merge` e `class-variance-authority`. Todas são só do app do painel. O processo do bot não muda.
- O `styles.css` escrito à mão sai. As telas passam a usar classes do Tailwind e os componentes de `components/ui`.
- O servidor do painel passa a montar o `index.html` por requisição, em vez de devolver sempre o mesmo conteúdo.
- Se uma biblioteca não aceitar nonce, o estilo dela precisa vir de um arquivo CSS estático, ou ela é trocada. Nenhuma violação de CSP no console é aceita.
- Esta decisão complementa a [0019](0019-panel-stack.md) e não a substitui.

> **Atualização (2026-11-26):** os toasts usam o `Toast` do Radix, não o Sonner. O Sonner 2.0.8 injeta um `<style>` sem nonce ao ser importado, o que viola a CSP. Por isso o Sonner sai da lista de dependências.
