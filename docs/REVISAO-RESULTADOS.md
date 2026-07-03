# Revisão do time myPKA — Parecer consolidado

**Data:** 2026-07-02
**Revisores:** Vex (segurança/infra) · Pax (dados/finanças) · Felix (código frontend) · Vera (UX/a11y/QA) · Nolan (arquitetura/integração D2) · consolidação por Larry (orquestrador)
**Escopo:** os 6 docs do pacote + o código-teste da branch `claude/financial-planner-audit-fnd1tv` (PR #25), verificado por leitura de código, `tsc`/lint/build e cálculo (contraste WCAG, simulação de daltonismo). **Nada em `src/` ou `functions/` foi alterado. Nenhum merge. O app não foi executado contra o Firebase** (o preview aponta para produção com dados reais — restrição respeitada).

---

## Sumário executivo

O trabalho auditado é **bom e majoritariamente correto no diagnóstico** — a maioria dos achados foi confirmada linha a linha. Mas a revisão adversarial encontrou problemas em três níveis:

1. **O código-teste da Fase 1 não está pronto para merge+deploy.** O fix do bug da sessão é real, porém deixa 7 cenários de uso irregular descobertos (2 deles críticos: falha de escrita congela a tela em silêncio; transação apagada envenena o apply para sempre). A Vera reprovou o gate com 6 achados HIGH. A troca de fonte introduziu uma regressão de alinhamento numérico em 12 telas **já neste commit**.
2. **As `firestore.rules` propostas são YELLOW, não GREEN.** Fecham a escrita, mas não fecham a **leitura pós-expiração** — exatamente o requisito que o próprio §2.1 da auditoria exige — e `allow list` para qualquer autenticado permite enumerar todos os tokens.
3. **A Fase 2, como especificada, não deve ser implementada.** O hash de dedupe é quebrado por construção (todas as linhas de fatura recebem data = dia 1 do mês; a descrição vem de um LLM não-determinístico). Idempotência de fachada é pior que nenhuma.

**Recomendação central: aprovar o pacote como especificação, mas NÃO mergear o PR #25 como está.** Primeiro um round de correções nesta mesma branch (lista objetiva na seção "Ordem recomendada"), re-gate da Vera, depois merge.

Vereditos por especialista:

| Especialista | Veredito |
| --- | --- |
| Vex | `firestore.rules`: **YELLOW** (3 correções para GREEN); §2.1 provavelmente crítico real (ver inferência abaixo) |
| Pax | §1.4/§3 confirmados com escopo condicionado ao hábito; **Fase 2 reprovada como especificada**; +1 achado novo que a auditoria não viu |
| Felix | `tsc`: 0 erros · `build`: OK · `lint`: **24 erros** (todos pré-existentes, fora da branch); fix do `applied` correto no núcleo, **7 cenários não cobertos** |
| Vera | Fase 1 como está: **FAIL** (6 HIGH); protótipo como direção: aprovado com cortes; tema de gráficos: aprovado com condições |
| Nolan | D2: **dividir** — D2a (Consultor, read-only) aprovar; D2b (Extrator, write) rebaixar a hipótese condicionada |

---

## 1. CONCORDO (confirmado com evidência)

### Segurança (Vex)
- **§2.1** — não há `firestore.rules` no master (só nesta branch); expiração de 48h era só cliente. Confirmado.
- **§2.2** — nenhum dos 4 handlers valida identidade (`functions/api/parse-statement.ts:22`, `financial-chat.ts:17`, `suggest-categories.ts:23`, `pluggy-proxy.ts:48`); todos aceitam `apiKey`/`clientSecret` do body com fallback pro env. Proxy aberto confirmado.
- **§2.3** — chave Anthropic em `localStorage` (`SettingsPage.tsx:336`), no corpo das requests e **dentro do backup em texto plano, deliberadamente** (`src/lib/backup.ts:29-35` — inclui também credenciais Pluggy).
- **§2.4** — cadastro aberto no master (`useAuth.ts:29-31`); na branch o flag `VITE_ALLOW_REGISTRATION` só esconde a UI (o próprio doc admite).
- Higiene da branch: **nenhum segredo commitado**; chunking correto (`useTransactions.ts:27-35`); o service worker **não cacheia dado sensível** (só GET same-origin; Firestore/Anthropic são cross-origin, `sw.js:27`); zero sinks de XSS novos.
- **Inferência que a auditoria não fez e que muda o quadro:** o fluxo da esposa funciona hoje **sem login** (`useCategorizationSession.ts:367-423` lê `categorizationSessions` sem auth). Se as regras de produção fossem estritas por dono, esse fluxo estaria quebrado. Como funciona, **produção é comprovadamente permissiva ao menos em parte** — a probabilidade a priori de o §2.1 ser crítico real é alta.

### Dados/finanças (Pax)
- **§1.4 (mecanismo)** — a agregação de fato não exclui nada: `Transaction` não tem `kind` (`types/index.ts:30-51`); Dashboard, `computeReportData.ts:112-113` e `CashFlowReport.tsx:65-66` somam tudo por sinal. **Mas a materialização depende do hábito de importação** (ver DISCORDO).
- **§3.3 é o pior achado analítico — confirmado integralmente.** Três telas, três números para o mesmo mês: Dashboard agrega subs no pai e o total só conta pais (`DashboardPage.tsx:186-201,222-223`); GoalsEvolution soma todas as budgets (pai+sub em dobro, `GoalsEvolutionTab.tsx:65`) e compara com todas as despesas, até as sem meta (`:68`); o PDF não agrega subs no pai (`computeReportData.ts:252`).
- **§3.1, 3.2 (parcial), 3.4, 3.5, 3.6, 3.8, 3.9/3.10, 3.11 (escopo menor), 3.12** — confirmados; nuances de escopo na seção DISCORDO.
- **Refs de linha da auditoria estão desatualizadas para esta branch** — a branch já implementa parte do que a auditoria dá como ausente (ex.: chunking §1.5 já existe). Quem implementar a Fase 2 não pode usar as linhas da auditoria como mapa.

### Código/UX (Felix + Vera)
- **O fix do bug `applied` (§1.1) é real no núcleo:** sessão só vira `applied` quando `categorized === total` (`useCategorizationSession.ts:313`), delta idempotente na subcoleção, sessões legadas tratadas na direção segura. O cenário original da auditoria está corrigido.
- **A sugestão de 1 toque é boa engenharia:** determinística, zero IA em runtime, zero latência (regras do dono + frequência histórica, calculadas na criação da sessão). Quando erra, não atrapalha — grade e busca a um toque; "É X?" é pergunta, não default aplicado.
- **A direção do protótipo é a certa para o objetivo nº 1** (1 lançamento por vez, grade na zona do polegar, alvos ≥44px nos fluxos principais, busca sem zoom no iOS). A implementação **melhorou** o protótipo em pontos reais: skeleton/erro/vazio existem, grade dinâmica por histórico, "breathe" removida.
- **V1 do diagnóstico visual é fato verificado no git:** a mono declarada nunca carregou (sem `@font-face` no master) — o app rodava no fallback `monospace` do aparelho. Migrar para sans do sistema é correção, não gosto.
- **Estratégia do service worker é a certa para app financeiro:** navegação network-first (sem app stale pós-deploy no caminho normal), dados financeiros nunca passam pelo Cache Storage.
- Preservar nomes de token v1 trocando só valores (`index.css:8-12`) é a jogada certa — migração reversível, confirmada por build limpo.

### Arquitetura (Nolan)
- App = interface, myPKA = back-office **analítico** (leitura) é o nosso padrão comprovado (runners headless do diário, guard-gated).
- A ressalva honesta do próprio plano (idempotência vira pré-requisito com dois caminhos de escrita) está certa — e implica que o Extrator não pode estar "decidido" antes da Fase 2 entregue e testada.
- Ponte em `tools/mypka/` no repo do planejador (não no myPKA) respeita nosso princípio "adaptar dado, não mudar sistema".

---

## 2. DISCORDO (com evidência)

### Severidades infladas ou condicionais (Vex)
- **§2.2 "qualquer anônimo gasta os créditos da ANTHROPIC_API_KEY" — condicional, possivelmente falso hoje.** O env é *fallback* (`parse-statement.ts:34`); o app manda a chave do localStorage no body — indício de que o secret talvez nem exista no Cloudflare. Se não existir: MÉDIO. Se existir: HIGH, não CRÍTICO — é abuso de custo, **não exposição de dados** (a function não lê o Firestore).
- **§2.4 "consumir os endpoints de IA quando autenticados" — errado.** Os endpoints não checam auth nenhuma; registrar conta não muda o abuso deles. O risco real do cadastro aberto é outro: virar chave de leitura do banco combinado com regras permissivas.
- **§2.2 "restringir CORS" — cosmético.** As functions não emitem `Access-Control-Allow-Origin` nenhum; CORS não bloqueia `curl`. O único fix que importa é o ID token, que a auditoria já propõe.
- **§2.3 como "CRÍTICO" — inflado para 2 usuários.** Explorar a chave no localStorage exige um XSS que ninguém demonstrou (e não há sink). O vetor realista é o **arquivo de backup** circulando por Drive/e-mail: HIGH; o resto MEDIUM.
- **`SEGURANCA-FASE-0.md:53-55` é tecnicamente falso:** "as regras não conseguem inspecionar o filtro da query" — errado; rules avaliam `list` contra as restrições da query. O "risco tolerável" tem correção de **uma linha**.
- **`PLANO-DE-MELHORIAS.md:11` é falso e perigoso:** "nenhuma linha de código de produção foi alterada; os únicos arquivos novos estão em docs/" — o diff toca ~27 arquivos, incluindo `src/`, `public/sw.js` e `firestore.rules`. O `IMPLEMENTADO-NESTA-BRANCH.md` conta a história correta; o PLANO está stale e pode induzir um revisor a não auditar código que existe.

### Escopo dos achados de dados (Pax)
- **§1.4 "confirmadas" incondicional — não.** No hábito só-faturas (sem extrato da corrente), a dupla contagem de pagamento de fatura **não existe** (a linha "PAGAMENTO FATURA" vive no extrato, que nunca entra). O que existe mesmo nesse hábito: estorno vira "receita" (o prompt manda importar estorno positivo, `parse-statement.ts:101`) e o achado novo da seção FALTA. Matriz completa por hábito no parecer da Pax; resposta do Guilherme define o escopo real.
- **§3.1 — o denominador errado não está "em todo lugar":** o gráfico do Dashboard usa o certo (`DashboardPage.tsx:129`); o bug vive na aba Categorias e na seção por-categoria do PDF.
- **§3.2 mistura dois casos:** para médias por categoria, ignorar meses zerados superestima — real; para a média global 12M, pular meses pré-histórico é a escolha certa, não bug.
- **§3.11 — escopo menor:** no caminho de cartão, `invoiceDate` é sempre dia 1 (`ImportModal.tsx:520`) → `setMonth` nunca estoura ali; o overflow afeta parcelas manuais, extrato com parcela em dia 29–31 e "mover fatura" de transações legadas.
- **§3.5 — rótulo errado, não conta errada.** Prioridade baixa.

### Fase 2 como especificada (Pax) — **não implementar sem redesenho**
- **Hash de dedupe (conta+data+valor+descrição+parcela) quebrado por construção:** (a) na importação de cartão todas as linhas recebem `date` = dia 1 do mês da fatura (`ImportModal.tsx:519-529`) → colide para *qualquer* compra repetida no mesmo estabelecimento com mesmo valor dentro do ciclo (2× iFood de R$ 34,90 em dias diferentes — frequência alta em fatura real); (b) a descrição vem de um **LLM instruído a "limpar"** (`parse-statement.ts:124`) — não-determinística entre importações → falsos negativos estruturais. **Idempotência sobre parser não-determinístico é idempotência de fachada.** Alternativa que casa com o uso real: **dedupe por substituição de fatura** — re-importar a fatura do mês X da conta Y substitui transacionalmente as transações `(conta, mês-fatura)`, preservando `categoryId` por melhor esforço.
- **Detecção de `kind` por keyword vai poluir de outro jeito:** "PAGAMENTO DE BOLETO CEMIG" é despesa real que sumiria **silenciosamente** como `pagamento_fatura` (pior que a dupla contagem, que ao menos é visível); Pix/TED a terceiros é despesa real; transferência interna só é detectável com segurança por **pareamento** de valor oposto entre contas cadastradas. Recomendação: `kind` como campo sim; detecção mínima e conservadora (default `normal`, nunca excluir por keyword sem confirmação individual).

### Fase 1 / visual (Felix + Vera)
- **"Lint limpo" é falso para o repo:** `npm run lint` = 24 erros + 2 warnings. Nuance: todos em arquivos **não tocados** pela branch (batem com o §5.5 da própria auditoria); o código novo está limpo. Mas se a intenção for CI, `npm run lint` quebra o pipeline hoje.
- **"Paleta validada para daltonismo" — alegação mais forte que a validação.** O script validou só pares adjacentes da ordem fixa, mas a regra do tema atrela cor à entidade → qualquer par pode ficar adjacente num donut real. Calculado: azul `#3987e5` × violeta `#9085e9` — **ΔE protan 2,2 / deutan 1,6, indistinguíveis**. E os dois únicos consumidores do tema violam as regras dele: `CashFlowChart.tsx:67-68` hardcoda o legado `#22c55e`/`#ef4444`; `ExpensesByCategoryChart.tsx:85,100` cicla por módulo além de 6 e prefere a cor da categoria gravada no Firestore (default âmbar legado, `useCategories.ts:22`).
- **O protótipo não roda como página mobile de verdade:** sem `<!DOCTYPE>`, `<html lang>` nem `<meta viewport>` — num celular real renderiza em viewport desktop ~980px. Serviu como demo; ninguém validou a experiência real de toque nele.
- **A migração §6 "incremental e segura" entrega a regressão antes da cura:** a fonte virou sans **neste commit**, mas `.tnum` só existe na tela nova — 60 usos de `font-mono` em 12 telas (Dashboard, Faturas, Metas, Relatórios…) agora renderizam números proporcionais → **colunas financeiras desalinhadas em todo o app hoje**, especialmente no iPhone (SF Pro é proporcional por padrão).

### D2 (Nolan)
- **"É o mesmo padrão dos nossos crons" — não é.** Os precedentes do myPKA leem arquivos e escrevem markdown local. O Extrator escreveria em **produção financeira** com **Admin SDK — que bypassa completamente as `firestore.rules`**: toda a Fase 0 fica anulada por essa credencial. Seria a primeira credencial de escrita irrestrita em produção guardada nesta máquina — nossa postura registrada é o oposto (gateway default-deny, gate do Vex antes de flag de write).
- **"Dois caminhos de escrita valem a pena" — o ganho encolheu.** A Fase 1 já entrega sugestão pré-calculada + aplicação automática; a fricção do dono cai para "arrastar o PDF pro app". O Extrator economiza ~1 gesto por fatura ao custo permanente de: segundo parser, watcher + tarefa agendada, credencial a rotacionar, idempotência como pré-requisito duro. **O app deve continuar caminho único de escrita** até o uso real pós-Fase 1 provar que a fricção remanescente incomoda.
- **"Extrator é um agente" — não deveria ser.** Feedback durável do Guilherme: integração que dá para fazer em código não usa IA em runtime. Se D2b um dia existir: script determinístico do Mack, zero tokens por fatura, escrevendo **via endpoint autenticado do app** (Function pós-Fase 0) — não Admin SDK.

---

## 3. FALTA (o que a auditoria/implementação não pegou)

### Achado novo de dados — pior que o estorno no hábito só-fatura (Pax)
Faturas brasileiras trazem a linha **"PAGAMENTO EFETUADO/RECEBIDO" da fatura anterior como crédito dentro da própria fatura**. O prompt exclui "RESUMO/TOTAIS" e "faturas futuras" (`parse-statement.ts:102-103`) mas **não exclui a linha de pagamento recebido**. Se a IA a importar, cada mês ganha uma "receita" do tamanho da fatura anterior — infla receitas e zera artificialmente o resultado **mesmo sem importar extrato nenhum**. Está no kit de teste (caso 5).

### Buracos nas rules propostas (Vex)
1. **Leitura pós-expiração não é bloqueada** — `firestore.rules:38,51,58` (`allow get/read: if true`) sem check de `expiresAt`. Token expirado no histórico do WhatsApp lê todas as transações copiadas, para sempre. A implementação descumpre o requisito explícito do próprio §2.1.
2. **`allow list: if request.auth != null` (`firestore.rules:39`) = enumeração total de tokens** por qualquer conta autenticada — e conta se auto-cria via "Entrar com Google" (`useAuth.ts:33-35`) ou via REST com a web API key pública; o flag `VITE_ALLOW_REGISTRATION` não impede nada.
3. **TTL não apaga subcoleções:** o TTL deleta só o doc da sessão; `transactions`/`categories` órfãs continuam publicamente legíveis por token. O "acesso eterno" que o §2.1 denuncia sobrevive à correção proposta. Precisa de rotina de limpeza real.
4. **Campo `applied` gravável pelo público (`firestore.rules:61`):** quem tem o token pode setar `applied:true` e o apply do dono pula os itens silenciosamente — o exato bug corrigido, reintroduzível por adversário. Idem `categorizedCount` sem validação (setar 0 faz `applyAllPendingSessions` ignorar a sessão). LOW/MEDIUM (token de 128 bits, 2 usuários), mas a validação custa 3 linhas.
5. **Guia de console incompleto:** desabilitar cadastro no provedor Email/Senha não bloqueia contas via Google. O passo correto é project-wide: Authentication → Settings → User actions → desativar "Create (sign-up)".
6. **Checklist da Fase 0 sem rollback nem teste offline:** falta (a) copiar as regras ATUAIS do console para arquivo antes do deploy (sem isso não há rollback), (b) testar no **emulador** (`firebase emulators:start --only firestore` + `@firebase/rules-unit-testing`) — valida tudo sem tocar produção, (c) avisar que o deploy é imediato e global.
7. Sem rate limiting nas functions; e o D3 (semear staging com backup) duplicaria a exposição das chaves que o backup carrega — primeiro tirar as chaves do backup, depois usar backups para staging.

### Cenários do fix da sessão não cobertos (Felix; C2 e o undo confirmados independentemente pela Vera)
- **C1 — "volta 2 dias depois": link morto e sessão zumbi invisível (CRÍTICO de produto).** Expiração fixa de 48h nunca estendida por atividade (`useCategorizationSession.ts:177`). As parciais não se perdem, mas a sessão expirada-parcial fica invisível para o dono (`activeSessions` exclui expiradas `:151-154`; histórico só mostra `applied`/`dismissed` `:155-158`) — ninguém fica sabendo que sobraram 15 pendentes. O fix ainda pune "categorizar em partes com >48h de intervalo" — exatamente o padrão declarado da esposa.
- **C2 — Escrita falha no meio (rede móvel, token expira com a página aberta): a UI congela sem mensagem (CRÍTICO de robustez).** `handleSelect` (`CategorizationCard.tsx:74-85`) anima o card para opacity-0 e faz `await onCategorize(...)` **sem try/catch**; se o `updateDoc` é rejeitado pelas rules ou pendura offline, o card fica invisível e os botões disabled, sem erro em lugar nenhum. É o caminho de falha mais provável do mundo real da esposa.
- **C3 — Transação apagada pelo dono = poison-pill permanente (CRÍTICO).** O apply usa `batch.update` (`:302-303`); update em doc inexistente falha o batch **inteiro**; o catch engole com `console.error` e retorna 0 — nenhum delta aplica, e a próxima abertura repete. Loop silencioso para sempre.
- **C4 — Sem chunking nos dois batches da sessão:** criação = 1 op/transação num batch único (`:253-271`, >500 lançamentos falha); apply = 2 ops/transação (>250 deltas estoura o limite de 500 e cai no C3). A branch adicionou chunking em `useTransactions.ts` e esqueceu o próprio arquivo do fix.
- **C5 — Duas abas/aparelhos:** sem `onSnapshot` (§4.4 segue aberto); `pushCount` sobrescreve `categorizedCount` com estado local stale (`:427-436`) e `applyAllPendingSessions` filtra por `categorizedCount > 0` (`:338`) — janela real de delta nunca aplicado (o comentário em `TransactionsPage.tsx:61` afirma o oposto do que o código faz).
- **C6 — Apply é read-then-write sem transação:** recategorização da esposa durante o apply do dono pode ser perdida com `applied:true` sobrescrito (`:290` + `:307`). Precisaria de `runTransaction`/precondition.
- **C7 — O undo do ÚLTIMO lançamento é inalcançável:** quando é o último, o re-render cai na celebração antes do JSX do toast (`CategorizationPage.tsx:102-117` vs `:172-186`). Errou o último, não corrige no mobile.

### A11y e UX (Vera — FAIL, 6 HIGH)
1. Caminho de escrita sem tratamento de erro (= C2 acima).
2. **Desfazer frágil demais como única rede de segurança:** toast de 4s com botão de ~18–24px de altura (`CategorizationPage.tsx:178-183` — reprova até o mínimo de 24px do WCAG 2.5.8); expirou, não há nenhum outro caminho de correção na tela; e confirmação acidental da sugestão **reforça a regra errada** ("você escolheu isso 8 vezes").
3. **`ink-3` reprova contraste em todos os fundos** (3,02–3,75:1 < 4,5:1) e é usado em conteúdo real de 11px — inclusive a razão da sugestão, que é o texto que constrói confiança.
4. **Indicador de foco reprovado:** outline `accent-dim` composto = 2,15–2,19:1 (< 3:1, WCAG 1.4.11); inputs usam `focus:outline-none` com borda ainda mais fraca. Fix: menta sólida (11,69:1).
5. **Bottom-sheet sem semântica de diálogo:** sem `role="dialog"`/`aria-modal`/trap de foco/Esc/botão Fechar visível; X de limpar busca icon-only sem `aria-label`, alvo ~16px.
6. **Regressão tipográfica app-wide** (= item da seção DISCORDO; 12 telas desalinhadas hoje).
- MEDIUMs registrados no parecer completo: toast cobre a grade por 4s; grade muda de posição entre cards (quebra memória muscular); sem `aria-live`; bordas 1,2:1; observação digitada + "Pular" = texto perdido sem aviso.

### Protótipo × implementação (Felix + Vera convergem)
- **Entregar:** chip da conta no card ("Nubank •••• 4535") — casal com vários cartões precisa desse contexto; `createSession` não copia `account` para a subcoleção (`:257-269`).
- **Cortar do protótipo:** confetti; cronômetro "6 lançamentos em 1m24s" (medir a velocidade da esposa é vigilância disfarçada de gamificação); painel "o app aprendeu com você" (vende feature que não existe — manter só "no próximo mês chegam prontas"); animação "breathe".
- A "tela final de revisão" prometida na auditoria §1.2 não foi entregue — junto com o C7, deixa o fluxo sem fechamento de correção.

### Service worker (Felix — menores, nenhum bloqueia)
Cache cresce sem limite (nome fixo `planejador-v1`, assets de cada deploy acumulam); sem handler de erro de lazy-chunk pós-deploy (clássico Vite+SPA); borda offline com `respondWith(undefined)` → TypeError; "offline" só funciona após uma visita completa (APP_SHELL não inclui bundles hasheados) — o doc vende offline sem essa nota.

### Dados legados e código morto (Pax)
- **MigrationMDW:** se a migração já rodou, existe um estrato de dados legados com `titular` = string do cartão (`MigrationMDW.tsx:381`), `cardNumber: null` e `date` = vencimento — poluindo agrupamento por titular e fatura por mês **hoje**. Corrigir os dados migrados vem antes de remover o código.
- **Projetos está vivo e integrado** (rota + menu + painel no Dashboard + coluna no import + PDF): remover é cirurgia em 5+ pontos, não "apagar página morta". **FamilyView é o único morto de verdade** (exportado, importado por ninguém). Pluggy: dormência provável, fonte única (declaração do dono citada pela auditoria) — confirmar no banco.
- Fricção que ninguém pegou: no hábito só-fatura, `savingsRate = totalBalance/totalEntries` (`computeReportData.ts:150`) é matematicamente sem sentido se as receitas não entram por algum caminho — "taxa de poupança em tela" (§6.1) só faz sentido depois de decidir **como receitas entram**.

### Arquitetura/operação (Nolan)
- Gate do Vex não é nomeado como pré-condição para qualquer credencial de escrita em produção financeira.
- Watcher de `inbox/` sem log/alerta/heartbeat = faturas "importadas" que nunca entraram (precedente nosso: gateway caiu em silêncio).
- Quem mantém o segundo parser — o maior custo recorrente escondido do D2b — não é decidido.
- Rollback de escrita errada do Extrator no mês aberto: sem resposta.
- O Consultor de Fechamento não tem dono no nosso roster hoje (ver casting).

---

## 4. REPRIORIZA

1. **§2.1 permanece nº 1** — com a matriz console→severidade abaixo (a verificação do console é a maior alavanca de informação do pacote inteiro e custa 5 minutos).
2. **§2.2: CRÍTICO → HIGH condicional** (MÉDIO se o secret não estiver no Cloudflare). **§2.3: CRÍTICO → HIGH** (vetor real = backup; manter o fix). **§2.4:** severidade acoplada à matriz; o fix certo é sign-up project-wide no console (grátis, imediato).
3. **Robustez do fluxo da esposa (C2, C3, C4, C1, undo) sobe para antes de qualquer polish visual.** Confiança é o produto; esses são os cenários que a fazem desistir no primeiro tropeço.
4. **Validação do total da fatura no preview vira o item nº 1 da Fase 2** (era recomendação menor da auditoria §3.12): pega truncamento, linhas perdidas pela IA, duplicatas e falsos negativos de uma vez — maior redutor de desconfiança por hora investida.
5. **Unificação das metas (§3.3) sobe** — é o caso mais concreto de "o painel mente" que independe de hábito de importação.
6. **Hash de dedupe como especificado: não implementar** — redesenhar (substituição de fatura, ou hash com `purchaseDate` + ordinal intra-arquivo + cartão no hash). **`kind` encolhe** conforme a resposta sobre hábito de importação.
7. **Dados legados do MigrationMDW** (se a migração rodou): corrigir antes de qualquer painel novo.
8. **D2 divide:** D2a (Consultor read-only) mantém-se na Fase 3, após números confiáveis; **D2b (Extrator) sai de "decidido" e vira hipótese pós-Fase 2**, condicionada a: 1–2 ciclos reais da Fase 1 + medição da fricção remanescente + desenho via endpoint autenticado do app (não Admin SDK) + Vex GREEN.
9. **`.tnum` nas tabelas existentes no mesmo commit da troca de fonte** — a regressão está viva na branch.
10. Adiar sem culpa: heatmap sequencial, zebra de tabelas, seções de Settings — nada disso compete com os itens acima.

### Matriz console → severidade do §2.1 (Vex)

| Estado das rules em produção | Severidade | Consequência |
| --- | --- | --- |
| `allow read, write: if true` (modo teste) | **CRÍTICO confirmado** | Base financeira inteira legível/gravável por qualquer um com o `firebaseConfig` do bundle público. Deploy das rules corrigidas = urgência nº 1. |
| `allow read, write: if request.auth != null` | **CRÍTICO** (via cadeia com §2.4) | Qualquer conta auto-registrada (REST ou Google) lê/grava tudo. Fechar sign-up mitiga na hora. |
| Estritas por dono + carve-out para `categorizationSessions` | **MÉDIO** | "Já resolvido, mas não auditável" — comparar carve-out com as rules da branch e migrar. |
| Estritas por dono, sem carve-out | Impossível | O fluxo público da esposa não funcionaria — se aparecer isso, o diagnóstico está errado em outro lugar. |

**Verificar no mesmo passo:** (a) Authentication → Settings → User actions: sign-up habilitado? (b) provedores ativos; (c) Cloudflare Pages → Environment variables: `ANTHROPIC_API_KEY` e `PLUGGY_*` existem?

---

## 5. Vereditos formais

### Firestore rules propostas — **YELLOW** (Vex). Condições para GREEN:
1. `allow list: if request.auth != null && resource.data.userId == request.auth.uid;` (linha 39).
2. Expiração também na **leitura** das subcoleções `transactions`/`categories` (o `get` do doc da sessão pode ficar aberto para a mensagem amigável de "expirou").
3. Validação de tipo/valor no update público (`categoryId` string-ou-null com limite, `notes` com limite, `categorizedCount` int entre 0 e `transactionIds.size()`); avaliar tirar `applied` da allow-list pública.
4. Cleanup real das subcoleções (TTL sozinho não basta) — pode ser fase seguinte.

**Plano de validação exigido antes de qualquer deploy:** (1) snapshot das regras atuais do console em `docs/rules-producao-YYYY-MM-DD.txt` (rollback); (2) emulador local + `@firebase/rules-unit-testing` com a matriz de casos do parecer do Vex — zero contato com produção; (3) só então `firebase deploy --only firestore:rules` + smoke test manual, de preferência sem sessão ativa da esposa; (4) **o preview do Cloudflare NÃO é staging** — aponta para produção.

### Fase 1 como está — **FAIL no gate da Vera** (6 HIGH; régua do SOP-005 reprova com 3+).
Condições de re-gate: C2/erro de escrita, undo robusto (≥8s, alvo ≥44px, e/ou lista "últimos categorizados"), token `ink-3`, foco visível sólido, bottom-sheet acessível, `.tnum` nas 12 telas legadas (ou aceite explícito do Guilherme da janela de desalinhamento). Re-gate em aparelho real com screenshots — esta análise foi estática por restrição de produção.

### Verificação mecânica (Felix)
`npx tsc -b --noEmit`: **0 erros** · `npm run build`: **OK** ("✓ built in 4.38s") · `npm run lint`: **24 erros + 2 warnings, todos pré-existentes em arquivos fora da branch** (o doc da branch afirma só tsc+build limpos — correto; mas CI com lint quebraria hoje).

### Casting D2 (Nolan)
| Papel | Recomendação |
| --- | --- |
| Extrator (se D2b sobreviver) | **Mack constrói; nenhum agente em runtime** (código determinístico + tarefa agendada; Silas consulta no desenho do contrato de dados). Não justifica contratação. |
| Consultor de Fechamento | **Faseado:** começar sem contratar — skill `planejador-fechamento-*` + runner headless guard-gated (padrão exato do diário/WS-004); rodar 1–2 fechamentos reais; **depois** contratar 1 especialista de finanças familiares via SOP-001 (padrão Priscila/Asclépio), com material concreto para o brief. |

---

## 6. Ordem de implementação recomendada pelo time

Difere das 5 fases propostas. Pré-requisito de tudo: **as respostas do Guilherme** (seção 7) — várias severidades e o escopo da Fase 2 dependem delas.

**Etapa A — Verificações de 5 minutos (Guilherme, antes de qualquer código):**
console do Firebase (texto das rules de produção + sign-up + provedores) e Cloudflare (env vars). Muda a severidade de §2.1/§2.2/§2.4 e pode transformar a Fase 0 em incêndio ou em burocracia.

**Etapa B — Correções NESTA branch, antes do merge do PR #25:**
1. Rules YELLOW→GREEN (3 correções de linha) + correções do checklist Fase 0 (snapshot/rollback, emulador, sign-up project-wide).
2. C2 (try/catch + estado de erro visível), C3+C4 (apply resiliente a doc apagado + chunking nos 2 batches da sessão), C1 (expiração estendida por atividade + visibilidade de sessão expirada-parcial), C7/undo robusto.
3. `.tnum` nas colunas numéricas das 12 telas legadas; focus ring sólido; `ink-3`; bottom-sheet acessível.
4. Corrigir `PLANO-DE-MELHORIAS.md:11` (afirmação stale) e as promessas do protótipo (cortar confetti/cronômetro/"aprendeu").
5. Re-gate da Vera (aparelho real) → **então** merge do PR #25.

**Etapa C — Fase 0 em produção (Guilherme executa, time acompanha):**
backup → snapshot das rules atuais → emulador → deploy das rules GREEN → smoke test → sign-up OFF project-wide → TTL + rotina de limpeza de subcoleções. Se houver backups exportados antigos: rotacionar a chave Anthropic.

**Etapa D — Fase 1 na vida real:** teste real da esposa no celular (o objetivo nº 1 só se valida assim); medir onde ela tropeça; chip da conta no card.

**Etapa E — Fase 2 redesenhada:** 1º validação de total da fatura no preview; 2º unificação das metas (§3.3); 3º kit de teste do parser com 2–3 faturas reais (local, nada commitado — kit pronto no parecer da Pax, 13 casos); 4º dedupe por substituição de fatura (ou hash redesenhado); 5º `kind` conservador conforme hábito confirmado; 6º correção dos dados legados do MigrationMDW (se a migração rodou).

**Etapa F — Fases 3/4 + D2a:** telas/gráficos consumindo o tema (corrigir os 2 consumidores que o violam + paleta de categorias — gap de design-system para a Iris), remoção de código morto confirmado (FamilyView já; Pluggy/Projetos conforme respostas), Consultor de Fechamento como skill+runner.

**D2b (Extrator):** hipótese adormecida — só volta com medição de fricção pós-Fase 1 + desenho via endpoint do app + Vex GREEN.

---

## 7. Perguntas ao Guilherme (bloqueiam severidades e escopo)

**Verificações de console (5 min, maior alavanca do pacote):**
1. Texto integral das regras do Firestore em produção hoje (console → Firestore Database → Rules — colar texto, sem screenshot de dados).
2. `ANTHROPIC_API_KEY` (e `PLUGGY_*`) estão como secrets no Cloudflare Pages?
3. Sign-up habilitado no Firebase Auth (Settings → User actions)? Quais provedores ativos? Vocês entram por Google, e-mail/senha, ou ambos?

**Hábito real (define o escopo da Fase 2):**
4. Importam extrato da conta corrente ou só faturas de cartão? E as receitas (salário) — entram manualmente, por extrato, ou não entram?
5. A migração do "Meu Dinheiro" (MigrationMDW) já rodou? Pluggy foi usado alguma vez? A página Projetos é usada (há transações com projeto)?
6. Metas: vocês definem meta em categoria-pai E numa sub dela ao mesmo tempo?
7. Costumam re-importar a mesma fatura? Quais bancos/formatos reais (calibra o kit de teste)? A linha "pagamento recebido" costuma aparecer no preview de importação?
8. Existem arquivos de backup exportados por aí (Drive/e-mail/disco)? Cada um contém a chave Anthropic e credenciais Pluggy em texto plano — se sim, rotacionar a chave após a Fase 0.

**Decisões de produto (só suas):**
9. **Fonte mono→sans:** o time confirma que a "mono" nunca carregou (o app rodava em Courier de fallback) e que a sans com `tabular-nums` é tecnicamente a troca certa — mas a identidade "terminal" é sua. Mantém a sans (com `.tnum` obrigatório nas tabelas no mesmo commit) ou quer avaliar uma mono de verdade via `@font-face`?
10. Quantas faturas/mês e quantos minutos custa o upload manual hoje? (É o número que decide se o Extrator D2b vive ou morre.)
11. Staging Firebase separado (D3): sim ou não? (Nenhuma credencial de escrita local deveria existir antes dessa resposta.)
12. Consultor de Fechamento: especialista nomeado no time, ou basta o padrão skill+runner do diário? (Recomendação: faseado — runner primeiro, contratação depois de 2 ciclos.)
13. O fechamento mensal pode ser disparo manual seu (1 clique) em vez de cron? (Elimina a dependência de máquina ligada.)

---

*Pareceres completos dos especialistas disponíveis na sessão de revisão do myPKA. Este arquivo é a consolidação oficial; em caso de divergência de detalhe, vale a evidência `arquivo:linha` citada aqui.*
