# 0015 — Detecção de phishing e ações automáticas iniciais

**Status:** Aceita
**Data:** 2026-11-17

## Contexto

O ROADMAP deixou duas decisões pendentes para a Fase 2: a fonte de detecção de phishing e se as ações automáticas começam ativas. A ameaça principal do servidor são contas que publicam links de golpe (falsos "Nitro grátis", Steam, cripto) em vários canais.

## Decisão

- **Fonte de detecção:** lista local de domínios bloqueados e permitidos, mantida pela equipe, mais heurísticas locais (imitação de marcas protegidas, link mascarado, mesmo link em vários canais, termos de isca, menção em massa, conta ou entrada recente). Não há dependência de serviço ou lista externa.
- **Pontuação:** cada sinal soma pontos. O total define o nível: violação confirmada, suspeito ou nada. Os pesos e os limites são configuráveis.
- **Ações automáticas ativas na configuração inicial:** em violação confirmada, o bot apaga a mensagem, aplica timeout (padrão de 1 hora) e alerta a equipe. Em nível suspeito, apenas alerta.
- Toda ação automática gera um caso, que a equipe pode revisar e reverter.

Esta decisão substitui a recomendação do ROADMAP de começar com ações automáticas desativadas.

## Consequências

- Um link de golpe é removido em segundos, sem esperar pela equipe.
- Um falso positivo custa um timeout curto, revertido por comando. A reversão pode adicionar o domínio à lista de permitidos.
- Domínios de golpe novos, que não imitam marcas nem aparecem na lista, podem passar sem detecção. A lista local e a regra de vários canais cobrem parte desse risco.
