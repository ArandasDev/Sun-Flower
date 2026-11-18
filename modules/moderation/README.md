# Módulo `moderation`

## 1. Descrição e finalidade

Primeiro módulo real do Sun Flower. Detecta phishing em mensagens do servidor e aplica ações de moderação. Esta versão contém apenas o esqueleto: manifesto, configuração, migração e ciclo de vida vazio. A spec está em [docs/specs/2026-11-17-fase-2-moderacao-phishing.md](../../docs/specs/2026-11-17-fase-2-moderacao-phishing.md).

## 2. Funcionalidades disponibilizadas

Nenhuma ainda. Detecção, resposta automática e comandos `/mod` chegam em tarefas seguintes.

## 3. Requisitos e dependências

- `apiVersion` `1.1.0` do contrato do Core.
- Nenhuma dependência de outro módulo.

## 4. Configurações disponíveis

O módulo exporta `configSchema` (`config.ts`). Todos os campos são opcionais e têm padrão; `{}` gera a configuração completa: `alertChannelId` (ausente por padrão), `timeoutMinutes`, `thresholds`, `weights`, `exemptRoleIds`, `newAccountDays`, `newMemberHours`, `multiChannel` e `baitTerms`. Detalhes na spec §4.2.

## 5. Permissões necessárias

Capacidades `guild.moderate` e `guild.message`; permissões `moderation.*` declaradas no manifesto.

## 6. Eventos emitidos e consumidos

- Consome: `discord.message.created`, `discord.message.updated`.
- Publica: `moderation.case.created`, `moderation.case.reverted`.

## 7. Comandos e interfaces disponibilizados

Nenhum ainda.

## 8. Exemplos de utilização

Não se aplica nesta versão.

## 9. Limitações conhecidas

- O ciclo de vida não faz nada ainda.

## 10. Informações relevantes para manutenção

- Migração: `migrations/0001-moderation.sql` cria `moderation_cases` e `moderation_domains`.
- Testes: `modules/moderation/tests/config.test.ts` e `tests/integration/moderation.test.ts`.
