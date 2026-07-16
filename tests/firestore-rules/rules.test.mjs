// Testes das firestore.rules contra o EMULADOR (nunca producao).
// Projeto "demo-*" e offline por definicao no firebase-tools — nao existe
// backend real correspondente. Ver README.md para como rodar.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
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
  increment,
  collection,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, '..', '..', 'firestore.rules');

const OWNER = 'owner-uid';
const STRANGER = 'stranger-uid';
const TOK_VALID = 'tok-valid-0123456789abcdef';
const TOK_EXPIRED = 'tok-expired-0123456789abcdef';
// Sessao dedicada aos testes de increment() — mantem os asserts de range
// independentes da ordem dos demais testes. Seed: categorizedCount=1, total=3.
const TOK_COUNTER = 'tok-counter-0123456789abcdef';

const future = () => Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000);
const past = () => Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let env;

function sessionSeed(expiresAt) {
  return {
    userId: OWNER,
    titularName: 'Titular',
    transactionIds: ['t1', 't2', 't3'],
    categorizedCount: 0,
    expiresAt,
    createdAt: Timestamp.now(),
    status: 'active',
    monthFilter: 'all',
    accounts: ['Nubank'],
    totalAmount: -100,
    appliedAt: null,
    appliedCount: 0,
    lastActivityAt: null,
    topCategoryIds: [],
  };
}

function txSeed() {
  return {
    transactionId: 't1',
    description: 'IFOOD *RESTAURANTE',
    amount: -34.9,
    date: Timestamp.now(),
    installmentNumber: null,
    totalInstallments: null,
    categoryId: null,
    notes: '',
    suggestedCategoryId: 'cat-food',
    suggestionReason: 'Regra automatica',
    applied: false,
    markReimbursement: false,
    markAwaiting: false,
  };
}

/** Entrada (amount positivo) — para as flags que dependem do sinal. */
function incomeTxSeed() {
  return Object.assign(txSeed(), {
    transactionId: 't2',
    description: 'PIX RECEBIDO PLANO SAUDE',
    amount: 50,
  });
}

/** Doc LEGADO: criado antes das flags existirem (sem os dois campos). */
function legacyTxSeed() {
  const seed = Object.assign(txSeed(), { transactionId: 't3' });
  delete seed.markReimbursement;
  delete seed.markAwaiting;
  return seed;
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-planejador-rules',
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  // Seed com rules desligadas: 1 sessao valida + 1 expirada, cada uma com
  // subcolecoes transactions/categories, e dados privados do dono em /users.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [tok, exp] of [[TOK_VALID, future()], [TOK_EXPIRED, past()]]) {
      await setDoc(doc(db, 'categorizationSessions', tok), sessionSeed(exp));
      await setDoc(doc(db, 'categorizationSessions', tok, 'transactions', 't1'), txSeed());
      await setDoc(doc(db, 'categorizationSessions', tok, 'transactions', 't2'), incomeTxSeed());
      await setDoc(doc(db, 'categorizationSessions', tok, 'transactions', 't3'), legacyTxSeed());
      await setDoc(doc(db, 'categorizationSessions', tok, 'categories', 'cat-food'), {
        name: 'Alimentacao', icon: 'utensils', color: '#3987e5', type: 'despesa', parentId: null,
      });
    }
    await setDoc(doc(db, 'categorizationSessions', TOK_COUNTER),
      Object.assign(sessionSeed(future()), { categorizedCount: 1 }));
    await setDoc(doc(db, 'users', OWNER, 'transactions', 't1'), {
      description: 'IFOOD *RESTAURANTE', amount: -34.9, categoryId: null,
    });
  });
});

after(async () => {
  await env.cleanup();
});

const anon = () => env.unauthenticatedContext().firestore();
const owner = () => env.authenticatedContext(OWNER).firestore();
const stranger = () => env.authenticatedContext(STRANGER).firestore();

// ---------------------------------------------------------------------------
// 1. list da colecao de sessoes
// ---------------------------------------------------------------------------

test('anonimo NAO lista a colecao de sessoes (enumeracao de tokens)', async () => {
  await assertFails(getDocs(collection(anon(), 'categorizationSessions')));
});

test('anonimo NAO lista nem com filtro por userId', async () => {
  await assertFails(getDocs(query(
    collection(anon(), 'categorizationSessions'), where('userId', '==', OWNER))));
});

test('conta estranha NAO lista sessoes de outro dono (nem sem filtro)', async () => {
  await assertFails(getDocs(collection(stranger(), 'categorizationSessions')));
  await assertFails(getDocs(query(
    collection(stranger(), 'categorizationSessions'), where('userId', '==', OWNER))));
});

test('dono lista as proprias sessoes (query igual a do hook)', async () => {
  await assertSucceeds(getDocs(query(
    collection(owner(), 'categorizationSessions'), where('userId', '==', OWNER))));
});

// ---------------------------------------------------------------------------
// 2. get do doc da sessao vs leitura das subcolecoes (expiracao)
// ---------------------------------------------------------------------------

test('anonimo LE o doc da sessao expirada por token (mensagem amigavel)', async () => {
  await assertSucceeds(getDoc(doc(anon(), 'categorizationSessions', TOK_EXPIRED)));
});

test('anonimo NAO le subcolecao transactions de sessao EXPIRADA', async () => {
  await assertFails(getDocs(collection(anon(), 'categorizationSessions', TOK_EXPIRED, 'transactions')));
  await assertFails(getDoc(doc(anon(), 'categorizationSessions', TOK_EXPIRED, 'transactions', 't1')));
});

test('anonimo NAO le subcolecao categories de sessao EXPIRADA', async () => {
  await assertFails(getDocs(collection(anon(), 'categorizationSessions', TOK_EXPIRED, 'categories')));
});

test('anonimo LE subcolecoes de sessao VALIDA (fluxo da esposa)', async () => {
  await assertSucceeds(getDocs(collection(anon(), 'categorizationSessions', TOK_VALID, 'transactions')));
  await assertSucceeds(getDocs(collection(anon(), 'categorizationSessions', TOK_VALID, 'categories')));
});

test('dono LE subcolecao mesmo de sessao expirada (apply do delta)', async () => {
  await assertSucceeds(getDocs(collection(owner(), 'categorizationSessions', TOK_EXPIRED, 'transactions')));
});

// ---------------------------------------------------------------------------
// 3. update publico da transacao: valido passa, adversarial falha
// ---------------------------------------------------------------------------

test('anonimo categoriza (categoryId/notes/applied:false) em sessao valida', async () => {
  await assertSucceeds(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { categoryId: 'cat-food', notes: 'almoco', applied: false }));
});

test('anonimo desfaz (categoryId:null) em sessao valida', async () => {
  await assertSucceeds(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { categoryId: null, notes: '', applied: false }));
});

test('anonimo NAO seta applied:true (nao pula o apply do dono)', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { categoryId: 'cat-food', notes: '', applied: true }));
});

test('anonimo NAO grava categoryId/notes de tipo ou tamanho invalido', async () => {
  const ref = doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1');
  await assertFails(updateDoc(ref, { categoryId: 42, notes: '', applied: false }));
  await assertFails(updateDoc(ref, { categoryId: 'x'.repeat(129), notes: '', applied: false }));
  await assertFails(updateDoc(ref, { categoryId: 'cat-food', notes: 'y'.repeat(501), applied: false }));
});

test('anonimo NAO altera amount/description/date da transacao', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { amount: -1 }));
});

test('anonimo NAO escreve em transacao de sessao EXPIRADA', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_EXPIRED, 'transactions', 't1'),
    { categoryId: 'cat-food', notes: '', applied: false }));
});

test('anonimo NAO cria docs na subcolecao', async () => {
  await assertFails(setDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't9'), txSeed()));
});

test('conta estranha NAO cria transacao em sessao alheia (forja)', async () => {
  await assertFails(setDoc(
    doc(stranger(), 'categorizationSessions', TOK_VALID, 'transactions', 't9'), txSeed()));
});

// ---------------------------------------------------------------------------
// 4. update publico do doc da sessao (contadores)
// ---------------------------------------------------------------------------

test('anonimo atualiza categorizedCount/lastActivityAt validos', async () => {
  await assertSucceeds(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID),
    { categorizedCount: 1, lastActivityAt: Timestamp.now() }));
});

test('anonimo NAO grava categorizedCount invalido (negativo, > total, string)', async () => {
  const ref = doc(anon(), 'categorizationSessions', TOK_VALID);
  await assertFails(updateDoc(ref, { categorizedCount: -1, lastActivityAt: Timestamp.now() }));
  await assertFails(updateDoc(ref, { categorizedCount: 4, lastActivityAt: Timestamp.now() }));
  await assertFails(updateDoc(ref, { categorizedCount: '2', lastActivityAt: Timestamp.now() }));
});

test('anonimo NAO estende expiresAt nem muda status/transactionIds/userId', async () => {
  const ref = doc(anon(), 'categorizationSessions', TOK_VALID);
  await assertFails(updateDoc(ref, { expiresAt: future() }));
  await assertFails(updateDoc(ref, { status: 'applied' }));
  await assertFails(updateDoc(ref, { transactionIds: [] }));
  await assertFails(updateDoc(ref, { userId: STRANGER }));
});

test('anonimo NAO atualiza contadores de sessao EXPIRADA', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_EXPIRED),
    { categorizedCount: 1, lastActivityAt: Timestamp.now() }));
});

// ---------------------------------------------------------------------------
// 5. create da sessao
// ---------------------------------------------------------------------------

test('conta autenticada NAO cria sessao com userId de OUTRO (forja)', async () => {
  await assertFails(setDoc(
    doc(stranger(), 'categorizationSessions', 'tok-forged'), sessionSeed(future())));
});

test('anonimo NAO cria sessao', async () => {
  await assertFails(setDoc(
    doc(anon(), 'categorizationSessions', 'tok-anon'), sessionSeed(future())));
});

test('dono cria sessao em nome proprio (fluxo do createSession)', async () => {
  await assertSucceeds(setDoc(
    doc(owner(), 'categorizationSessions', 'tok-new-own'), sessionSeed(future())));
});

test('dono NAO cria sessao com expiresAt/transactionIds de tipo errado', async () => {
  await assertFails(setDoc(doc(owner(), 'categorizationSessions', 'tok-bad-exp'),
    Object.assign(sessionSeed(future()), { expiresAt: 'nunca' })));
  await assertFails(setDoc(doc(owner(), 'categorizationSessions', 'tok-bad-ids'),
    Object.assign(sessionSeed(future()), { transactionIds: 't1' })));
});

// ---------------------------------------------------------------------------
// 6. /users/{uid} privado
// ---------------------------------------------------------------------------

test('dono le e escreve os proprios /users/{uid}', async () => {
  await assertSucceeds(getDoc(doc(owner(), 'users', OWNER, 'transactions', 't1')));
  await assertSucceeds(updateDoc(
    doc(owner(), 'users', OWNER, 'transactions', 't1'), { categoryId: 'cat-food' }));
});

test('conta estranha NAO le nem escreve /users de outro', async () => {
  await assertFails(getDoc(doc(stranger(), 'users', OWNER, 'transactions', 't1')));
  await assertFails(updateDoc(
    doc(stranger(), 
      'users', OWNER, 'transactions', 't1'), { categoryId: 'x' }));
});

test('anonimo NAO le /users de ninguem', async () => {
  await assertFails(getDoc(doc(anon(), 'users', OWNER, 'transactions', 't1')));
});

// ---------------------------------------------------------------------------
// 7. Integracao com o fluxo do Felix (increment atomico, renovacao pelo dono,
//    delta orfao applied+orphaned)
// ---------------------------------------------------------------------------

test('anonimo incrementa categorizedCount via increment() dentro do range', async () => {
  // seed: categorizedCount=1, total=3 → +1 = 2, dentro do teto.
  await assertSucceeds(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_COUNTER),
    { categorizedCount: increment(1), lastActivityAt: Timestamp.now() }));
});

test('anonimo NAO incrementa alem do teto (increment avaliado pos-transform)', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_COUNTER),
    { categorizedCount: increment(10), lastActivityAt: Timestamp.now() }));
});

test('anonimo NAO decrementa abaixo de zero via increment()', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_COUNTER),
    { categorizedCount: increment(-5), lastActivityAt: Timestamp.now() }));
});

test('dono renova expiresAt (apply/reopenSession) e muda status', async () => {
  await assertSucceeds(updateDoc(
    doc(owner(), 'categorizationSessions', TOK_VALID),
    { expiresAt: future() }));
  await assertSucceeds(updateDoc(
    doc(owner(), 'categorizationSessions', TOK_VALID),
    { appliedCount: 1, status: 'active' }));
});

test('anonimo NAO renova expiresAt de sessao expirada (so o dono reabre)', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_EXPIRED),
    { expiresAt: future() }));
});

test('dono marca applied:true + orphaned:true na subcolecao (delta orfao)', async () => {
  await assertSucceeds(updateDoc(
    doc(owner(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { applied: true, orphaned: true }));
  // devolve o seed para nao interferir em re-runs no mesmo emulador vivo
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'), txSeed());
  });
});

test('anonimo NAO grava orphaned (fora da allow-list publica)', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { categoryId: 'cat-food', notes: '', applied: false, orphaned: true }));
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { orphaned: true }));
});

// ---------------------------------------------------------------------------
// 8. Flags de reembolso na sessao (markReimbursement / markAwaiting):
//    tipo bool + sinal do amount (gasto ↔ markAwaiting; entrada ↔
//    markReimbursement) + compat com docs legados sem os campos.
// ---------------------------------------------------------------------------

test('anonimo marca "vou pedir reembolso" (markAwaiting) num GASTO', async () => {
  await assertSucceeds(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { markAwaiting: true, applied: false }));
});

test('anonimo desmarca markAwaiting (toggle liga/desliga)', async () => {
  await assertSucceeds(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { markAwaiting: false, applied: false }));
});

test('anonimo marca "e um reembolso" (markReimbursement) numa ENTRADA', async () => {
  await assertSucceeds(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't2'),
    { markReimbursement: true, applied: false }));
});

test('anonimo NAO marca markReimbursement em GASTO (sinal errado)', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { markReimbursement: true, applied: false }));
});

test('anonimo NAO marca markAwaiting em ENTRADA (sinal errado)', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't2'),
    { markAwaiting: true, applied: false }));
});

test('anonimo NAO grava flag de tipo invalido (string, numero)', async () => {
  const t1 = doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1');
  const t2 = doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't2');
  await assertFails(updateDoc(t1, { markAwaiting: 'sim', applied: false }));
  await assertFails(updateDoc(t2, { markReimbursement: 1, applied: false }));
});

test('anonimo NAO combina flag com applied:true (nao pula o apply)', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't1'),
    { markAwaiting: true, applied: true }));
});

test('anonimo NAO marca flag em sessao EXPIRADA', async () => {
  await assertFails(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_EXPIRED, 'transactions', 't1'),
    { markAwaiting: true, applied: false }));
});

test('doc LEGADO (sem flags): anonimo ainda categoriza normalmente', async () => {
  await assertSucceeds(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't3'),
    { categoryId: 'cat-food', notes: 'legado ok', applied: false }));
});

test('doc LEGADO: anonimo adiciona a flag num gasto (campo novo no merge)', async () => {
  await assertSucceeds(updateDoc(
    doc(anon(), 'categorizationSessions', TOK_VALID, 'transactions', 't3'),
    { markAwaiting: true, applied: false }));
});

test('dono grava flags livremente (nao passa pela allow-list publica)', async () => {
  await assertSucceeds(updateDoc(
    doc(owner(), 'categorizationSessions', TOK_VALID, 'transactions', 't2'),
    { markReimbursement: true }));
});
