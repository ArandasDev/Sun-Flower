# Módulo `ping`

## 1. Descrição e finalidade

Módulo de exemplo do Sun Flower. Confirma que o bot está conectado e respondendo, e serve de referência mínima para o contrato de módulo de [MODULES.md](../../docs/MODULES.md).

## 2. Funcionalidades disponibilizadas

- Comando `/ping`, que responde `Pong!`.

## 3. Requisitos e dependências

- `apiVersion` `1.0.0` do contrato do Core.
- Nenhuma dependência de outro módulo.

## 4. Configurações disponíveis

Não se aplica. O módulo não exporta `configSchema`.

## 5. Permissões necessárias

Não se aplica. O manifesto não declara permissões, e `/ping` responde a qualquer membro do servidor.

## 6. Eventos emitidos e consumidos

Não se aplica. O módulo não publica nem assina eventos.

## 7. Comandos e interfaces disponibilizados

| Comando | Descrição                                  | Resposta |
| ------- | ------------------------------------------ | -------- |
| `/ping` | Verifica se o Sun Flower está respondendo. | `Pong!`  |

A resposta é pública (não efêmera).

## 8. Exemplos de utilização

No servidor configurado em `DISCORD_GUILD_ID`, digite `/ping`. O bot responde `Pong!`.

## 9. Limitações conhecidas

- `/ping` não mede a latência; apenas confirma que o bot recebe e responde a comandos.

## 10. Informações relevantes para manutenção

- O manifesto segue exatamente a [spec da Fase 1 §10](../../docs/specs/2026-11-16-fase-1-core-discord.md#10-módulo-ping).
- `register` registra o comando; `initialize`, `start`, `stop` e `dispose` não fazem nada.
- O módulo importa somente tipos de `shared/`, como exige o ESLint para `modules/`.
- Testes: `modules/ping/tests/ping.test.ts` (registro e resposta) e `tests/integration/ping.test.ts` (manifesto aceito pelo Core e `/ping` respondido pelo Core real).
