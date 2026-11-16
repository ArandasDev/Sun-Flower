# Spec — Fase 0: Base do repositório

**Status:** Aprovada em 2026-11-16
**Fase:** [ROADMAP — Fase 0](../ROADMAP.md#fase-0--base-do-repositório)
**Decisões aplicadas:** [0002](../decisions/0002-typescript-node.md), [0004](../decisions/0004-tooling.md)

## 1. Objetivo

Deixar o repositório pronto para receber o código da Fase 1: projeto TypeScript compilável, verificações executáveis por um único comando e CI bloqueando Pull Requests que falhem.

Fora do escopo: qualquer código de Core, Discord ou módulos, e a dependência `discord.js` (entram na Fase 1).

## 2. Arquivos criados

| Arquivo                    | Conteúdo                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`             | `"type": "module"`, `"private": true`, `engines.node: ">=26"`, scripts da seção 3, somente dependências de desenvolvimento.                                                                       |
| `package-lock.json`        | Gerado pelo `npm install` e versionado.                                                                                                                                                           |
| `.nvmrc`                   | `26`.                                                                                                                                                                                             |
| `tsconfig.json`            | `strict: true`, `noUncheckedIndexedAccess: true`, `module`/`moduleResolution: "NodeNext"`, `target: "ES2024"`, `outDir: "dist"`. Inclui `core/`, `modules/`, `interfaces/`, `shared/` e `tests/`. |
| `eslint.config.js`         | Configuração flat: `@eslint/js` recomendado + `typescript-eslint` `recommendedTypeChecked` + `eslint-config-prettier`. Ignora `dist/` e `node_modules/`.                                          |
| `.prettierrc.json`         | `singleQuote: true`, `semi: true`, `trailingComma: "all"`, `printWidth: 100`.                                                                                                                     |
| `.prettierignore`          | `dist/`, `node_modules/`, `package-lock.json`.                                                                                                                                                    |
| `vitest.config.ts`         | Testes em `**/*.test.ts`, ambiente `node`.                                                                                                                                                        |
| `tests/sanity.test.ts`     | Um teste que confirma que o Vitest executa, para que a CI tenha pelo menos um teste real. Removido na Fase 1, quando houver testes do Core.                                                       |
| `.gitignore`               | `node_modules/`, `dist/`, `coverage/`, `.env`, `*.log`.                                                                                                                                           |
| `.gitattributes`           | `* text=auto eol=lf`, para todos os arquivos usarem quebra de linha LF.                                                                                                                           |
| `.env.example`             | `DISCORD_TOKEN=` e `DISCORD_GUILD_ID=`, ambos vazios. Os valores reais ficam somente no `.env` local, que não é versionado.                                                                       |
| `.github/workflows/ci.yml` | Executa em todo Pull Request para `main` e em push na `main`: Node 26, `npm ci`, `npm run check`. O job se chama **`check`**, nome exigido pelo ruleset da seção 5.                               |

Dependências de desenvolvimento: `typescript`, `@types/node`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`, `eslint-config-prettier`. Versões: as mais recentes estáveis no momento da instalação.

## 3. Comandos

| Comando                | Faz                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `npm run build`        | Compila para `dist/` com `tsc`.                                                    |
| `npm run typecheck`    | `tsc --noEmit`.                                                                    |
| `npm run lint`         | `eslint .`                                                                         |
| `npm run format`       | `prettier --write .`                                                               |
| `npm run format:check` | `prettier --check .`                                                               |
| `npm test`             | `vitest run`.                                                                      |
| `npm run check`        | `format:check`, `lint`, `typecheck` e `test`, nessa ordem; para na primeira falha. |

`npm run check` é a verificação obrigatória antes de abrir um Pull Request, e é o que a CI executa.

## 4. Documentação atualizada

- `README.md`: seção **Desenvolvimento** com pré-requisitos (Node 26), instalação (`npm install`), cópia de `.env.example` para `.env` e a tabela de comandos da seção 3.
- `CONTRIBUTING.md §5`: os comandos obrigatórios passam a ser `npm run check`.
- `docs/ROADMAP.md`: estado atual e critérios da Fase 0.
- `CHANGELOG.md`: entrada em `Unreleased › Added`.

## 5. Proteção da `main`

O ruleset versionado em `.github/rulesets/main.json` implementa as regras de [GIT.md §2.1](../GIT.md#21-branch-permanente) para a branch padrão:

| Regra do ruleset          | Efeito                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `deletion`                | Bloqueia a exclusão da `main`.                                                              |
| `non_fast_forward`        | Bloqueia force push.                                                                        |
| `required_linear_history` | Impede merge commits na `main`.                                                             |
| `pull_request`            | Exige Pull Request, `0` aprovações, resolução das conversas e somente **Squash and merge**. |
| `required_status_checks`  | Exige o job `check` da CI aprovado, com a branch atualizada em relação à `main`.            |

Sem `bypass_actors`: nem a pessoa mantenedora contorna as regras.

A pessoa mantenedora importa o arquivo no GitHub (**Settings → Rules → Rulesets → New ruleset → Import a ruleset**) **depois** que o Pull Request da etapa 2 for integrado. Antes disso, o job `check` não existe na `main` e nenhum Pull Request conseguiria ser integrado.

Agentes de IA não alteram essa configuração ([CONTRIBUTING.md §8.2](../../CONTRIBUTING.md#82-o-agente-nunca-sem-autorização-explícita)).

## 6. Sequência de entrega

1. Commit inicial na `main` com a documentação, esta spec, a decisão 0004 e o ruleset `.github/rulesets/main.json`.
2. Pull Request `chore: set up typescript project and ci` com os arquivos das seções 2 a 4.
3. A pessoa mantenedora importa o ruleset (seção 5).

## 7. Critérios de conclusão

- [ ] `npm run check` passa em uma cópia nova do repositório após `npm ci`.
- [ ] A CI executa no Pull Request da etapa 2 e passa.
- [ ] Um commit com erro de formatação, lint, tipo ou teste faz a CI falhar (verificado em um commit temporário no mesmo Pull Request, revertido antes do merge).
- [ ] Um push direto na `main` é recusado pelo GitHub.
