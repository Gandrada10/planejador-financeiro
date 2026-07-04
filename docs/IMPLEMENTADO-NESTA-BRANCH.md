# O que já está implementado nesta branch (para auditar como código)

**Branch:** `claude/financial-planner-audit-fnd1tv` · **Data:** 02/07/2026 · **Natureza:** implementação-teste, **sem merge no master**.

Esta branch deixou de ser só documentação: contém agora uma **implementação de teste** das partes seguras do roadmap, para o time auditar **código rodando** (no preview do Cloudflare Pages) em vez de só um plano. O `master` continua intocado.

> ⚠️ **Banco compartilhado:** o preview aponta para o **mesmo Firestore de produção** (dados reais), a menos que exista um projeto de staging. Por isso só foram implementadas mudanças seguras contra o banco real (interface, correções de comportamento, sugestões aditivas). **Mudanças de modelo de dados (Fase 2) NÃO foram feitas** — ver "Deixado de fora".

## Implementado

### 1. Fundação visual (`1eb7d4f`)
- `src/index.css`: sistema de tokens 2.0 (menta como única cor de ação, sans do sistema no lugar da mono que nunca carregava, superfícies em camadas, escala tipográfica, raios, `.tnum`, `:focus-visible`, `prefers-reduced-motion`). **Nomes de token da v1 preservados** → nenhuma classe existente quebrou; o app inteiro mudou de aparência num commit reversível.
- `src/lib/chartTheme.ts`: paleta categórica de 6 slots em ordem fixa **validada por script** (daltonismo + contraste na superfície real), semântica receita/despesa/resultado, `buildColorMap` para cor por entidade, eixos/grade recessivos.

### 2. Fase 1 — fluxo da esposa (`dc4ca54`, `f… reset por key`)
- **FIX do bug crítico** (`src/hooks/useCategorizationSession.ts`): a sessão só vira `applied` quando **todas** as transações estão categorizadas; enquanto há pendentes, reaplica só o **delta** (marcado `applied:true` na subcoleção). O trabalho feito aos poucos nunca mais é descartado.
- **Sugestão de 1 toque, sem IA**: na criação da sessão, cada transação recebe `suggestedCategoryId` + `suggestionReason`, calculados por **regras do dono + histórico** das escolhas dela (fonte = base completa; escopo compartilhado = filtro atual). Validado pelo sinal do valor.
- **Nova tela** (`CategorizationCard.tsx`, `CategorizationPage.tsx`): sugestão em destaque, grade de categorias frequentes na zona do polegar, busca em bottom-sheet, **desfazer**, barra de progresso, tela de celebração, skeleton no load, vibração no toque (Android). Corrige **receita exibida como gasto** (verde vs. coral).
- Contagem por toque agora vem do estado local (antes: releitura O(n) da subcoleção por toque).

### 3. PWA (`a6de256`)
- Ícones PNG reais 180/192/512 (gerados por script, sem dependência), `apple-touch-icon`, service worker (network-first p/ navegação, cache-first p/ assets, cross-origin nunca cacheado), registro em `main.tsx`, `theme-color`/manifesto em `#0d0d0f`. Resolve "Adicionar à Tela de Início" sem ícone no iPhone.

### 4. Fase 0 segura (`f5cf2f5`)
- **Chunking de 400** em `importBatch`/`batchUpdate`/`batchUpdateReconciled` (`useTransactions.ts`).
- **Cadastro fechado por padrão** atrás de `VITE_ALLOW_REGISTRATION` (`LoginForm.tsx`).
- **`firestore.rules` versionadas** + `firebase.json` + `docs/SEGURANCA-FASE-0.md` (checklist de deploy).

## Deixado de fora (de propósito — para o time decidir/executar)
- **Fase 2 (modelo de dados):** campo `kind` (transferência/pagamento/estorno), dedupe idempotente na escrita, unificação das fórmulas de meta. **Motivo:** mexem no shape dos dados e são perigosas contra o banco de produção compartilhado — exigem a decisão do staging antes.
- **Autenticar as Cloudflare Functions + mover a chave Anthropic para secret.** Meio-caminho quebraria importação/chat no preview; é acoplado a infra. Ver `docs/SEGURANCA-FASE-0.md` §3.
- **Aprendizado automático de regras** (criar `CategoryRule` a partir das escolhas repetidas dela): escreve regras — deixado para o time calibrar (risco de regra ruim). A sugestão por histórico já entrega o efeito "aprende" sem escrever nada.
- **Fase 3/4** inteiras (painel que direciona, remoção de Pluggy/MigrationMDW, etc.).

## Como verificar
- `npm install && npm run build` → compila limpo (warnings de tamanho de bundle são pré-existentes).
- `npx tsc -b --noEmit` → sem erros.
- Preview do Cloudflare Pages da branch → testar no celular: gerar link (dono), categorizar (esposa), abrir o app do dono e ver as categorias aplicadas mesmo com sessão parcial.
- **Antes de testar contra dados reais, faça um backup** (Configurações → Backup) — ver ressalva do banco compartilhado acima.
