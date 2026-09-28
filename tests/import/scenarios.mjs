// Cenários da caracterização. Cada um devolve um valor serializável (via
// `canon`) que é gravado uma vez a partir do master (golden.json) e comparado
// a cada rodada contra a árvore de trabalho.
import { mountImport, withBrowserFakes, settle, canon } from './driver.mjs';
import * as F from './fixtures.mjs';

const { d, tx, item } = F;

const baseProps = {
  accounts: F.accounts,
  accountNames: F.accountNames,
  categories: F.categories,
  titularNames: F.titularNames,
  allTitulars: [],
  matchCategory: F.matchCategory,
};

function snapshot(ui, calls) {
  return canon({
    step: ui.get('step'),
    error: ui.get('error'),
    importKind: ui.get('importKind'),
    isCreditCard: ui.get('isCreditCard'),
    billingMonth: ui.get('billingMonth'),
    billingDueDay: ui.get('billingDueDay'),
    declaredTotal: ui.get('declaredTotal'),
    detectedAccount: ui.get('detectedAccount'),
    rows: ui.get('items'),
    selected: [...ui.get('selected')].sort((a, b) => a - b),
    onImport: ui.captured.onImport,
    onSaveFxWallet: ui.captured.onSaveFxWallet,
    fetchCalls: calls,
  });
}

async function runAi(loaded, { ai, existing, fileName = 'fatura-sintetica.csv', props = {}, before }) {
  return withBrowserFakes(ai, async (calls) => {
    const ui = mountImport(loaded, { ...baseProps, existingTransactions: existing, ...props });
    // CSV qualquer com mais de 50 caracteres: o conteúdo não importa, a
    // "IA" responde com `ai` de qualquer jeito.
    await ui.drop(new File(['data;descricao;valor\n' + 'x'.repeat(80)], fileName));
    const preview = snapshot(ui, calls);
    if (before) await before(ui);
    await ui.clickImport();
    return { preview, afterImport: snapshot(ui, calls) };
  });
}

export const componentScenarios = {
  // A: fatura com os casos de duplicata, parcela e reembolso; mês e dia vindos
  // do próprio arquivo e do cadastro do cartão.
  'A1 fatura: dedupe por data da compra, contagem, parcelas, reembolso': (L) =>
    runAi(L, { ai: F.invoiceAi, existing: F.invoiceExisting }),

  // A2: o usuário troca o mês de pagamento e digita dia 31 em fevereiro (trava
  // no último dia) e seleciona tudo, inclusive as duplicatas.
  'A2 fatura: mês trocado, dia 31 em fevereiro, tudo selecionado': (L) =>
    runAi(L, {
      ai: F.invoiceAi, existing: F.invoiceExisting,
      before: async (ui) => {
        await ui.set('billingMonth', '2026-02');
        await ui.set('billingDueDay', '31');
        await ui.set('selected', new Set(ui.get('items').map((_, i) => i)));
      },
    }),

  // A3: parcelas futuras na fatura (o editor de parcelas da tela muda
  // installmentType/periodicidade/valor da linha; aqui isso é feito direto no
  // estado, como `updateInstallmentConfig` faria). Vencimento em 31/01 força
  // a virada de mês do setMonth.
  'A3 fatura: parcelas futuras, periodicidade 1 e 2, vencimento dia 31': (L) =>
    runAi(L, {
      ai: F.invoiceAi, existing: F.invoiceExisting,
      before: async (ui) => {
        await ui.set('billingMonth', '2026-01');
        await ui.set('billingDueDay', '31');
        await ui.set('items', ui.get('items').map((r, i) => {
          if (i === 3) return { ...r, installmentType: 'parcelada', periodicity: 1 };
          if (i === 4) return { ...r, installmentType: 'parcelada', periodicity: 2, installmentAmount: -49.5 };
          return r;
        }));
      },
    }),

  'A4 fatura: titular desconhecido trava a gravação': (L) =>
    runAi(L, { ai: F.invoiceAiUnknownTitular, existing: F.invoiceExisting }),

  // A5: cartão detectado pela heurística do número do cartão, sem descritor:
  // um só cartão cadastrado recebe o lote.
  'A5 fatura: heurística de cartão, cartão único': (L) =>
    runAi(L, {
      ai: F.invoiceAiHeuristic, existing: [],
      props: { accounts: F.accounts.filter((a) => a.name !== 'Cartão Beta') },
    }),

  // B: extrato via IA — descrição volta ao critério; parcelas futuras
  // automáticas; sem mês de fatura.
  'B1 extrato via IA: critério com descrição, parcelas futuras automáticas': (L) =>
    runAi(L, { ai: F.statementAi, existing: F.statementExisting, fileName: 'extrato-sintetico.xlsx' }),

  'C1 OFX: FITID+conta+valor, FITID reciclado, reserva por valor': (L) =>
    withBrowserFakes(null, async (calls) => {
      const ui = mountImport(L, { ...baseProps, existingTransactions: F.ofxExisting });
      await ui.drop(new File([F.ofxText], 'extrato-sintetico.ofx'));
      const preview = snapshot(ui, calls);
      await ui.clickImport();
      return { preview, afterImport: snapshot(ui, calls) };
    }),

  'D1 moeda estrangeira: carteira que continua, dedupe por id sem valor': (L) =>
    withBrowserFakes(null, async (calls) => {
      const ui = mountImport(L, { ...baseProps, existingTransactions: F.wiseExisting, fxWallets: F.wiseWallets });
      await ui.drop(new File([F.wiseCsv], 'wise-sintetico.csv'));
      await settle();
      const preview = snapshot(ui, calls);
      await ui.clickImport();
      return { preview, afterImport: snapshot(ui, calls) };
    }),
};

// ─── Funções puras: mesmos argumentos, resultado fixado ────────────────────
const e = [
  tx({ id: 'e1', date: d('2026-08-10'), purchaseDate: d('2026-07-20'), description: 'ZIG*ZIGPAY', amount: -30, account: 'Cartão Alfa' }),
  tx({ id: 'e2', date: d('2026-08-10'), purchaseDate: d('2026-07-20'), description: 'Zig* *Zigpay', amount: -30, account: 'Cartão Alfa' }),
  tx({ id: 'e3', date: d('2026-08-10'), purchaseDate: d('2026-07-01'), description: 'LOJA', amount: -83.64, account: 'Cartão Alfa', installmentNumber: 4, totalInstallments: 6, categoryId: 'cat-lazer' }),
  tx({ id: 'e4', date: d('2026-08-10'), purchaseDate: null, description: 'Manual', amount: -15, account: 'Cartão Alfa' }),
  tx({ id: 'e5', date: d('2026-08-12'), description: 'RESGATE CDB', amount: 100, account: 'Conta Gama', fitid: 'BB1' }),
  tx({ id: 'e6', date: d('2026-08-13'), description: 'Cafe', amount: -50, account: 'Conta Wise', fitid: 'W1' }),
];

const ledger = {
  movements: [
    { entry: { id: 'W1', date: d('2026-08-02'), description: 'Cafe', amountFx: -20, isConversion: false, isTransfer: false }, amountBrl: -120.004, rate: 6.0002 },
    { entry: { id: 'W2', date: d('2026-08-05'), description: 'Hotel Teste', amountFx: -100, isConversion: false, isTransfer: false }, amountBrl: -612.345, rate: 6.12345 },
  ],
  conversions: [
    { entry: { id: 'W0', date: d('2026-08-01'), description: 'Converted', amountFx: 500, isConversion: true, isTransfer: true }, amountBrl: 3000, rate: 6 },
  ],
};

export const pureCases = {
  datesMatch: (f) => [
    f.datesMatch(d('2026-08-10'), new Date('2026-08-10T23:59:00')),
    f.datesMatch(d('2026-08-10'), d('2026-08-11')),
    f.datesMatch(null, d('2026-08-10')),
    f.datesMatch(null, null),
  ],
  anyDatePairMatches: (f) => [
    f.anyDatePairMatches(e[0], item({ date: d('2026-07-20'), amount: -30 })),
    f.anyDatePairMatches(e[0], item({ date: d('2026-09-01'), purchaseDate: d('2026-08-10'), amount: -30 })),
    f.anyDatePairMatches(e[0], item({ date: d('2026-09-01'), purchaseDate: d('2026-09-02'), amount: -30 })),
  ],
  installmentKey: (f) => [
    f.installmentKey({ installmentNumber: 5, totalInstallments: 6 }),
    f.installmentKey({ installmentNumber: null, totalInstallments: 6 }),
    f.installmentKey({ installmentNumber: 0, totalInstallments: 0 }),
  ],
  descriptionCore: (f) => ['ZIG*ZIGPAY', 'Zig* *Zigpay', 'Loja 05/06', 'Café São João', ''].map((s) => f.descriptionCore(s)),
  descriptionsCompatible: (f) => [
    ['ELUBEL INDUSTRIA', 'Elubel Industria Ecotia'],
    ['ABC', 'ABCD'],
    ['ABCDEF', 'ABCDEFGH'],
    ['ABCDE', 'ABCDEFGH'],
    ['', ''],
    ['', 'X'],
    ['ZIG*ZIGPAY', 'Zig* *Zigpay'],
    ['Padaria Sol', 'Mercado Sol'],
  ].map(([a, b]) => f.descriptionsCompatible(a, b)),
  DESC_CORE_MIN: (f) => f.DESC_CORE_MIN,
  accountsCompatible: (f) => [['A', 'A'], ['A', 'B'], ['', 'B'], ['A', ''], ['', '']].map(([a, b]) => f.accountsCompatible(a, b)),
  statementLineMatches: (f) => [
    f.statementLineMatches(item({ date: d('2026-07-20'), description: 'zigzigpay', amount: -30, account: 'Cartão Alfa' }), e[0]),
    f.statementLineMatches(item({ date: d('2026-07-20'), description: 'zigzigpay', amount: -30.009, account: 'Cartão Alfa' }), e[0]),
    f.statementLineMatches(item({ date: d('2026-07-20'), description: 'zigzigpay', amount: -30.01, account: 'Cartão Alfa' }), e[0]),
    f.statementLineMatches(item({ date: d('2026-07-20'), description: 'zigzigpay', amount: -30, account: 'Cartão Beta' }), e[0]),
    f.statementLineMatches(item({ date: d('2026-08-10'), purchaseDate: d('2026-07-01'), description: 'LOJA', amount: -83.64, account: 'Cartão Alfa', installmentNumber: 5, totalInstallments: 6 }), e[2]),
    f.statementLineMatches(item({ date: d('2026-08-10'), purchaseDate: d('2026-07-01'), description: 'LOJA', amount: -83.64, account: 'Cartão Alfa' }), e[2]),
  ],
  invoiceLineMatches: (f) => [
    // descrição fora do critério quando as duas datas de compra existem
    f.invoiceLineMatches(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-20'), description: 'OUTRA COISA', amount: -30, account: 'Cartão Alfa' }), e[0]),
    // compra em 10/08 NÃO casa com lançamento que VENCE em 10/08
    f.invoiceLineMatches(item({ date: d('2026-08-10'), purchaseDate: d('2026-08-10'), description: 'ZIG', amount: -30, account: 'Cartão Alfa' }), e[0]),
    // parcela diferente não casa
    f.invoiceLineMatches(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-01'), description: 'LOJA', amount: -83.64, account: 'Cartão Alfa', installmentNumber: 5, totalInstallments: 6 }), e[2]),
    f.invoiceLineMatches(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-01'), description: 'LOJA', amount: -83.64, account: 'Cartão Alfa', installmentNumber: 4, totalInstallments: 6 }), e[2]),
    // parcela declarada de um lado só: chaves diferentes, não casa
    f.invoiceLineMatches(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-01'), description: 'LOJA', amount: -83.64, account: 'Cartão Alfa' }), e[2]),
    // reserva sem data de compra: date + descrição
    f.invoiceLineMatches(item({ date: d('2026-08-10'), purchaseDate: d('2026-08-01'), description: 'MANUAL', amount: -15, account: 'Cartão Alfa' }), e[3]),
    f.invoiceLineMatches(item({ date: d('2026-08-10'), purchaseDate: d('2026-08-01'), description: 'OUTRO', amount: -15, account: 'Cartão Alfa' }), e[3]),
    // conta vazia do lado do arquivo aceita
    f.invoiceLineMatches(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-20'), description: 'X', amount: -30, account: '' }), e[0]),
    // valor positivo (estorno) não casa com negativo
    f.invoiceLineMatches(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-20'), description: 'X', amount: 30, account: 'Cartão Alfa' }), e[0]),
  ],
  categoryFromPreviousInstallment: (f) => [
    f.categoryFromPreviousInstallment(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-01'), amount: -83.64, account: 'Cartão Alfa', installmentNumber: 5, totalInstallments: 6 }), e),
    f.categoryFromPreviousInstallment(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-01'), amount: -83.64, account: 'Cartão Alfa', installmentNumber: 4, totalInstallments: 6 }), e),
    f.categoryFromPreviousInstallment(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-01'), amount: -83.64, account: 'Cartão Alfa' }), e),
    f.categoryFromPreviousInstallment(item({ date: d('2026-09-10'), purchaseDate: d('2026-07-01'), amount: -83.64, account: 'Cartão Alfa', installmentNumber: 5, totalInstallments: 6 }),
      [...e, tx({ id: 'e7', date: d('2026-06-10'), purchaseDate: d('2026-07-01'), amount: -83.64, account: 'Cartão Alfa', installmentNumber: 3, totalInstallments: 6, categoryId: 'cat-casa' })]),
  ],
  markDuplicates: (f) => {
    const items = [
      item({ date: d('2026-09-10'), purchaseDate: d('2026-07-20'), description: 'a', amount: -30, account: 'Cartão Alfa' }),
      item({ date: d('2026-09-10'), purchaseDate: d('2026-07-20'), description: 'b', amount: -30, account: 'Cartão Alfa' }),
      item({ date: d('2026-09-10'), purchaseDate: d('2026-07-20'), description: 'c', amount: -30, account: 'Cartão Alfa' }),
    ];
    return [
      f.markDuplicates(items, e, f.invoiceLineMatches, 'fatura'),
      f.markDuplicates(items, [], f.invoiceLineMatches, 'fatura'),
      f.markDuplicates(items, e, f.statementLineMatches, 'valor'),
    ];
  },
  findDuplicate_isDuplicate: (f) => {
    const it = item({ date: d('2026-08-10'), description: 'Manual', amount: -15, account: 'Cartão Alfa' });
    const no = item({ date: d('2026-08-11'), description: 'Manual', amount: -15, account: 'Cartão Alfa' });
    return [f.findDuplicate(it, e)?.id ?? null, f.isDuplicate(it, e), f.findDuplicate(no, e), f.isDuplicate(no, e)];
  },
  isOfxDuplicate: (f) => [
    f.isOfxDuplicate(item({ date: d('2026-09-01'), description: 'x', amount: 100, account: 'Conta Gama', fitid: 'BB1' }), e),
    f.isOfxDuplicate(item({ date: d('2026-09-01'), description: 'x', amount: 250, account: 'Conta Gama', fitid: 'BB1' }), e),
    f.isOfxDuplicate(item({ date: d('2026-09-01'), description: 'x', amount: 100, account: 'Conta Delta', fitid: 'BB1' }), e),
    f.isOfxDuplicate(item({ date: d('2026-08-12'), description: 'Resgate CDB', amount: 100, account: '', fitid: 'BB1' }), e),
    f.isOfxDuplicate(item({ date: d('2026-08-12'), description: 'Resgate CDB', amount: 100, account: 'Conta Gama', fitid: null }), e),
  ],
  findFxDuplicate: (f) => [
    f.findFxDuplicate(item({ date: d('2026-09-01'), description: 'x', amount: -999, account: 'Conta Wise', fitid: 'W1' }), e),
    f.findFxDuplicate(item({ date: d('2026-08-13'), description: 'Cafe', amount: -50, account: 'Conta Wise', fitid: 'W9' }), e),
    f.findFxDuplicate(item({ date: d('2026-08-14'), description: 'Cafe', amount: -50, account: 'Conta Wise', fitid: 'W9' }), e),
    f.findFxDuplicate(item({ date: d('2026-08-13'), description: 'Cafe', amount: -50, account: '', fitid: 'W1' }), e),
  ],
  normalizeBankId: (f) => ['0341', '  001 ', '000', '', null, '260'].map((x) => f.normalizeBankId(x)),
  stripAccents: (f) => ['Itaú Açúcar', 'São', 'plain'].map((x) => f.stripAccents(x)),
  OFX_BANK_HINTS: (f) => f.OFX_BANK_HINTS,
  matchOfxAccountName: (f) => {
    const corr = F.accounts.filter((a) => a.type !== 'cartao');
    return [
      f.matchOfxAccountName('0341', corr),
      f.matchOfxAccountName('0001', corr),
      f.matchOfxAccountName('0001', [{ ...corr[0], name: 'Minha BB', bank: 'bb' }]),
      f.matchOfxAccountName(null, [corr[1]]),
      f.matchOfxAccountName('999', corr),
    ];
  },
  matchAccountFromDescriptor: (f) => [
    f.matchAccountFromDescriptor('Fatura Cartao Alfa Platinum final 0000', F.accounts),
    f.matchAccountFromDescriptor('Extrato Conta Delta', F.accounts),
    f.matchAccountFromDescriptor('Conta', F.accounts),
    f.matchAccountFromDescriptor('', F.accounts),
    f.matchAccountFromDescriptor(null, F.accounts),
    f.matchAccountFromDescriptor('Latam Itau', [
      { name: 'Latam Pass', bank: 'Itaú Personalite', type: 'cartao' },
      { name: 'Itaú Personalite', bank: 'Itaú', type: 'corrente' },
    ]),
  ],
  parseDecimalInput: (f) => ['7.124,37', '7124.37', '1,234.56', '', '  ', 'abc', '-12,5', 'R$ 1.000', '1.2.3'].map((x) => f.parseDecimalInput(x)),
  round2: (f) => [1.005, -120.004, 612.345, -0.005, 2.675].map((x) => f.round2(x)),
  buildFxRows: (f) => [
    f.buildFxRows(ledger, 'EUR', true, 'cat-transf', F.matchCategory, e, 'Conta Wise'),
    f.buildFxRows(ledger, '', false, null, undefined, [], ''),
  ],
};

export async function runAll(loadedComponent, pureFns) {
  const out = { components: {}, pure: {} };
  for (const [name, run] of Object.entries(componentScenarios)) out.components[name] = await run(loadedComponent);
  for (const [name, run] of Object.entries(pureCases)) out.pure[name] = canon(run(pureFns));
  return out;
}
