// Tipos e limites de TODOS os campos que o usuario operador (IA) grava ao
// criar lancamento e conta (condicao F4-1 do parecer do Vex, 28-09-2026).
// Emulador, projeto "demo-*": nenhum backend real.
//
// Os tipos sao os que o app grava (src/types/index.ts e os caminhos de escrita
// de src/hooks/useTransactions.ts e useAccounts.ts). Os limites de tamanho
// ficam folgados sobre os maximos observados na referencia de 27-09 (so
// tamanhos, nunca valores): ver o README desta pasta.
//
// RULES_FILE troca o arquivo de regras (mutantes, texto de producao).
// T_OWNER / T_OPERATOR: UIDs para o texto de producao; nunca imprimir.
// REF_FILE (opcional): referencia JSON de lancamentos reais; se presente, o
// teste "referencia inteira" cria cada um pelo operador. Nenhum valor e
// impresso: so contagens.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, Timestamp } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = process.env.RULES_FILE
  ? resolve(process.env.RULES_FILE)
  : resolve(__dirname, '..', '..', 'firestore.rules');
const RAW_RULES = readFileSync(RULES_PATH, 'utf8');

const OWNER = process.env.T_OWNER || 'owner-uid';
const OPERATOR = process.env.T_OPERATOR || 'operator-uid';

const withUids = (text) =>
  text.replaceAll('__OPERADOR_UID__', OPERATOR).replaceAll('__DONO_UID__', OWNER);

/** Lancamento exatamente como o `importBatch` do app grava (fatura de cartao
 *  com parcela, moeda estrangeira e carimbo). */
function txApp(overrides = {}) {
  return {
    date: Timestamp.fromMillis(Date.UTC(2026, 8, 10, 15)),
    purchaseDate: Timestamp.fromMillis(Date.UTC(2026, 7, 2, 15)),
    description: 'LOJA EXEMPLO',
    amount: -189.9,
    categoryId: 'AbCdEfGhIjKlMnOpQrSt',
    account: 'Cartao Exemplo',
    familyMember: 'Membro',
    titular: 'MEMBRO EXEMPLO',
    installmentNumber: 3,
    totalInstallments: 10,
    cardNumber: '1234',
    projectId: null,
    tags: [],
    notes: '',
    importBatch: 'import_1790000000000',
    reconciled: false,
    reconciledAt: null,
    createdAt: Timestamp.now(),
    billingMonth: '2026-09',
    provisionalDate: Timestamp.fromMillis(Date.UTC(2026, 8, 10, 15)),
    fitid: null,
    amountFx: -32.5,
    currencyFx: 'EUR',
    fxRate: 5.843,
    ...overrides,
  };
}

function accountApp(overrides = {}) {
  return {
    name: 'Cartao Exemplo',
    type: 'cartao',
    bank: 'Banco Exemplo',
    closingDay: 3,
    dueDay: 10,
    creditLimit: 15000,
    createdAt: Timestamp.now(),
    ...overrides,
  };
}

let env;
let seq = 0;
const newId = (p) => `${p}-${++seq}-${Date.now()}`;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-planejador-operador-tipos',
    firestore: { rules: withUids(RAW_RULES), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();
});

after(async () => { await env?.cleanup(); });

// Uma instancia so: milhares de contextos estouram a memoria do node (visto
// no teste da referencia inteira).
let opDb;
const op = () => (opDb ??= env.authenticatedContext(OPERATOR).firestore());
const T = (id) => doc(op(), 'users', OWNER, 'transactions', id ?? newId('t'));
const A = (id) => doc(op(), 'users', OWNER, 'accounts', id ?? newId('a'));

/** Cada caso num documento proprio: um campo errado por vez. */
async function refusesTx(field, values) {
  for (const v of values) {
    await assertFails(setDoc(T(), txApp({ [field]: v })), `${field} deveria ser recusado`);
  }
}
async function acceptsTx(field, values) {
  for (const v of values) {
    await assertSucceeds(setDoc(T(), txApp({ [field]: v })));
  }
}
async function refusesAcc(field, values) {
  for (const v of values) {
    await assertFails(setDoc(A(), accountApp({ [field]: v })), `${field} deveria ser recusado`);
  }
}
async function acceptsAcc(field, values) {
  for (const v of values) {
    await assertSucceeds(setDoc(A(), accountApp({ [field]: v })));
  }
}

const S = (n) => 'a'.repeat(n);

// ---------------------------------------------------------------------------
// Positivos: o formato do app passa
// ---------------------------------------------------------------------------

test('lancamento no formato do app (fatura, parcela, moeda) e aceito', async () => {
  await assertSucceeds(setDoc(T(), txApp()));
});

test('lancamento avulso do app (sem cartao, sem moeda, valor inteiro) e aceito', async () => {
  await assertSucceeds(setDoc(T(), txApp({
    purchaseDate: null, installmentNumber: null, totalInstallments: null, cardNumber: null,
    importBatch: null, billingMonth: null, provisionalDate: null, amountFx: null,
    currencyFx: null, fxRate: null, amount: 2500, categoryId: null, titular: '',
  })));
});

test('lancamento de extrato OFX (fitid) e um lote no formato do app sao aceitos', async () => {
  await assertSucceeds(setDoc(T(), txApp({ fitid: '20260910001', cardNumber: null, installmentNumber: null, totalInstallments: null })));
  const db = op();
  const b = writeBatch(db);
  for (let i = 0; i < 5; i++) {
    b.set(doc(db, 'users', OWNER, 'transactions', newId('lote')), txApp({ installmentNumber: i + 1, totalInstallments: 5 }));
  }
  await assertSucceeds(b.commit());
});

test('lote de 400 (o bloco do app) com todas as checagens passa no emulador', async () => {
  const db = op();
  const b = writeBatch(db);
  for (let i = 0; i < 400; i++) {
    b.set(doc(db, 'users', OWNER, 'transactions', newId('bloco')), txApp({ tags: ['a', 'b', 'c'] }));
  }
  await assertSucceeds(b.commit());
});

test('limites exatos passam (500, 100, 32, 255, parcela 1 e 99, 10 tags de 50)', async () => {
  await acceptsTx('description', [S(500), '']);
  await acceptsTx('notes', [S(500)]);
  await acceptsTx('account', [S(100)]);
  await acceptsTx('familyMember', [S(100)]);
  await acceptsTx('titular', [S(100)]);
  await acceptsTx('cardNumber', [S(32)]);
  await acceptsTx('fitid', [S(255)]);
  await acceptsTx('installmentNumber', [1, 99]);
  await acceptsTx('totalInstallments', [1, 99]);
  await acceptsTx('tags', [['viagem', 'reembolsar'], Array.from({ length: 10 }, (_, i) => `${i}`.padEnd(50, 't'))]);
  await acceptsTx('amount', [100000000, -100000000, 0, -1]);
  await acceptsTx('amountFx', [100000000, 12]);
  await acceptsTx('fxRate', [1000, 0.04]);
  await acceptsTx('billingMonth', ['2026-01', '2026-12']);
  await acceptsTx('projectId', ['AbCdEfGhIjKlMnOpQrSt']);
});

test('conta no formato do app e aceita (com e sem os opcionais)', async () => {
  await assertSucceeds(setDoc(A(), accountApp()));
  await assertSucceeds(setDoc(A(), { name: 'Conta', type: 'corrente', bank: 'Banco', createdAt: Timestamp.now() }));
  await acceptsAcc('creditLimit', [0, 100000000, null, 1234.56]);
  await acceptsAcc('bank', [S(100), '']);
});

// ---------------------------------------------------------------------------
// Os casos exatos que o Vex criou no emulador (parecer 28-09): agora recusados
// ---------------------------------------------------------------------------

test('casos do Vex: tags string, notes 300 KB, parcela "um", total -5, billingMonth numero, familyMember mapa, NaN, bank mapa', async () => {
  await refusesTx('tags', ['nao-e-lista']);
  await refusesTx('notes', [S(300000)]);
  await refusesTx('installmentNumber', ['um']);
  await refusesTx('totalInstallments', [-5]);
  await refusesTx('billingMonth', [202608]);
  await refusesTx('familyMember', [{ a: 1 }]);
  await refusesTx('amount', [NaN]);
  await refusesAcc('bank', [{ x: 1 }]);
});

// ---------------------------------------------------------------------------
// Lancamento: cada campo com tipo errado ou fora do limite
// ---------------------------------------------------------------------------

test('date e createdAt so timestamp', async () => {
  await refusesTx('date', ['2026-09-10', 1790000000000, null, { seconds: 1 }]);
  await refusesTx('createdAt', ['agora', null, 5]);
});

test('purchaseDate e provisionalDate so timestamp ou null', async () => {
  await refusesTx('purchaseDate', ['2026-08-02', 5, { a: 1 }]);
  await refusesTx('provisionalDate', ['2026-09-10', 5, true]);
});

test('amount: numero finito, modulo ate 100 milhoes', async () => {
  await refusesTx('amount', [NaN, Infinity, -Infinity, 100000000.01, -1e12, '-10', null, { v: 1 }]);
});

test('description: string ate 500', async () => {
  await refusesTx('description', [S(501), 5, null, ['a'], { a: 1 }]);
});

test('account: string de 1 a 100', async () => {
  await refusesTx('account', ['', S(101), 7, { a: 1 }]);
});

test('familyMember e titular: string ate 100', async () => {
  await refusesTx('familyMember', [S(101), 5, null, ['a']]);
  await refusesTx('titular', [S(101), 5, null, { a: 1 }]);
});

test('notes: string ate 500', async () => {
  await refusesTx('notes', [S(501), 5, null, ['a']]);
});

test('cardNumber: string ate 32 ou null', async () => {
  await refusesTx('cardNumber', [1234, S(33), { a: 1 }]);
});

test('fitid: string ate 255 ou null', async () => {
  await refusesTx('fitid', [5, S(256), ['a']]);
});

test('projectId: id no formato ou null', async () => {
  await refusesTx('projectId', [5, 'a/b', '', S(129), { a: 1 }]);
});

test('installmentNumber e totalInstallments: inteiro de 1 a 99 ou null', async () => {
  await refusesTx('installmentNumber', ['um', 0, -1, 100, 1.5, { a: 1 }]);
  await refusesTx('totalInstallments', ['doze', 0, -5, 100, 2.5]);
});

test('billingMonth: AAAA-MM ou null', async () => {
  await refusesTx('billingMonth', ['2026-13', '2026-00', '2026-8', '26-08', '2026-08-01', { a: 1 }]);
});

test('amountFx: numero finito ate 100 milhoes ou null', async () => {
  await refusesTx('amountFx', [NaN, Infinity, 1e9, '10', { a: 1 }]);
});

test('currencyFx: 3 letras maiusculas ou null', async () => {
  await refusesTx('currencyFx', ['eur', 'EURO', 'EU', 5, { a: 1 }]);
});

test('fxRate: numero finito maior que 0 e ate 1000, ou null', async () => {
  await refusesTx('fxRate', [0, -1, NaN, Infinity, 1000.5, '5.8']);
});

test('tags: lista de ate 10 strings de ate 50, tipo checado em cada posicao', async () => {
  await refusesTx('tags', ['x', [1], [{ a: 1 }], [null], [true], [Timestamp.now()], { a: 1 }, null]);
  await refusesTx('tags', [Array.from({ length: 11 }, () => 't'), [S(51)], ['ok', S(51)]]);
  // item errado em cada uma das 10 posicoes (a checagem e por indice)
  for (let i = 0; i < 10; i++) {
    const l = Array.from({ length: 10 }, () => 'ok'); l[i] = 7;
    await refusesTx('tags', [l]);
  }
});

// ---------------------------------------------------------------------------
// Conta: cada campo com tipo errado ou fora do limite
// ---------------------------------------------------------------------------

test('conta: bank string ate 100', async () => {
  await refusesAcc('bank', [5, S(101), null, ['a']]);
});

test('conta: nome ate 100, createdAt timestamp, dias inteiros', async () => {
  await refusesAcc('name', [S(101), 5, { a: 1 }]);
  await refusesAcc('createdAt', ['agora', null]);
  await refusesAcc('closingDay', [1.5, '12', { a: 1 }]);
  await refusesAcc('dueDay', [10.5, '10']);
});

test('conta: creditLimit numero finito de 0 a 100 milhoes ou null', async () => {
  await refusesAcc('creditLimit', [NaN, Infinity, -1, 1e9, '5000', { a: 1 }]);
});

// ---------------------------------------------------------------------------
// Opcional: a referencia real inteira passa pela regra (nenhum valor impresso)
// ---------------------------------------------------------------------------

const TX_FIELDS = new Set(['date', 'purchaseDate', 'description', 'amount', 'categoryId', 'account',
  'familyMember', 'titular', 'installmentNumber', 'totalInstallments', 'cardNumber', 'projectId',
  'tags', 'notes', 'importBatch', 'reconciled', 'reconciledAt', 'createdAt', 'billingMonth',
  'provisionalDate', 'fitid', 'amountFx', 'currencyFx', 'fxRate']);
const TS_FIELDS = new Set(['date', 'purchaseDate', 'createdAt', 'provisionalDate', 'reconciledAt']);

test('referencia real: todo lancamento e conta, no formato de criacao, passa', { skip: !process.env.REF_FILE }, async () => {
  assert.ok(existsSync(process.env.REF_FILE));
  const ref = JSON.parse(readFileSync(process.env.REF_FILE, 'utf8'));
  const toCreate = (data, fields) => {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (!fields.has(k)) continue;
      out[k] = TS_FIELDS.has(k) && typeof v === 'string' ? Timestamp.fromDate(new Date(v)) : v;
    }
    // criacao pelo operador: nunca conciliado
    if ('reconciled' in out) out.reconciled = false;
    if ('reconciledAt' in out) out.reconciledAt = null;
    return out;
  };
  // Unica diferenca DE PROPOSITO para o app: o app aceita `account` vazio (a
  // importacao sem conta sugerida grava ''), o operador nao. Essas linhas tem
  // de ser recusadas como estao e aceitas com a conta preenchida.
  let ok = 0; let vaziaRecusada = 0; const recusados = {};
  const db = op();
  for (const [i, t] of ref.collections.transactions.entries()) {
    const d = toCreate(t.data, TX_FIELDS);
    if (d.account === '') {
      try { await setDoc(doc(db, 'users', OWNER, 'transactions', `ref-v-${i}`), d); recusados['account-vazia-aceita'] = (recusados['account-vazia-aceita'] || 0) + 1; }
      catch { vaziaRecusada++; }
      d.account = 'Conta Preenchida';
    }
    try { await setDoc(doc(db, 'users', OWNER, 'transactions', `ref-${i}`), d); ok++; }
    catch {
      // descobre QUAL campo reprova, sem imprimir o valor
      for (const k of Object.keys(d)) {
        const probe = { ...txApp(), [k]: d[k] };
        try { await setDoc(doc(db, 'users', OWNER, 'transactions', newId('probe')), probe); }
        catch { recusados[k] = (recusados[k] || 0) + 1; }
      }
    }
  }
  const ACC_FIELDS = new Set(['name', 'type', 'bank', 'closingDay', 'dueDay', 'creditLimit', 'createdAt']);
  let okAcc = 0;
  for (const [i, a] of ref.collections.accounts.entries()) {
    try { await setDoc(doc(db, 'users', OWNER, 'accounts', `ref-${i}`), toCreate(a.data, ACC_FIELDS)); okAcc++; }
    catch { recusados['conta'] = (recusados['conta'] || 0) + 1; }
  }
  console.log(`REF lancamentos=${ref.collections.transactions.length} aceitos=${ok} conta_vazia_recusada=${vaziaRecusada} contas=${ref.collections.accounts.length} aceitas=${okAcc} recusas_por_campo=${JSON.stringify(recusados)}`);
  assert.equal(ok, ref.collections.transactions.length);
  assert.deepEqual(recusados, {});
  assert.equal(okAcc, ref.collections.accounts.length);
});
