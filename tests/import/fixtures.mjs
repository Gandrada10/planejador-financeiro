// Dados SINTÉTICOS da caracterização. Nenhum nome, valor ou descrição vem de
// fatura ou extrato real: tudo aqui foi inventado para exercitar uma regra.

/** Data como o app a monta ao ler a IA: meio-dia local. */
export const d = (iso) => new Date(`${iso}T12:00:00`);

let seq = 0;
/** Transação já gravada (o `existingTransactions` do app). */
export function tx(o) {
  seq += 1;
  return {
    id: o.id ?? `tx-${seq}`,
    date: o.date,
    purchaseDate: o.purchaseDate ?? null,
    description: o.description ?? '',
    amount: o.amount,
    categoryId: o.categoryId ?? null,
    account: o.account ?? '',
    familyMember: '',
    titular: '',
    installmentNumber: o.installmentNumber ?? null,
    totalInstallments: o.totalInstallments ?? null,
    cardNumber: null,
    projectId: null,
    fitid: o.fitid ?? null,
    tags: [],
    notes: '',
    importBatch: null,
    reconciled: false,
    reconciledAt: null,
    createdAt: d('2026-01-01'),
  };
}

/** Linha do lote (ImportItem), para os testes das funções puras. */
export function item(o) {
  const { id: _id, createdAt: _c, ...rest } = tx(o);
  return rest;
}

export const accounts = [
  { id: 'a1', name: 'Cartão Alfa', type: 'cartao', bank: 'Banco Alfa', closingDay: 3, dueDay: 10, createdAt: d('2026-01-01') },
  { id: 'a2', name: 'Cartão Beta', type: 'cartao', bank: 'Banco Beta', closingDay: 20, dueDay: 31, createdAt: d('2026-01-01') },
  { id: 'a3', name: 'Conta Gama', type: 'corrente', bank: 'Itaú', createdAt: d('2026-01-01') },
  { id: 'a4', name: 'Conta Delta', type: 'corrente', bank: 'Banco Delta', createdAt: d('2026-01-01') },
  { id: 'a5', name: 'Conta Wise', type: 'corrente', bank: 'Carteira Euro', createdAt: d('2026-01-01') },
];
export const accountNames = accounts.map((a) => a.name);

export const categories = [
  { id: 'cat-transf', name: 'Transferência', type: 'ambos', parentId: null, excludeFromTotals: true },
  { id: 'cat-mercado', name: 'Mercado', type: 'despesa', parentId: null },
  { id: 'cat-transporte', name: 'Transporte', type: 'despesa', parentId: null },
  { id: 'cat-lazer', name: 'Lazer', type: 'despesa', parentId: null },
  { id: 'cat-casa', name: 'Casa', type: 'despesa', parentId: null },
];

export const titularNames = ['Ana Teste', 'Bruno Teste'];

export function matchCategory(desc) {
  if (/mercado/i.test(desc)) return 'cat-mercado';
  if (/metr[oô]/i.test(desc)) return 'cat-transporte';
  if (/cafe/i.test(desc)) return 'cat-lazer';
  return null;
}

// ─── A: fatura de cartão lida pela "IA" ────────────────────────────────────
export const invoiceAi = {
  isCreditCard: true,
  declaredTotal: -754.96,
  accountDescriptor: 'Fatura Cartao Alfa Platinum final 0000',
  usage: { input_tokens: 10, output_tokens: 20 },
  transactions: [
    // 0: mesma compra já gravada, descrição transcrita diferente → duplicata
    { date: '2026-07-20', purchaseDate: '2026-07-20', description: 'MERCADO BOM PRECO', amount: -150, titular: 'ANA TESTE', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
    // 1 e 2: duas passagens iguais no mesmo dia, uma já gravada → uma duplicata, uma nova
    { date: '2026-07-22', purchaseDate: '2026-07-22', description: 'METRO LINHA', amount: -7.9, titular: 'ANA TESTE', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
    { date: '2026-07-22', purchaseDate: '2026-07-22', description: 'METRO LINHA', amount: -7.9, titular: 'ANA TESTE', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
    // 3: parcela 5/6; a 4/6 do mês anterior tem a mesma data de compra e valor → NÃO é duplicata; herda categoria
    { date: '2026-03-10', purchaseDate: '2026-03-10', description: 'LOJA PARCELADA', amount: -83.64, titular: 'BRUNO TESTE', installmentNumber: 5, totalInstallments: 6, cardNumber: '0000' },
    // 4: dois carnês iguais com categorias diferentes → não herda nada
    { date: '2025-10-20', purchaseDate: '2025-10-20', description: 'CARNE DUPLO', amount: -50, titular: 'BRUNO TESTE', installmentNumber: 3, totalInstallments: 10, cardNumber: '0000' },
    // 5: mesmo valor de um lançamento cujo VENCIMENTO é o dia desta compra → não é duplicata
    { date: '2026-07-20', purchaseDate: '2026-07-20', description: 'UBER VIAGEM', amount: -32.1, titular: 'ANA TESTE', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
    // 6: gravado sem data de compra (digitado à mão) → casa por date + descrição
    { date: '2026-07-25', purchaseDate: '2026-07-25', description: 'ANTIGO DIGITADO', amount: -45, titular: 'ANA TESTE', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
    // 7: igual a um lançamento de OUTRO cartão → não é duplicata
    { date: '2026-07-18', purchaseDate: '2026-07-18', description: 'OUTRO CARTAO', amount: -99.99, titular: 'ANA TESTE', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
    // 8: estorno (valor positivo)
    { date: '2026-07-19', purchaseDate: '2026-07-19', description: 'ESTORNO LOJA', amount: 120, titular: 'ANA TESTE', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
    // 9: marcador de parcela colado na descrição, sem parcela da IA
    { date: '2026-05-02', purchaseDate: '2026-05-02', description: 'SAPATARIA CENTRO   03/05', amount: -60, titular: 'BRUNO TESTE', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
    // 10: sem data de compra na leitura
    { date: '2026-07-28', purchaseDate: null, description: 'SEM DATA COMPRA', amount: -10, titular: 'ana teste', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
    // 11: reembolso de compra no mercado (positivo) com regra de categoria
    { date: '2026-07-21', purchaseDate: '2026-07-21', description: 'MERCADO DEVOLUCAO', amount: 18.35, titular: 'BRUNO TESTE', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
  ],
};

export const invoiceExisting = [
  tx({ date: d('2026-08-10'), purchaseDate: d('2026-07-20'), description: 'Mercado Bom  Preço', amount: -150, account: 'Cartão Alfa', categoryId: 'cat-mercado' }),
  tx({ date: d('2026-08-10'), purchaseDate: d('2026-07-22'), description: 'Metro Linha', amount: -7.9, account: 'Cartão Alfa' }),
  tx({ date: d('2026-07-10'), purchaseDate: d('2026-03-10'), description: 'Loja Parcelada', amount: -83.64, account: 'Cartão Alfa', installmentNumber: 4, totalInstallments: 6, categoryId: 'cat-lazer' }),
  tx({ date: d('2026-07-10'), purchaseDate: d('2025-10-20'), description: 'Carne Duplo A', amount: -50, account: 'Cartão Alfa', installmentNumber: 2, totalInstallments: 10, categoryId: 'cat-lazer' }),
  tx({ date: d('2026-07-10'), purchaseDate: d('2025-10-20'), description: 'Carne Duplo B', amount: -50, account: 'Cartão Alfa', installmentNumber: 2, totalInstallments: 10, categoryId: 'cat-casa' }),
  tx({ date: d('2026-07-20'), purchaseDate: d('2026-06-15'), description: 'GOOGLE ONE', amount: -32.1, account: 'Cartão Alfa' }),
  tx({ date: d('2026-07-25'), purchaseDate: null, description: 'Antigo digitado', amount: -45, account: 'Cartão Alfa' }),
  tx({ date: d('2026-08-31'), purchaseDate: d('2026-07-18'), description: 'Outro Cartao', amount: -99.99, account: 'Cartão Beta' }),
];

// Variante com titular desconhecido: a trava de titular tem de impedir a gravação.
export const invoiceAiUnknownTitular = {
  ...invoiceAi,
  transactions: [
    ...invoiceAi.transactions.slice(0, 3),
    { date: '2026-07-23', purchaseDate: '2026-07-23', description: 'PADARIA X', amount: -12, titular: 'FULANO DE TAL', installmentNumber: null, totalInstallments: null, cardNumber: '0000' },
  ],
};

// Variante sem descritor, sem flag de cartão, mas com número de cartão na maioria
// das linhas (heurística). (Uma data ilegível derruba o render do preview no
// app — `toISOString` de Invalid Date —, então não entra aqui.)
export const invoiceAiHeuristic = {
  isCreditCard: false,
  declaredTotal: null,
  accountDescriptor: null,
  usage: { input_tokens: 1, output_tokens: 1 },
  transactions: [
    { date: '2026-06-03', purchaseDate: '2026-06-03', description: 'FARMACIA', amount: -40, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: '1111' },
    { date: '2026-05-30', purchaseDate: null, description: 'LINHA ANTIGA', amount: -1, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: '1111' },
    { date: '2026-06-09', purchaseDate: '2026-06-09', description: 'LIVRARIA 2 de 3', amount: -30, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: null },
    // leitura em que a data da linha (vencimento) difere da data da compra
    { date: '2026-06-12', purchaseDate: '2026-06-01', description: 'ACADEMIA', amount: -99, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: '1111' },
  ],
};

// ─── B: extrato de conta lido pela "IA" ────────────────────────────────────
export const statementAi = {
  isCreditCard: false,
  declaredTotal: null,
  accountDescriptor: 'Extrato Conta Delta agencia 0001',
  usage: { input_tokens: 5, output_tokens: 5 },
  transactions: [
    { date: '2026-08-05', purchaseDate: null, description: 'PIX ENVIADO JOAO', amount: -200, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: null },
    { date: '2026-08-06', purchaseDate: null, description: 'ELUBEL INDUSTRIA', amount: -300, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: null },
    { date: '2026-08-06', purchaseDate: null, description: 'ABC', amount: -10, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: null },
    { date: '2026-08-08', purchaseDate: null, description: 'COMPRA PARCELADA', amount: -100, titular: '', installmentNumber: 2, totalInstallments: 4, cardNumber: null },
    { date: '2026-08-01', purchaseDate: null, description: 'SALARIO', amount: 5000, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: null },
    { date: '2026-08-02', purchaseDate: null, description: 'TARIFA PACOTE', amount: -12.5, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: null },
    { date: '2026-08-07', purchaseDate: null, description: 'LOJA CRUZADA', amount: -20, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: null },
    { date: '2026-08-09', purchaseDate: null, description: 'CURSO ONLINE 02/03', amount: -75, titular: '', installmentNumber: null, totalInstallments: null, cardNumber: null },
    { date: '2026-01-31', purchaseDate: null, description: 'ASSINATURA ANUAL', amount: -120, titular: '', installmentNumber: 1, totalInstallments: 3, cardNumber: null },
  ],
};

export const statementExisting = [
  tx({ date: d('2026-08-05'), description: 'Pix enviado joao', amount: -200, account: 'Conta Delta' }),
  tx({ date: d('2026-08-06'), description: 'Elubel Industria Ecotia', amount: -300, account: 'Conta Delta' }),
  tx({ date: d('2026-08-06'), description: 'ABCD', amount: -10, account: 'Conta Delta' }),
  tx({ date: d('2026-08-08'), description: 'Compra parcelada', amount: -100, account: 'Conta Delta', installmentNumber: 3, totalInstallments: 4 }),
  tx({ date: d('2026-08-02'), description: 'Tarifa pacote', amount: -12.5, account: '' }),
  tx({ date: d('2026-09-10'), purchaseDate: d('2026-08-07'), description: 'Loja cruzada', amount: -20, account: 'Conta Delta' }),
];

// ─── C: OFX de conta corrente ──────────────────────────────────────────────
function stmttrn(fitid, dt, amt, memo) {
  return `<STMTTRN>\n<TRNTYPE>OTHER\n<DTPOSTED>${dt}120000[-03:EST]\n<TRNAMT>${amt}\n<FITID>${fitid}\n<MEMO>${memo}\n</STMTTRN>`;
}
export const ofxText = [
  'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', '',
  '<OFX>', '<BANKMSGSRSV1>', '<STMTTRNRS>', '<STMTRS>', '<CURDEF>BRL',
  '<BANKACCTFROM>', '<BANKID>0341', '<ACCTID>00000', '<ACCTTYPE>CHECKING', '</BANKACCTFROM>',
  '<BANKTRANLIST>', '<DTSTART>20260801120000[-03:EST]', '<DTEND>20260831120000[-03:EST]',
  stmttrn('F1', '20260803', '-50.00', 'CONTA DE LUZ'),
  stmttrn('F2', '20260804', '1000.00', 'RESGATE CDB'),
  stmttrn('F3', '20260805', '-25.00', 'PADARIA'),
  stmttrn('F4', '20260806', '-80.00', 'FARMACIA'),
  '</BANKTRANLIST>', '<LEDGERBAL>', '<BALAMT>845.00', '<DTASOF>20260831120000[-03:EST]', '</LEDGERBAL>',
  '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>', '',
].join('\n');

export const ofxExisting = [
  tx({ date: d('2026-08-03'), description: 'CONTA DE LUZ', amount: -50, account: 'Conta Gama', fitid: 'F1' }),
  tx({ date: d('2026-07-04'), description: 'RESGATE CDB', amount: 500, account: 'Conta Gama', fitid: 'F2' }),
  tx({ date: d('2026-08-05'), description: 'Padaria', amount: -25, account: 'Conta Gama' }),
];

// ─── D: extrato em moeda estrangeira (layout Wise) ─────────────────────────
export const wiseCsv = [
  'TransferWise ID,Date,Amount,Currency,Description,Running Balance,Exchange From,Exchange Rate,Merchant,Transaction Details Type',
  'CARD-3,2026-08-04,-10.00,EUR,Card transaction of 10.00 EUR issued by Livraria Teste,50.00,,,Livraria Teste,CARD',
  'CARD-2,2026-08-03,-20.00,EUR,Card transaction of 20.00 EUR issued by Museu Teste,60.00,,,Museu Teste,CARD',
  'CARD-1,2026-08-02,-20.00,EUR,Card transaction of 20.00 EUR issued by Cafe Teste,80.00,,,Cafe Teste,CARD',
  '',
].join('\n');

export const wiseWallets = [
  { currency: 'EUR', balanceFx: 100, costBrl: 600, estimated: false, accountName: 'Conta Wise', updatedAt: d('2026-07-31') },
];

export const wiseExisting = [
  tx({ date: d('2026-08-02'), description: 'Cafe Teste', amount: -999, account: 'Conta Wise', fitid: 'CARD-1' }),
  tx({ date: d('2026-08-03'), description: 'Museu Teste', amount: -120, account: 'Conta Wise' }),
];
