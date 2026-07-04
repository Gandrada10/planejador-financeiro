# Respostas do Guilherme às perguntas do parecer (seção 7) — 2026-07-03

Adendo oficial à `REVISAO-RESULTADOS.md`. Consolidação por Larry; análise de segurança por Vex (parecer da sessão de 03/07).

## Verificações de console (completas)

| # | Pergunta | Resposta | Consequência |
| --- | --- | --- | --- |
| 1 | Rules de produção | Coladas verbatim → `rules-producao-2026-07-03.txt` | §2.1 = **HIGH** (base `/users` protegida; carve-out das sessões com 3 buracos HIGH: `list` anônimo de tokens, leitura anônima das subcoleções, forja de sessão por conta auto-criada; `update: if true` deixa `applied`/`categorizedCount`/`expiresAt` mutáveis por qualquer um) |
| 2 | `ANTHROPIC_API_KEY` no Cloudflare | **Existe** | §2.2 = **HIGH confirmado** — endpoints sem auth + secret no env = qualquer um na internet gasta os créditos Anthropic dele |
| 3 | Sign-up no Firebase Auth | **Habilitado**; provedor ativo = Google | §2.4 = **HIGH confirmado** — a cadeia de forja de sessão está aberta à internet inteira; sign-up OFF project-wide é a mitigação imediata e grátis |
| 8 | Backups exportados circulando | **Pode haver** | Rotacionar a chave Anthropic (backups carregam a chave + credenciais Pluggy em texto plano) |

## Hábito real (define escopo da Fase 2)

| # | Pergunta | Resposta | Consequência |
| --- | --- | --- | --- |
| 4 | Extrato ou só fatura? Receitas? | Faturas **e** extrato de conta corrente (PDF + Excel), com lançamentos manuais ocasionais | Dupla contagem de pagamento de fatura EXISTE no hábito dele → Fase 2 em escopo cheio (`kind` + pareamento conservador) |
| 5 | MigrationMDW / Pluggy / Projetos | MDW **não rodou inteira** (estrato parcial possível); Pluggy **abandonado**; Projetos **será usada** (sistema estava em teste, sem uso real ainda) | Pluggy = superfície morta a remover (código + `pluggy-proxy.ts` + env); Projetos sai da lista de remoção; dados de teste → avaliar zerar em vez de corrigir (pendência abaixo) |
| 6 | Metas pai+sub simultâneas? | Sem clareza ainda | Time propõe modelo simples na Fase 2 (meta no pai OU na sub); Guilherme valida |
| 7 | Re-importação / formatos | Pode reimportar por engano; faturas com períodos sobrepostos entre si | Dedupe é necessidade real; substituição por fatura sozinha não cobre sobreposição → insumo pro redesenho da Pax |

## Decisões de produto

| # | Pergunta | Resposta |
| --- | --- | --- |
| 9 | Fonte mono→sans | **Delegado ao time** ("a melhor para a interface de acordo com as melhores práticas") → DECISÃO: sans do sistema com `tabular-nums` (`.tnum`) obrigatório em TODAS as colunas numéricas no mesmo commit (recomendação Felix+Vera do parecer) |
| 10 | Faturas/mês, minutos de upload | Pendente (só afeta D2b, adormecido) |
| 11 | Staging Firebase (D3) | Pendente (bloqueia apenas Fases 3+) |
| 12 | Consultor de Fechamento | Pendente (recomendação em pé: skill+runner primeiro) |
| 13 | Fechamento por clique vs cron | Pendente |

## P4-bis (zerar vs corrigir dados) — RESPONDIDA 2026-07-03

**Decisão do Guilherme: NÃO apagar os dados.** Consequência: a correção dos dados legados do MigrationMDW (item 7 do REPRIORIZA) PERMANECE no plano (Etapa E) — corrigir o estrato parcial migrado (titular = string do cartão, cardNumber null, date = vencimento) antes de qualquer painel novo.

## Ações imediatas (Guilherme, console — ordem do Vex)

1. ✅ **FEITO (03/07)** — Sign-up OFF project-wide (Authentication → Settings → User actions).
2. ✅ **FEITO (03/07)** — Cloudflare: `ANTHROPIC_API_KEY` (e `PLUGGY_*` se havia) removidas do env. §2.2 mitigado: endpoints sem secret para abusar; agora só repassam a chave que o cliente envia.
3. ⏳ **PENDENTE** — Rotacionar a chave Anthropic (console.anthropic.com) — backups em texto plano podem circular. Criar nova → colar no Settings do app → revogar a antiga.
4. Deploy das rules GREEN vem na Etapa B (emulador primeiro; fora de sessão ativa da esposa).
