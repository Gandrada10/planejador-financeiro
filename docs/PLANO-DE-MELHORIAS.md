# Plano de melhorias — proposta para revisão

**Data:** 02/07/2026 · **Status:** Fases 0 (parte segura) e 1 + fundação visual **implementadas como teste** nesta branch (ver `IMPLEMENTADO-NESTA-BRANCH.md`); Fases 2–4 pendentes · **Branch:** `claude/financial-planner-audit-fnd1tv` (sem merge) · **Execução das fases restantes:** time de agentes do MyPKA, após a revisão (`REVISAO-DO-TIME.md`)

Este documento consolida as mudanças propostas a partir da auditoria (`AUDITORIA-2026-07.md`) e das decisões tomadas na conversa de planejamento. É a base para a revisão do time de agentes do MyPKA **antes** de qualquer implementação. Leia junto com:

- `AUDITORIA-2026-07.md` — os achados (o que está errado hoje, com `arquivo:linha`).
- `prototipos/categorizacao-mobile.html` — protótipo navegável da nova tela da esposa (abra no navegador; é uma demo isolada com dados fictícios, não é código de produção).
- `REVISAO-DO-TIME.md` — o briefing de auditoria (o que pedir aos agentes que pressionem).

> **Nenhuma linha de código de produção foi alterada.** Os únicos arquivos novos estão em `docs/`. O objetivo desta entrega é ser auditável, não executável.

---

## Princípios que guiam o plano

1. **Fundação antes de recurso.** Sem números confiáveis e sem o fluxo da esposa funcionando, qualquer análise nova é construída sobre areia. A ordem das fases reflete isso.
2. **Fricção mínima para a esposa é o objetivo nº 1.** A regularidade dela é o que faz o sistema inteiro ter dados. Tudo que reduz o atrito dela tem prioridade sobre tudo que agrada o dono.
3. **Menos tempo de administração.** Cada passo manual que puder virar automático (importação, aplicação de categorias, fechamento) deve virar.
4. **Leveza e elegância.** Zero bibliotecas novas de peso; animações só em `transform`/`opacity`; ícones de linha monocromáticos; tipografia do sistema. A sensação de robustez vem da contenção, não do enfeite.

---

## Decisões tomadas na conversa (que refinam o roadmap da auditoria)

### D1. Cadência de relatórios: fechamento **mensal** + consolidação **anual** (não semanal)
Os dados chegam em lotes (faturas), não em fluxo contínuo — então o rito natural é o fechamento mensal, com uma consolidação anual. **Sem notificações no meio do mês.** O painel ao vivo do app mostra projeção de fim de mês e metas em risco para quando abrirem, mas nenhum aviso é empurrado. Relatório formal só no fechamento.

- **Fechamento mensal** (checklist → relatório → selo de mês fechado):
  1. Checklist: todas as contas/cartões com fatura importada? categorização 100%? total bate com a fatura? Se não, o relatório sai com ressalvas explícitas ("Itaú não importado — números parciais").
  2. Relatório do mês: resultado, taxa de poupança, realizado vs. metas, variações vs. média dos últimos 6 meses, anomalias, assinaturas detectadas, comprometimento de parcelas dos próximos meses.
  3. Selo de "mês fechado": o mês fica imutável no app (estende o conceito de ciclo fechado que já existe por cartão). Protege contra edição retroativa acidental.
- **Fechamento anual**: consolida os 12 meses (YoY por categoria, evolução da taxa de poupança, para onde o dinheiro foi) e **propõe metas para o ano seguinte** com base no realizado.

### D2. Integração com o MyPKA: app = interface da família; MyPKA = back-office
- O **app web** continua sendo a interface sempre no ar: a tela de categorização da esposa, os dashboards, o histórico.
- O **MyPKA** vira o back-office operado pelo time de agentes, com dois papéis:
  - **Extrator**: observa uma pasta `inbox/`, processa a fatura (PDF/Excel), deduplica por hash idempotente, valida o total contra a fatura, grava no Firestore e **já cria a sessão de categorização com sugestões pré-calculadas**, devolvendo o link pronto para o WhatsApp. Reduz a fricção de importação do dono a "salvar arquivo na pasta".
  - **Consultor de Fechamento**: dispara o fechamento mensal/anual (D1), gera o relatório, arquiva no cockpit e entrega ao casal.
- **Pré-requisitos técnicos**: service account do Firebase (Admin SDK) só na máquina do dono; contrato de dados estável (o hash de dedupe + o campo `kind` da Fase 2). A ponte fica em `tools/mypka/` (a ser criada após a aprovação).
- **Ressalvas honestas**: a máquina precisa estar ligada para o fluxo automático rodar (o upload pelo app continua como fallback); com dois caminhos de escrita, a idempotência deixa de ser melhoria e vira pré-requisito.

### D3. Como testar sem risco ao main
- Cada branch gera um **preview deployment** próprio no Cloudflare Pages — a família usa a URL de teste enquanto a produção segue intocada. Merge no `master` só após aprovação; rollback é reverter o merge.
- **Recomendado**: um segundo projeto Firebase ("staging") apontado pelas variáveis do preview, populado com um backup dos dados reais — teste com dados reais em ambiente descartável. **Decisão pendente do dono:** staging separado (~30 min no console) vs. banco real com backup prévio.

### D4. Direção estética (protótipo em `prototipos/categorizacao-mobile.html`; especificação completa com código em `MELHORIAS-VISUAIS.md`)
Fundo `#121212`, superfícies com borda sutil, raio 16px, um único verde-menta como cor de ação/sucesso, coral para despesa, números tabulares, ícones de linha monocromáticos (estilo SF Symbols), tipografia do sistema. Vale para o app inteiro — hoje cada tela tem densidade e pesos diferentes. No desktop, a mudança mais valiosa não é cosmética: é **hierarquia** — o Dashboard deve abrir com os "sinais vitais" (taxa de poupança, resultado projetado, metas em risco) antes dos detalhes.

---

## Roadmap por fases

> Estimativas são de esforço de desenvolvimento, não prazo de calendário. Cada fase é mergeável e testável de forma independente.

### Fase 0 — Segurança e integridade (fazer antes de tudo)
Objetivo: fechar os buracos que colocam dados ou dinheiro em risco.
1. Escrever e versionar `firestore.rules` + TTL nas sessões de categorização. *(Auditoria §2.1)*
2. Autenticar as Cloudflare Functions (Firebase ID token) + mover a chave Anthropic para secret do ambiente, removendo-a do app, do tráfego e do backup. *(§2.2, §2.3)*
3. Desabilitar cadastro aberto (allowlist de e-mails). *(§2.4)*
4. Chunking (450) em `importBatch`/`batchUpdate`/`batchUpdateReconciled`; confirmação em toda exclusão em lote. *(§1.5)*

### Fase 1 — O fluxo da esposa (a maior alavanca)
Objetivo: ela amar o processo e o trabalho dela nunca se perder.
5. **Corrigir o bug da sessão `applied` prematura** — o trabalho feito aos poucos não pode mais ser descartado. *(§1.1)*
6. **Sugestão de 1 toque** no card (regras + histórico de escolhas dela, pré-calculadas ao criar a sessão) + **aprendizado automático de regras**. *(§1.3)*
7. **Desfazer / corrigir** no mobile + tela final de revisão. *(§1.2)*
8. **PWA completo** (service worker + apple-touch-icon 180×180) + micro-interações do protótipo. *(§4.2)*
9. **Aplicação automática** das categorizações (sem depender de o dono abrir a página). *(§4.1)*

### Fase 2 — Dados confiáveis
Objetivo: os números do painel merecerem confiança.
10. Campo `kind` na transação (`normal` / `transferencia` / `pagamento_fatura` / `estorno`) + detecção na importação + exclusão de transferências/pagamentos das agregações. *(§1.4)*
11. Validação de total da fatura no preview + **dedupe idempotente na escrita** (hash conta+data+valor+descrição+parcela). *(§3.9–3.12)*
12. Unificar as 3 fórmulas de meta; corrigir denominadores e médias. *(§3.1–3.5)*
13. Testes de unidade das funções de cálculo + CI (GitHub Action com `tsc && eslint`). *(§5.5)*

### Fase 3 — O painel que direciona
Objetivo: sair do retrovisor e virar farol.
14. Taxa de poupança + fixas vs. variáveis + projeção de fim de mês no Dashboard. *(§6.1–6.3)*
15. Painel de comprometimento futuro (parcelas) + assinaturas/recorrências. *(§6.4–6.5)*
16. Fechamento mensal/anual (D1) — operado pelo Consultor de Fechamento no MyPKA (D2).

### Fase 4 — Simplificação contínua
Objetivo: menos código, menos manutenção.
17. Remover Pluggy (~900 linhas) e MigrationMDW (~590 linhas); unificar as duas telas de conciliação; centralizar estado num Provider; quebrar componentes gigantes; housekeeping (nome do pacote, README, lint zerado). *(§5)*

---

## O que **não** muda (decisões conscientes)
- **Investimentos continuam fora** — outro sistema cuida disso; aqui é só planejamento de despesas/receitas da família.
- **Sem integração bancária (Open Banking).** O upload manual de PDF/Excel é a escolha; a Fase 4 remove o código dormente de Pluggy em vez de reativá-lo.
- **A IA (Anthropic) continua rodando só na importação**, feita pelo dono — nunca no momento em que a esposa categoriza (a "inteligência" da tela dela é sugestão pré-calculada, sem chamada de IA por toque, sem custo e sem latência).
