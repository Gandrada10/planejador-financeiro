# Fase 0 — Segurança e integridade: checklist de deploy

Esta branch já **implementa em código** as partes seguras da Fase 0. Alguns
passos, porém, exigem ações no console (Firebase/Cloudflare) que só o dono/time
pode executar — este documento lista o que falta para a proteção ficar completa.

## Já implementado nesta branch (código)
- ✅ **`firestore.rules` versionadas** (raiz do repo) + `firebase.json` — revisão
  GREEN de 2026-07-03 (`list` só do dono, expiração também na leitura das
  subcoleções, validação de tipo/faixa no update público, `applied:true`
  exclusivo do dono; suite de testes em `tests/firestore-rules/`).
- ✅ **Snapshot de rollback das regras EM PRODUÇÃO** colado verbatim em
  `docs/rules-producao-2026-07-03.txt` (não editar — é o registro pré-Fase 0).
- ✅ **Chunking de 400** em `importBatch`/`batchUpdate`/`batchUpdateReconciled` (`src/hooks/useTransactions.ts`) — importações/edições grandes não estouram mais o limite de 500 do Firestore.
- ✅ **Cadastro aberto desligado por padrão** (`src/components/auth/LoginForm.tsx`), atrás do flag `VITE_ALLOW_REGISTRATION`.

## Falta executar (console — não dá para fazer pelo código)

### 1. Publicar as regras do Firestore  ⚠️ prioridade máxima

**Pré-condições, nesta ordem (plano de validação da `REVISAO-RESULTADOS.md` §5):**
1. ✅ Snapshot das regras atuais do console → `docs/rules-producao-2026-07-03.txt` (JÁ FEITO — é o rollback).
2. **Emulador ANTES do deploy:** rodar a suite `tests/firestore-rules/`
   (`npm run test:exec` lá dentro; precisa de JDK 11+ — ver README de lá).
   Zero contato com produção; todos os testes verdes são condição de deploy.
3. Só então:

```bash
firebase login
firebase use <seu-projeto>      # ou: firebase use --add
firebase deploy --only firestore:rules
```

⚠️ **O deploy de rules é imediato e global** — vale para todos os clientes no
instante da publicação, sem janela de propagação para "testar antes". Por isso:
faça o deploy **fora de uma sessão de categorização ativa da esposa** (uma
escrita dela no meio da troca pode ser rejeitada pelas regras novas). Rollback
= colar o conteúdo de `docs/rules-producao-2026-07-03.txt` de volta no console.

Smoke test pós-deploy: o dono lê/grava os próprios dados; um token de sessão
válido permite categorizar; um token expirado não lê mais as transações da
sessão (só a mensagem de "link expirado").

### 2. Desativar o sign-up project-wide (proteção real)
O flag `VITE_ALLOW_REGISTRATION` só esconde a UI, e desabilitar apenas o
provedor Email/Senha **não bloqueia** contas novas via Google ou via REST com a
web API key pública. A proteção de fato é project-wide no console:
**Authentication → Settings → User actions → desativar "Create (sign-up)"**.
Contas existentes seguem funcionando; contas novas podem ser criadas depois
pelo próprio console (Users → Add user). Mantenha `VITE_ALLOW_REGISTRATION`
vazio no ambiente de produção/preview.

### 3. Mover a chave Anthropic para secret do ambiente  (deferido — ver nota)
Hoje a chave vive no `localStorage` e trafega no corpo das requisições às
Functions, que aceitam `apiKey` de qualquer origem. O fim correto é: a chave
vira **secret no Cloudflare** (`ANTHROPIC_API_KEY`), as Functions passam a exigir
um Firebase ID token no header `Authorization` e param de aceitar `apiKey` do
body; o app remove o campo de chave.

**Por que não foi feito nesta branch:** autenticar as Functions e cortar o
`apiKey` do body quebraria a importação e o chat no preview enquanto o secret e
a verificação de token não estiverem no ar — meio-caminho é pior que o estado
atual. É uma mudança acoplada a infraestrutura; recomendo o time implementar
junto com o deploy (código das Functions + secret + verificação de JWT), testável
de uma vez. A auditoria detalha em `AUDITORIA-2026-07.md` §2.2–2.3.

## Observações sobre as regras (revisão GREEN 2026-07-03)
- O `get` do doc `categorizationSessions/{token}` é legível por quem tem o link
  (capability URL) **mesmo expirado** — isso é intencional: o doc só carrega
  metadados e permite a mensagem amigável de "link expirado". Os dados
  financeiros ficam nas subcoleções `transactions`/`categories`, cuja leitura
  pública agora **exige sessão não expirada** (o dono lê sempre — o apply do
  delta pode acontecer depois da expiração).
- A escrita pública é limitada a `categoryId`/`notes`/`applied` (transações) e
  `categorizedCount`/`lastActivityAt` (sessão), só enquanto `expiresAt` é
  futuro, e **validada**: `categoryId` string ≤128 ou null; `notes` string
  ≤500; `categorizedCount` int entre 0 e `transactionIds.size()`;
  `applied` público só aceita `false` (marcar `true` é exclusivo do dono no
  apply — quem tem o token não faz o apply pular itens). `expiresAt` fica fora
  da allow-list pública → ninguém estende o próprio prazo com o token; a
  renovação da janela (o apply estende para `lastActivityAt + 48h`; "reabrir"
  dá +48h) é sempre escrita do **dono autenticado**, permitida pelo caminho
  `isOwner`. A contagem pública usa `increment()` atômico — as rules validam o
  valor RESULTANTE do transform, então o range vale também para incrementos. O
  dono também marca `applied:true + orphaned:true` na subcoleção para consumir
  deltas de transações reais já excluídas (C3); `orphaned` é negado ao público.
- `list` na coleção de sessões exige `resource.data.userId == request.auth.uid`.
  (Correção de registro: a versão anterior deste doc afirmava que "as regras
  não conseguem inspecionar o filtro da query" — **isso é falso**; as rules
  avaliam `list` contra as restrições da query, então a query do hook
  `where('userId','==',uid)` passa e qualquer list sem esse filtro — ou com o
  uid de outro — é negado. Enumeração de tokens por conta autenticada está
  fechada.)
- `create` de sessão exige `request.resource.data.userId == request.auth.uid`
  (forja de sessão em nome de outra conta bloqueada) e tipos corretos de
  `expiresAt`/`transactionIds`; `create`/`delete`/`write` nas subcoleções são
  presos ao **dono da sessão-pai**, não a "qualquer autenticado".
- Falta uma limpeza/TTL das sessões expiradas. Atenção: **o TTL do Firestore
  apaga só o doc da sessão, não as subcoleções** — com o check de expiração na
  leitura elas deixam de ser legíveis pelo público, mas continuam ocupando
  espaço; a rotina de limpeza real das subcoleções fica para a fase seguinte
  (condição 4 do parecer). Recomendado mesmo assim: **TTL policy** no campo
  `expiresAt` da coleção `categorizationSessions` (console → Firestore → TTL).
