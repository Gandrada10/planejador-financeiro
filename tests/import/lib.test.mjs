// A API de `src/lib` que um caminho de importação fora da tela vai chamar
// (buildAiRows, buildOfxRows, billingCardAccountFor, effectiveDueDayFor,
// buildImportItems) tem de devolver EXATAMENTE o que o ImportModal do master
// mostrou no preview e entregou ao `onImport` nos mesmos cenários — o golden
// dos cenários de componente é a referência.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REPO, loadLibPure } from './bundle.mjs';
import { canon } from './driver.mjs';
import { GOLDEN, assertTz } from './run.mjs';
import { parseOfx } from './ofx-parse.mjs';
import * as F from './fixtures.mjs';

const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).result.components;
let lib;

before(async () => {
  assertTz();
  lib = await loadLibPure(REPO);
});

const cards = F.accounts.filter((a) => a.type === 'cartao');

function aiCtx(existing, accounts = F.accounts) {
  return {
    accounts,
    accountNames: F.accountNames,
    memberOptions: F.titularNames,
    matchCategory: F.matchCategory,
    existingTransactions: existing,
  };
}

/** Mesmo caminho da tela: linhas → cartão-alvo → dia efetivo → lote. */
function importFrom(rows, selected, { isCreditCard, billingMonth, billingDueDay }, accounts = F.accounts) {
  const card = lib.billingCardAccountFor(accounts.filter((a) => a.type === 'cartao'), rows);
  const effectiveDueDay = lib.effectiveDueDayFor(billingDueDay, card);
  return lib.buildImportItems(rows, selected, { isCreditCard, billingMonth, effectiveDueDay });
}

const nonDup = (rows) => new Set(rows.map((_, i) => i).filter((i) => !rows[i].isDuplicate));

test('buildAiRows reproduz o preview do master (fatura, fatura por heurística, extrato)', () => {
  const cases = [
    ['A1 fatura: dedupe por data da compra, contagem, parcelas, reembolso', F.invoiceAi, F.invoiceExisting, F.accounts],
    ['A4 fatura: titular desconhecido trava a gravação', F.invoiceAiUnknownTitular, F.invoiceExisting, F.accounts],
    ['A5 fatura: heurística de cartão, cartão único', F.invoiceAiHeuristic, [], F.accounts.filter((a) => a.name !== 'Cartão Beta')],
    ['A6 fatura: mês sugerido pela compra mais recente, estorno não casa com compra', F.invoiceAiMonths, F.invoiceMonthsExisting, F.accounts],
    ['B1 extrato via IA: critério com descrição, parcelas futuras automáticas', F.statementAi, F.statementExisting, F.accounts],
  ];
  for (const [name, ai, existing, accounts] of cases) {
    const g = golden[name].preview;
    const r = lib.buildAiRows(ai, aiCtx(existing, accounts));
    assert.deepStrictEqual(canon(r.rows), g.rows, name);
    assert.equal(r.suggestedAccount, g.detectedAccount, name);
    assert.equal(r.detectedCreditCard, g.isCreditCard, name);
    assert.equal(r.billingMonth ?? '', g.billingMonth, name);
    assert.deepStrictEqual([...nonDup(r.rows)], g.selected, name);
  }
});

test('buildImportItems reproduz o lote gravado pelo master (datas de caixa, billingMonth, parcelas futuras)', () => {
  const A = 'A1 fatura: dedupe por data da compra, contagem, parcelas, reembolso';
  const rows = lib.buildAiRows(F.invoiceAi, aiCtx(F.invoiceExisting)).rows;
  const g1 = golden[A].preview;

  // A1: mês e dia como a tela sugeriu
  assert.deepStrictEqual(
    canon([importFrom(rows, nonDup(rows), { isCreditCard: true, billingMonth: g1.billingMonth, billingDueDay: g1.billingDueDay })]),
    golden[A].afterImport.onImport
  );
  // A2: fevereiro, dia 31, tudo selecionado
  assert.deepStrictEqual(
    canon([importFrom(rows, new Set(rows.map((_, i) => i)), { isCreditCard: true, billingMonth: '2026-02', billingDueDay: '31' })]),
    golden['A2 fatura: mês trocado, dia 31 em fevereiro, tudo selecionado'].afterImport.onImport
  );
  // A3: parcelas futuras editadas na tela
  const edited = rows.map((r, i) => {
    if (i === 3) return { ...r, installmentType: 'parcelada', periodicity: 1 };
    if (i === 4) return { ...r, installmentType: 'parcelada', periodicity: 2, installmentAmount: -49.5 };
    return r;
  });
  assert.deepStrictEqual(
    canon([importFrom(edited, nonDup(rows), { isCreditCard: true, billingMonth: '2026-01', billingDueDay: '31' })]),
    golden['A3 fatura: parcelas futuras, periodicidade 1 e 2, vencimento dia 31'].afterImport.onImport
  );
  // A5: um cartão só, dia do cadastro
  const acc5 = F.accounts.filter((a) => a.name !== 'Cartão Beta');
  const r5 = lib.buildAiRows(F.invoiceAiHeuristic, aiCtx([], acc5));
  assert.deepStrictEqual(
    canon([importFrom(r5.rows, nonDup(r5.rows), { isCreditCard: true, billingMonth: r5.billingMonth, billingDueDay: '10' }, acc5)]),
    golden['A5 fatura: heurística de cartão, cartão único'].afterImport.onImport
  );
  // B1: extrato — sem data de caixa de fatura, parcelas futuras automáticas
  const rb = lib.buildAiRows(F.statementAi, aiCtx(F.statementExisting)).rows;
  assert.deepStrictEqual(
    canon([importFrom(rb, nonDup(rb), { isCreditCard: false, billingMonth: '', billingDueDay: '' })]),
    golden['B1 extrato via IA: critério com descrição, parcelas futuras automáticas'].afterImport.onImport
  );
});

test('buildOfxRows + buildImportItems reproduzem o OFX do master', () => {
  const C = 'C1 OFX: FITID+conta+valor, FITID reciclado, reserva por valor';
  const parsed = parseOfx(F.ofxText);
  const acct = lib.matchOfxAccountName(parsed.account.bankId, F.accounts.filter((a) => a.type !== 'cartao'));
  const rows = lib.buildOfxRows(parsed.transactions, acct, F.ofxExisting);
  assert.deepStrictEqual(canon(rows), golden[C].preview.rows);
  assert.deepStrictEqual(
    canon([importFrom(rows, nonDup(rows), { isCreditCard: false, billingMonth: '', billingDueDay: '' })]),
    golden[C].afterImport.onImport
  );
});

test('billingCardAccountFor / effectiveDueDayFor: cartão único, o mais frequente, override', () => {
  assert.equal(lib.billingCardAccountFor([cards[0]], [])?.name, 'Cartão Alfa');
  const rows = [{ account: 'Cartão Beta' }, { account: 'Cartão Beta' }, { account: 'Cartão Alfa' }, { account: '' }];
  assert.equal(lib.billingCardAccountFor(cards, rows)?.name, 'Cartão Beta');
  assert.equal(lib.billingCardAccountFor(cards, [{ account: 'Conta Gama' }]), null);
  assert.equal(lib.effectiveDueDayFor('', cards[1]), 31);
  assert.equal(lib.effectiveDueDayFor(' 5 ', cards[1]), 5);
  assert.equal(lib.effectiveDueDayFor('abc', cards[0]), 10);
  assert.equal(lib.effectiveDueDayFor('', null), null);
});
