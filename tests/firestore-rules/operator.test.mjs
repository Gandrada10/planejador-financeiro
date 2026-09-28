// Testes do USUARIO OPERADOR (IA) nas firestore.rules, contra o EMULADOR.
// Projeto "demo-*": offline por definicao, nenhum backend real.
//
// O firestore.rules do repositorio (publico) carrega os UIDs como marcadores
// (__OPERADOR_UID__, __DONO_UID__). Aqui os marcadores viram UIDs de teste; o
// texto de producao e gerado fora do repositorio. RULES_FILE (variavel de
// ambiente) troca o arquivo de regras: e assim que os mutantes rodam.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  writeBatch,
  collection,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = process.env.RULES_FILE
  ? resolve(process.env.RULES_FILE)
  : resolve(__dirname, '..', '..', 'firestore.rules');
const RAW_RULES = readFileSync(RULES_PATH, 'utf8');

const OWNER = 'owner-uid';
const OPERATOR = 'operator-uid';
const STRANGER = 'stranger-uid';
const TOK = 'tok-op-valid-0123456789abcdef';

const withUids = (text, operator, owner) =>
  text.replaceAll('__OPERADOR_UID__', operator).replaceAll('__DONO_UID__', owner);

const future = () => Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000);

/** Lancamento no formato que o app grava (importBatch do useTransactions). */
function txFull(overrides = {}) {
  return {
    date: Timestamp.fromMillis(Date.UTC(2026, 7, 10, 12)),
    purchaseDate: Timestamp.fromMillis(Date.UTC(2026, 6, 28, 12)),
    description: 'COMPRA TESTE',
    amount: -123.45,
    categoryId: 'cat-food',
    account: 'Cartao Teste',
    familyMember: 'Titular',
    titular: 'Titular',
    installmentNumber: null,
    totalInstallments: null,
    cardNumber: '1234',
    projectId: null,
    tags: [],
    notes: '',
    importBatch: 'import_1790000000000',
    reconciled: false,
    reconciledAt: null,
    createdAt: Timestamp.now(),
    billingMonth: '2026-08',
    provisionalDate: Timestamp.fromMillis(Date.UTC(2026, 7, 10, 12)),
    fitid: null,
    amountFx: null,
    currencyFx: null,
    fxRate: null,
    ...overrides,
  };
}

function accountFull(overrides = {}) {
  return {
    name: 'Cartao Novo',
    type: 'cartao',
    bank: 'Banco',
    closingDay: 12,
    dueDay: 20,
    creditLimit: null,
    createdAt: Timestamp.now(),
    ...overrides,
  };
}

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let env;
/** Ambiente com operador == dono (UID copiado errado): tem de falhar fechado. */
let envSame;

let seq = 0;
const newId = (p) => `${p}-${++seq}-${Date.now()}`;

async function seed(e, ownerUid) {
  // Base limpa a cada rodada: o emulador guarda dados entre processos, e um
  // mutante anterior pode ter deixado documentos que mascaram o proximo.
  await e.clearFirestore();
  await e.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ownerUid, 'transactions', 'tx1'), txFull({ importBatch: null, categoryId: null }));
    await setDoc(doc(db, 'users', ownerUid, 'transactions', 'tx-imported'), txFull());
    await setDoc(doc(db, 'users', ownerUid, 'accounts', 'acc1'), accountFull({ name: 'Conta Existente' }));
    await setDoc(doc(db, 'users', ownerUid, 'categories', 'cat-food'), { name: 'Alimentacao', type: 'despesa', parentId: null });
    await setDoc(doc(db, 'users', ownerUid, 'categories', 'cat-other'), { name: 'Outras', type: 'despesa', parentId: null });
    // id valido para o Firestore mas fora do formato aceito (ponto)
    await setDoc(doc(db, 'users', ownerUid, 'categories', 'cat.ponto'), { name: 'Fora do formato', type: 'despesa', parentId: null });
    for (const c of ['categoryRules', 'billingCycles', 'budgets', 'projects', 'familyMembers', 'titularMappings', 'fxWallets']) {
      await setDoc(doc(db, 'users', ownerUid, c, 'x1'), { v: 1 });
    }
    await setDoc(doc(db, 'users', STRANGER, 'transactions', 's1'), txFull());
    await setDoc(doc(db, 'users', OPERATOR, 'transactions', 'o1'), txFull());
    await setDoc(doc(db, 'categorizationSessions', TOK), {
      userId: ownerUid, transactionIds: ['t1'], categorizedCount: 0, expiresAt: future(),
      status: 'active', lastActivityAt: null,
    });
    await setDoc(doc(db, 'categorizationSessions', TOK, 'transactions', 't1'), {
      categoryId: null, notes: '', applied: false, amount: -1, description: 'x',
    });
    await setDoc(doc(db, 'categorizationSessions', TOK, 'categories', 'cat-food'), { name: 'Alimentacao' });
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-planejador-operador',
    firestore: { rules: withUids(RAW_RULES, OPERATOR, OWNER), host: '127.0.0.1', port: 8080 },
  });
  envSame = await initializeTestEnvironment({
    projectId: 'demo-planejador-operador-igual',
    firestore: { rules: withUids(RAW_RULES, OWNER, OWNER), host: '127.0.0.1', port: 8080 },
  });
  await seed(env, OWNER);
  await seed(envSame, OWNER);
});

after(async () => {
  await env.cleanup();
  await envSame.cleanup();
});

const op = () => env.authenticatedContext(OPERATOR).firestore();
const owner = () => env.authenticatedContext(OWNER).firestore();
const stranger = () => env.authenticatedContext(STRANGER).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const T = (db, id) => doc(db, 'users', OWNER, 'transactions', id);
const A = (db, id) => doc(db, 'users', OWNER, 'accounts', id);

// ---------------------------------------------------------------------------
// 0. O arquivo do repositorio nao carrega UID real
// ---------------------------------------------------------------------------

test('rules do repo usam marcadores, nao UIDs', () => {
  if (process.env.RULES_FILE) return; // mutantes sao copias; o check vale para o arquivo do repo
  assert.ok(RAW_RULES.includes("'__OPERADOR_UID__'"));
  assert.ok(RAW_RULES.includes("'__DONO_UID__'"));
});

// ---------------------------------------------------------------------------
// 1. Leitura
// ---------------------------------------------------------------------------

test('operador LE lancamento, conta, categoria e lista lancamentos do dono', async () => {
  await assertSucceeds(getDoc(T(op(), 'tx1')));
  await assertSucceeds(getDoc(A(op(), 'acc1')));
  await assertSucceeds(getDoc(doc(op(), 'users', OWNER, 'categories', 'cat-food')));
  await assertSucceeds(getDocs(collection(op(), 'users', OWNER, 'transactions')));
});

// ---------------------------------------------------------------------------
// 2. Criar lancamento
// ---------------------------------------------------------------------------

test('operador CRIA lancamento valido (formato do importBatch do app)', async () => {
  await assertSucceeds(setDoc(T(op(), newId('new')), txFull()));
});

test('operador CRIA lancamento avulso (importBatch null, sem categoria)', async () => {
  await assertSucceeds(setDoc(T(op(), newId('new')), txFull({ importBatch: null, categoryId: null })));
});

test('operador cria lote de lancamentos num writeBatch (commit atomico)', async () => {
  const db = op();
  const b = writeBatch(db);
  for (let i = 0; i < 5; i++) b.set(T(db, newId('lote')), txFull());
  await assertSucceeds(b.commit());
});

test('operador NAO cria lancamento com campo fora da lista fechada', async () => {
  for (const extra of [
    { isReimbursement: true },
    { reimbursementFor: 'tx1' },
    { awaitingReimbursement: true },
    { reimbursementPrevCategoryId: null },
    { noteAlert: true },
    { pluggyTransactionId: 'p' },
    { qualquerCoisa: 1 },
  ]) {
    await assertFails(setDoc(T(op(), newId('bad')), txFull(extra)));
  }
});

test('operador NAO cria lancamento sem campo obrigatorio ou com tipo errado', async () => {
  const noDate = txFull(); delete noDate.date;
  const noAccount = txFull(); delete noAccount.account;
  const noCreated = txFull(); delete noCreated.createdAt;
  await assertFails(setDoc(T(op(), newId('bad')), noDate));
  await assertFails(setDoc(T(op(), newId('bad')), noAccount));
  await assertFails(setDoc(T(op(), newId('bad')), noCreated));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ amount: '-10' })));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ date: '2026-08-10' })));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ description: 5 })));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ account: '' })));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ createdAt: 'agora' })));
});

test('operador NAO cria lancamento com carimbo fora do padrao, conciliado ou categoryId invalido', async () => {
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ importBatch: 'manual_1' })));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ importBatch: 'import_123' })));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ reconciled: true })));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ reconciledAt: Timestamp.now() })));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ categoryId: 'a/b' })));
  await assertFails(setDoc(T(op(), newId('bad')), txFull({ categoryId: 7 })));
});

test('operador NAO cria doc que ja existe (set sobre lancamento/conta existente)', async () => {
  await assertFails(setDoc(T(op(), 'tx1'), txFull()));
  await assertFails(setDoc(T(op(), 'tx-imported'), txFull({ importBatch: 'import_1790000000001' })));
  await assertFails(setDoc(A(op(), 'acc1'), accountFull()));
});

// ---------------------------------------------------------------------------
// 3. Criar conta
// ---------------------------------------------------------------------------

test('operador CRIA conta valida', async () => {
  await assertSucceeds(setDoc(A(op(), newId('acc')), accountFull()));
  await assertSucceeds(setDoc(A(op(), newId('acc')), { name: 'Minima', type: 'corrente', createdAt: Timestamp.now() }));
});

test('operador NAO cria conta com campo extra, tipo ou dia invalido', async () => {
  await assertFails(setDoc(A(op(), newId('acc')), accountFull({ importBatch: 'import_1790000000000' })));
  await assertFails(setDoc(A(op(), newId('acc')), accountFull({ archived: true })));
  await assertFails(setDoc(A(op(), newId('acc')), accountFull({ type: 'cripto' })));
  await assertFails(setDoc(A(op(), newId('acc')), accountFull({ dueDay: 32 })));
  await assertFails(setDoc(A(op(), newId('acc')), accountFull({ closingDay: 0 })));
  await assertFails(setDoc(A(op(), newId('acc')), accountFull({ name: '' })));
  await assertFails(setDoc(A(op(), newId('acc')), accountFull({ creditLimit: 'muito' })));
  const noName = accountFull(); delete noName.name;
  await assertFails(setDoc(A(op(), newId('acc')), noName));
});

test('operador NAO altera conta existente', async () => {
  await assertFails(updateDoc(A(op(), 'acc1'), { name: 'Renomeada' }));
  await assertFails(updateDoc(A(op(), 'acc1'), { dueDay: 5 }));
});

// ---------------------------------------------------------------------------
// 4. Trocar so categoryId
// ---------------------------------------------------------------------------

test('operador troca SO categoryId de lancamento existente (categoria existente ou null)', async () => {
  await assertSucceeds(updateDoc(T(op(), 'tx1'), { categoryId: 'cat-other' }));
  await assertSucceeds(updateDoc(T(op(), 'tx1'), { categoryId: null }));
  await assertSucceeds(setDoc(T(op(), 'tx1'), { categoryId: 'cat-food' }, { merge: true }));
  // os outros campos continuam la
  const snap = await getDoc(T(owner(), 'tx1'));
  assert.equal(snap.data().amount, -123.45);
  assert.equal(snap.data().categoryId, 'cat-food');
});

test('operador NAO troca categoryId para categoria que nao existe', async () => {
  await assertFails(updateDoc(T(op(), 'tx1'), { categoryId: 'cat-inexistente' }));
  // existe, mas o id foge do formato: a regex barra antes do exists()
  await assertFails(updateDoc(T(op(), 'tx1'), { categoryId: 'cat.ponto' }));
  await assertFails(updateDoc(T(op(), 'tx1'), { categoryId: 7 }));
});

test('operador NAO muda outro campo alem de categoryId', async () => {
  await assertFails(updateDoc(T(op(), 'tx1'), { amount: -1 }));
  await assertFails(updateDoc(T(op(), 'tx1'), { categoryId: 'cat-other', amount: -1 }));
  await assertFails(updateDoc(T(op(), 'tx1'), { categoryId: 'cat-other', notes: 'x' }));
  await assertFails(updateDoc(T(op(), 'tx1'), { reconciled: true }));
  await assertFails(updateDoc(T(op(), 'tx1'), { isReimbursement: true }));
});

test('operador NAO carimba nem troca importBatch em linha existente', async () => {
  await assertFails(updateDoc(T(op(), 'tx1'), { importBatch: 'import_1790000000002' }));
  await assertFails(updateDoc(T(op(), 'tx-imported'), { importBatch: 'import_1790000000002' }));
  await assertFails(updateDoc(T(op(), 'tx-imported'), { importBatch: null }));
});

test('operador NAO faz update substituindo o documento inteiro', async () => {
  await assertFails(setDoc(T(op(), 'tx1'), { categoryId: 'cat-other' }));
  await assertFails(setDoc(T(op(), 'tx-imported'), { categoryId: 'cat-other', amount: -123.45 }));
});

test('operador NAO apaga campo (deleteField) nem o categoryId some', async () => {
  await assertFails(updateDoc(T(op(), 'tx1'), { notes: deleteField() }));
  await assertFails(updateDoc(T(op(), 'tx1'), { categoryId: deleteField() }));
});

// ---------------------------------------------------------------------------
// 5. Nunca delete
// ---------------------------------------------------------------------------

test('operador NAO apaga lancamento, conta nem qualquer doc', async () => {
  await assertFails(deleteDoc(T(op(), 'tx1')));
  await assertFails(deleteDoc(T(op(), 'tx-imported')));
  await assertFails(deleteDoc(A(op(), 'acc1')));
  await assertFails(deleteDoc(doc(op(), 'users', OWNER, 'categories', 'cat-food')));
  for (const c of ['categoryRules', 'billingCycles', 'budgets', 'projects', 'familyMembers', 'titularMappings', 'fxWallets']) {
    await assertFails(deleteDoc(doc(op(), 'users', OWNER, c, 'x1')));
  }
});

test('operador NAO apaga nem o lancamento que ele mesmo criou', async () => {
  const id = newId('mine');
  await assertSucceeds(setDoc(T(op(), id), txFull()));
  await assertFails(deleteDoc(T(op(), id)));
});

// ---------------------------------------------------------------------------
// 6. Nada fora de transactions/accounts, nada fora do dono
// ---------------------------------------------------------------------------

test('operador NAO escreve em categorias, regras, ciclos, orcamentos e demais colecoes', async () => {
  for (const c of ['categories', 'categoryRules', 'billingCycles', 'budgets', 'projects', 'familyMembers', 'titularMappings', 'fxWallets', 'qualquer']) {
    await assertFails(setDoc(doc(op(), 'users', OWNER, c, newId('n')), { name: 'x' }));
  }
  await assertFails(updateDoc(doc(op(), 'users', OWNER, 'categories', 'cat-food'), { name: 'y' }));
  await assertFails(updateDoc(doc(op(), 'users', OWNER, 'billingCycles', 'x1'), { v: 2 }));
});

test('operador NAO escreve em subcolecao aninhada nem no doc raiz do dono', async () => {
  await assertFails(setDoc(doc(op(), 'users', OWNER, 'transactions', 'tx1', 'sub', 'a'), txFull()));
  await assertFails(setDoc(doc(op(), 'users', OWNER, 'accounts', 'acc1', 'sub', 'a'), accountFull()));
  await assertFails(setDoc(doc(op(), 'users', OWNER), { x: 1 }));
});

test('operador NAO le nem escreve fora de /users/{dono} (outro usuario, a propria arvore, raiz)', async () => {
  await assertFails(getDoc(doc(op(), 'users', STRANGER, 'transactions', 's1')));
  await assertFails(setDoc(doc(op(), 'users', STRANGER, 'transactions', newId('n')), txFull()));
  await assertFails(updateDoc(doc(op(), 'users', STRANGER, 'transactions', 's1'), { categoryId: null }));
  await assertFails(getDoc(doc(op(), 'users', OPERATOR, 'transactions', 'o1')));
  await assertFails(setDoc(doc(op(), 'users', OPERATOR, 'transactions', newId('n')), txFull()));
  await assertFails(deleteDoc(doc(op(), 'users', OPERATOR, 'transactions', 'o1')));
  await assertFails(setDoc(doc(op(), 'qualquer', newId('n')), { x: 1 }));
});

// ---------------------------------------------------------------------------
// 7. Sessoes de categorizacao: operador fora, ate com o token
// ---------------------------------------------------------------------------

test('operador NAO cria sessao (nem em nome proprio, nem do dono)', async () => {
  const s = { transactionIds: [], expiresAt: future(), categorizedCount: 0 };
  await assertFails(setDoc(doc(op(), 'categorizationSessions', newId('tok')), { ...s, userId: OPERATOR }));
  await assertFails(setDoc(doc(op(), 'categorizationSessions', newId('tok')), { ...s, userId: OWNER }));
});

test('operador NAO le nem categoriza sessao valida, mesmo com o token', async () => {
  await assertFails(getDoc(doc(op(), 'categorizationSessions', TOK)));
  await assertFails(getDoc(doc(op(), 'categorizationSessions', TOK, 'transactions', 't1')));
  await assertFails(getDoc(doc(op(), 'categorizationSessions', TOK, 'categories', 'cat-food')));
  await assertFails(updateDoc(doc(op(), 'categorizationSessions', TOK, 'transactions', 't1'),
    { categoryId: 'cat-food', notes: '', applied: false }));
  await assertFails(updateDoc(doc(op(), 'categorizationSessions', TOK),
    { categorizedCount: 1, lastActivityAt: Timestamp.now() }));
  await assertFails(deleteDoc(doc(op(), 'categorizationSessions', TOK)));
  await assertFails(getDocs(query(collection(op(), 'categorizationSessions'), where('userId', '==', OPERATOR))));
});

test('fluxo publico da esposa continua (anonimo com token categoriza)', async () => {
  await assertSucceeds(getDoc(doc(anon(), 'categorizationSessions', TOK)));
  await assertSucceeds(updateDoc(doc(anon(), 'categorizationSessions', TOK, 'transactions', 't1'),
    { categoryId: 'cat-food', notes: '', applied: false }));
});

// ---------------------------------------------------------------------------
// 8. Outros usuarios e o dono
// ---------------------------------------------------------------------------

test('outro usuario e anonimo continuam sem acesso ao dono (nem pelos caminhos do operador)', async () => {
  for (const db of [stranger(), anon()]) {
    await assertFails(getDoc(T(db, 'tx1')));
    await assertFails(setDoc(T(db, newId('n')), txFull()));
    await assertFails(setDoc(A(db, newId('n')), accountFull()));
    await assertFails(updateDoc(T(db, 'tx1'), { categoryId: 'cat-food' }));
  }
});

test('dono intacto: le, cria, altera qualquer campo e apaga', async () => {
  const id = newId('dono');
  await assertSucceeds(setDoc(T(owner(), id), { qualquer: 'formato', amount: 1 }));
  await assertSucceeds(updateDoc(T(owner(), id), { amount: 2, importBatch: 'x' }));
  await assertSucceeds(deleteDoc(T(owner(), id)));
  await assertSucceeds(setDoc(doc(owner(), 'users', OWNER, 'categories', newId('c')), { name: 'nova' }));
  await assertSucceeds(updateDoc(A(owner(), 'acc1'), { name: 'Conta Existente' }));
  const s = { userId: OWNER, transactionIds: [], expiresAt: future(), categorizedCount: 0 };
  await assertSucceeds(setDoc(doc(owner(), 'categorizationSessions', newId('tok')), s));
});

// ---------------------------------------------------------------------------
// 9. Falha fechada: UID do operador igual ao do dono
// ---------------------------------------------------------------------------

test('com operador == dono, o dono segue dono e o ramo do operador nao amplia nada', async () => {
  const same = () => envSame.authenticatedContext(OWNER).firestore();
  const id = newId('igual');
  await assertSucceeds(setDoc(doc(same(), 'users', OWNER, 'transactions', id), { qualquer: 1 }));
  await assertSucceeds(deleteDoc(doc(same(), 'users', OWNER, 'transactions', id)));
  await assertSucceeds(getDoc(doc(same(), 'categorizationSessions', TOK)));
  const s = { userId: OWNER, transactionIds: [], expiresAt: future(), categorizedCount: 0 };
  await assertSucceeds(setDoc(doc(same(), 'categorizationSessions', newId('tok')), s));
  const str = envSame.authenticatedContext(STRANGER).firestore();
  await assertFails(getDoc(doc(str, 'users', OWNER, 'transactions', 'tx1')));
});
