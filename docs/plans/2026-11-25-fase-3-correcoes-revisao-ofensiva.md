# Fase 3 — Correções da revisão ofensiva: Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** corrigir, antes da `v0.3.0`, as falhas da revisão ofensiva da Fase 3 (spec §11.4) que a pessoa mantenedora decidiu corrigir, e registrar as que foram aceitas.

**Architecture:** cada correção fica no componente que já tem a responsabilidade:

- os limites de sessão ficam no `SessionStore`, e os de conexão no `LiveHub`;
- a chave do limitador fica no servidor do painel;
- a mescla da configuração fica no `ModuleConfigStore`;
- as regras de domínio e de motivo ficam no `moderation`;
- a redação de logs fica no Core.

Nada muda no contrato de módulos, então `CORE_API_VERSION` continua `1.4.0`.

**Tech Stack:** o mesmo da Fase 3, sem dependências novas.

**Spec:** [`docs/specs/2026-11-24-fase-3-painel.md`](../specs/2026-11-24-fase-3-painel.md) §5.3 a §5.6 e §11.4. A spec da Fase 2 ([`2026-11-17-fase-2-moderacao-phishing.md`](../specs/2026-11-17-fase-2-moderacao-phishing.md)) também se aplica, no que trata de imitação de domínio e listas de domínios. Os relatórios da revisão ficam fora do repositório, porque trazem passos de ataque. Este plano resume o que cada task precisa.

## Global Constraints

- Tudo das Global Constraints das etapas 1, 2 e 3 continua valendo.
- **Limites novos ([0024](../decisions/0024-panel-session-limits.md)):**
  - no máximo 5 sessões ativas por pessoa. Uma sessão nova apaga a mais antiga pelo último uso, e o apagamento avisa os ouvintes de `onRevoked`, que fecham a conexão ao vivo dela;
  - no máximo 10 conexões ao vivo por pessoa, somando todas as sessões;
  - no máximo 500 conexões ao vivo no total;
  - acima de um desses limites, o upgrade é recusado com 403, como já acontece com o limite por sessão.
- **Chave do limitador por IP:** um endereço IPv4 conta sozinho. Um endereço IPv6 conta pelo seu bloco `/64`, que são os 4 primeiros grupos depois de expandir `::`. Um IPv6 que representa um IPv4 (`::ffff:a.b.c.d`) conta como o IPv4.
- **Mescla da configuração:** `updateSettings` mescla em profundidade os objetos simples, e as listas são substituídas inteiras. A validação e a gravação usam o resultado da mescla.
- **Domínios recusados em `moderation.domains.allow`** (código `invalid`):
  - sufixo público: `Este domínio é um sufixo público e não pode ser permitido.`
  - imitação de um domínio conhecido: `Este domínio imita um domínio conhecido e não pode ser permitido.`
- **Sufixos públicos recusados**, uma lista fixa no módulo: `com.br`, `net.br`, `org.br`, `gov.br`, `edu.br`, `co.uk`, `org.uk`, `com.au`, `co.jp`, `github.io`, `gitlab.io`, `pages.dev`, `workers.dev`, `vercel.app`, `netlify.app`, `web.app`, `firebaseapp.com`, `herokuapp.com`, `blogspot.com`, `glitch.me`, `repl.co`.
- **Motivo:** além das regras atuais, um motivo com caractere de controle de direção é recusado com `Entrada inválida: reason.` São eles U+061C, U+200E, U+200F, U+202A a U+202E e U+2066 a U+2069. U+200D continua aceito, porque compõe emojis.
- **Logs:**
  - a linha `guild action executed` não leva mais o motivo, e passa a levar `hasReason: true | false`;
  - a redação do pino também cobre `accessToken`, `refreshToken`, `clientSecret`, `cookie`, `csrfToken` e `secret`, nas profundidades 0 a 2 que as chaves atuais já cobrem;
  - `code` não é redigido, porque carrega o código de erro.
- **`.gitignore`:** acrescentar `.superpowers/`, `.env.*` com a exceção `!.env.example`, `*.db`, `*.db-wal` e `*.db-shm`.

## Review Focus

1. **Logar de novo seis vezes:** a sexta sessão apaga a primeira, a conexão ao vivo da primeira recebe `session.ended` e fecha, e as outras cinco seguem válidas. Teste na Task 1.
2. **Abrir 11 conexões com duas sessões da mesma pessoa:** a 11ª é recusada com 403 e nenhuma é fechada. Teste na Task 1.
3. **IPv6 no mesmo `/64`:** dez logins de endereços diferentes do mesmo bloco esgotam o limite, e o 11º recebe 429. Teste na Task 2.
4. **Alterar só `spam.flood.limit` pelo painel:** `spam.escalation`, `spam.ignoredChannelIds` e os outros campos de `spam` continuam como estavam. Teste na Task 3.
5. **Permitir `steɑm-gift.com` ou `com.br`:** os dois são recusados com o texto certo. Uma mensagem com `steɑm-gift.com` recebe o sinal de imitação. Testes na Task 4.

## Entrega

Um único Pull Request, PR O, com as Tasks 1 a 5 e o título `fix: address the phase 3 offensive review`.

---

### Task 1: Limites de sessão e de conexão

**Files:**

- Create: `docs/decisions/0024-panel-session-limits.md`
- Modify:
  - `core/sessions/session-store.ts` e `.test.ts`
  - `interfaces/dashboard/live.ts` e `live.test.ts`

**Interfaces:**

- Produces:
  - `MAX_SESSIONS_PER_USER = 5` em `session-store.ts`. `create(userId)`:
    - apaga as sessões mais antigas pelo `last_seen_at`, até sobrarem 4;
    - em seguida cria a nova;
    - avisa os ouvintes de `onRevoked` com os hashes apagados.
  - `MAX_CONNECTIONS_PER_USER = 10` e `MAX_CONNECTIONS_TOTAL = 500` em `live.ts`. Os dois são conferidos em `#admit`, junto do limite por sessão que já existe.

- [ ] **Step 1: Decisão 0024.** No mesmo formato das decisões 0017 a 0023, registrar:
  - os três limites e o motivo: um membro sem permissão podia esgotar a memória do processo do bot;
  - que a sessão mais antiga é a apagada;
  - que o limite de requisições continua por sessão;
  - que separar as leituras do limite de alterações segue pendente.
- [ ] **Step 2: Testes que falham:**
  - a sexta sessão apaga a primeira pelo último uso e avisa `onRevoked` uma vez;
  - sessões vencidas não contam;
  - outra pessoa não é afetada;
  - **(Review Focus 1)** com WebSocket real, a conexão da sessão apagada recebe `session.ended` e fecha;
  - **(Review Focus 2)** a 11ª conexão da mesma pessoa é recusada com 403;
  - a 501ª conexão no total é recusada (use um limite injetável no construtor para o teste não abrir 500 sockets).
- [ ] **Step 3: Rodar.** `npx vitest run core/sessions interfaces/dashboard` → FAIL.
- [ ] **Step 4: Implementar.**
- [ ] **Step 5: Rodar.** `npm run check` → PASS.
- [ ] **Step 6: Commit.** `fix(dashboard): cap panel sessions and live connections per person`

### Task 2: Limitador por bloco IPv6

**Files:**

- Create: `interfaces/dashboard/client-key.ts` e `.test.ts`
- Modify: `interfaces/dashboard/server.ts` e `server.test.ts`

**Interfaces:**

- Produces: `clientKey(ip: string): string`. Para IPv4 devolve o próprio endereço; para IPv6, o bloco `/64` normalizado, como nas Global Constraints. O limitador de `/auth` e o de requisições sem sessão usam `i:${clientKey(request.ip)}`.

- [ ] **Step 1: Testes que falham:**
  - `clientKey('2001:db8:1:2:3:4:5:6')` e `clientKey('2001:db8:1:2:ffff::1')` são iguais;
  - `clientKey('2001:db8::1')` e `clientKey('2001:0db8:0000:0000::9')` são iguais;
  - `clientKey('::ffff:192.0.2.1')` é `192.0.2.1`;
  - um IPv4 volta igual;
  - **(Review Focus 3)** com `inject` e `remoteAddress` variando dentro de um `/64`, o 11º login recebe 429.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** com `node:net` (`isIPv4`/`isIPv6`) e uma expansão própria de `::`.
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `fix(dashboard): rate limit IPv6 clients by /64`

### Task 3: Mescla profunda da configuração

**Files:**

- Modify:
  - `core/configuration/module-config.ts` e `.test.ts`
  - `modules/moderation/operations/config.ts` e `config.test.ts`

**Interfaces:**

- Produces: `mergeSettings(stored: Record<string, unknown>, partial: Record<string, unknown>): Record<string, unknown>`, exportado de `module-config.ts`.
  - Objetos simples são mesclados chave a chave, em qualquer profundidade.
  - Listas, valores primitivos e `null` substituem o valor guardado.
  - As chaves `__proto__`, `constructor` e `prototype` são ignoradas.
  - `updateSettings` usa essa função. A validação antecipada de `moderation.config.update` também passa a usar a mesma função, no lugar do espalhamento raso.

- [ ] **Step 1: Testes que falham:**
  - a mescla preserva as chaves vizinhas;
  - uma lista é substituída, não concatenada;
  - `__proto__` é ignorado;
  - **(Review Focus 4)** `config.update` com `{ spam: { flood: { limit: 7 } } }` mantém `spam.escalation`, `spam.ignoredChannelIds` e os outros campos de `spam.flood`;
  - o `/mod config` continua com as mesmas respostas.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `fix(core): merge partial module settings deeply`

### Task 4: Domínios e motivo no `moderation`

**Files:**

- Modify:
  - `modules/moderation/detection/lookalike.ts` e os testes
  - `modules/moderation/operations/domains.ts` e os testes
  - `modules/moderation/operations/actions.ts` e os testes
  - `modules/moderation/README.md`
  - a spec da Fase 2, no trecho da lista de caracteres parecidos, com uma nota de atualização datada

**Interfaces:**

- Produces:
  - **`CONFUSABLES`** ganha estas formas:
    - Latim estendido: `ɑ`→a, `ɡ`→g, `ı`→i, `ȷ`→j, `ʀ`→r;
    - versaletes: `ᴀ ʙ ᴄ ᴅ ᴇ ꜰ ɢ ʜ ɪ ᴊ ᴋ ʟ ᴍ ɴ ᴏ ᴘ ʀ ꜱ ᴛ ᴜ ᴠ ᴡ ʏ ᴢ` → a–z;
    - cirílico: `т`→t, `м`→m, `н`→h, `к`→k, `в`→b, `ѕ`→s, `і`→i, `ј`→j, `ԁ`→d, `ɡ`→g;
    - armênio: `օ`→o, `ս`→u, `հ`→h, `ո`→n;
    - grego: `ο`→o, `α`→a, `ν`→v, `τ`→t, `κ`→k, `ι`→i, `ρ`→p.
  - **Regra nova em `isLookalike`:** um rótulo com caractere não ASCII cujo esqueleto fica a distância 1 ou menos de um alvo também é imitação, mesmo para alvos curtos como `steam`.
  - **`domains.allow`:**
    - recusa os sufixos públicos das Global Constraints;
    - recusa um domínio que `isLookalike` marca;
    - usa os dois textos das Global Constraints;
    - `domains.block` continua aceitando os dois.
  - **Motivo:** recusa os controles de direção das Global Constraints, no schema `reason` de `actions.ts`.

- [ ] **Step 1: Testes que falham:**
  - **(Review Focus 5)** `steɑm-gift.com`, `ꜱteam-gift.com` e `ѕтеам.ru` são imitações;
  - `stean-gift.com` continua como hoje, pela regra de distância dos alvos longos ou de nenhuma regra. Registre no teste o resultado atual em vez de mudá-lo, porque ele é ASCII;
  - `steam.com` e `discord.com` continuam não sendo imitação;
  - permitir `com.br` e `github.io` dá o texto de sufixo público;
  - permitir `steɑm-gift.com` dá o texto de imitação;
  - bloquear os dois continua aceito;
  - um motivo com U+202E é recusado, e um motivo com emoji com U+200D é aceito;
  - os testes atuais do `/mod` continuam passando.
- [ ] **Step 2: Rodar.** `npx vitest run modules/moderation` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `fix(moderation): catch more lookalikes and refuse risky allow entries`

### Task 5: Logs, `.gitignore` e registro da revisão

**Files:**

- Create: `docs/security/2026-11-25-revisao-ofensiva-fase-3.md`
- Modify:
  - `core/guild/module-guild.ts` e os testes
  - `core/infrastructure/logger.ts` e `logger.test.ts`
  - `core/infrastructure/recent-logs.ts`, para que `fields` seja criado com `Object.create(null)`
  - `.gitignore`
  - `README.md`, com uma nota sobre a permissão do arquivo do banco e sobre não deixar `data/` numa pasta sincronizada
  - `docs/ROADMAP.md`
  - `CHANGELOG.md`

- [ ] **Step 1: Testes que falham:**
  - `guild action executed` traz `hasReason: true` e nenhum texto do motivo;
  - o logger redige `accessToken`, `clientSecret`, `cookie` e `csrfToken` nas profundidades 0 a 2, e não redige `code`;
  - uma entrada de log com a chave `__proto__` não altera o protótipo de `fields`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar e documentar.** O registro da revisão, em português, lista cada achado com severidade, decisão e PR, sem passos de ataque.
  - **Corrigidos neste PR:** os limites de sessão e de conexão, as imitações, o motivo nos logs, a mescla da configuração, a lista de permitidos, o limitador IPv6, os controles de direção, o `.gitignore` e a redação.
  - **Aceitos pela pessoa mantenedora:**
    - o `core.admin` não fica preso ao `administration`: a 0023 deixa para a revisão de PR, e há um teste;
    - o dono pode receber advertência;
    - o limite de requisições é por sessão, e as leituras contam no limite de alterações, o que fica para uma decisão pendente;
    - o estado do módulo aparece pelo 404, 503 ou 403, porque a ordem de checagem da spec §4 é a mesma;
    - a máscara de IDs não pega IDs com separadores;
    - a permissão do arquivo do banco fica como nota no README;
    - os achados informativos.
  - **Pendente da pessoa mantenedora:** conferir com o suporte do GitHub as cópias em cache do ID vazado antes.
  - **ROADMAP:** revisão ofensiva concluída, com o teste manual pendente.
- [ ] **Step 4: Rodar.** `npm run check` → PASS.
- [ ] **Step 5: Commit.** `fix(core): keep free text out of logs and record the offensive review`
