/**
 * parseWiseStatement — parser determinístico do extrato da Wise (ou de
 * qualquer conta em moeda estrangeira que exporte o mesmo layout).
 *
 * Terceiro irmão dos parsers de importação, ao lado de `parseOfx` (extrato de
 * conta corrente, determinístico) e `functions/api/parse-statement.ts` (fatura
 * de cartão em texto livre, via IA). Aqui o formato é estruturado e estável —
 * cabeçalho nomeado, id próprio por lançamento — então NÃO passa por IA: é
 * varredura de colunas, reprodutível e de graça.
 *
 * ── Duas entradas, um núcleo ───────────────────────────────────────────────
 * A Wise exporta o MESMO extrato em CSV e em XLSX, e traduz os NOMES DAS
 * COLUNAS para o idioma da conta ("Amount"/"Valor", "Running Balance"/"Saldo
 * cumulativo"). O núcleo (`parseWiseRows`) trabalha sobre linhas já
 * desserializadas em objetos e resolve as colunas por uma tabela de apelidos;
 * `parseWiseCsv` é só o adaptador do CSV. O XLSX entra pelo mesmo núcleo, com
 * a planilha lida por quem chama (a lib já está no bundle do importador).
 *
 * Por isso os valores chegam como `string` (CSV) OU `number`/`Date` (XLSX):
 * toda leitura de célula passa pelos conversores tolerantes daqui.
 *
 * ── Por que este parser existe ─────────────────────────────────────────────
 * O extrato vem TODO na moeda da conta (ex.: EUR) e mistura duas coisas que o
 * app trata de formas opostas:
 *
 *   1. CONVERSÕES (BRL → EUR): a compra de moeda. NÃO é despesa — é dinheiro
 *      trocando de bolso, o mesmo caso da categoria `excludeFromTotals`
 *      ("Transferência", ver `src/lib/utils.ts`). Costuma JÁ existir no app,
 *      importada do extrato da conta corrente que pagou por ela.
 *   2. MOVIMENTOS (compras no cartão, saques, cobranças): a despesa real, que
 *      é o que deve entrar nos totais — convertida para BRL pelo CUSTO
 *      efetivo dos euros gastos, não por uma cotação de tabela.
 *
 * Este módulo só SEPARA e NORMALIZA os dois grupos. O apreçamento em BRL
 * (FIFO por lote de conversão) vive em `src/lib/fxLedger.ts` — a divisão de
 * responsabilidade é de propósito: parsear é sobre o formato do arquivo,
 * apreçar é sobre contabilidade de câmbio, e os dois evoluem por motivos
 * diferentes.
 *
 * ── Netting por `TransferWise ID` (CRÍTICO) ────────────────────────────────
 * A Wise emite MAIS DE UMA LINHA com o MESMO id quando um lançamento é
 * ajustado depois: hotel que pré-autoriza um valor e cobra outro, cobrança
 * cancelada inteira, estorno parcial do mesmo comerciante. Elas não são
 * transações independentes — são a mesma transação corrigida.
 *
 * Somamos as linhas do mesmo id numa entrada só. Sem isso o app registraria
 * uma despesa inflada MAIS uma falsa receita (o estorno), errando os dois
 * lados: a categoria fica com gasto que não houve e o mês ganha uma entrada
 * que nunca existiu. Grupos que somam zero (cobrança cancelada por inteiro)
 * são descartados — ver `meta.zeroed`.
 *
 * A data e a descrição do grupo vêm da linha de MAIOR valor absoluto (a
 * cobrança original), não da última — o ajuste chega dias depois e ancoraria
 * a despesa no mês errado.
 *
 * ── Dedupe contra o que já foi importado ───────────────────────────────────
 * O `TransferWise ID` é chave natural estável (o mesmo papel do `FITID` no
 * OFX) e é devolvido em `WiseEntry.id` para o caller gravar em
 * `Transaction.fitid`. Reimportar o mesmo extrato — ou um extrato que se
 * sobrepõe ao anterior — reconhece as linhas repetidas em vez de duplicar.
 */

import Papa from 'papaparse';

/** Lançamento já normalizado e com netting aplicado. */
export interface WiseEntry {
  /** `TransferWise ID` — chave natural de dedupe (vira `Transaction.fitid`). */
  id: string;
  /** Data da linha de maior valor absoluto do grupo (a cobrança original). */
  date: Date;
  /** Descrição limpa: nome do estabelecimento sem códigos internos, ou o
   *  texto do próprio extrato quando não há comerciante (ex.: conversões). */
  description: string;
  /** Valor assinado NA MOEDA DA CONTA (negativo = saída). Já é o líquido do
   *  grupo — inclui as taxas da Wise, que vêm embutidas no valor da linha. */
  amountFx: number;
  /** `true` para compra de moeda (BRL → moeda da conta): não é despesa. */
  isConversion: boolean;
  /** `true` quando a linha é dinheiro trocando de bolso e deve nascer com a
   *  categoria `excludeFromTotals`. Cobre a conversão de entrada E a de volta
   *  (sacar a moeda de volta para BRL), que também não é gasto. */
  isTransfer: boolean;
  /** Numa conversão de entrada, quanto saiu na moeda de origem (ex.: BRL).
   *  É o CUSTO real do lote — já com IOF e spread embutidos. `null` fora de
   *  conversões ou quando o valor não pôde ser lido. */
  sourceAmount: number | null;
  /** Moeda de origem da conversão (ex.: "BRL"), ou `null`. */
  sourceCurrency: string | null;
  /** Nome do estabelecimento, cru como veio no arquivo (`null` se não houver). */
  merchant: string | null;
  /** Últimos 4 dígitos do cartão usado, se a linha for de cartão. */
  cardLast4: string | null;
  /** Quantas linhas do arquivo formaram esta entrada (>1 = houve netting). */
  rowCount: number;
}

export interface WiseParseMeta {
  /** Moeda da conta (a coluna `Currency`), ex.: "EUR". */
  currency: string | null;
  /** Linhas de dado lidas do arquivo (fora o cabeçalho). */
  rowCount: number;
  /** Linhas absorvidas por netting (id repetido) — `rowCount - entries` antes
   *  do descarte dos grupos zerados. */
  netted: number;
  /** Grupos descartados por somarem zero (cobrança cancelada por inteiro). */
  zeroed: number;
  /** Linhas descartadas por malformação (valor ou data ilegível). */
  skipped: number;
  /** Saldo da conta ANTES da primeira linha do extrato, derivado de
   *  `Running Balance`. É a moeda que já existia e foi comprada em algum
   *  extrato anterior — o `fxLedger` precisa do custo em BRL dela para
   *  apreçar com exatidão. `null` se a coluna não veio no arquivo. */
  openingBalance: number | null;
  /** Saldo depois da última linha (`Running Balance` da linha mais recente). */
  closingBalance: number | null;
  dtStart: Date | null;
  dtEnd: Date | null;
  /** Um item por descarte/suspeita, em texto legível. Nunca inclui descrição
   *  ou valor (dado financeiro) — só índice da linha e o campo problemático. */
  warnings: string[];
}

export interface WiseParseResult {
  /** Em ordem CRONOLÓGICA CRESCENTE (o arquivo vem do mais novo para o mais
   *  antigo). O `fxLedger` depende dessa ordem para consumir os lotes FIFO. */
  entries: WiseEntry[];
  meta: WiseParseMeta;
}

/**
 * Apelidos de cada coluna que o parser usa, em todos os idiomas de exportação
 * conhecidos. A Wise traduz o cabeçalho conforme o idioma da conta — quem
 * exporta em português recebe "Valor" onde a documentação diz "Amount" — e
 * ancorar no nome em inglês faria o arquivo do usuário brasileiro cair no
 * caminho de IA, que leria os valores em euro como se fossem reais.
 *
 * Acrescentar um idioma é acrescentar apelido aqui; nada mais no arquivo
 * conhece nome de coluna.
 */
const COLUMNS = {
  id: ['TransferWise ID', 'ID', 'Número da transferência'],
  date: ['Date', 'Data'],
  dateTime: ['Date Time', 'Data e hora'],
  amount: ['Amount', 'Valor'],
  currency: ['Currency', 'Moeda'],
  description: ['Description', 'Descrição'],
  runningBalance: ['Running Balance', 'Saldo cumulativo'],
  exchangeFrom: ['Exchange From', 'Convertido de'],
  merchant: ['Merchant', 'Estabelecimento comercial'],
  cardLast4: ['Card Last Four Digits', 'Últimos quatro dígitos do cartão'],
  detailsType: ['Transaction Details Type', 'Tipo de detalhe da transação'],
} as const;

/** O id e o saldo acumulado juntos são assinatura suficiente: nenhum outro
 *  extrato traz os dois. Um só deles daria falso positivo em planilha caseira. */
const SIGNATURE: (keyof typeof COLUMNS)[] = ['id', 'runningBalance'];

/**
 * Reconhece o extrato pelos NOMES DAS COLUNAS. Serve tanto para a planilha
 * (cabeçalho já lido) quanto para o CSV, via `isWiseCsv`.
 */
export function isWiseHeader(headers: string[]): boolean {
  const norm = headers.map((h) => String(h ?? '').trim().toLowerCase());
  return SIGNATURE.every((key) =>
    COLUMNS[key].some((alias) => norm.includes(alias.toLowerCase()))
  );
}

/**
 * Reconhece o CSV da Wise pelo CABEÇALHO, sem parsear o arquivo inteiro.
 * O roteador de importação chama isto antes de mandar um `.csv` para a IA —
 * a extensão sozinha não distingue este extrato de uma planilha qualquer.
 */
export function isWiseCsv(text: string): boolean {
  const firstLine = text.slice(0, 2000).split(/\r?\n/)[0] ?? '';
  // Split cru por vírgula/ponto-e-vírgula basta para o sniff: as aspas viram
  // ruído nas pontas do nome, e o `includes` do `isWiseHeader` não se importa
  // — o parse de verdade fica com o Papa.
  return isWiseHeader(firstLine.split(/[,;]/).map((h) => h.replace(/"/g, '')));
}

/**
 * Números do extrato vêm em dois formatos: as COLUNAS numéricas usam ponto
 * decimal e sem separador de milhar (`-1884.40`), mas o valor em BRL de uma
 * conversão só existe DENTRO da descrição, escrito no idioma da conta
 * (`"5.000,00 BRL convertidos para 826,30 EUR"` em pt-BR, `"5,000.00 BRL"` em
 * en). Detectamos o separador decimal pelo ÚLTIMO separador presente, em vez
 * de assumir locale — assumir erraria por um fator de 1000 exatamente nos
 * valores altos, calado.
 */
function parseLooseNumber(raw: unknown): number | null {
  // A planilha entrega número de verdade; o CSV, texto. Aceitar os dois aqui
  // é o que permite um núcleo só para as duas entradas.
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const cleaned = raw.trim().replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = cleaned;
  } else if (lastComma > lastDot) {
    // Vírgula é o decimal: pontos são milhar.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Ponto é o decimal: vírgulas são milhar.
    normalized = cleaned.replace(/,/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * `Date` vem como `DD-MM-YYYY` na exportação pt-BR e `YYYY-MM-DD` em outras.
 * Desambiguamos pelo tamanho do primeiro campo — nunca por "chutar" que o
 * primeiro número é dia, o que trocaria dia por mês silenciosamente em datas
 * como `05-06-2026`. Ancorado ao meio-dia local (mesmo padrão de `parseOfx`)
 * para nunca sofrer rollover de fuso horário.
 */
function parseWiseDate(raw: unknown): Date | null {
  // XLSX pode entregar Date (célula formatada como data) ou o SERIAL do Excel
  // (número de dias desde 30/12/1899 — a época com o bug do ano bissexto de
  // 1900 já embutido, que é por isso que a base é 30/12 e não 31/12).
  if (raw instanceof Date) return anchorNoon(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(raw) * 86_400_000;
    const d = new Date(ms);
    return anchorNoon(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})/);
  if (!m) return null;
  const [, a, b, c] = m;
  const iso = a.length === 4;
  return anchorNoon(Number(iso ? a : c), Number(b), Number(iso ? c : a));
}

/** Ancora ao meio-dia local (mesmo padrão de `parseOfx`) e rejeita data
 *  inexistente — `new Date` normaliza 31/02 para março em silêncio. */
function anchorNoon(y: number, mo: number, d: number): Date | null {
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d, 12, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/**
 * Chave de ordenação: a data já parseada mais a HORA lida de `Date Time`.
 *
 * Não dá para ordenar `Date Time` como texto: ele vem `DD-MM-YYYY HH:MM:SS`,
 * e comparar isso alfabeticamente coloca 01/05 antes de 13/04 — o FIFO
 * consumiria lotes fora de ordem, e o erro só apareceria em extratos que
 * cruzam a virada do mês (justamente os de viagem). Então a data vem do
 * parser, e do texto aproveitamos só a hora, que desempata lançamentos do
 * mesmo dia. Sem hora legível, meia-noite — a ordem do arquivo desempata.
 */
function rowTimestamp(date: Date, dateTime: unknown): number {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Serial do Excel: a PARTE FRACIONÁRIA é a hora do dia. Vem antes do ramo de
  // texto porque a planilha entrega número, não string.
  if (typeof dateTime === 'number' && Number.isFinite(dateTime)) {
    const frac = dateTime - Math.floor(dateTime);
    return base + Math.round(frac * 86_400_000);
  }
  if (dateTime instanceof Date) {
    return base + (dateTime.getHours() * 3600 + dateTime.getMinutes() * 60 + dateTime.getSeconds()) * 1000;
  }
  const m = typeof dateTime === 'string' ? dateTime.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/) : null;
  if (!m) return date.getTime();
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  return base + seconds * 1000;
}

/**
 * Limpa o nome do estabelecimento para virar descrição legível.
 *
 * O campo `Merchant` vem com o ruído do adquirente colado: código interno
 * longo (`"Sephora 101 4552349 75PARIS"`) e o código do departamento francês
 * grudado na cidade (`75PARIS`, `67STRASBOURG`). Tiramos os dois e
 * normalizamos a caixa — siglas curtas (`SAS`, `AG`) ficam em maiúsculas.
 */
export function cleanMerchant(raw: string): string {
  const stripped = raw
    .replace(/\b\d{5,}\b/g, ' ')            // código interno do adquirente
    .replace(/\b\d{2}(?=[A-Za-z]{3,})/g, ' ') // "75PARIS" → "PARIS"
    .replace(/\s*\*\s*/g, ' ')              // "Sumup  *Lion" → "Sumup Lion"
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, '');
  return stripped
    .split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Linha crua já tipada, antes do netting. */
interface RawRow {
  index: number;
  id: string;
  date: Date;
  /** Timestamp para ordenar: data + hora do dia, em ms. Ver `rowTimestamp`. */
  sortTs: number;
  amount: number;
  runningBalance: number | null;
  description: string;
  merchant: string | null;
  cardLast4: string | null;
  exchangeFrom: string | null;
  currency: string | null;
  isConversionRow: boolean;
}

/** Linha genérica: CSV entrega tudo string, XLSX entrega number/Date/string. */
export type WiseRow = Record<string, unknown>;

/**
 * Valor de uma coluna pelos seus apelidos, na primeira que existir e não
 * estiver vazia. Casa o nome ignorando caixa e espaços das pontas — a Wise
 * varia isso entre exportações.
 */
function cell(row: WiseRow, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (alias in row) {
      const v = row[alias];
      if (v !== null && v !== undefined && v !== '') return v;
    }
  }
  const lookup = new Map(Object.keys(row).map((k) => [k.trim().toLowerCase(), k]));
  for (const alias of aliases) {
    const key = lookup.get(alias.toLowerCase());
    if (key === undefined) continue;
    const v = row[key];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

/** Texto de uma coluna, já aparado. `null` quando vazia. */
function text(row: WiseRow, aliases: readonly string[]): string | null {
  const v = cell(row, aliases);
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Parseia o CSV já decodificado como texto. Não lê bytes — quem chama decide
 * o encoding (a Wise exporta UTF-8; ver o roteador no `ImportModal`).
 */
export function parseWiseCsv(text: string): WiseParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return parseWiseRows(parsed.data);
}

/**
 * Núcleo do parser: recebe as linhas já desserializadas (CSV via Papa ou
 * planilha via `sheet_to_json`) e devolve os lançamentos normalizados.
 */
export function parseWiseRows(data: WiseRow[]): WiseParseResult {
  const warnings: string[] = [];
  const rows: RawRow[] = [];
  let skipped = 0;
  let currency: string | null = null;

  data.forEach((row, i) => {
    const id = text(row, COLUMNS.id);
    const amount = parseLooseNumber(cell(row, COLUMNS.amount));
    const date = parseWiseDate(cell(row, COLUMNS.date) ?? cell(row, COLUMNS.dateTime));
    if (!id || amount === null || !date) {
      // Linha em branco no fim do arquivo é comum e não é erro — só conta.
      if (id || amount !== null || date) {
        warnings.push(`Linha ${i + 2}: descartada (id, valor ou data ilegível).`);
      }
      skipped++;
      return;
    }
    const detailsType = (text(row, COLUMNS.detailsType) || '').toUpperCase();
    const exchangeFrom = text(row, COLUMNS.exchangeFrom);
    const rowCurrency = text(row, COLUMNS.currency);
    if (rowCurrency && !currency) currency = rowCurrency;
    rows.push({
      index: i,
      id,
      date,
      sortTs: rowTimestamp(date, cell(row, COLUMNS.dateTime)),
      amount,
      runningBalance: parseLooseNumber(cell(row, COLUMNS.runningBalance)),
      description: text(row, COLUMNS.description) || '',
      merchant: text(row, COLUMNS.merchant),
      cardLast4: text(row, COLUMNS.cardLast4),
      exchangeFrom,
      currency: rowCurrency,
      isConversionRow: detailsType === 'CONVERSION',
    });
  });

  // ── Ordem cronológica crescente ─────────────────────────────────────────
  // O arquivo vem do mais NOVO para o mais ANTIGO, mas não dependemos disso:
  // ordenamos por timestamp e, em empate, pela ordem inversa do arquivo (a
  // linha impressa DEPOIS é a mais antiga). O FIFO do `fxLedger` exige esta
  // ordem — um gasto não pode consumir um lote comprado depois dele.
  const chronological = [...rows].sort((a, b) => {
    const t = a.sortTs - b.sortTs;
    return t !== 0 ? t : b.index - a.index;
  });

  // Saldos derivados do `Running Balance`, que é acumulado na ordem
  // cronológica: antes da primeira linha o saldo era o dela menos o próprio
  // movimento; depois da última é o dela mesmo. É daqui que sai o saldo de
  // abertura que o `fxLedger` precisa apreçar.
  const first = chronological[0];
  const last = chronological[chronological.length - 1];
  const openingBalance = first && first.runningBalance !== null
    ? round2(first.runningBalance - first.amount)
    : null;
  const closingBalance = last ? last.runningBalance : null;

  // ── Netting por id ──────────────────────────────────────────────────────
  const groups = new Map<string, RawRow[]>();
  for (const r of chronological) {
    const g = groups.get(r.id);
    if (g) g.push(r); else groups.set(r.id, [r]);
  }

  const entries: WiseEntry[] = [];
  let zeroed = 0;
  let netted = 0;

  for (const [id, group] of groups) {
    if (group.length > 1) netted += group.length - 1;
    const total = round2(group.reduce((s, r) => s + r.amount, 0));
    if (total === 0) {
      // Cobrança cancelada por inteiro: as duas pernas se anulam e a
      // transação nunca existiu de fato. Importar seria criar uma despesa e
      // uma receita fantasmas que se cancelam nos totais mas poluem a lista.
      zeroed++;
      continue;
    }
    // Âncora = linha de maior valor absoluto (a cobrança original). O ajuste
    // chega dias depois e ancoraria a despesa no mês errado.
    const anchor = group.reduce((best, r) => (Math.abs(r.amount) > Math.abs(best.amount) ? r : best), group[0]);
    const isConversion = anchor.isConversionRow && total > 0;
    const sourceAmount = isConversion ? extractSourceAmount(anchor) : null;
    if (isConversion && sourceAmount === null) {
      warnings.push(`Linha ${anchor.index + 2}: conversão sem valor de origem legível — lote entra sem custo.`);
    }
    entries.push({
      id,
      date: anchor.date,
      description: anchor.merchant ? cleanMerchant(anchor.merchant) : anchor.description,
      amountFx: total,
      isConversion,
      // Conversão nos DOIS sentidos é transferência: comprar a moeda e sacar
      // de volta para BRL são dinheiro trocando de bolso, não gasto.
      isTransfer: anchor.isConversionRow,
      sourceAmount,
      sourceCurrency: isConversion ? anchor.exchangeFrom : null,
      merchant: anchor.merchant,
      cardLast4: anchor.cardLast4,
      rowCount: group.length,
    });
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    entries,
    meta: {
      currency,
      rowCount: rows.length,
      netted,
      zeroed,
      skipped,
      openingBalance,
      closingBalance,
      dtStart: first ? first.date : null,
      dtEnd: last ? last.date : null,
      warnings,
    },
  };
}

/**
 * Quanto saiu em BRL numa conversão. O valor NÃO está em nenhuma coluna
 * numérica — só dentro da descrição (`"5.000,00 BRL convertidos para 826,30
 * EUR"`). Não dá para derivá-lo de `Exchange Rate`: aquela é a cotação
 * mid-market, e o valor debitado já inclui a taxa da Wise (a diferença entre
 * as duas é justamente o custo do câmbio, ~4% no caso real que motivou este
 * código). Usar a cotação subestimaria a despesa de forma sistemática.
 */
function extractSourceAmount(row: RawRow): number | null {
  const cur = row.exchangeFrom;
  if (!cur) return null;
  // Pega o número imediatamente ANTES do código da moeda de origem — cobre
  // "5.000,00 BRL convertidos para ..." e "Converted 5,000.00 BRL to ...".
  const re = new RegExp(`([\\d.,]+)\\s*${cur}`, 'i');
  const m = re.exec(row.description);
  if (!m) return null;
  const n = parseLooseNumber(m[1]);
  return n !== null && n > 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
