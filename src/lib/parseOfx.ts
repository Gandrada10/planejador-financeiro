/**
 * parseOfx — parser OFX determinístico, client-side, zero rede, zero custo.
 *
 * Irmão SEM-IA de `functions/api/parse-statement.ts` (que usa Claude Haiku
 * para faturas de cartão em texto livre). Aqui o formato de entrada é
 * estruturado (OFX), então não precisa de modelo nenhum — regex/varredura
 * de blocos é suficiente e determinístico.
 *
 * ── Formato suportado ───────────────────────────────────────────────────
 * OFX 1.x / SGML (`OFXHEADER:100`, `DATA:OFXSGML`) é o alvo primário — é o
 * formato exportado pelo Itaú (e pela maioria dos bancos BR): tags de dado
 * "abertas" sem fechamento (`<TRNTYPE>DEBIT` sem `</TRNTYPE>`), mas tags de
 * agregado (`<STMTTRN>`, `<BANKACCTFROM>`, `<BANKTRANLIST>`, `<LEDGERBAL>`)
 * SEMPRE fecham — isso é garantido pela spec OFX 1.x, não é heurística.
 *
 * A extração de valor de tag usa uma regex "até o próximo `<`" —
 * `<TAG>([^<\r\n]*)` — que funciona igualmente bem para:
 *   - SGML: `<TRNTYPE>DEBIT\n<DTPOSTED>...` → captura "DEBIT" (para no \n)
 *   - XML:  `<TRNTYPE>DEBIT</TRNTYPE>`       → captura "DEBIT" (para no <)
 * Ou seja, o MESMO parser cobre OFX 2.x (XML) na prática, de graça, SEM
 * nunca instanciar um parser de XML/DOM — não há resolução de entidades
 * externas em lugar nenhum, então não existe superfície de XXE aqui. Não
 * criei um branch XML separado porque seria código morto: a extração
 * baseada em "valor até o próximo `<`" já é XML-safe para o caso comum
 * (tags de dado sem atributos, sem CDATA, sem namespaces). Documentado
 * como decisão, não como TODO pendente — se um dia aparecer um OFX 2.x
 * com CDATA ou atributos nas tags de transação, aí sim vale um parser XML
 * dedicado (com DOMParser em modo não-resolvedor de entidades).
 *
 * ── Encoding (IMPORTANTE para quem chama este módulo) ───────────────────
 * Esta função recebe `text: string` já decodificado — ela não lê bytes.
 * O header OFX declara `CHARSET:1252` (Windows-1252/Latin-1), NÃO UTF-8.
 * Extratos do Itaú têm acento nos MEMOs ("PIX TRANSF..."). Quem for ler o
 * arquivo do disco (ex.: o plug no ImportModal) PRECISA decodificar como
 * Windows-1252/Latin-1 — se ler como UTF-8, os acentos quebram (mojibake)
 * silenciosamente, sem erro. Exemplo de leitura correta em ambiente com
 * `TextDecoder` (browser/Node moderno):
 *
 *   const buf = await file.arrayBuffer();
 *   const text = new TextDecoder('windows-1252').decode(buf);
 *   const result = parseOfx(text);
 *
 * O charset efetivamente declarado no arquivo vem em `meta.charset`, para
 * o caller validar/logar — este módulo não decodifica, só relata.
 */

export interface OfxParsedTransaction {
  /** Chave natural de dedupe (tag FITID do OFX). Única dentro do arquivo
   *  (duplicatas são descartadas — ver `meta.duplicatesInFile`). Quando o
   *  arquivo não declara FITID para uma transação, uma chave sintética
   *  `SEM-FITID-<n>` é usada e um warning é emitido — dedupe contra dados
   *  já importados fica menos confiável nesse caso pontual. */
  fitid: string;
  /** `DTPOSTED`, ancorado ao meio-dia local (mesmo padrão de `invoiceDateFor`
   *  em `src/lib/utils.ts`) para nunca sofrer rollover de fuso horário. */
  date: Date;
  /** Conta corrente não tem "data de compra" separada da data de lançamento
   *  (isso só existe em fatura de cartão) — sempre `null` aqui. */
  purchaseDate: null;
  /** `MEMO`, só com trim (sem normalização agressiva — isso é downstream). */
  description: string;
  /** `parseFloat(TRNAMT)`. TRNAMT no OFX já vem assinado (negativo=débito,
   *  positivo=crédito) — o sinal NÃO é re-derivado de TRNTYPE. TRNTYPE é
   *  usado só como checagem cruzada (ver `trnType` + warnings). */
  amount: number;
  /** `TRNTYPE` cru (`"DEBIT"` | `"CREDIT"` | outro valor visto no arquivo),
   *  ou `null` se ausente. Guardado para auditoria/checagem cruzada. */
  trnType: string | null;
  /** `CHECKNUM`, se presente. No extrato Itaú de amostra é idêntico ao
   *  FITID, mas isso não é garantido pela spec — guardado à parte. */
  checkNum: string | null;
}

export interface OfxAccount {
  /** `BANKID` (código do banco, ex. "0341" = Itaú). */
  bankId: string | null;
  /** `ACCTID` (número da conta). */
  acctId: string | null;
  /** `ACCTTYPE` (ex. "CHECKING"). */
  acctType: string | null;
}

export interface OfxLedgerBalance {
  /** `BALAMT` — saldo declarado pelo banco na data `asOf`. */
  amount: number | null;
  /** `DTASOF`. */
  asOf: Date | null;
}

export type OfxFormat = 'sgml' | 'xml' | 'unknown';

export interface OfxParseMeta {
  /** Formato detectado pelo header. Ver nota de encoding acima — na prática
   *  o mesmo código de extração cobre 'sgml' e 'xml'; o campo é só
   *  informativo (para o caller decidir se quer validar/logar algo). */
  format: OfxFormat;
  /** Charset declarado no header OFX (ex. "1252"), ou `encoding=` do PI XML
   *  em OFX 2.x. `null` se não declarado. Este módulo NÃO decodifica bytes
   *  — é responsabilidade do caller (ver nota de encoding no topo). */
  charset: string | null;
  /** `DTSTART` do `BANKTRANLIST` (início do período do extrato). */
  dtStart: Date | null;
  /** `DTEND` do `BANKTRANLIST` (fim do período do extrato). */
  dtEnd: Date | null;
  /** Quantos blocos `<STMTTRN>` foram encontrados no arquivo (antes de
   *  qualquer skip/dedupe) — é o número pra bater com `transactions.length
   *  + skipped + duplicatesInFile` na validação. */
  stmttrnCount: number;
  /** `transactions.length` — atalho, já é o `.length` do array retornado. */
  parsedCount: number;
  /** Transações descartadas por malformação (TRNAMT ou DTPOSTED inválido/
   *  ausente). Nunca vira NaN silencioso — ou parseia certo, ou é
   *  descartada e contada aqui. */
  skipped: number;
  /** Linhas de SALDO ("Saldo do dia", "Saldo Anterior") que alguns bancos
   *  (ex.: Banco do Brasil) emitem como STMTTRN mas NÃO são transações —
   *  reconhecidas pelo NAME e puladas sem virar erro nem lançamento. */
  balanceSkipped: number;
  /** Transações descartadas por FITID repetido dentro do MESMO arquivo
   *  (mantida a 1ª ocorrência). Dedupe CONTRA dados já importados
   *  (Firestore) é responsabilidade do caller, usando `fitid` de cada
   *  transação retornada. */
  duplicatesInFile: number;
  /** Um item por transação descartada/suspeita, em texto legível — nunca
   *  inclui a descrição/MEMO (dado financeiro), só índice/FITID/campo. */
  warnings: string[];
}

export interface OfxParseResult {
  transactions: OfxParsedTransaction[];
  account: OfxAccount;
  ledgerBalance: OfxLedgerBalance;
  meta: OfxParseMeta;
}

const AMOUNT_RE = /^-?\d+(?:\.\d+)?$/;

/** Extrai o valor de uma tag de dado ("até o próximo `<`"). Funciona tanto
 *  para SGML sem fechamento quanto para XML com fechamento — ver nota de
 *  formato no topo do arquivo. Retorna `null` se a tag não existe ou está
 *  vazia (nunca string vazia — simplifica os checks de "ausente"). */
function extractTagValue(source: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\r\n]*)`, 'i');
  const m = re.exec(source);
  if (!m) return null;
  const value = m[1].trim();
  return value === '' ? null : value;
}

/** Extrai o conteúdo de uma tag de agregado (`<TAG>...</TAG>`), que SEMPRE
 *  fecha mesmo em OFX 1.x/SGML. Retorna `null` se a tag não existe. */
function extractBlock(source: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(source);
  return m ? m[1] : null;
}

function detectFormat(text: string): { format: OfxFormat; charset: string | null } {
  const head = text.slice(0, 2000);
  const looksXml = /<\?xml/i.test(head) || /OFXHEADER\s*=\s*["']?200/i.test(head);
  if (looksXml) {
    const encMatch = head.match(/encoding\s*=\s*["']([^"']+)["']/i);
    return { format: 'xml', charset: encMatch ? encMatch[1] : null };
  }
  const looksSgml = /OFXHEADER\s*:\s*100/i.test(head) || /DATA\s*:\s*OFXSGML/i.test(head);
  if (looksSgml) {
    const charsetMatch = head.match(/^CHARSET\s*:\s*(.+)$/im);
    return { format: 'sgml', charset: charsetMatch ? charsetMatch[1].trim() : null };
  }
  return { format: 'unknown', charset: null };
}

/** `DTPOSTED`/`DTASOF`/`DTSTART`/`DTEND` vêm como `YYYYMMDDHHMMSS[-03:EST]`
 *  (ou variações mais curtas). Usa só os primeiros 8 dígitos (ano/mês/dia)
 *  e ancora ao meio-dia local — mesmo padrão de `invoiceDateFor` em
 *  `src/lib/utils.ts` — para nunca sofrer rollover de fuso horário. */
function parseOfxDate(raw: string | null): Date | null {
  if (!raw) return null;
  const digits = raw.trim();
  if (digits.length < 8) return null;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  // Guarda contra datas "válidas na forma" mas inexistentes (ex. 20260231
  // → JS rola pra março). new Date normaliza silenciosamente; detectamos
  // comparando de volta.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** `TRNAMT` já vem assinado e com ponto decimal pelo padrão OFX
 *  (`-1884.40`, `1000.00`). Valida com regex ANTES de `parseFloat` — nunca
 *  confia em `parseFloat` sozinho, que aceita e trunca lixo à direita
 *  (`"12.3xyz"` → `12.3`) e produziria um valor de dinheiro errado calado. */
function parseOfxAmount(raw: string | null): number | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(',', '.');
  if (!AMOUNT_RE.test(normalized)) return null;
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parseia um extrato OFX (texto já decodificado — ver nota de encoding no
 * topo do arquivo) e retorna as transações mapeadas pro shape do app.
 *
 * Função pura: zero I/O, zero rede, zero mutação do input. Nunca lança —
 * entradas malformadas viram array vazio + `meta` explicando o motivo.
 */
export function parseOfx(text: string): OfxParseResult {
  const warnings: string[] = [];
  const { format, charset } = detectFormat(text);

  const account: OfxAccount = { bankId: null, acctId: null, acctType: null };
  const acctBlock = extractBlock(text, 'BANKACCTFROM');
  if (acctBlock) {
    account.bankId = extractTagValue(acctBlock, 'BANKID');
    account.acctId = extractTagValue(acctBlock, 'ACCTID');
    account.acctType = extractTagValue(acctBlock, 'ACCTTYPE');
  }

  const ledgerBalance: OfxLedgerBalance = { amount: null, asOf: null };
  const ledgerBlock = extractBlock(text, 'LEDGERBAL');
  if (ledgerBlock) {
    ledgerBalance.amount = parseOfxAmount(extractTagValue(ledgerBlock, 'BALAMT'));
    ledgerBalance.asOf = parseOfxDate(extractTagValue(ledgerBlock, 'DTASOF'));
  }

  const meta: OfxParseMeta = {
    format,
    charset,
    dtStart: null,
    dtEnd: null,
    stmttrnCount: 0,
    parsedCount: 0,
    skipped: 0,
    balanceSkipped: 0,
    duplicatesInFile: 0,
    warnings,
  };

  const tranListBlock = extractBlock(text, 'BANKTRANLIST');
  if (!tranListBlock) {
    warnings.push('BANKTRANLIST não encontrado no arquivo — nenhuma transação para importar.');
    return { transactions: [], account, ledgerBalance, meta };
  }

  meta.dtStart = parseOfxDate(extractTagValue(tranListBlock, 'DTSTART'));
  meta.dtEnd = parseOfxDate(extractTagValue(tranListBlock, 'DTEND'));

  const stmttrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  const seenKeys = new Set<string>();
  const transactions: OfxParsedTransaction[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = stmttrnRegex.exec(tranListBlock)) !== null) {
    index += 1;
    meta.stmttrnCount += 1;
    const block = match[1];

    const trnType = extractTagValue(block, 'TRNTYPE');
    const dtPostedRaw = extractTagValue(block, 'DTPOSTED');
    const trnAmtRaw = extractTagValue(block, 'TRNAMT');
    const fitidRaw = extractTagValue(block, 'FITID');
    const checkNum = extractTagValue(block, 'CHECKNUM');
    const name = extractTagValue(block, 'NAME');
    const memo = extractTagValue(block, 'MEMO');

    // Linhas de SALDO ("Saldo do dia", "Saldo Anterior") que alguns bancos
    // (ex.: Banco do Brasil) emitem como STMTTRN não são transações —
    // reconhecidas pelo NAME e puladas ANTES do parse de data, para não
    // poluir os avisos com "data inválida" nem criar lançamento fantasma.
    if (name && /^\s*saldo\b/i.test(name)) {
      meta.balanceSkipped += 1;
      continue;
    }

    const date = parseOfxDate(dtPostedRaw);
    if (date === null) {
      meta.skipped += 1;
      warnings.push(`STMTTRN #${index}: DTPOSTED inválido/ausente ("${dtPostedRaw ?? ''}") — transação descartada.`);
      continue;
    }

    const amount = parseOfxAmount(trnAmtRaw);
    if (amount === null) {
      meta.skipped += 1;
      warnings.push(`STMTTRN #${index}: TRNAMT inválido/ausente ("${trnAmtRaw ?? ''}") — transação descartada.`);
      continue;
    }

    const fitid = fitidRaw ?? `SEM-FITID-${index}`;
    if (!fitidRaw) {
      warnings.push(`STMTTRN #${index}: FITID ausente — usando chave sintética "${fitid}" (dedupe menos confiável para esta transação).`);
    }
    // Dedupe no arquivo por (FITID + data + valor), não só FITID: alguns bancos
    // (ex.: Banco do Brasil) reusam o MESMO FITID em transações DIFERENTES
    // (todos os "Resgate CDB" com o mesmo id). Deduplicar só por FITID
    // descartava transações reais e distintas. Só é duplicata quando FITID,
    // data e valor batem — aí sim é a mesma linha repetida no arquivo.
    const dedupeKey = `${fitid}|${date.getTime()}|${amount}`;
    if (seenKeys.has(dedupeKey)) {
      meta.duplicatesInFile += 1;
      warnings.push(`STMTTRN #${index}: duplicata exata (mesmo FITID, data e valor) — descartada (mantida a 1ª ocorrência).`);
      continue;
    }
    seenKeys.add(dedupeKey);

    if (trnType) {
      const t = trnType.toUpperCase();
      if (t === 'DEBIT' && amount > 0) {
        warnings.push(`STMTTRN #${index} (FITID ${fitid}): TRNTYPE=DEBIT mas TRNAMT positivo — mantido o sinal de TRNAMT.`);
      } else if (t === 'CREDIT' && amount < 0) {
        warnings.push(`STMTTRN #${index} (FITID ${fitid}): TRNTYPE=CREDIT mas TRNAMT negativo — mantido o sinal de TRNAMT.`);
      }
    }

    transactions.push({
      fitid,
      date,
      purchaseDate: null,
      // MEMO quando existe (traz o detalhe/contraparte); senão NAME — vários
      // bancos deixam o MEMO vazio em lançamentos como "Resgate CDB",
      // "Rendimento", etc., que ficariam sem descrição.
      description: memo ?? name ?? '',
      amount,
      trnType,
      checkNum,
    });
  }

  meta.parsedCount = transactions.length;
  return { transactions, account, ledgerBalance, meta };
}
