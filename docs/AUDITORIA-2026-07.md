# Auditoria completa — Planejador Financeiro Familiar

**Data:** 02/07/2026 · **Escopo:** todo o código (~19 mil linhas) — importação, categorização, dashboards/relatórios, orçamento, camada de dados, segurança e qualidade de engenharia.

**Objetivos declarados do dono, usados como critério de avaliação:**
1. Pouco tempo de administração do sistema (para o casal);
2. Esposa categorizando com regularidade e fricção mínima (celular, link via WhatsApp);
3. Dados confiáveis para análise objetiva;
4. Painel de controle que direcione a saúde financeira (controle, otimização, economia, decisão).

---

## Sumário executivo

O sistema tem uma base muito boa: o fluxo de importação com IA funciona, a tela de categorização mobile é de 1 toque com progresso salvo no servidor, e há um conjunto amplo de painéis (KPIs, YoY, evolução por categoria, metas, fluxo de caixa, chat com IA, PDF executivo). O problema não é falta de funcionalidade — é que **quatro fragilidades minam exatamente os quatro objetivos**:

| Objetivo | O que está minando |
|---|---|
| Regularidade da esposa | **Bug crítico**: se ela categoriza aos poucos, o trabalho feito depois da primeira aplicação é descartado silenciosamente (sessão vira `applied`). E a tela dela não tem sugestões nem correção de erro. |
| Pouco tempo de administração | Dedupe só visual (re-importar duplica), regras de categoria não aprendem com o uso, duas telas de conciliação, aplicação de categorizações depende do dono abrir a página. |
| Dados confiáveis | **Sem tipo de lançamento** (transferência / pagamento de fatura / estorno): pagamento de fatura conta a despesa duas vezes, transferências inflam receitas e despesas, estorno vira "receita". |
| Painel que direciona | Não existe taxa de poupança em tela, nem fixas vs. variáveis, nem projeção de fim de mês, nem comprometimento futuro com parcelas, nem alerta de estouro de meta. Os painéis mostram o passado; nada aponta o próximo passo. |

Além disso, há **riscos de segurança sérios** (regras do Firestore não versionadas, endpoints de IA abertos na internet, chave Anthropic em localStorage e dentro do backup) e **riscos de perda de dados** (exclusão em lote sem confirmação, batches acima de 500 que estouram o limite do Firestore, backup 100% manual).

A recomendação central: **antes de adicionar qualquer análise nova, corrigir a fundação** — o bug da sessão de categorização, o tipo de lançamento e a segurança. Sem isso, os números do painel não merecem confiança e a esposa vai perder trabalho feito.

---

## 1. CRÍTICO — Bugs que atacam diretamente os objetivos

### 1.1 Trabalho de categorização da esposa é descartado (o bug mais importante do sistema)

`useCategorizationSession.ts:210-239` + `TransactionsPage.tsx:62-66`

Ao abrir a aba Transações, o app aplica automaticamente qualquer sessão `active` com `categorizedCount > 0` e **marca a sessão inteira como `applied`**. Cenário real e provável:

1. Você compartilha 20 lançamentos → ela categoriza 3 e sai (interrupção normal do dia a dia);
2. Você abre o app → as 3 são aplicadas e a sessão sai da lista de ativas;
3. Ela volta dias depois pelo mesmo link e categoriza as outras 17;
4. **Essas 17 nunca são aplicadas** — `applyAllPendingSessions` só olha sessões `active`. O trabalho dela fica órfão na subcoleção.

Este bug pune exatamente o comportamento que você quer incentivar (entrar aos poucos, com irregularidade). **Correção:** aplicar incrementalmente sem mudar o status, ou só marcar `applied` quando `categorizedCount === transactionIds.length`, e reaplicar deltas a cada abertura.

### 1.2 Sem correção de erro no celular

`CategorizationPage.tsx:45` + `CategorizationCard.tsx`

Depois do toque, a transação some da lista e **não há como corrigir nem desfazer** — o botão "Voltar" só navega entre pendentes puladas. Sua dor original era "ela categorizava errado"; sem undo, um erro exige que você detecte e corrija depois no desktop. **Correção:** botão "Desfazer última" + uma tela final de revisão ("confira as 20 que você categorizou") antes de fechar.

### 1.3 Sugestões inteligentes NÃO existem na tela dela

- A IA de `suggest-categories` só roda na importação do dono (`TransactionsPage.tsx:236`, `ImportModal.tsx:408`) — nunca na tela da esposa.
- As `CategoryRule` (`matchCategory`, `useCategories.ts:147-158`) também só rodam na importação.
- Nenhum aprendizado com o histórico dela: a mesma padaria precisa ser recategorizada manualmente toda vez, escolhendo numa lista alfabética completa.

Seu próprio documento (`categorização/Melhoria para interface de categorização mobile.md`, itens 3 e 10 — "Sugestão Mágica: É Vestuário?") pede isso e não foi implementado. **Correção (maior alavanca de fricção do sistema):**
1. Ao montar a sessão, pré-calcular a categoria provável de cada transação (regras + histórico de descrições já categorizadas) e mostrar como botão de destaque no topo do card: 1 toque confirma;
2. Quando ela escolher 2–3× a mesma categoria para a mesma descrição normalizada, criar/atualizar `CategoryRule` automaticamente — o sistema melhora sozinho a cada fatura.

### 1.4 Dupla contagem e distorções — o modelo não tem "tipo de lançamento"

`types/index.ts:30-51` — `Transaction` só tem `amount` com sinal; toda a analítica assume `>0` receita, `<0` despesa. Consequências confirmadas:

- **Pagamento de fatura conta a despesa 2×**: os itens do cartão entram como despesa E a linha "PAGAMENTO FATURA" do extrato da corrente entra de novo (`DashboardPage.tsx:36-37`, `CashFlowReport.tsx:65-66`, `computeReportData.ts:112-113` somam todas as contas sem exclusão).
- **Transferências entre contas** inflam receitas e despesas simultaneamente e distorcem a taxa de poupança do PDF (`computeReportData.ts:150`).
- **Estorno de cartão vira "receita"** em todas as telas, inclusive no YoY (`YoyDeviationPanel.tsx:102`).

**Correção estrutural (pré-requisito para confiar no painel):** adicionar `kind: 'normal' | 'transferencia' | 'pagamento_fatura' | 'estorno'` à transação; detectar automaticamente na importação (descrições "PAGAMENTO", "TED", "PIX TRANSF", valor positivo em cartão) com confirmação no preview; excluir `transferencia`/`pagamento_fatura` de receita/despesa e tratar `estorno` como redução de despesa da categoria.

### 1.5 Risco de perda de dados

- **Batches acima de 500 documentos estouram** o limite do Firestore e a operação inteira falha: `importBatch`, `batchUpdate`, `batchUpdateReconciled` (`useTransactions.ts:99-149`) não fazem chunking — ironicamente `backup.ts:172` e `MigrationMDW.tsx:400` fazem (450). Importação grande ou "selecionar todos + editar em lote" pode falhar.
- **Exclusão em lote sem confirmação e sem undo**: `TransactionTable.tsx:149-152` apaga tudo que estiver selecionado em 1 clique; a lixeira por linha (`:544-548`) também não confirma (o modal de edição confirma — inconsistente).
- **Backup só manual** (`SettingsPage.tsx:534`) e a **restauração apaga tudo antes de gravar** (`backup.ts:172-181`) sem snapshot de segurança — arquivo corrompido após o wipe = perda total.
- Dedupe de importação é **apenas visual no preview** (`ImportModal.tsx:34-48`); a escrita não é idempotente — clique duplo ou re-importação com datas ligeiramente diferentes duplica silenciosamente.

---

## 2. CRÍTICO — Segurança

### 2.1 Regras do Firestore não versionadas (maior risco em aberto)

Não existe `firestore.rules` nem `firebase.json` no repositório. A segurança de **toda a base financeira da família** depende de regras configuradas manualmente no console — não auditáveis, não versionadas. Como o fluxo da esposa exige leitura/escrita **anônima** na coleção top-level `categorizationSessions`, há chance real de as regras em produção estarem permissivas demais.

**O que deve existir (versionado no repo e publicado via `firebase deploy`):**
- `users/{uid}/**`: `allow read, write: if request.auth.uid == uid`;
- `categorizationSessions/{token}`: leitura por `get` (nunca `list`, para impedir enumeração), escrita **somente** nos campos `categoryId`/`notes`/`categorizedCount`/`lastActivityAt`, e `expiresAt > request.time` validado na regra (hoje a expiração de 48h é checada **só no cliente**, `useCategorizationSession.ts:283` — quem tem o token lê direto pelo SDK para sempre);
- Cleanup: as sessões e suas cópias de transações **nunca são deletadas** — o link no histórico do WhatsApp dá acesso eterno aos dados. Adicionar TTL policy do Firestore no campo `expiresAt` (ou uma rotina de limpeza).

### 2.2 Endpoints Cloudflare abertos na internet

Nenhuma das functions valida autenticação (`parse-statement.ts:22`, `suggest-categories.ts:23`, `financial-chat.ts:17`, `pluggy-proxy.ts:48`): qualquer anônimo que descubra a URL pode gastar os créditos da `ANTHROPIC_API_KEY` configurada no ambiente — inclusive rodando prompts arbitrários no Sonnet via `financial-chat`. **Correção:** exigir o Firebase ID token no header `Authorization` e validá-lo na function (verificação do JWT contra as chaves públicas do Google — sem SDK admin, ~40 linhas), além de restringir CORS à origem do app.

### 2.3 Chave Anthropic em texto plano em 3 lugares

- `localStorage` (`SettingsPage.tsx:336`) — qualquer XSS a lê;
- No **corpo de cada request** (`TransactionsPage.tsx:239`, `FinancialChat.tsx:223`) — as functions aceitam `body.apiKey` de qualquer origem, virando proxy aberto;
- **Dentro do arquivo de backup** em texto plano (`backup.ts:31-35`) junto com `pluggy_client_id`/`pluggy_client_secret` — um backup salvo no Drive/e-mail expõe as credenciais.

**Correção:** a chave deve viver **somente** como secret no ambiente Cloudflare; remover o campo de chave do app, do tráfego e do backup. Com os endpoints autenticados (2.2), o app não precisa conhecer a chave.

### 2.4 Cadastro aberto

`useAuth.ts:30` + `LoginForm` expõem registro — qualquer pessoa pode criar conta no seu app (e consumir os endpoints de IA quando autenticados). Para um app de 2 usuários: desabilitar cadastro (allowlist de e-mails ou desativar o provider no console).

---

## 3. ALTO — Corretude analítica (o painel hoje "mente" nesses pontos)

| # | Problema | Onde | Efeito |
|---|---|---|---|
| 3.1 | Percentual de categoria sobre denominador misto (receitas+despesas em valor absoluto) | `ReportsPage.tsx:78-81`, `computeReportData.ts:312` | % de despesa subestimado quando há receitas no mês |
| 3.2 | "Média mensal" ignora meses zerados/sem dados | `DashboardPage.tsx:56-61`, `CategoryEvolutionReport.tsx:18-22`, `computeReportData.ts:98-102`, `GoalsEvolutionTab.tsx:420-424` | Superestima gastos recorrentes — perigoso para decisão |
| 3.3 | Metas: 3 fórmulas diferentes para o mesmo total | Dashboard exclui metas só-de-sub (`DashboardPage.tsx:222-223`); GoalsEvolution soma meta de pai+sub em dobro e compara com TODAS as despesas (`GoalsEvolutionTab.tsx:65,68`); PDF não agrega subs no pai (`computeReportData.ts:249-256`) | O mesmo mês mostra números diferentes em cada tela |
| 3.4 | "Resultado" na evolução de metas = só −despesas | `GoalsEvolutionTab.tsx:180-181` | Rótulo enganoso |
| 3.5 | "Saldo" do fluxo de caixa é fluxo líquido acumulado desde o início dos dados, sem saldo de abertura por conta | `CashFlowReport.tsx:58-69` | Não é saldo bancário; rótulo enganoso |
| 3.6 | Fatura de cartão: saldo anterior silenciosamente 0 se o ciclo do mês anterior nunca foi criado; carry-forward não cascateia | `CreditCardPage.tsx:65-78`, `InvoiceSummaryPanel.tsx:46` | "Valor a pagar" errado |
| 3.7 | `purchaseDate` nunca é usado na analítica — tudo é competência de fatura | `computeReportData.ts:399-408` | Sem visão "quando gastamos de fato" (aceitável, mas seja uma escolha consciente) |
| 3.8 | Edição manual de data no preview de importação de cartão é descartada (sobrescrita pelo mês da fatura) | `ImportModal.tsx:528-529` vs. coluna editável `:767-778` | Usuário acha que corrigiu e não corrigiu |
| 3.9 | Dedupe ignora conta/titular: mesma compra de 2 pessoas no mesmo dia = falso positivo desmarcado por padrão | `ImportModal.tsx:34-48` | Transação legítima pode ser perdida na importação |
| 3.10 | Duplicata intra-arquivo não detectada (compara só com existentes) | `ImportModal.tsx:36` | PDF com layout quebrado pode duplicar linha |
| 3.11 | Parcelas: overflow de fim de mês (`setMonth` em dia 29–31) | `ImportModal.tsx:548-549`, `TransactionsPage.tsx:184-185`, `CreditCardPage.tsx:150-152` | Compra de 31/jan cai em 03/mar → fatura errada |
| 3.12 | Truncamento silencioso na importação: texto cortado em 60k chars e resposta da IA limitada a 16k tokens | `parse-statement.ts:51,126` | Fatura grande perde transações **sem aviso** — adicionar validação de contagem/total contra a fatura |

**Validação que falta em todo o fluxo de importação:** o sistema nunca confere o total importado contra o total da fatura. Um campo "total da fatura" no preview (digitado ou extraído pela IA) com check verde/vermelho eliminaria a principal fonte de desconfiança e boa parte da conciliação manual.

---

## 4. ALTO — Fricção e tempo de administração

1. **Aplicação de categorizações depende do dono**: só acontece quando você abre a aba Transações, uma vez por carregamento (`TransactionsPage.tsx:47,62-66`). Se ela categoriza com sua página já aberta, nada é aplicado até um refresh. Ideal: aplicar server-side (Cloud Function/cron) ou ao menos `onSnapshot` nas sessões ativas.
2. **PWA incompleto para iPhone**: manifest e theme-color existem (`index.html:7-10`), mas **não há service worker** nem `apple-touch-icon` PNG 180×180 — no iPhone dela, "Adicionar à Tela de Início" fica sem ícone decente e sem abertura instantânea. São 2 itens baratos do seu próprio documento de melhorias.
3. **Recontagem cara a cada toque dela**: `categorizeTransaction` relê a subcoleção inteira para recontar (`useCategorizationSession.ts:334-337`) — trocar por `increment()` atômico melhora latência percebida no celular.
4. **Sessão sem realtime**: dois dispositivos na mesma sessão não se veem (`getDoc` único, `:273-308`); último toque vence.
5. **Duas telas de conciliação para o mesmo dado** (`ReconciliationPage` e os dots em `InvoiceTransactionList`), e a página de conciliação mostra transações de cartão todas com "dia 01" (`ReconciliationTable.tsx:59`) porque `date` = 1º do mês da fatura — inviável para bater linha a linha. Unificar em uma, orientada por fatura.
6. **Receita aparece como gasto na tela dela**: tudo é rotulado "CATEGORIZAR GASTOS" e todo valor fica vermelho (`CategorizationPage.tsx:132`, `CategorizationCard.tsx:188`), mas o compartilhamento inclui receitas (`ShareCategorizationModal.tsx:113`).
7. **Micro-fricções do seu documento ainda não implementadas**: haptic feedback (`navigator.vibrate` — funciona em Android; iOS Safari não suporta, mas o custo é 1 linha), skeleton screen no load, botões ≥48px, barra de progresso cinza→verde, categorias mais usadas na zona do polegar.

---

## 5. MÉDIO — Simplificação (menos código = menos manutenção)

1. **Remover Pluggy** (~900 linhas dormentes): `PluggySync.tsx` (591), `pluggy-proxy.ts`, `pluggy-webhook.ts` (no-op), seção em Settings (`SettingsPage.tsx:363-465`), segundo caminho de dedupe inconsistente (`PluggySync.tsx:76-81`), credenciais em localStorage. Você declarou que abriu mão de integração bancária — o código só adiciona superfície de ataque e manutenção. (Git preserva o histórico se quiser voltar.)
2. **Remover MigrationMDW** (~590 linhas): importador one-shot do "Meu Dinheiro" já usado, que além disso grava dados **inconsistentes** com o resto do app (titular = string do cartão, `cardNumber: null`, data = vencimento em vez de 1º do mês — `MigrationMDW.tsx:360-386`) e escreve direto no Firestore contornando os hooks.
3. **Centralizar estado**: cada hook abre seu próprio `onSnapshot` e não há Provider/cache — a página de Transações abre 9 listeners; Relatórios abre 3 cópias da coleção INTEIRA de transações (`ReportsPage.tsx:41`, `CashFlowReport.tsx:24`, `CategoryEvolutionReport.tsx:198`). Um Context (ou TanStack Query) com um único listener por coleção reduz custo Firestore, memória e re-renders.
4. **Quebrar componentes gigantes**: `ImportModal` (1108), `YoyDeviationPanel` (870), `ExpenseGoalsTab` (700), `SettingsPage` (623).
5. **Housekeeping**: `package.json` ainda se chama `temp-init`; README é o template do Vite; `FamilyView.tsx` é stub morto; lint com 24 erros (destaque: `useCategories.ts:130` mutando ref durante render; deps incompletas mascaradas em `TransactionsPage.tsx:201,260`); **zero testes e zero CI** — mínimo: GitHub Action com `tsc && eslint` e testes de unidade para as funções puras críticas (`computeReportData`, dedupe, `extractTrailingInstallment`, fórmulas de meta).

---

## 6. Lacunas de produto — o que falta para "direcionar a saúde financeira"

O painel atual descreve o passado. Para **direcionar**, na ordem de valor/esforço:

1. **Taxa de poupança em tela** (já calculada no PDF, `computeReportData.ts:150` — só falta expor no Dashboard). Com o tipo de lançamento (1.4), ela passa a ser confiável. É O indicador de saúde financeira dado que investimentos ficam fora.
2. **Fixas vs. variáveis**: um campo `nature: 'fixa' | 'variavel'` por categoria (ou flag na transação). Destrava as perguntas que importam: "qual nosso custo fixo mensal?", "quanto do variável dá para cortar?", "quantos meses de reserva nosso custo fixo exige?".
3. **Projeção de fim de mês (run-rate)**: no mês corrente, projetar `realizado + média diária × dias restantes` por categoria e no total, comparando com meta — transforma o dashboard de retrovisor em farol.
4. **Comprometimento futuro com parcelas**: as parcelas futuras JÁ existem como transações datadas — só falta um painel "próximos 12 meses: quanto já está comprometido" (curva + lista). Hoje só a fatura individual mostra isso (`InvoiceSummaryPanel.tsx:167-178`).
5. **Assinaturas e recorrências**: detectar descrições que se repetem mensalmente com valor similar → painel "assinaturas: R$ X/mês" com variações destacadas. É onde famílias mais acham dinheiro esquecido.
6. **Alertas proativos** (o elo com "pouco tempo de administração"): hoje o estouro de meta só aparece se você abrir a tela certa. Um resumo semanal/mensal automático (e-mail ou WhatsApp via link, como o de categorização) com: metas estouradas, anomalias, taxa de poupança do mês, pendências de categorização. Isso inverte o fluxo — o sistema procura vocês, não o contrário.
7. **Anomalias simples**: gasto de categoria > 2× a mediana dos últimos 6 meses → destacar. Sem ML, só estatística básica.
8. **FinancialChat**: útil, mas envia todo o retrato financeiro a cada mensagem sem prompt caching (`financial-chat.ts:62-67`) — adicionar `cache_control: {type: 'ephemeral'}` no bloco de contexto corta o custo; e após autenticar o endpoint (2.2), deixa de ser proxy aberto.

---

## 7. Roadmap recomendado

**Fase 0 — Segurança e integridade (1–2 dias de trabalho; fazer antes de tudo)**
1. Escrever e publicar `firestore.rules` (versionadas no repo) + TTL nas sessões;
2. Autenticar as functions (Firebase ID token) + mover a chave Anthropic para secret do Cloudflare e removê-la do app/backup/localStorage;
3. Desabilitar cadastro aberto;
4. Chunking (450) em `importBatch`/`batchUpdate`/`batchUpdateReconciled`; confirmação em toda exclusão.

**Fase 1 — O fluxo da esposa (a maior alavanca do sistema; ~2–3 dias)**
5. Corrigir o bug da sessão `applied` prematura (1.1);
6. Sugestão de 1 toque no card (regras + histórico) e aprendizado automático de regras (1.3);
7. Desfazer/corrigir no mobile (1.2);
8. PWA completo (service worker + apple-touch-icon) + micro-interações do seu documento;
9. Aplicação automática das categorizações (sem depender de você abrir a página).

**Fase 2 — Dados confiáveis (~2–3 dias)**
10. Campo `kind` na transação + detecção na importação + exclusão de transferências/pagamentos das agregações (1.4);
11. Validação de total da fatura no preview + dedupe idempotente na escrita (hash conta+data+valor+descrição+parcela);
12. Unificar as 3 fórmulas de meta; corrigir denominadores e médias (seção 3);
13. Testes de unidade das funções de cálculo + CI.

**Fase 3 — O painel que direciona (~3–5 dias)**
14. Taxa de poupança + fixas/variáveis + projeção de fim de mês no Dashboard;
15. Painel de comprometimento futuro (parcelas) + assinaturas/recorrências;
16. Resumo periódico automático com alertas (meta estourada, anomalia, pendências).

**Fase 4 — Simplificação contínua**
17. Remover Pluggy e MigrationMDW; unificar conciliação; centralizar estado num Provider; quebrar componentes gigantes; housekeeping (nome do pacote, README, lint zerado).

---

## Apêndice — inventário de bugs por arquivo

| Arquivo:linha | Bug |
|---|---|
| `useCategorizationSession.ts:210-239` | Sessão marcada `applied` com pendentes → trabalho da esposa descartado |
| `useCategorizationSession.ts:283` | Expiração de 48h só no cliente |
| `useCategorizationSession.ts:334-337` | Releitura da subcoleção inteira a cada categorização |
| `useCategorizationSession.ts:195-205` | Aplica `categoryId`/`notes` da sessão pública sem validar |
| `useTransactions.ts:99-149` | Batches sem chunking (limite 500 do Firestore) |
| `useTransactions.ts:53-64` | Listener da coleção inteira, sem limite/janela |
| `TransactionTable.tsx:149-152, 544-548` | Exclusões sem confirmação/undo |
| `TransactionsPage.tsx:62-66, 47` | Aplicação de sessões só 1× por carregamento da página |
| `ImportModal.tsx:34-48` | Dedupe ignora conta/titular; só visual |
| `ImportModal.tsx:36` | Sem dedupe intra-arquivo |
| `ImportModal.tsx:528-529` | Edição de data do preview descartada em cartão |
| `ImportModal.tsx:548-549` | Overflow de fim de mês na geração de parcelas |
| `parse-statement.ts:51, 126` | Truncamento silencioso (60k chars / 16k tokens) |
| `functions/api/*.ts` | Endpoints sem autenticação; aceitam `apiKey` do body |
| `SettingsPage.tsx:336` / `backup.ts:31-35` | Chave Anthropic em localStorage e no backup em texto plano |
| `CreditCardPage.tsx:65-78` | Saldo anterior da fatura silenciosamente 0; sem cascata |
| `CreditCardPage.tsx:150-152` | Overflow de fim de mês no "mover fatura" |
| `DashboardPage.tsx:36-37` etc. | Dupla contagem pagamento de fatura; transferências infladas |
| `DashboardPage.tsx:56-61, 222-223` | Média 12M ignora meses vazios; total de metas exclui metas só-de-sub |
| `GoalsEvolutionTab.tsx:65, 68, 180-181` | Meta pai+sub em dobro; realizado vs. meta parcial; "Resultado" = −despesas |
| `computeReportData.ts:249-256, 312` | Orçamento sem agregar subs; % sobre denominador misto |
| `ReportsPage.tsx:78-81` | % de categoria sobre receitas+despesas |
| `CashFlowReport.tsx:58-69` | "Saldo" sem saldo de abertura |
| `YoyDeviationPanel.tsx:102` | Estorno tratado como receita |
| `CategorizationPage.tsx:132` / `CategorizationCard.tsx:188` | Receita exibida como gasto em vermelho |
| `useBillingCycles.ts:47, 101` | Criação de ciclo sem transação atômica (duplicidade possível) |
| `useCategories.ts:130` | Mutação de ref durante render (erro de lint) |
| `MigrationMDW.tsx:360-386` | Dados inconsistentes (titular=cartão, cardNumber null, data=vencimento); sem dedupe |
| `PluggySync.tsx:76-81, 214-215` | Dedupe inconsistente com ImportModal; cap silencioso de 5 páginas |
| `FinancialChat.tsx:221` / `financial-chat.ts:62-67` | Filtro de histórico frágil; contexto sem prompt caching |
