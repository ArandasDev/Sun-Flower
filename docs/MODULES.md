# 🌻 Sun Flower — Module Development Specification

## 1. Introdução

Este documento estabelece as especificações técnicas para desenvolvimento, integração e manutenção de módulos no Sun Flower.

A arquitetura utiliza o conceito de **Modular Monolith** ([decisão 0001](decisions/0001-modular-monolith.md)), no qual os módulos compartilham o mesmo processo de aplicação, mas mantêm responsabilidades, interfaces e domínios funcionais isolados.

Os módulos são escritos em **TypeScript** e executados em **Node.js** ([decisão 0002](decisions/0002-typescript-node.md)).

O objetivo é permitir que funcionalidades sejam desenvolvidas e mantidas independentemente, sem comprometer a estabilidade do sistema central.

Todo módulo deverá respeitar os contratos definidos neste documento.

## 2. Conceito de Módulo

Um módulo representa uma unidade funcional independente dentro do Sun Flower.

Cada módulo deverá possuir:

- Identidade própria.
- Responsabilidade funcional definida.
- Configurações específicas.
- Permissões declaradas.
- Interfaces de comunicação.
- Ciclo de vida padronizado.
- Testes próprios.
- Documentação técnica.

Um módulo não deverá implementar funcionalidades pertencentes a outro domínio.

### Exemplos

| Módulo           | Responsabilidade                   |
| ---------------- | ---------------------------------- |
| `moderation`     | Segurança e moderação              |
| `music`          | Reprodução e gerenciamento musical |
| `social`         | Funcionalidades sociais            |
| `administration` | Operações administrativas          |

## 3. Estrutura de Diretórios

Estrutura do repositório:

```text
sun-flower/
│
├── core/                      # Núcleo: nenhuma regra de negócio de domínio
│   ├── application/
│   ├── module-registry/
│   ├── event-bus/
│   ├── permissions/
│   ├── configuration/
│   └── infrastructure/
│
├── modules/
│   └── <id>/                  # Um diretório por módulo; o nome é o id do módulo
│       ├── manifest.json      # Obrigatório
│       ├── index.ts           # Obrigatório: exporta a implementação do contrato
│       ├── README.md          # Obrigatório
│       ├── tests/             # Obrigatório: testes do módulo
│       ├── commands/          # Opcional
│       ├── events/            # Opcional
│       ├── services/          # Opcional
│       ├── repositories/      # Opcional
│       └── schemas/           # Opcional
│
├── interfaces/
│   ├── discord/
│   ├── dashboard/
│   └── api/
│
├── shared/
│   ├── contracts/             # Contrato oficial de módulo (seção 5)
│   ├── types/
│   └── utilities/
│
├── tests/                     # Testes de integração entre componentes
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── MODULES.md
│   ├── GIT.md
│   ├── ROADMAP.md
│   ├── decisions/
│   └── specs/
│
├── AGENTS.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── README.md
```

Em cada módulo, os itens marcados como **obrigatórios** sempre existem. Os **opcionais** só são criados quando houver conteúdo para eles; diretórios vazios não são versionados.

## 4. Manifesto do Módulo

Todo módulo deverá possuir um manifesto chamado `manifest.json`.

Esse arquivo será responsável por declarar sua identidade, versão, compatibilidade, dependências e requisitos.

### 4.1. Exemplo

```json
{
  "id": "moderation",
  "name": "Moderation",
  "description": "Active server moderation system",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "entrypoint": "index.ts",
  "enabledByDefault": false,
  "dependencies": [],
  "permissions": [
    "moderation.rules.read",
    "moderation.rules.manage",
    "moderation.actions.warn",
    "moderation.actions.timeout",
    "moderation.actions.ban"
  ],
  "events": {
    "subscribes": ["discord.message.created"],
    "publishes": ["moderation.violation.detected", "moderation.action.executed"]
  }
}
```

### 4.2. Campos obrigatórios

| Campo          | Tipo     | Regra                                                                                         |
| -------------- | -------- | --------------------------------------------------------------------------------------------- |
| `id`           | string   | Único, em `kebab-case`, igual ao nome do diretório do módulo.                                 |
| `name`         | string   | Nome de apresentação.                                                                         |
| `description`  | string   | Descrição funcional em uma frase.                                                             |
| `version`      | string   | Versão do módulo em SemVer (`MAJOR.MINOR.PATCH`).                                             |
| `apiVersion`   | string   | Versão SemVer completa do contrato do Core que o módulo utiliza (ex.: `"1.0.0"`).             |
| `entrypoint`   | string   | Caminho, relativo ao diretório do módulo, do arquivo que exporta a implementação do contrato. |
| `dependencies` | string[] | Ids dos módulos dos quais este depende. Lista vazia quando não houver.                        |
| `permissions`  | string[] | Permissões que o módulo declara, no formato da seção 9.1.                                     |

### 4.3. Campos opcionais

| Campo               | Tipo     | Valor padrão | Regra                                                                                      |
| ------------------- | -------- | ------------ | ------------------------------------------------------------------------------------------ |
| `enabledByDefault`  | boolean  | `false`      | Se o módulo é ativado na primeira execução, antes de qualquer configuração administrativa. |
| `events.subscribes` | string[] | `[]`         | Eventos que o módulo consome.                                                              |
| `events.publishes`  | string[] | `[]`         | Eventos que o módulo publica.                                                              |

Campos não listados nas seções 4.2 e 4.3 tornam o manifesto inválido.

### 4.4. Validação

O Core deverá validar o manifesto antes de inicializar o módulo.

A validação deverá verificar:

- Campos obrigatórios.
- Identificadores duplicados.
- Formato da versão.
- Compatibilidade com a API do Core.
- Dependências inexistentes.
- Dependências incompatíveis.
- Permissões declaradas.
- Eventos registrados.

Módulos inválidos não deverão ser inicializados.

## 5. Contrato de Desenvolvimento

Todo módulo deverá implementar o contrato oficial disponibilizado pelo Core.

O contrato define as operações fundamentais necessárias para integrar o módulo ao ciclo de vida da aplicação.

### 5.1. Interface

O contrato é uma interface TypeScript exportada por `shared/contracts`. Os tipos `ModuleManifest` e `ModuleContext` são detalhados na spec da Fase 1 do [ROADMAP](ROADMAP.md).

```typescript
interface SunFlowerModule {
  register(context: ModuleContext): Promise<void>;

  initialize(): Promise<void>;

  start(): Promise<void>;

  stop(): Promise<void>;

  dispose(): Promise<void>;
}
```

O manifesto não faz parte da interface: o `manifest.json` do módulo é a fonte única do manifesto. O `entrypoint` declarado nele exporta `default`, uma fábrica (`ModuleFactory`) que devolve a instância de `SunFlowerModule`, e, opcionalmente, `configSchema`, um schema zod usado para validar a configuração do módulo.

### 5.2. Responsabilidade dos métodos

| Método         | Responsabilidade                       |
| -------------- | -------------------------------------- |
| `register()`   | Registrar comandos, eventos e serviços |
| `initialize()` | Preparar dependências e configurações  |
| `start()`      | Ativar as operações do módulo          |
| `stop()`       | Interromper novas operações            |
| `dispose()`    | Liberar recursos e finalizar o módulo  |

Todos os métodos deverão possuir comportamento previsível e tratamento adequado de erros.

O método `dispose()` deverá ser seguro mesmo após uma inicialização parcialmente concluída.

## 6. Ciclo de Vida

O Core será responsável por controlar o ciclo de vida dos módulos.

Fluxo esperado:

```text
DISCOVERY
    |
    v
MANIFEST VALIDATION
    |
    v
DEPENDENCY RESOLUTION
    |
    v
REGISTER
    |
    v
INITIALIZE
    |
    v
START
    |
    v
RUNNING
    |
    v
STOP
    |
    v
DISPOSE
```

### 6.1. Discovery

Identificação dos módulos disponíveis no ambiente.

### 6.2. Manifest Validation

Validação dos metadados, versões, permissões e requisitos.

### 6.3. Dependency Resolution

Resolução das dependências e determinação da ordem de inicialização.

Dependências circulares deverão ser rejeitadas.

### 6.4. Register

Registro dos recursos disponibilizados pelo módulo no Core.

### 6.5. Initialize

Carregamento de configurações, preparação dos serviços e inicialização de recursos necessários.

### 6.6. Start

Ativação dos consumidores de eventos, serviços e funcionalidades.

### 6.7. Stop

Interrupção controlada de novas operações e conclusão ou cancelamento seguro das operações em andamento.

### 6.8. Dispose

Liberação de conexões, listeners, recursos e referências mantidas pelo módulo.

### 6.9. Correspondência com o contrato

| Etapa                 | Executada por | Método do módulo |
| --------------------- | ------------- | ---------------- |
| Discovery             | Core          | —                |
| Manifest Validation   | Core          | —                |
| Dependency Resolution | Core          | —                |
| Register              | Core → módulo | `register()`     |
| Initialize            | Core → módulo | `initialize()`   |
| Start                 | Core → módulo | `start()`        |
| Running               | Módulo        | —                |
| Stop                  | Core → módulo | `stop()`         |
| Dispose               | Core → módulo | `dispose()`      |

Os módulos são iniciados na ordem determinada pela resolução de dependências e encerrados na ordem inversa.

### 6.10. Falhas no ciclo de vida

Quando uma etapa falha para um módulo, o Core:

1. Registra o erro com o id do módulo e a etapa que falhou.
2. Marca o módulo com o estado `FAILED`.
3. Chama `dispose()` se a etapa que falhou foi `register()`, `initialize()` ou `start()`.
4. Não inicia os módulos que dependem dele, marcando-os também como `FAILED`.
5. Continua o ciclo de vida dos demais módulos.

## 7. Comunicação entre Módulos

A comunicação entre módulos deverá ocorrer por mecanismos disponibilizados pelo Core.

São permitidas duas abordagens principais:

- Comunicação por eventos.
- Comunicação por interfaces de serviços e contratos explícitos.

Dependências diretas entre implementações internas deverão ser evitadas.

### 7.1. Event Bus

O Event Bus será responsável por distribuir eventos entre os componentes interessados.

Exemplos de eventos:

```text
discord.message.created
discord.member.joined
discord.member.left

moderation.violation.detected
moderation.action.executed

music.track.started
music.track.ended
music.queue.updated

social.wishlist.created
social.wishlist.updated
```

### 7.2. Estrutura de eventos

Os eventos deverão possuir uma estrutura padronizada.

Exemplo:

```json
{
  "id": "event-uuid",
  "type": "moderation.violation.detected",
  "version": 1,
  "source": "moderation",
  "timestamp": "2026-11-15T12:00:00Z",
  "context": {
    "userId": "discord-user-id",
    "channelId": "discord-channel-id"
  },
  "payload": {
    "violationType": "spam",
    "severity": "medium"
  }
}
```

| Campo       | Regra                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | UUID v4 único por evento.                                                                                                                        |
| `type`      | Nome do evento no formato `<origem>.<entidade>.<ação>`, com a ação no passado (`created`, `detected`, `executed`).                               |
| `version`   | Inteiro que identifica a versão do formato de `payload` daquele `type`. Começa em `1` e é incrementado a cada alteração incompatível do payload. |
| `source`    | Id do módulo ou da interface que publicou o evento (`moderation`, `discord`).                                                                    |
| `timestamp` | Data e hora em ISO 8601, em UTC.                                                                                                                 |
| `context`   | Ids do Discord relacionados ao evento (`userId`, `channelId`); cada campo só aparece quando se aplica.                                           |
| `payload`   | Dados específicos do evento, documentados no `README.md` do módulo que o publica.                                                                |

Um módulo só publica eventos cujo prefixo `<origem>` é o seu próprio id.

### 7.3. Regras de comunicação

- Eventos deverão possuir identificadores únicos.
- O nome dos eventos deverá seguir o formato definido na seção 7.2.
- Os produtores não deverão depender dos consumidores.
- Os consumidores deverão validar os dados recebidos.
- Falhas de processamento deverão ser registradas.
- Eventos críticos deverão possuir estratégias de recuperação adequadas.
- O processamento não deverá presumir entrega exatamente uma vez.

A semântica de entrega do Event Bus local está definida na [decisão 0007](decisions/0007-event-bus-delivery.md): consumidores assíncronos e isolados, entrega no máximo uma vez e profundidade máxima de encadeamento 8.

Caso futuramente exista comunicação distribuída, deverão ser consideradas estratégias de idempotência, retentativas e entrega pelo menos uma vez.

## 8. Configurações

Cada módulo deverá possuir configurações independentes.

As configurações deverão ser administráveis pelo painel central e disponibilizadas ao módulo por meio do contrato do Core.

Exemplo:

```json
{
  "enabled": true,
  "settings": {
    "spamDetection": true,
    "maxChannels": 2,
    "messageWindowSeconds": 30,
    "automaticActions": false
  }
}
```

### Requisitos

- Validação de configurações.
- Valores padrão documentados.
- Tipagem consistente.
- Suporte a alterações em tempo de execução quando seguro.
- Proteção de informações sensíveis.
- Versionamento e migração de configurações quando necessário.

Alterações de configuração não deverão exigir reinicialização completa da aplicação, quando puderem ser aplicadas com segurança.

## 9. Permissões

O Core será responsável pela autorização centralizada das operações.

Cada módulo deverá declarar suas permissões no manifesto e solicitar a validação correspondente antes de executar operações protegidas.

### 9.1. Convenção de nomenclatura

Formato:

```text
<module>.<resource>.<action>
```

Exemplos:

```text
moderation.rules.read
moderation.rules.manage
moderation.actions.ban

music.queue.read
music.queue.manage
music.playback.control

social.wishlist.read
social.wishlist.manage
```

### 9.2. Origem das permissões

Conforme a [decisão 0006](decisions/0006-permission-model.md):

| Permissões                 | Quem recebe                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `core.*` (operação do bot) | Somente usuários da lista de desenvolvedores do bot. Nunca associáveis a cargos do servidor.                       |
| Permissões de módulo       | Membros cujos cargos do servidor tenham a permissão associada. Ser desenvolvedor não concede permissões de módulo. |

O dono do servidor e membros com a permissão de Administrador do Discord não recebem nenhuma permissão automática.

### 9.3. Regras

- Permissões deverão possuir escopo definido.
- Um módulo só pode verificar as permissões que declarou no próprio manifesto.
- Operações originadas fora do servidor autorizado deverão ser rejeitadas antes da verificação de permissões.
- Operações administrativas deverão exigir permissões específicas.
- O módulo não poderá conceder permissões por conta própria.
- A ausência de uma permissão deverá resultar em negação de acesso.
- Interfaces visuais não substituirão verificações no backend.

## 10. Persistência de Dados

Os módulos poderão manter dados específicos de seus respectivos domínios.

Entretanto, o acesso à persistência deverá ocorrer por meio de abstrações e serviços definidos pela arquitetura.

### Requisitos

- Separação lógica por domínio.
- Validação de dados.
- Controle de concorrência.
- Tratamento de falhas.
- Migrações versionadas.
- Proteção contra acesso indevido.

Um módulo não deverá consultar diretamente tabelas ou estruturas internas pertencentes a outro módulo.

Quando existir necessidade de compartilhar informações, deverão ser utilizados contratos explícitos.

## 11. Isolamento e Tolerância a Falhas

A falha de um módulo não deverá provocar, automaticamente, a interrupção dos demais módulos.

O Core deverá possuir mecanismos para identificar e tratar falhas individuais.

### Requisitos

- Captura de exceções.
- Registro de erros por módulo.
- Controle de estado operacional.
- Proteção contra inicializações duplicadas.
- Encerramento seguro.
- Limitação de recursos.
- Prevenção contra loops de eventos.
- Estratégias de recuperação quando aplicáveis.

Módulos críticos deverão possuir políticas de degradação controlada.

**Importante:** o isolamento lógico de um Modular Monolith não equivale ao isolamento de processos. Um erro fatal, consumo excessivo de memória ou bloqueio do processo principal ainda poderá afetar toda a aplicação.

Por isso, operações potencialmente bloqueantes deverão ser controladas e tarefas pesadas deverão utilizar mecanismos adequados de execução assíncrona.

## 12. Integrações Externas

Módulos que dependam de serviços externos deverão utilizar adaptadores próprios.

Exemplos:

- APIs HTTP.
- Serviços de áudio.
- Integrações com plataformas externas.
- Serviços de armazenamento.
- Provedores de autenticação.

As integrações não deverão ser implementadas diretamente no Core, salvo quando forem responsabilidades compartilhadas da infraestrutura.

### Requisitos

- Timeouts.
- Tratamento de erros.
- Controle de requisições.
- Retentativas com limites.
- Proteção de credenciais.
- Validação de respostas externas.
- Observabilidade das integrações.

## 13. Observabilidade

Todo módulo deverá disponibilizar informações suficientes para acompanhamento de seu funcionamento.

### Requisitos

- Logs estruturados.
- Identificação do módulo de origem.
- Registro de falhas.
- Métricas operacionais.
- Rastreamento de operações relevantes.
- Identificação de estados do ciclo de vida.

Os logs deverão utilizar os mecanismos centralizados disponibilizados pelo Core.

Informações sensíveis não deverão ser registradas.

## 14. Testes

Todo módulo deverá possuir testes proporcionais à sua complexidade.

### 14.1. Testes unitários

Validam regras de negócio isoladamente.

### 14.2. Testes de integração

Validam comunicação com o Core, persistência, Event Bus e serviços externos.

### 14.3. Testes de contrato

Verificam se o módulo respeita as interfaces e especificações definidas pela arquitetura.

### 14.4. Testes de ciclo de vida

Verificam:

- Inicialização.
- Encerramento.
- Falhas durante a inicialização.
- Dependências ausentes.
- Configurações inválidas.
- Ativação e desativação.

Os critérios para um módulo ser integrado estão na seção 18.

## 15. Documentação dos Módulos

Cada módulo deverá possuir seu próprio `README.md`.

O documento deverá conter:

1. Descrição e finalidade.
2. Funcionalidades disponibilizadas.
3. Requisitos e dependências.
4. Configurações disponíveis.
5. Permissões necessárias.
6. Eventos emitidos e consumidos.
7. Comandos e interfaces disponibilizados.
8. Exemplos de utilização.
9. Limitações conhecidas.
10. Informações relevantes para manutenção.

## 16. Versionamento e Compatibilidade

Cada módulo deverá possuir versionamento independente utilizando Semantic Versioning.

Formato:

```text
MAJOR.MINOR.PATCH
```

O versionamento do módulo representa a compatibilidade de suas interfaces públicas: eventos que publica, permissões, comandos e chaves de configuração. Os incrementos `MAJOR`, `MINOR` e `PATCH` seguem as regras de [GIT.md §5](GIT.md#5-versionamento-semver).

A versão do módulo e a versão da API do Core são conceitos distintos:

- `version` é a versão do próprio módulo.
- `apiVersion` é a versão SemVer completa do contrato do Core que o módulo utiliza.

Exemplo:

```json
{
  "version": "2.1.0",
  "apiVersion": "1.0.0"
}
```

O Core só inicializa um módulo cujo `apiVersion` tenha o mesmo `MAJOR` da versão do contrato do Core e `MINOR.PATCH` menor ou igual ao do Core, conforme a [decisão 0009](decisions/0009-api-version-compatibility.md). Caso contrário, o módulo é rejeitado na etapa Manifest Validation.

Alterações incompatíveis nos contratos públicos deverão ser documentadas e acompanhadas de orientações de migração.

## 17. Diretrizes de Implementação

Todos os desenvolvedores deverão respeitar as seguintes diretrizes:

- Não acessar implementações internas de outros módulos.
- Não duplicar serviços disponibilizados pelo Core.
- Não criar dependências circulares.
- Não concentrar regras de negócio no Core.
- Não armazenar credenciais diretamente no código.
- Não ignorar as verificações de permissão.
- Não criar abstrações sem necessidade funcional.
- Não implementar funcionalidades fora do domínio do módulo.
- Não assumir que eventos serão processados exatamente uma vez.
- Não realizar operações bloqueantes sem justificativa e controle.

## 18. Critérios de Aceitação

Um módulo será considerado apto para integração quando atender aos seguintes critérios:

- [ ] Possui manifesto válido.
- [ ] Implementa o contrato oficial do Core.
- [ ] Respeita o ciclo de vida.
- [ ] Possui dependências declaradas.
- [ ] Possui permissões documentadas.
- [ ] Possui configurações validadas.
- [ ] Respeita os contratos de comunicação.
- [ ] Possui tratamento de falhas.
- [ ] Possui testes adequados.
- [ ] Possui documentação própria.
- [ ] Não compromete os demais módulos.
- [ ] Foi revisado conforme [`CONTRIBUTING.md`](../CONTRIBUTING.md).

---

**Sun Flower Development Team**

_Um módulo deve ser independente em suas responsabilidades, consistente em seus contratos e integrado em sua execução._
