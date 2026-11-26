# 🌻 Sun Flower — Architecture

## 1. Visão Geral

O **Sun Flower** é um chatbot modular, extensível e de propósito utilitário, desenvolvido para atuar em um **único servidor Discord**, oferecendo funcionalidades independentes que podem ser habilitadas, configuradas e administradas conforme as necessidades dessa comunidade.

### 1.1. Servidor de Atuação

O Sun Flower é um bot **dedicado** e atuará exclusivamente em um único servidor Discord. O ID desse servidor é informação não pública: ele existe apenas na variável de ambiente `DISCORD_GUILD_ID` do ambiente de execução e nunca é escrito no repositório ([CONTRIBUTING.md §7.1](../CONTRIBUTING.md#71-informações-não-públicas)).

Ele não foi projetado para operar em múltiplos servidores. Consequentemente:

- O ID do servidor é lido da variável de ambiente `DISCORD_GUILD_ID` e nunca escrito diretamente no código.
- Se `DISCORD_GUILD_ID` estiver ausente, a aplicação não inicia.
- Eventos, comandos e interações originados de qualquer outro servidor deverão ser ignorados.
- O bot não sai de outros servidores; ele apenas não responde a nada vindo deles ([decisão 0010](decisions/0010-stay-in-other-guilds.md)).
- Os comandos deverão ser registrados no escopo do servidor (_guild commands_), e não globalmente.
- A arquitetura não deverá implementar isolamento multi-servidor (_multi-tenancy_): configurações, regras e dados pertencem a esse único servidor.

Sua arquitetura deve permitir que o sistema evolua continuamente, incorporando novos módulos e integrações sem comprometer os componentes existentes.

Embora seu ambiente inicial seja o Discord, o Sun Flower não deve ser limitado a essa plataforma. Sua estrutura deverá permitir futuras integrações com outros softwares, aplicações, jogos e serviços externos por meio de APIs e adaptadores independentes.

O projeto tem como princípio central a construção de um ecossistema de funcionalidades autônomas, centralizadas em uma única plataforma de gerenciamento.

### 1.2. Decisões Fundamentais

| Decisão                                                                                         | Registro                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Arquitetura **Modular Monolith**: um único processo, módulos com domínios e contratos isolados. | [0001](decisions/0001-modular-monolith.md) |
| Stack **TypeScript + Node.js**, com `discord.js` para a integração com o Discord.               | [0002](decisions/0002-typescript-node.md)  |
| Atuação em **um único servidor Discord**.                                                       | [0003](decisions/0003-single-guild.md)     |

Decisões ainda não tomadas estão listadas, com a fase em que serão resolvidas, no [ROADMAP](ROADMAP.md).

## 2. Objetivos Arquiteturais

A arquitetura do Sun Flower deverá atender aos seguintes objetivos:

- **Modularidade:** cada funcionalidade deve possuir responsabilidades bem definidas, permitindo desenvolvimento, manutenção e evolução independentes.
- **Autonomia:** módulos devem operar sem dependências desnecessárias de outros módulos.
- **Extensibilidade:** novos recursos devem poder ser adicionados sem exigir alterações estruturais em todo o sistema.
- **Configurabilidade:** funcionalidades, regras e comportamentos devem ser personalizáveis por meio de configurações administrativas.
- **Segurança:** mecanismos de proteção devem atuar continuamente, respeitando permissões, políticas e limites configurados.
- **Escalabilidade:** a arquitetura deve suportar o crescimento de membros, atividade e funcionalidades do servidor.
- **Integração:** componentes externos devem conseguir interagir com o Sun Flower por interfaces bem definidas.
- **Manutenibilidade:** o código deve seguir padrões consistentes, facilitando a colaboração entre desenvolvedores humanos e agentes de IA.

## 3. Estrutura Funcional

O Sun Flower será organizado em módulos independentes, agrupados conforme suas responsabilidades.

Cada domínio funcional corresponde a um componente com identificador fixo:

| Domínio                                               | Componente       | Tipo      |
| ----------------------------------------------------- | ---------------- | --------- |
| Moderação e Segurança (3.1)                           | `moderation`     | Módulo    |
| Funcionalidades Sociais (3.2)                         | `social`         | Módulo    |
| Sistema Musical (3.3)                                 | `music`          | Módulo    |
| Painel Administrativo (3.4)                           | `dashboard`      | Interface |
| Operações administrativas (equipe, cargos, histórico) | `administration` | Módulo    |

O **painel** é uma interface, assim como o Discord: ele não contém regras de negócio e opera os módulos pela API do Core. As operações administrativas que ele exibe (gestão de equipe, cargos e histórico) pertencem ao módulo `administration`. A ativação de módulos, as configurações e os logs são serviços do Core.

Cada módulo deverá possuir seu próprio domínio funcional, configurações, permissões e mecanismos de execução, respeitando os contratos definidos pela arquitetura central.

### 3.1. Moderação e Segurança

Responsável pela proteção ativa do servidor Discord, identificando comportamentos suspeitos e executando ações preventivas ou corretivas.

O sistema deverá utilizar mecanismos autônomos de análise comportamental, considerando diferentes variáveis antes de tomar decisões.

**Funcionalidades previstas:**

- Detecção de spam em múltiplos canais.
- Identificação de mensagens suspeitas e possíveis tentativas de phishing.
- Monitoramento de padrões de comportamento.
- Controle de frequência de mensagens.
- Identificação de usuários que tentam contornar mecanismos de proteção.
- Aplicação automatizada de advertências, silenciamentos, expulsões e banimentos.
- Registro de ocorrências e histórico de ações de moderação.

**Exemplo de comportamento:**

Um usuário envia mensagens em dois canais diferentes. Inicialmente, esse comportamento pode ser considerado normal.

Entretanto, caso ultrapasse determinada quantidade de canais, frequência ou apresente conteúdo semelhante a padrões conhecidos de spam, o sistema deverá elevar o nível de suspeita.

A partir das condições configuradas, poderá aplicar medidas preventivas ou encaminhar a ocorrência para análise da equipe de moderação.

As regras deverão ser configuráveis, permitindo que a administração do servidor estabeleça seus próprios limites e políticas.

**Requisitos importantes:**

- Regras de moderação configuráveis pela administração.
- Diferenciação entre comportamentos suspeitos e violações confirmadas.
- Prevenção contra falsos positivos.
- Registro de decisões automatizadas.
- Possibilidade de revisão e reversão de ações administrativas.
- Hierarquia de permissões para execução de medidas restritivas.

### 3.2. Funcionalidades Sociais

Responsável por oferecer ferramentas de interação e conveniência para os membros da comunidade.

**Funcionalidades previstas:**

- Lista de desejos (_Wishlist_).
- Compartilhamento de interesses entre amigos.
- Controle de visibilidade das informações.
- Configuração de listas públicas, privadas ou restritas.
- Gerenciamento de amizades e permissões de visualização.

**Exemplo de funcionamento:**

Um usuário poderá criar sua própria lista de desejos e definir quem poderá visualizá-la.

As opções de privacidade poderão incluir:

- Pública: qualquer membro autorizado poderá visualizar.
- Privada: somente o próprio usuário poderá visualizar.
- Restrita: somente usuários ou grupos selecionados poderão visualizar.

A arquitetura deverá permitir a inclusão de novas funcionalidades sociais sem acoplar suas regras aos demais módulos.

### 3.3. Sistema Musical

Responsável pela reprodução e gerenciamento de músicas em canais de voz do Discord.

O sistema deverá oferecer uma experiência colaborativa, permitindo que os participantes interajam com a reprodução por diferentes interfaces.

**Funcionalidades previstas:**

- Reprodução e gerenciamento de músicas.
- Fila de reprodução compartilhada.
- Adicionar, remover e reorganizar músicas.
- Pausar, retomar, avançar e interromper reprodução.
- Controle de volume.
- Gerenciamento de sessões musicais.
- Controle de permissões para utilização dos comandos.
- Painel visual de gerenciamento.

**Interfaces de interação:**

- Comandos diretamente no Discord.
- Painel web integrado ao sistema.

Ambas as interfaces deverão utilizar a mesma camada de gerenciamento musical, evitando duplicação de regras e comportamentos.

A implementação deverá respeitar as políticas e condições de uso das fontes de áudio integradas. A escolha das fontes de áudio e do mecanismo de reprodução é uma decisão pendente da Fase 5 do [ROADMAP](ROADMAP.md).

### 3.4. Painel Administrativo

Responsável pela centralização do gerenciamento do Sun Flower, oferecendo uma interface visual para administração das funcionalidades e configurações.

O painel deverá funcionar como uma camada de gerenciamento independente da interface do Discord.

**Funcionalidades previstas:**

- Gerenciamento de usuários.
- Visão geral do servidor (canais, cargos e estado de conexão do bot).
- Administração de membros da equipe (_Staff_).
- Controle de cargos e permissões.
- Gerenciamento de comandos.
- Ativação e desativação de módulos.
- Configuração individual de funcionalidades.
- Gerenciamento de regras de moderação.
- Consulta de logs e histórico de atividades.
- Monitoramento da saúde dos módulos.
- Visualização de métricas e indicadores operacionais.

O painel deverá consumir as interfaces disponibilizadas pela aplicação central, sem acessar diretamente as implementações internas dos módulos.

O painel é a interface `dashboard`: um servidor Fastify e um aplicativo React, no mesmo processo do bot, atrás de um proxy HTTPS e com atualização em tempo real por WebSocket. Veja as decisões [0017](decisions/0017-access-levels.md), [0018](decisions/0018-panel-authentication.md), [0019](decisions/0019-panel-stack.md), [0020](decisions/0020-panel-realtime.md) e [0021](decisions/0021-panel-hosting.md), os limites de sessões e conexões ([0024](decisions/0024-panel-session-limits.md)) e a [spec da Fase 3](specs/2026-11-24-fase-3-painel.md).

**Operações.** O painel não chama os módulos: ele executa operações nomeadas pelo Core, as mesmas que o Discord usa (contrato completo em [MODULES.md §5.3](MODULES.md#53-operações) e [decisão 0022](decisions/0022-module-operations.md)).

- Cada módulo registra as suas no `register()`, com `ctx.operations.register`. O módulo executa as próprias com `ctx.operations.execute`; as interfaces usam `CoreHandle.operations.execute(name, actor, input, source)`.
- O Core checa, nesta ordem: operação inexistente (`not_found`), módulo inativo (`unavailable`), permissão (`forbidden`) e entrada (`invalid`). Só então roda o handler.
- Cada chamada registra `{ module, operation, source, result }`, sem entrada, IDs nem texto.
- A rota `POST /api/operations/:name` exige sessão e CSRF e valida o nome (`^[a-z][a-z0-9.-]{2,100}$`; fora disso, 404). O corpo precisa ser um objeto JSON (sem corpo vale `{}`). O ator vem sempre da sessão, nunca do corpo, e a `source` enviada ao Core é `dashboard`. Responde `200 { data }` ou `{ error: { code, message } }` com 403, 404, 409, 422, 500 ou 503.
- O canal ao vivo envia `case.created` e `case.updated` (`{ caseId }`) só a quem tem `moderation.cases.read`, e a permissão é checada a cada envio.

**Administração.** O serviço `admin` do Core cobre desenvolvedores, permissões de cargos, ligar e desligar módulos, logs recentes e sessões do painel. Ele é liberado pela capacidade `core.admin`, que só o módulo `administration` possui (contrato em [MODULES.md](MODULES.md) e [decisão 0023](decisions/0023-administration-module.md)); o painel o usa pelas operações `administration.*`, como qualquer outra.

- Ligar e desligar acontece com o bot em execução, e os comandos são ressincronizados no Discord. O Core recusa desligar um módulo com `core.admin` ou do qual outro módulo ativo depende, e recusa ligar um módulo com uma dependência desligada.
- Os logs recentes ficam só em memória (500 entradas), com IDs mascarados, e se perdem ao reiniciar.
- Encerrar uma sessão fecha a conexão ao vivo dela na hora.

## 4. Princípios de Modularização

A modularização é um dos fundamentos mais importantes do Sun Flower.

Cada módulo deverá funcionar como uma unidade funcional independente, possuindo responsabilidades específicas e evitando dependências diretas desnecessárias.

### 4.1. Isolamento de Responsabilidades

Um módulo não deverá assumir responsabilidades pertencentes a outro.

Por exemplo:

- O módulo de moderação será responsável pelas regras de segurança.
- O módulo musical será responsável pelas sessões de reprodução.
- O módulo social será responsável pelas interações entre usuários.
- O painel administrativo será responsável pela interface de gerenciamento.

A comunicação entre esses componentes deverá ocorrer por interfaces e contratos bem definidos.

### 4.2. Ciclo de Vida dos Módulos

Todo módulo segue o mesmo ciclo de vida, controlado pelo Core: ele é descoberto, validado, tem suas dependências resolvidas, é registrado, inicializado, iniciado e, ao final, interrompido e descartado.

A definição oficial das etapas, com seus nomes e responsabilidades, está **somente** em [MODULES.md §6](MODULES.md#6-ciclo-de-vida).

A arquitetura deverá permitir habilitar e desabilitar módulos sem comprometer a execução dos demais componentes.

### 4.3. Contratos e Interfaces

Os módulos deverão implementar contratos padronizados para integração com o núcleo da aplicação.

Esses contratos deverão definir, quando aplicável:

- Identificação e metadados do módulo.
- Versão e compatibilidade.
- Dependências declaradas.
- Configurações disponíveis.
- Permissões necessárias.
- Eventos emitidos e consumidos.
- Comandos e operações disponibilizados.
- Inicialização e encerramento.

## 5. Arquitetura de Integração

O Sun Flower deverá possuir uma camada central responsável por intermediar a comunicação entre o Discord, o painel administrativo, os módulos internos e futuras integrações externas.

Essa camada deverá evitar que os módulos dependam diretamente de uma plataforma específica.

**Integrações previstas:**

- Discord Gateway e Discord REST API.
- Painel administrativo via API.
- Serviços externos via HTTP.
- Integrações futuras com jogos e aplicações.
- Adaptadores específicos para novas plataformas.

A comunicação deverá seguir contratos consistentes, permitindo que novas interfaces sejam adicionadas sem modificar as regras de negócio existentes.

## 6. Segurança e Controle de Acesso

A segurança deverá ser tratada como uma responsabilidade transversal da arquitetura.

Todos os módulos deverão respeitar um modelo centralizado de identidade, autenticação e autorização, com possibilidade de aplicação de políticas específicas por funcionalidade.

**Requisitos:**

- Controle de acesso baseado em permissões (RBAC), com permissões nomeadas conforme [MODULES.md §9](MODULES.md#9-permissões), em duas camadas independentes ([decisão 0006](decisions/0006-permission-model.md)): a **lista de desenvolvedores do bot**, que opera o próprio Sun Flower, e os **cargos do servidor**, que concedem as permissões dos módulos à equipe da comunidade. Os desenvolvedores recebem todas as permissões, e o dono do servidor recebe as permissões de todos os módulos, mas nunca as do Core ([decisão 0017](decisions/0017-access-levels.md)). Ser administrador do servidor não concede nenhuma permissão, e ser dono não concede controle sobre o bot.
- Restrição de atuação ao servidor autorizado, rejeitando eventos e comandos de qualquer outro servidor.
- Proteção de credenciais e tokens.
- Validação das operações administrativas.
- Registro de atividades sensíveis.
- Controle de acesso às APIs.
- Proteção contra execução indevida de comandos.
- Limitação de requisições (_Rate Limiting_).

Nenhum módulo deverá assumir que um usuário possui autorização apenas por conseguir acessar uma determinada interface.

As permissões deverão ser verificadas na camada responsável pela execução da operação.

## 7. Persistência e Gerenciamento de Dados

A persistência deverá ser organizada conforme os domínios funcionais do sistema.

Os módulos poderão possuir estruturas de dados próprias, respeitando os padrões de acesso e persistência definidos pelo projeto.

**Diretrizes:**

- Separação lógica dos dados por domínio.
- Identificação dos usuários aos quais os registros pertencem.
- Integridade e consistência das informações.
- Controle de acesso aos dados.
- Estratégias de retenção e limpeza de registros.
- Suporte a futuras estratégias de cache.
- Migrações de banco de dados versionadas.

O banco de dados é SQLite, acessado pelo módulo embutido `node:sqlite` ([decisão 0005](decisions/0005-runtime-and-persistence.md)).

A arquitetura não deverá obrigar todos os módulos a utilizarem a mesma estratégia de persistência quando suas necessidades forem diferentes.

## 8. Observabilidade e Monitoramento

O sistema deverá disponibilizar mecanismos que permitam acompanhar seu funcionamento e identificar problemas operacionais.

**Requisitos:**

- Logs estruturados.
- Identificação de erros por módulo.
- Monitoramento de disponibilidade.
- Métricas de utilização.
- Rastreamento de operações relevantes.
- Histórico de eventos administrativos.
- Indicadores de desempenho.

A observabilidade deverá permitir identificar falhas isoladas sem comprometer a análise do restante da aplicação.

## 9. Diretrizes de Evolução

O desenvolvimento do Sun Flower deverá seguir uma abordagem incremental.

A inclusão de novas funcionalidades não deverá justificar, por si só, alterações profundas na arquitetura existente.

Novos módulos deverão respeitar os contratos e padrões estabelecidos, preservando a compatibilidade com os componentes já implementados.

Alterações estruturais deverão ser documentadas, especialmente quando envolverem:

- Mudanças nos contratos entre módulos.
- Alterações no modelo de permissões.
- Modificações na persistência.
- Novas integrações externas.
- Mudanças incompatíveis entre versões.

## 10. Considerações Finais

O Sun Flower não deverá ser tratado simplesmente como um bot com diversos comandos, mas como uma plataforma modular de serviços e funcionalidades integradas.

Sua arquitetura deverá priorizar independência entre componentes, segurança, facilidade de manutenção e capacidade de expansão.

O objetivo é construir uma base sólida que permita ao projeto crescer organicamente, incorporando novas funcionalidades e integrações sem transformar sua manutenção em um processo excessivamente complexo.

**Princípio fundamental:**

> Cada módulo deve resolver seu próprio domínio, enquanto a arquitetura central garante que todos trabalhem de maneira consistente, segura e integrada.
