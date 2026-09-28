// Equivalência com uma LEITURA REAL: o mesmo arquivo e o mesmo backup rodados
// pelo ImportModal do master e pelo da árvore de trabalho (ou de outro commit),
// e pela API de `src/lib` que um caminho fora da tela vai chamar. Diz se as
// saídas são idênticas — linhas do preview, duplicatas, seleção e o lote que
// seria gravado.
//
// NÃO abre o app, NÃO autentica, NÃO faz rede, NÃO grava nada: o backup e o
// arquivo são só lidos, o `onImport` é um coletor e os pacotes vão para uma
// pasta temporária apagada no fim. Não imprime descrição nem valor: só
// contagens e, se houver diferença, os índices e os nomes dos campos.
//
// Uso (fuso obrigatório, como nos testes):
//
//   TZ=America/Sao_Paulo node tests/import/compare-real.mjs \
//     --backup  /fora/do/repo/backup.json \
//     --leitura /fora/do/repo/resposta-parse-statement.json   (fatura/extrato lido por IA)
//   | --ofx     /fora/do/repo/extrato.ofx
//   | --wise    /fora/do/repo/extrato-wise.csv
//     [--mes 2026-08] [--dia 10] [--selecionar-tudo] [--contra <commit>]
//
// --backup: o JSON de Configurações → Backup e Restauração. Só as coleções
//   `transactions`, `accounts`, `categories`, `categoryRules`,
//   `familyMembers` e `titularMappings` são lidas; a chave da API que o
//   backup carrega NÃO é lida nem usada.
// --leitura: a resposta de `/api/parse-statement` para o arquivo (o JSON que
//   o app recebe da IA). A leitura por IA não é determinística, então a
//   comparação fixa UMA leitura e passa a mesma para os dois lados. Obtenha-a
//   uma vez no app (DevTools → Rede → parse-statement → Resposta → salvar),
//   sem importar nada.
// --mes / --dia: o mês de pagamento e o dia de vencimento que o usuário
//   escolheria na tela (sem eles vale o que a tela sugere).
// --contra: compara o master com este commit em vez da árvore de trabalho.
//
// Os arquivos de entrada têm de estar FORA do repositório (o script recusa):
// dado real não entra em commit.
import fs from 'node:fs';
import path from 'node:path';
import { rolldown } from 'rolldown';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { REPO, exportRef, loadComponent, loadLibPure } from './bundle.mjs';
import { mountImport, withBrowserFakes, settle, canon } from './driver.mjs';
import { assertTz } from './run.mjs';

function args() {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return {
    backup: get('--backup'), leitura: get('--leitura'), ofx: get('--ofx'), wise: get('--wise'),
    mes: get('--mes'), dia: get('--dia'), contra: get('--contra'), tudo: a.includes('--selecionar-tudo'),
  };
}

function outsideRepo(p, label) {
  if (!p) return;
  const abs = path.resolve(p);
  if (abs === REPO || abs.startsWith(REPO + path.sep)) {
    throw new Error(`${label} está dentro do repositório (${abs}). Dado real não entra aqui: mova o arquivo para fora.`);
  }
  if (!fs.existsSync(abs)) throw new Error(`${label} não encontrado: ${abs}`);
}

// ── backup → props da tela, como os hooks montam ──────────────────────────
const TS = '__firestoreTimestamp__';
const toDate = (v) => (v && v[TS] === true ? new Date((Number(v.seconds) || 0) * 1000 + Math.floor((Number(v.nanoseconds) || 0) / 1e6)) : null);
// Firestore ordena texto por bytes UTF-8; empates, pelo id do documento.
const byBytes = (a, b) => Buffer.compare(Buffer.from(String(a ?? '')), Buffer.from(String(b ?? '')));

async function helpers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-real-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'entry.mjs');
  fs.writeFileSync(entry, [
    `export { normalizeTitular } from ${JSON.stringify(path.join(REPO, 'src/lib/utils.ts'))};`,
    `export { matchCategoryId } from ${JSON.stringify(path.join(REPO, 'src/lib/categoryRules.ts'))};`,
    `export { parseOfx } from ${JSON.stringify(path.join(REPO, 'src/lib/parseOfx.ts'))};`,
  ].join('\n'));
  const b = await rolldown({ input: entry, platform: 'node', logLevel: 'silent' });
  await b.write({ file: path.join(dir, 'h.mjs'), format: 'esm' });
  await b.close();
  return import(pathToFileURL(path.join(dir, 'h.mjs')).href);
}

function propsFromBackup(file, h) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const col = (name) => (raw.collections?.[name] ?? []).map((d) => ({ id: d.id, data: d.data ?? {} }));
  const sortBy = (docs, field, dir = 1) => [...docs].sort((x, y) => {
    const c = field === 'date'
      ? ((toDate(x.data.date)?.getTime() ?? 0) - (toDate(y.data.date)?.getTime() ?? 0))
      : byBytes(x.data[field], y.data[field]);
    return c !== 0 ? dir * c : byBytes(x.id, y.id);
  });

  // Espelho de `docToTransaction` (src/hooks/useTransactions.ts).
  const transactions = sortBy(col('transactions'), 'date', -1).map(({ id, data }) => ({
    id,
    date: toDate(data.date),
    description: data.description || '',
    amount: data.amount || 0,
    categoryId: data.categoryId || null,
    account: data.account || '',
    familyMember: data.familyMember || '',
    titular: h.normalizeTitular(data.titular || ''),
    purchaseDate: data.purchaseDate ? toDate(data.purchaseDate) : null,
    installmentNumber: data.installmentNumber ?? null,
    totalInstallments: data.totalInstallments ?? null,
    cardNumber: data.cardNumber || null,
    projectId: data.projectId || null,
    pluggyTransactionId: data.pluggyTransactionId || null,
    tags: data.tags || [],
    notes: data.notes || '',
    noteAlert: data.noteAlert || false,
    importBatch: data.importBatch || null,
    reconciled: data.reconciled || false,
    reconciledAt: data.reconciledAt ? toDate(data.reconciledAt) : null,
    createdAt: toDate(data.createdAt) || new Date(0),
    billingMonth: data.billingMonth || null,
    provisionalDate: data.provisionalDate ? toDate(data.provisionalDate) : null,
    fitid: data.fitid || null,
    amountFx: typeof data.amountFx === 'number' ? data.amountFx : null,
    currencyFx: data.currencyFx || null,
    fxRate: typeof data.fxRate === 'number' ? data.fxRate : null,
    isReimbursement: data.isReimbursement || false,
    reimbursementFor: data.reimbursementFor || null,
    awaitingReimbursement: data.awaitingReimbursement || false,
    reimbursementPrevCategoryId: data.reimbursementPrevCategoryId ?? null,
  }));
  const byId = new Map(transactions.map((t) => [t.id, t]));
  for (const t of transactions) {
    const target = t.reimbursementFor ? byId.get(t.reimbursementFor) : undefined;
    t.effectiveDate = target ? target.date : t.date;
  }

  const accounts = sortBy(col('accounts'), 'name').map(({ id, data }) => ({
    id, name: data.name || '', type: data.type || 'corrente', bank: data.bank || '',
    closingDay: data.closingDay || undefined, dueDay: data.dueDay || undefined,
    creditLimit: data.creditLimit || undefined, createdAt: toDate(data.createdAt) || new Date(0),
  }));
  const categories = sortBy(col('categories'), 'name').map(({ id, data }) => ({ id, ...data }));
  const rules = sortBy(col('categoryRules'), 'pattern').map(({ id, data }) => ({
    id, pattern: data.pattern || '', keywords: Array.isArray(data.keywords) ? data.keywords : [],
    categoryId: data.categoryId || '', createdAt: toDate(data.createdAt) || new Date(0),
  }));
  const memberNames = sortBy(col('familyMembers'), 'name').map((d) => d.data.name);
  const titularNames = [...new Set(sortBy(col('titularMappings'), 'titularName').map((d) => d.data.titularName))];

  return {
    existingTransactions: transactions,
    accounts,
    accountNames: accounts.map((a) => a.name),
    categories,
    // Como o TransactionsPage passa: membros da família, senão os titulares.
    titularNames: memberNames.length > 0 ? memberNames : titularNames,
    // `allTitulars` só entra quando não há membro nem titular cadastrado.
    allTitulars: memberNames.length > 0 ? memberNames : titularNames,
    matchCategory: (desc) => h.matchCategoryId(rules, desc),
    fxWallets: [],
  };
}

async function runSide(loaded, props, input, opt) {
  return withBrowserFakes(input.ai ?? null, async (calls) => {
    const ui = mountImport(loaded, props);
    await ui.drop(input.file);
    await settle();
    if (opt.mes) await ui.set('billingMonth', opt.mes);
    if (opt.dia) await ui.set('billingDueDay', opt.dia);
    if (opt.tudo) await ui.set('selected', new Set(ui.get('items').map((_, i) => i)));
    const preview = {
      error: ui.get('error'), step: ui.get('step'), isCreditCard: ui.get('isCreditCard'),
      billingMonth: ui.get('billingMonth'), billingDueDay: ui.get('billingDueDay'),
      detectedAccount: ui.get('detectedAccount'), rows: ui.get('items'),
      selected: [...ui.get('selected')].sort((a, b) => a - b),
    };
    await ui.clickImport();
    return { preview: canon(preview), lote: canon(ui.captured.onImport[0] ?? null), erroAoGravar: ui.get('error'), rede: calls };
  });
}

function counts(side) {
  const rows = side.preview.rows ?? [];
  return {
    linhas: rows.length,
    duplicatas: rows.filter((r) => r.isDuplicate).length,
    selecionadas: side.preview.selected.length,
    aGravar: Array.isArray(side.lote) ? side.lote.length : 0,
    cartao: side.preview.isCreditCard,
    mes: side.preview.billingMonth || '-',
    dia: side.preview.billingDueDay || '-',
    erro: side.preview.error ? 'sim' : 'não',
  };
}

function whereDiffers(a, b) {
  const out = [];
  const ra = a.preview.rows ?? [], rb = b.preview.rows ?? [];
  if (ra.length !== rb.length) out.push(`preview: ${ra.length} x ${rb.length} linhas`);
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    const keys = new Set([...Object.keys(ra[i]), ...Object.keys(rb[i])]);
    const f = [...keys].filter((k) => !isDeepStrictEqual(ra[i][k], rb[i][k]));
    if (f.length) out.push(`preview linha ${i}: ${f.join(', ')}`);
  }
  for (const k of ['selected', 'isCreditCard', 'billingMonth', 'billingDueDay', 'detectedAccount', 'error', 'step']) {
    if (!isDeepStrictEqual(a.preview[k], b.preview[k])) out.push(`preview: ${k}`);
  }
  const la = a.lote ?? [], lb = b.lote ?? [];
  if (la.length !== lb.length) out.push(`lote: ${la.length} x ${lb.length} lançamentos`);
  for (let i = 0; i < Math.min(la.length, lb.length); i++) {
    const keys = new Set([...Object.keys(la[i]), ...Object.keys(lb[i])]);
    const f = [...keys].filter((k) => !isDeepStrictEqual(la[i][k], lb[i][k]));
    if (f.length) out.push(`lote lançamento ${i}: ${f.join(', ')}`);
  }
  return out;
}

async function main() {
  assertTz();
  const o = args();
  const fontes = [o.leitura, o.ofx, o.wise].filter(Boolean);
  if (!o.backup || fontes.length !== 1) {
    throw new Error('informe --backup e exatamente uma de --leitura, --ofx ou --wise (ver o cabeçalho do script)');
  }
  outsideRepo(o.backup, '--backup');
  outsideRepo(fontes[0], o.leitura ? '--leitura' : o.ofx ? '--ofx' : '--wise');

  const h = await helpers();
  const props = propsFromBackup(o.backup, h);
  let input;
  if (o.leitura) {
    const r = JSON.parse(fs.readFileSync(o.leitura, 'utf8'));
    const ai = Array.isArray(r) ? { transactions: r } : r;
    ai.usage ??= { input_tokens: 0, output_tokens: 0 };
    // Nome .csv com texto qualquer: o conteúdo não importa, a "IA" devolve `ai`.
    input = { ai, file: new File(['leitura-fixada;'.repeat(8)], 'leitura.csv') };
  } else if (o.ofx) {
    input = { file: new File([fs.readFileSync(o.ofx)], path.basename(o.ofx).replace(/[^\w.]/g, '_')) };
  } else {
    input = { file: new File([fs.readFileSync(o.wise)], 'wise.csv') };
  }

  const master = await loadComponent(exportRef('master'), 'master');
  const outro = o.contra ? await loadComponent(exportRef(o.contra), o.contra) : await loadComponent(REPO, 'worktree');
  const A = await runSide(master, { ...props }, input, o);
  const B = await runSide(outro, { ...props }, input, o);

  console.log(`transações no backup: ${props.existingTransactions.length} · contas: ${props.accounts.length}`);
  console.log('master     ', JSON.stringify(counts(A)));
  console.log(`${(o.contra ?? 'trabalho').padEnd(11)}`, JSON.stringify(counts(B)));
  const diffs = whereDiffers(A, B);

  // A API da lib, como o operador vai chamá-la (só para leitura por IA e OFX).
  if (o.leitura || o.ofx) {
    const lib = await loadLibPure(REPO);
    const pv = A.preview;
    let rows;
    if (o.leitura) {
      rows = lib.buildAiRows(input.ai, {
        accounts: props.accounts, accountNames: props.accountNames,
        memberOptions: props.titularNames.length > 0 ? props.titularNames : props.allTitulars,
        matchCategory: props.matchCategory, existingTransactions: props.existingTransactions,
      }).rows;
    } else {
      // Mesma escolha de decodificador da tela (`handleParseOfx`).
      const buf = fs.readFileSync(o.ofx);
      const header = new TextDecoder('latin1').decode(buf.subarray(0, 512));
      const isUtf8 = /ENCODING\s*:\s*UTF-?8/i.test(header) || /encoding\s*=\s*["']?utf-?8/i.test(header);
      const parsed = h.parseOfx(new TextDecoder(isUtf8 ? 'utf-8' : 'windows-1252').decode(buf));
      const acct = lib.matchOfxAccountName(parsed.account.bankId, props.accounts.filter((x) => x.type !== 'cartao'));
      rows = lib.buildOfxRows(parsed.transactions, acct, props.existingTransactions);
    }
    const libRowsOk = isDeepStrictEqual(canon(rows), pv.rows);
    const card = lib.billingCardAccountFor(props.accounts.filter((x) => x.type === 'cartao'), rows);
    const due = lib.effectiveDueDayFor(pv.billingDueDay, card);
    const lote = lib.buildImportItems(rows, new Set(pv.selected), { isCreditCard: pv.isCreditCard, billingMonth: pv.billingMonth, effectiveDueDay: due });
    const libLoteOk = isDeepStrictEqual(canon(lote), A.lote);
    console.log(`lib (operador): preview ${libRowsOk ? 'IGUAL' : 'DIFERENTE'} ao master · lote ${libLoteOk ? 'IGUAL' : 'DIFERENTE'} ao master`);
    if (!libRowsOk) diffs.push('lib: preview');
    if (!libLoteOk) diffs.push('lib: lote');
  }

  if (A.rede.length > 1 || B.rede.length > 1) diffs.push('chamadas à IA inesperadas');
  console.log(diffs.length ? `DIFERENTE em ${diffs.length} ponto(s):\n  ${diffs.slice(0, 50).join('\n  ')}` : 'IGUAL: master e refatorado produzem o mesmo preview e o mesmo lote.');
  process.exitCode = diffs.length ? 1 : 0;
}

main().catch((e) => { console.error(`erro: ${e.message}`); process.exitCode = 2; });
