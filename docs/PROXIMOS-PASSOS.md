# Planejador financeiro — próximos passos (mapa vivo)

Atualizado 2026-07-05 por Larry (time myPKA). Fonte de verdade da sequência.
Branch de trabalho: `master` (PR #25 auditoria e PR #26 import OFX já mergeados).

## Estado atual
PR #25 (auditoria + Fases 0/1 + visual) e PR #26 (parser OFX determinístico,
categoria Transferência excluída dos totais) mergeados no master. Etapa B +
rounds 2–7 concluídos (regras GREEN+testes, robustez da sessão, a11y/tipografia,
normalização de titulares, offline durável, auto-update do SW, navegação
voltar/avançar, layout do card, backlog de polimento). Todos com gate
Vera PASS / Vex GREEN. Validado pelo Guilherme em aparelho real a cada round.

## NOVO workstream — Módulo Finanças no cockpit (aprovado pelo Guilherme, 05/07)
Cockpit = palco da reunião mensal do casal. Decisões: relatórios mensal (pauta
de reunião), semestral e anual; chat via hand-off pro terminal; sync por botão
via Admin SDK; fechamentos arquivados como notas no vault (loop de correção de
rota). Design completo na conversa de 05/07; convenções em
`tools/mypka/README.md`.
- **Fase 1 (fundação) — FEITA (05/07):** `tools/mypka/sync_cockpit.py` com dois
  modos: `--backup <json>` (sem credenciais) e Firestore/Admin SDK (`--uid`).
  Espelho real gerado do backup de 04/07 (3.524 transações).
- **Fase 2 (view) — FEITA (05/07):** módulo "Finanças" no cockpit
  (`server/financeApi.js` + `web/src/views/FinanceView.tsx`, slug `financas`).
  Reiniciar o cockpit para carregar. Dados: exportar backup FRESCO do app
  (o de 04/07 é anterior à categoria Transferência do PR #26 — totais inflam
  com pagamento de fatura) e rodar o sync de novo.
- **Fase 3 (loop de rota) — FEITA (05/07):** "Fechar o mês" gera ata em
  `PKM/Fleeting Notes` (slug `fechamento-financeiro-YYYY-MM`); seção "Rota
  combinada" cobra as decisões da ata anterior contra os números (tags
  `fin:{categoryId,teto}`); card "Pulso Financeiro" no Hub (toggle em Settings).
  Também: botão Sincronizar (backup mais novo de ~/Downloads), MonthBar, fixes
  de KPI/poupança/tooltip.
- **Fase 4 (zoom) — FEITA (05/07):** abas Mensal|Semestral|Anual na view
  (endpoints /finance/semester/:sem e /finance/year/:year); semestral =
  comparações, poupança/mês, fixas×variáveis, heatmap com tendência, top
  movers; anual = YoY, sazonalidade, assinaturas, custo fixo, maiores gastos,
  placar das decisões; botão "Discutir com a IA" (hand-off launch-terminal).
  **Módulo completo.** Pendente do Guilherme: backup fresco + testar o ciclo.

## NOVO workstream — Qualidade da importação (levantado pelo Guilherme, 03/07)
**Contexto:** a leitura de faturas (PDF/Excel) via IA nunca foi testada nesta
reforma (chave Anthropic estava fora; nenhuma fatura submetida). Historicamente
é a MAIOR dificuldade do app — cada banco/planilha tem seu formato. Modelos de
IA evoluíram desde o último teste; precisa ser re-exercitado.

**Pré-requisito:** a chave Anthropic precisa estar configurada em Configurações
do app (o app envia a chave do localStorage no corpo; o env do Cloudflare foi
removido de propósito). Como a rotação da chave ainda está pendente:
→ rotacionar a chave → colar a nova em Configurações → então importar.

**Plano (já esboçado no parecer, seção 6 Etapa E):**
1. DIAGNÓSTICO (Guilherme): importar 2–3 faturas reais de bancos/formatos
   diferentes (PDF e Excel) e anotar os erros que aparecem (linhas perdidas,
   valores errados, estorno/pagamento virando receita, datas, parcelas).
2. VALIDAÇÃO DE TOTAL NO PREVIEW (era o item nº 1 da Fase 2): mostrar no
   preview de importação o total lido pela IA vs. o total declarado da fatura —
   pega truncamento, linha perdida e duplicata de uma vez. Maior redutor de
   desconfiança por hora investida.
3. MELHORAR O PARSER (`functions/api/parse-statement.ts`): revisar o prompt e a
   robustez por formato à luz dos erros reais; consultar a skill claude-api
   (modelo/prompt). Achado da Pax a tratar: linha "PAGAMENTO RECEBIDO/EFETUADO"
   da fatura anterior não é excluída e pode virar receita fantasma.
4. KIT DE TESTE DA PAX (13 casos): validar localmente, nada commitado, faturas
   reais ficam locais.

## Sequência acordada
1. **Guilherme:** testar importação (importar → ver erros → me trazer a lista).
2. **Time:** limpeza única do backlog acumulado (Lows/Mediums — ver abaixo).
3. ~~Merge do PR #25.~~ ✅ Feito (e PR #26 OFX também).
4. **Etapa C (produção):** instalar JDK 11+ (`winget install EclipseAdoptium.Temurin.21.JDK`)
   → rodar os 35 testes das regras no emulador → backup → deploy das regras
   GREEN (fora de sessão ativa da esposa) → smoke test → sign-up já OFF →
   **rotação da chave Anthropic** (também destrava o teste de importação).
5. **Fase 2 (qualidade de dados/importação):** validação de total (item 2 acima),
   unificação de metas (§3.3), redesenho do dedupe, campo `kind` conservador,
   correção dos dados legados do MigrationMDW (Guilherme optou por não apagar).
6. **Fase 3/4 + D2a:** telas/gráficos consumindo o tema, remoção de código morto
   confirmado (FamilyView), Consultor de Fechamento como skill+runner.

## Backlog de polimento — LIMPO no round 7 (`875f5de`, Vera PASS)
Feitos: guard de save na nav (corrida do double-tap), aria-label (observação +
4 selects de import), truncate "· revisando" <360px, realce da sugestão,
undo resiliente + aria-live, window.confirm→ConfirmDialog (3 pontos), âmbar→
status-warn no ImportModal.

## Backlog remanescente (LOW, para uma passada futura — não bloqueia merge)
- [LOW] `ConfirmDialog` não restaura o foco ao elemento que o abriu (Felix, rápido).
- [MEDIUM latente] `BatchEditModal` sem focus-trap/Esc próprios quando aberto sozinho.
- [LOW] selects do bloco "aplicar em lote" do ImportModal sem `aria-label`.
- [LOW design] drift de `yellow-*` (regra) e `purple-*` (IA) fora do token system.
- [LOW] âmbar ainda em `TransactionsPage`/`CategorizationHistoryModal` (não tocados) → unificar em status-warn.
- [LOW] `familyMemberId` FK no tipo Transaction (blindagem definitiva — Silas, Fase 2).
