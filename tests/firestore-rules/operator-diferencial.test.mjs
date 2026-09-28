// Prova diferencial (Vex, parecer de 28-09-2026; incorporada pelo Mack na F4-1).
// Para todo principal que NAO e o operador, a regra nova decide exatamente como
// a regra de antes do operador (commit e32704a, o master em que a regra do
// operador foi baseada). Para o operador, o que muda so pode ser a leitura da
// arvore do dono. Emulador local, projetos demo-*.
//
// RULES_FILE: regra nova (padrao: firestore.rules do repo, com marcadores
// trocados por UIDs de teste). RULES_BASE: regra de antes (padrao:
// `git show e32704a:firestore.rules`). T_OWNER / T_OPERATOR: UIDs para o texto
// de producao; nunca imprimir.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, Timestamp, increment } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const OWNER = process.env.T_OWNER || 'owner-uid';
const OPERATOR = process.env.T_OPERATOR || 'operator-uid';
const STRANGER = 'stranger-uid-vex';
const withUids = (t) => t.replaceAll('__OPERADOR_UID__', OPERATOR).replaceAll('__DONO_UID__', OWNER);
const A = process.env.RULES_BASE
  ? readFileSync(process.env.RULES_BASE, 'utf8')
  : execFileSync('git', ['show', 'e32704a:firestore.rules'], { cwd: REPO, encoding: 'utf8' });
const B = withUids(readFileSync(process.env.RULES_FILE ? resolve(process.env.RULES_FILE) : resolve(REPO, 'firestore.rules'), 'utf8'));

const COLLS = ['transactions','accounts','categories','categoryRules','billingCycles','budgets','projects','familyMembers','titularMappings','fxWallets','goals'];
let envA, envB;
const fut = () => Timestamp.fromMillis(Date.now() + 48*3600e3);
const past = () => Timestamp.fromMillis(Date.now() - 3600e3);

async function seed(env, k) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const c of COLLS) await setDoc(doc(db,'users',OWNER,c,`d_${k}`), { name:'x', categoryId:'c1', amount:1 });
    await setDoc(doc(db,'users',OWNER), { root:1 });
    await setDoc(doc(db,'users',STRANGER,'transactions',`d_${k}`), { amount:1 });
    for (const [s, exp] of [[`sv_${k}`, fut()], [`se_${k}`, past()]]) {
      await setDoc(doc(db,'categorizationSessions',s), { userId:OWNER, transactionIds:['t1','t2'], expiresAt:exp, categorizedCount:0, lastActivityAt:Timestamp.now(), status:'active' });
      await setDoc(doc(db,'categorizationSessions',s,'categories','c1'), { name:'x' });
      await setDoc(doc(db,'categorizationSessions',s,'transactions','t1'), { categoryId:null, notes:'', applied:false, transactionId:'t1' });
    }
  });
}

function ops(uid) {
  const L = [];
  for (const c of COLLS) {
    L.push([`get ${c}`, (db,k)=>getDoc(doc(db,'users',OWNER,c,`d_${k}`))]);
    L.push([`list ${c}`, (db)=>getDocs(collection(db,'users',OWNER,c))]);
    L.push([`create ${c}`, (db,k)=>setDoc(doc(db,'users',OWNER,c,`n_${k}`), { name:'n' })]);
    L.push([`update ${c}`, (db,k)=>updateDoc(doc(db,'users',OWNER,c,`d_${k}`), { categoryId:'c2' })]);
    L.push([`set-sobre ${c}`, (db,k)=>setDoc(doc(db,'users',OWNER,c,`d_${k}`), { y:1 })]);
    L.push([`delete ${c}`, (db,k)=>deleteDoc(doc(db,'users',OWNER,c,`d_${k}`))]);
    L.push([`aninhado ${c}`, (db,k)=>setDoc(doc(db,'users',OWNER,c,`d_${k}`,'sub','z'), { z:1 })]);
  }
  L.push(['get raiz dono', (db)=>getDoc(doc(db,'users',OWNER))]);
  L.push(['set raiz dono', (db)=>setDoc(doc(db,'users',OWNER), { r:2 })]);
  L.push(['get arvore alheia', (db,k)=>getDoc(doc(db,'users',STRANGER,'transactions',`d_${k}`))]);
  L.push(['set arvore alheia', (db,k)=>setDoc(doc(db,'users',STRANGER,'transactions',`n_${k}`), { a:1 })]);
  L.push(['colecao raiz qualquer', (db,k)=>setDoc(doc(db,'outra',`n_${k}`), { a:1 })]);
  for (const sk of ['sv','se']) {
    const S = (k)=>`${sk}_${k}`;
    L.push([`${sk} get sessao`, (db,k)=>getDoc(doc(db,'categorizationSessions',S(k)))]);
    L.push([`${sk} update contador`, (db,k)=>updateDoc(doc(db,'categorizationSessions',S(k)), { categorizedCount:1, lastActivityAt:Timestamp.now() })]);
    L.push([`${sk} increment`, (db,k)=>updateDoc(doc(db,'categorizationSessions',S(k)), { categorizedCount:increment(1), lastActivityAt:Timestamp.now() })]);
    L.push([`${sk} renova expiresAt`, (db,k)=>updateDoc(doc(db,'categorizationSessions',S(k)), { expiresAt:fut() })]);
    L.push([`${sk} status`, (db,k)=>updateDoc(doc(db,'categorizationSessions',S(k)), { status:'applied' })]);
    L.push([`${sk} delete sessao`, (db,k)=>deleteDoc(doc(db,'categorizationSessions',S(k)))]);
    L.push([`${sk} le categorias`, (db,k)=>getDocs(collection(db,'categorizationSessions',S(k),'categories'))]);
    L.push([`${sk} grava categoria`, (db,k)=>setDoc(doc(db,'categorizationSessions',S(k),'categories','c9'), { name:'y' })]);
    L.push([`${sk} le transacoes`, (db,k)=>getDocs(collection(db,'categorizationSessions',S(k),'transactions'))]);
    L.push([`${sk} categoriza publico`, (db,k)=>updateDoc(doc(db,'categorizationSessions',S(k),'transactions','t1'), { categoryId:'c1', notes:'ok', applied:false })]);
    L.push([`${sk} applied true`, (db,k)=>updateDoc(doc(db,'categorizationSessions',S(k),'transactions','t1'), { applied:true })]);
    L.push([`${sk} orphaned`, (db,k)=>updateDoc(doc(db,'categorizationSessions',S(k),'transactions','t1'), { applied:true, orphaned:true })]);
    L.push([`${sk} cria tx sessao`, (db,k)=>setDoc(doc(db,'categorizationSessions',S(k),'transactions','t9'), { categoryId:null })]);
    L.push([`${sk} apaga tx sessao`, (db,k)=>deleteDoc(doc(db,'categorizationSessions',S(k),'transactions','t1'))]);
  }
  L.push(['list sessoes proprias', (db)=>getDocs(query(collection(db,'categorizationSessions'), where('userId','==', uid ?? 'x')))]);
  L.push(['list sessoes do dono', (db)=>getDocs(query(collection(db,'categorizationSessions'), where('userId','==', OWNER)))]);
  L.push(['list sessoes todas', (db)=>getDocs(collection(db,'categorizationSessions'))]);
  L.push(['cria sessao dono', (db,k)=>setDoc(doc(db,'categorizationSessions',`nw_${k}`), { userId:OWNER, transactionIds:[], expiresAt:fut(), categorizedCount:0 })]);
  L.push(['cria sessao propria', (db,k)=>setDoc(doc(db,'categorizationSessions',`np_${k}`), { userId: uid ?? 'x', transactionIds:[], expiresAt:fut(), categorizedCount:0 })]);
  return L;
}

async function outcome(p) {
  try { await p; return 'ok'; } catch (e) { return e?.code === 'permission-denied' ? 'negado' : `erro:${e?.code ?? e?.message}`; }
}

before(async () => {
  envA = await initializeTestEnvironment({ projectId: 'demo-planejador-diff-base', firestore: { rules: A, host: '127.0.0.1', port: 8080 } });
  envB = await initializeTestEnvironment({ projectId: 'demo-planejador-diff-nova', firestore: { rules: B, host: '127.0.0.1', port: 8080 } });
  await envA.clearFirestore(); await envB.clearFirestore();
});
after(async () => { await envA?.cleanup(); await envB?.cleanup(); });

const PRINCIPALS = [
  ['dono', (env)=>env.authenticatedContext(OWNER), OWNER],
  ['estranho', (env)=>env.authenticatedContext(STRANGER), STRANGER],
  ['anonimo-auth', (env)=>env.authenticatedContext('anon-vex', { firebase: { sign_in_provider: 'anonymous' } }), 'anon-vex'],
  ['sem-login', (env)=>env.unauthenticatedContext(), null],
];

test('diferencial master x producao para todo principal que nao e o operador', async () => {
  let k = 0, total = 0, allowed = 0; const bad = [];
  for (const [pn, ctx, uid] of PRINCIPALS) {
    for (const [on, fn] of ops(uid)) {
      k++; await seed(envA, k); await seed(envB, k);
      const a = await outcome(fn(ctx(envA).firestore(), k));
      const b = await outcome(fn(ctx(envB).firestore(), k));
      total++; if (a === 'ok') allowed++;
      if (a !== b || a.startsWith('erro')) bad.push(`${pn} | ${on} | master=${a} prod=${b}`);
    }
  }
  console.log(`VEX-DIFF total=${total} permitidos_no_master=${allowed} divergencias=${bad.length}`);
  for (const l of bad) console.log('VEX-DIFF-DIVERGE', l);
  assert.equal(bad.length, 0);
});

test('operador: o que muda em relacao a regra de antes e so a leitura da arvore do dono', async () => {
  // Na regra de antes o operador e um estranho qualquer.
  const esperado = new Set([...COLLS.flatMap((c) => [`get ${c}`, `list ${c}`]), 'get raiz dono']);
  const ganhou = []; const perdeu = [];
  let k = 100000;
  for (const [on, fn] of ops(OPERATOR)) {
    k++; await seed(envA, k); await seed(envB, k);
    const a = await outcome(fn(envA.authenticatedContext(OPERATOR).firestore(), k));
    const b = await outcome(fn(envB.authenticatedContext(OPERATOR).firestore(), k));
    assert.ok(!a.startsWith('erro') && !b.startsWith('erro'), `${on}: ${a} / ${b}`);
    if (a !== 'ok' && b === 'ok') ganhou.push(on);
    if (a === 'ok' && b !== 'ok') perdeu.push(on);
  }
  console.log(`VEX-OP ganhou=${ganhou.length} perdeu=${perdeu.length}`);
  assert.deepEqual(ganhou.filter((o) => !esperado.has(o)), []);
  assert.deepEqual([...esperado].filter((o) => !ganhou.includes(o)), []);
});
