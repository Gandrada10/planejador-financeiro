# Planejador Financeiro Familiar

App React + TypeScript + Vite sobre Firebase (Auth + Firestore), uso familiar
por duas pessoas. Importa extratos e faturas, categoriza, e monta painéis de
controle financeiro. Deploy no Cloudflare Pages a partir do `master`.

## Comandos

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build   <- rode antes de qualquer push
npm run lint       # eslint
npx tsc -b         # só o typecheck
```

Não há suíte de testes de `src/`. **Validação é `tsc -b` + `eslint` + `build`**,
mais verificação contra dados reais quando a mudança mexe em regra de negócio
(ver "Como validar mudança de regra").

`eslint` acusa um erro pré-existente em `InvoiceTransactionList.tsx:205`
(`SortIcon` criado durante o render). Não é regressão — confira contra o
`master` antes de atribuir a si mesmo.

## Modelo de dados

Firestore, tudo sob `users/{uid}/`: `transactions`, `categories`,
`categoryRules`, `accounts`, `familyMembers`, `titularMappings`,
`billingCycles`, `projects`, `budgets`. Regras em `firestore.rules`: só o dono
lê e escreve.

### As duas datas de uma transação — a maior fonte de bug do projeto

| campo | num lançamento de cartão | num extrato de conta |
|---|---|---|
| `date` | **vencimento da fatura** — igual para todas as linhas do mês | data do lançamento |
| `purchaseDate` | **data da compra** — identifica a cobrança | igual a `date` |

Cruzar as duas é o erro clássico: "compra feita no dia 20/08" e "fatura que
vence em 20/08" não são a mesma coisa. Numa fatura, **só `purchaseDate`
identifica a linha**. Já custou duas rodadas de bug (PRs #52 e #55).

E o banco **repete a data da compra original em toda parcela seguinte**: a
`Parcela 5 de 6` de agosto tem a mesma descrição, mesmo valor e mesma data da
`Parcela 4 de 6` de julho. O que as distingue é `installmentNumber`.

## Importação (`src/components/transactions/ImportModal.tsx`)

Três caminhos, com critérios de duplicata **deliberadamente diferentes**:

| origem | chave natural | função |
|---|---|---|
| OFX (conta corrente) | FITID + conta + valor | `isOfxDuplicate` |
| Wise (moeda estrangeira) | TransferWise ID + conta (valor **fora**: o BRL é recalculado pelo `fxLedger`) | `findFxDuplicate` |
| Fatura de cartão (via IA) | conta + data da compra + valor + parcela — **descrição fora** | `invoiceLineMatches` |
| Extrato via IA | + descrição tolerante a truncamento | `statementLineMatches` |

Numa fatura a descrição é o campo **menos** confiável: a leitura por IA não é
determinística e transcreve a mesma linha de formas diferentes a cada
importação (`"ZIG*ZIGPAY"` e `"Zig* *Zigpay"`). Não a use como discriminador ali.

`markDuplicates` **conta ocorrências** em vez de perguntar "existe alguma
igual?": a fatura repete cobranças legítimas (duas passagens de metrô de
R$ 7,90 no mesmo dia são duas linhas). Cada transação gravada explica no
máximo uma linha do arquivo.

Duplicatas entram **desmarcadas** no preview. Um critério frouxo demais não
gera erro visível — ele some com lançamentos em silêncio, e a fatura fecha
abaixo do que o banco cobrou.

## Categorização (`src/lib/categoryRules.ts`)

- A regra se prende **só à descrição**. Não há vínculo com conta, cartão ou
  titular em lugar nenhum.
- Vence a regra **mais específica** (a que exige mais texto), não a primeira.
- `normalizeForMatch` trata pontuação como espaço — a mesma cobrança sai com
  pontuação diferente conforme a fonte.
- `matchScore` lê os curingas (`*` de borda) no token **cru**, antes de
  normalizar. Normalizar primeiro faria o `*` virar espaço e toda regra
  ancorada passaria a casar por substring, em silêncio.
- `suggestRulePattern` limpa a descrição antes de virar padrão (CNPJ, número de
  loja, data, marcador de parcela). Nunca corta palavras — quem cria revisa num
  campo editável.
- **Regras só são aplicadas na importação**, nunca retroativamente. Regra
  criada depois do import não alcança o que já está gravado.
- `findRuleForDescription` é a única definição de "mesmo padrão". Não recrie a
  comparação com `pattern.toLowerCase()` nas telas.

## Totais e ciclos de fatura

- `countsInTotals` (`src/lib/utils.ts`): lançamento **sem categoria conta nos
  totais**. Um pagamento de fatura sem categoria vira despesa e dobra o gasto
  do cartão. Pagamento de fatura e transferência entre contas próprias devem
  ficar numa categoria com `excludeFromTotals`.
- `CreditCardPage` agrupa por `familyMember` (nome canônico), caindo para
  `titular` só em dados legados. `titular` passa por `normalizeTitular` e
  deforma nomes.
- `previousBalance` só puxa saldo do mês anterior **se o ciclo daquele mês
  existir**. Criar um ciclo antigo estende a cascata para trás — feche do mais
  antigo para o mais novo.
- "Parcelas futuras" conta **linhas** desta fatura com
  `installmentNumber < totalInstallments`, não parcelas a vencer.

## Como validar mudança de regra de negócio

`tsc` e `build` não pegam erro de critério. O que pega: rodar a função contra
dados reais. O padrão usado nos PRs #52–#56:

1. Extrair as funções **verbatim** do arquivo para um `.ts` temporário.
2. `npx esbuild arquivo.ts --bundle --format=esm --platform=node` .
3. Rodar contra um backup real (Configurações → Backup e Restauração) e contra
   o XLSX da fatura.
4. Medir os **dois** sentidos: quantos falsos positivos e quantos falsos
   negativos. Um critério de duplicata erra nas duas direções.

Um backup real tem ~5.000 transações e é a melhor fixture do projeto.

**O backup inclui a chave da API Anthropic** (`src/lib/backup.ts`, de
propósito, para restaurar o app inteiro). Se alguém anexar um backup numa
conversa, avise para rotacionar a chave.

## Convenções de código

- **Comentários em português explicando o PORQUÊ**, não o quê — quase sempre
  ancorados no bug que motivou a decisão. É a convenção mais forte do
  repositório; siga-a. Veja `categoryRules.ts` e `ImportModal.tsx`.
- Mensagens de commit e PR em português, no formato `tipo(escopo): descrição`.
- Documentos de investigação vão em `docs/` (ver `AUDITORIA-2026-07.md`,
  `CONCILIACAO-FATURA-2026-08.md`).

## Git e deploy

- **`master` é protegido**: exige o check "Cloudflare Pages". Push direto é
  recusado — o caminho é branch → PR → check verde → merge.
- O check verde no PR é o build de **preview** da branch. O build de
  **produção** só roda no merge para `master`, e já travou por horas sem
  publicar. Confirme o deployment de produção antes de dizer que está no ar.
- O app tem service worker (`public/sw.js`). Depois de publicar, `Ctrl+Shift+R`
  — senão o navegador segue no bundle antigo, e o comportamento observado será
  o do código velho.

## O que este app NÃO tem

- Nenhuma ação de "aplicar as regras aos lançamentos já existentes".
- Nenhuma sugestão de categoria por histórico do estabelecimento (medido:
  cobriria 60% dos lançamentos sem categoria; decidido não implementar por ora).
- Nenhum teste automatizado de `src/`. `tests/` cobre só as regras do Firestore.
