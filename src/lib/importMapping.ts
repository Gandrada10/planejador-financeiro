/**
 * Mapeamento da importação: do que o arquivo (ou a leitura por IA) traz até as
 * linhas do preview, e das linhas do preview até os documentos gravados.
 *
 * Saiu do `ImportModal` SEM mudança de comportamento. É aqui que moram as
 * duas datas de uma transação de cartão (`date` = vencimento da fatura,
 * `purchaseDate` = data da compra — ver `CLAUDE.md`), o `billingMonth`, a
 * `provisionalDate` e a expansão de parcelas futuras: as regras que mais
 * custaram bug no projeto. Tirá-las da tela é o que permite que outro caminho
 * de importação grave no formato idêntico ao do app, rodando o mesmo código.
 *
 * O que ficou no componente é estado de tela, leitura de arquivo e rede.
 *
 * O comportamento está fixado em `tests/import/` (golden tirado do master
 * antes da extração).
 */
import type { Account, Transaction } from '../types';
import type { OfxParsedTransaction } from './parseOfx';
import type { FxLedgerResult } from './fxLedger';
import type { AiParseResponse, ImportItem, ImportRow } from './importTypes';
import {
  categoryFromPreviousInstallment,
  findFxDuplicate,
  invoiceLineMatches,
  isOfxDuplicate,
  markDuplicates,
  statementLineMatches,
} from './importDedupe';
import {
  extractTrailingInstallment,
  formatFx,
  fuzzyMatchMember,
  getMonthYear,
  invoiceDateFor,
  normalizeTitular,
} from './utils';

// BANKID (OFX) → padrões de nome/banco, para auto-selecionar a conta de
// destino quando existe uma conta corrente cadastrada daquele banco. Best
// effort: sem match, cai para seleção manual (MVP), como combinado.
export const OFX_BANK_HINTS: Record<string, string[]> = {
  '1': ['banco do brasil', ' bb '],
  '33': ['santander'],
  '77': ['inter', 'banco inter'],
  '104': ['caixa', 'cef'],
  '212': ['original'],
  '237': ['bradesco'],
  '260': ['nubank', 'nu pagamentos'],
  '290': ['pagbank', 'pagseguro'],
  '336': ['c6', 'c6 bank'],
  '341': ['itau', 'itaú'],
  '380': ['pagbank'],
};

export function normalizeBankId(bankId: string | null): string {
  if (!bankId) return '';
  const stripped = bankId.trim().replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Tenta casar o BANKID do OFX com uma conta corrente cadastrada (por nome
 *  do banco/conta); se não achar e houver exatamente UMA conta elegível,
 *  usa essa como padrão. Caso contrário devolve '' (seleção manual). */
export function matchOfxAccountName(bankId: string | null, candidates: Account[]): string {
  const hints = OFX_BANK_HINTS[normalizeBankId(bankId)];
  if (hints && hints.length > 0) {
    const found = candidates.find((a) => {
      // Padding com espaços nas bordas para hints curtos (" bb ") baterem
      // mesmo quando o token aparece no início/fim do texto concatenado.
      const hay = stripAccents(` ${a.bank} ${a.name} `.toLowerCase());
      return hints.some((h) => hay.includes(stripAccents(h)));
    });
    if (found) return found.name;
  }
  return candidates.length === 1 ? candidates[0].name : '';
}

/**
 * Sugere a conta/cartão cadastrada a partir do descritor lido pela IA no
 * cabeçalho da fatura/extrato (ex.: "Latam Pass Itau Black Mastercard final
 * 4640"). Pontua cada conta pelos tokens do seu nome/banco que aparecem no
 * descritor (soma o comprimento dos tokens que casam) e devolve a de maior
 * pontuação — desde que passe de um mínimo e vença o 2º lugar com folga, para
 * não sugerir errado quando duas contas compartilham um token (ex.: "itau"
 * aparece no banco do cartão E no nome da conta corrente). Sem match confiável,
 * devolve '' e o usuário escolhe manualmente. Irmão do matchOfxAccountName (que
 * casa pelo BANKID do OFX); este casa pelo texto do cabeçalho da fatura.
 */
export function matchAccountFromDescriptor(descriptor: string | null | undefined, candidates: Account[]): string {
  if (!descriptor) return '';
  const hay = ` ${stripAccents(descriptor.toLowerCase())} `;
  const scoreTokens = (text: string, weight: number): number => {
    let s = 0;
    for (const t of stripAccents(text.toLowerCase()).split(/\s+/).filter((tok) => tok.length >= 3)) {
      if (hay.includes(t)) s += t.length * weight;
    }
    return s;
  };
  let best = '';
  let bestScore = 0;
  let secondScore = 0;
  for (const a of candidates) {
    // Nome pesa o DOBRO do banco: quando duas contas compartilham o banco (ex.: o
    // cartão tem banco "Itaú Personalite", que também é o NOME da conta corrente),
    // é o casamento pelo NOME que decide qual sugerir.
    const score = scoreTokens(a.name, 2) + scoreTokens(a.bank, 1);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = a.name;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  // Exige um casamento sólido (>= 6 ≈ um token de nome com 3+ letras) e folga
  // sobre o 2º lugar — em empate (ambíguo) devolve '' e o usuário escolhe.
  return bestScore >= 6 && bestScore > secondScore ? best : '';
}

/** Lê um valor em reais digitado à mão ("7.124,37" ou "7124.37"). Devolve
 *  `null` para vazio/ilegível — o caller decide o que fazer com a ausência,
 *  em vez de receber um 0 que se confunde com "custo zero". */
export function parseDecimalInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/[^\d.,-]/g, '');
  if (cleaned === '') return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const normalized = lastComma > lastDot
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Monta as linhas do preview a partir do extrato em moeda já apreçado.
 *
 * Função pura (fora do componente) porque roda em dois momentos: logo após o
 * parse e de novo a cada mudança do custo de abertura — se fosse só o efeito,
 * o preview apareceria vazio por um quadro entre um e outro.
 */
export function buildFxRows(
  ledger: FxLedgerResult,
  currency: string,
  includeConversions: boolean,
  transferCategoryId: string | null,
  matchCategory: ((description: string) => string | null) | undefined,
  existingTransactions: Transaction[],
  defaultAccount: string
): ImportRow[] {
  const priced = includeConversions
    ? [...ledger.movements, ...ledger.conversions].sort((a, b) => a.entry.date.getTime() - b.entry.date.getTime())
    : ledger.movements;

  return priced.map((p) => {
    // A descrição fica com o NOME do estabelecimento e mais nada: o valor
    // original mora em `amountFx`/`currencyFx` (campos próprios), e é de lá
    // que as telas o leem. Antes ele era anexado ao texto por falta de campo
    // — o que sujava a descrição e atrapalhava o casamento das regras de
    // categoria, que agem sobre ela. A compra de moeda é a exceção: ali o
    // valor em moeda É a identidade do lançamento ("Compra de EUR 1.165,45"),
    // já que não há estabelecimento nenhum.
    const description = p.entry.isConversion
      ? `Compra de ${currency} — ${formatFx(p.entry.amountFx, currency)}`
      : p.entry.description;
    const item: ImportItem = {
      date: p.entry.date,
      purchaseDate: null,
      description,
      amount: round2(p.amountBrl),
      amountFx: p.entry.amountFx,
      currencyFx: currency || null,
      // Taxa do LOTE que este gasto consumiu (FIFO), não a média do extrato.
      fxRate: p.rate,
      // Transferência para o que é troca de bolso; para o resto, as regras de
      // categoria do app agem sobre o nome LIMPO do estabelecimento (sem o
      // sufixo em moeda, que atrapalharia o casamento das regras).
      categoryId: p.entry.isTransfer
        ? transferCategoryId
        : (matchCategory ? matchCategory(p.entry.description) : null),
      account: defaultAccount,
      familyMember: '',
      titular: '',
      installmentNumber: null,
      totalInstallments: null,
      cardNumber: null,
      projectId: null,
      fitid: p.entry.id,
      tags: [],
      notes: '',
      importBatch: null,
      reconciled: false,
      reconciledAt: null,
    };
    const duplicateOf = findFxDuplicate(item, existingTransactions);
    return {
      ...item,
      isDuplicate: duplicateOf !== undefined,
      duplicateOf,
      installmentType: 'unica' as const,
      periodicity: 1,
      installmentAmount: null,
    };
  });
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cartão-alvo do lote (para o dia de vencimento padrão): com um único cartão,
 *  é ele; com vários, o cartão (type cartao) mais frequente entre as linhas. */
export function billingCardAccountFor(
  creditCardAccounts: Account[],
  items: Pick<ImportItem, 'account'>[]
): Account | null {
  if (creditCardAccounts.length === 1) return creditCardAccounts[0];
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.account) counts.set(it.account, (counts.get(it.account) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [name, n] of counts) if (n > bestN) { bestN = n; best = name; }
  return creditCardAccounts.find((a) => a.name === best) || null;
}

/** Dia de vencimento efetivo: override digitado no import > dia cadastrado no
 *  cartão. É o DIA da data de caixa; o MÊS vem do seletor de pagamento. */
export function effectiveDueDayFor(billingDueDay: string, billingCardAccount: Account | null): number | null {
  const override = parseInt(billingDueDay, 10);
  if (billingDueDay.trim() !== '' && Number.isFinite(override)) return override;
  return billingCardAccount?.dueDay ?? null;
}

/** Linhas do preview de um extrato OFX (conta corrente): todas na conta
 *  sugerida, sem categoria, com o dedupe do OFX (FITID + conta + valor, e a
 *  reserva por data + valor + descrição — ver `isOfxDuplicate`). */
export function buildOfxRows(
  transactions: OfxParsedTransaction[],
  defaultAccountName: string,
  existingTransactions: Transaction[]
): ImportRow[] {
  return transactions.map((t) => {
    const item: ImportItem = {
      date: t.date,
      purchaseDate: null,
      description: t.description,
      amount: t.amount,
      categoryId: null,
      account: defaultAccountName,
      familyMember: '',
      titular: '',
      installmentNumber: null,
      totalInstallments: null,
      cardNumber: null,
      projectId: null,
      fitid: t.fitid,
      tags: [],
      notes: '',
      importBatch: null,
      reconciled: false,
      reconciledAt: null,
    };
    return {
      ...item,
      isDuplicate: isOfxDuplicate(item, existingTransactions),
      installmentType: 'unica' as const,
      periodicity: 1,
      installmentAmount: null,
    };
  });
}

/** Contexto que a tela entrega para montar as linhas da leitura por IA. */
export interface AiRowsContext {
  accounts: Account[];
  accountNames: string[];
  /** Membros cadastrados (os nomes contra os quais o titular é casado). */
  memberOptions: string[];
  matchCategory?: (description: string) => string | null;
  existingTransactions: Transaction[];
}

export interface AiRowsResult {
  rows: ImportRow[];
  /** Conta sugerida pelo cabeçalho do arquivo ('' quando não há confiança). */
  suggestedAccount: string;
  detectedCreditCard: boolean;
  /** Mês de pagamento sugerido (`YYYY-MM`) — só para fatura de cartão. */
  billingMonth: string | null;
}

/**
 * Linhas do preview a partir da resposta da leitura por IA (fatura de cartão
 * ou extrato): descrição limpa, parcela, titular canônico, categoria pelas
 * regras, conta do lote, mês de pagamento sugerido, duplicatas (contando
 * ocorrências) e a categoria de reserva das parcelas anteriores — nesta
 * ordem, que é a do app.
 */
export function buildAiRows(data: AiParseResponse, ctx: AiRowsContext): AiRowsResult {
  const { accounts, accountNames, memberOptions, matchCategory, existingTransactions } = ctx;
  const creditCardAccounts = accounts.filter((a) => a.type === 'cartao');

  // Sugestão de conta: casa o cabeçalho lido pela IA com as contas
  // cadastradas. Vira o valor pré-preenchido das linhas (o usuário troca no
  // "Aplicar em lote" se quiser). Espelha o auto-match do caminho OFX.
  const suggestedAccount = matchAccountFromDescriptor(data.accountDescriptor, accounts);

  // Detect credit card: AI flag or heuristic (most transactions have cardNumber)
  const hasCardNumbers = data.transactions.filter((t) => t.cardNumber).length > data.transactions.length / 2;
  const detectedCreditCard = !!data.isCreditCard || hasCardNumbers;

  const parsed: ImportRow[] = data.transactions.map((t) => {
    // Post-process: spreadsheet rows often glue the parcel marker at the end
    // of the description (e.g. "DA CAPO       02/02" or "MERCA05/05"). When
    // the AI missed it, extract it ourselves; in any case strip the trailing
    // marker so descriptions are clean and duplicates match across imports.
    const extracted = extractTrailingInstallment(t.description);
    const cleanDescription = (extracted ? extracted.description : (t.description || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const installmentNumber = t.installmentNumber ?? extracted?.installmentNumber ?? null;
    const totalInstallments = t.totalInstallments ?? extracted?.totalInstallments ?? null;
    // True when the parcel came from our regex rather than the AI —
    // these rows are already one-row-per-parcel-occurrence, so we must
    // NOT auto-expand them into future installments.
    const installmentFromDescription = extracted !== null && t.totalInstallments == null;

    const date = new Date(t.date + 'T12:00:00');
    const matchedMember = fuzzyMatchMember(t.titular || '', memberOptions);
    const hasInstallments = totalInstallments != null && totalInstallments > 1;
    const item: ImportItem = {
      date,
      purchaseDate: t.purchaseDate ? new Date(t.purchaseDate + 'T12:00:00') : null,
      description: cleanDescription,
      amount: t.amount,
      categoryId: matchCategory ? matchCategory(cleanDescription) : null,
      account: suggestedAccount || accountNames[0] || '',
      familyMember: matchedMember,
      // Use canonical member name as titular when matched; otherwise normalize to Title Case.
      // This prevents duplicates in the titular filter when the same person's name
      // appears in slightly different formats across different PDF imports.
      titular: matchedMember || normalizeTitular(t.titular || ''),
      installmentNumber,
      totalInstallments,
      cardNumber: t.cardNumber,
      projectId: null,
      tags: [],
      notes: '',
      importBatch: null,
      reconciled: false,
      reconciledAt: null,
    };
    return {
      ...item,
      // Decidido mais abaixo, em UM passo sobre o lote inteiro: o critério
      // conta ocorrências (ver `markDuplicates`) e a conta de destino ainda
      // pode mudar no bloco de cartão, então aqui a linha nasce sem marca.
      isDuplicate: false,
      // Only auto-expand future installments for bank statements where the AI
      // itself identified the parcel. Credit card imports and parcels that we
      // recovered from a trailing marker in the description are already
      // one-row-per-occurrence and must stay as 'unica' to avoid creating
      // phantom future transactions on every re-import.
      installmentType:
        hasInstallments && !detectedCreditCard && !installmentFromDescription
          ? ('parcelada' as const)
          : ('unica' as const),
      periodicity: 1,
      installmentAmount: hasInstallments ? t.amount : null,
    };
  });

  let billingMonth: string | null = null;
  // Sem sugestão de categoria por IA — o que as regras não categorizaram
  // fica sem categoria, para o usuário categorizar manualmente (e as
  // regras aprenderem disso).

  // Auto-detect billing month from the MOST RECENT transaction date — o mês
  // de pagamento nunca pode ficar anterior à última compra da fatura. (Antes
  // usava o mês mais FREQUENTE, o que sugeria um mês passado quando a
  // maioria das compras caía no mês anterior ao fechamento.)
  if (detectedCreditCard && parsed.length > 0) {
    // Ignora datas inválidas (Invalid Date) — senão getMonthYear devolveria
    // "NaN-NaN" e envenenaria o seletor de mês de pagamento.
    const validDates = parsed
      .map((p) => p.date)
      .filter((d): d is Date => d instanceof Date && !isNaN(d.getTime()));
    if (validDates.length > 0) {
      const latestDate = validDates.reduce((latest, d) => (d > latest ? d : latest), validDates[0]);
      billingMonth = getMonthYear(latestDate);
    }

    // Conta do lote: prioridade para a SUGESTÃO (cabeçalho da fatura casado
    // com uma conta cadastrada). Sem sugestão, cai no fallback de "só existe
    // um cartão". O pré-preenchimento de "Vence dia:" acontece no efeito
    // do ImportModal (reage a billingCardAccount), cobrindo vários cartões.
    if (!suggestedAccount && creditCardAccounts.length === 1) {
      const ccName = creditCardAccounts[0].name;
      parsed.forEach((p) => { p.account = ccName; });
    }
  }

  // Dedupe SÓ AQUI, com o lote pronto e a conta de destino já resolvida.
  // Antes cada linha se comparava sozinha, no meio do `map`: contava
  // existência em vez de ocorrências, e ainda rodava antes do bloco acima
  // definir a conta do cartão — então o critério de conta nunca valia.
  // Fatura e extrato usam critérios diferentes de propósito: numa fatura a
  // descrição é o campo menos confiável (a IA a transcreve diferente a cada
  // leitura), num extrato ela é o que distingue lançamentos do mesmo valor.
  const duplicates = markDuplicates(
    parsed,
    existingTransactions,
    detectedCreditCard ? invoiceLineMatches : statementLineMatches,
    detectedCreditCard ? 'fatura' : 'valor'
  );
  duplicates.forEach((hit, i) => {
    if (!hit) return;
    parsed[i].isDuplicate = true;
    parsed[i].duplicateOf = hit;
  });

  // Reserva de categoria para parcela: o que as parcelas anteriores do
  // mesmo carnê já receberam. Depois das regras (que continuam tendo
  // precedência) e só para a linha que ficou sem categoria.
  for (const row of parsed) {
    if (row.categoryId) continue;
    row.categoryId = categoryFromPreviousInstallment(row, existingTransactions);
  }

  return { rows: parsed, suggestedAccount, detectedCreditCard, billingMonth };
}

/** O que a tela decidiu sobre a fatura: se é cartão, o mês de pagamento e o
 *  dia de vencimento efetivo. */
export interface ImportBillingOptions {
  isCreditCard: boolean;
  billingMonth: string;
  effectiveDueDay: number | null;
}

/**
 * Das linhas SELECIONADAS do preview aos documentos que o app grava: tira os
 * campos de tela, aplica a data de caixa da fatura (`date` = vencimento,
 * `purchaseDate` = compra), carimba `billingMonth`/`provisionalDate` no fluxo
 * de cartão e expande as parcelas futuras das linhas marcadas como
 * parceladas.
 */
export function buildImportItems(
  rows: ImportRow[],
  selected: Set<number>,
  { isCreditCard, billingMonth, effectiveDueDay }: ImportBillingOptions
): ImportItem[] {
  const toImport: ImportItem[] = [];

  // Data de caixa da fatura: DIA = vencimento (cadastro do cartão ou override
  // no import); MÊS = o mês de pagamento escolhido no seletor. Sob regime de
  // caixa, essa `date` GOVERNA o mês do lançamento (quando o dinheiro sai),
  // inclusive quando a fatura fecha num mês e vence no seguinte. Sem dia de
  // vencimento, cai no dia 1º (retrocompatível). invoiceDateFor trava o dia
  // dentro do mês, então o mês do lançamento é sempre o do seletor.
  let billingDate: Date | null = null;
  if (isCreditCard && billingMonth) {
    billingDate = invoiceDateFor(billingMonth, effectiveDueDay);
  }

  for (const [i, row] of rows.entries()) {
    if (!selected.has(i)) continue;
    // `duplicateOf` SAI aqui junto com os outros campos de tela.
    //
    // Ele é metadado do preview (descreve um lançamento JÁ existente que
    // parece igual a este) e nunca teve o que fazer dentro do documento. Só
    // que, no caminho do extrato em moeda estrangeira, a linha nasce com a
    // chave presente e valor `undefined` quando NÃO é duplicata — e o
    // Firestore recusa `undefined` com exceção síncrona no `batch.set`
    // (o app não liga `ignoreUndefinedProperties`, de propósito: campo
    // indefinido em app financeiro é bug, não valor). A exceção subia pelo
    // `onImport`, ninguém pegava, e o botão ficava "Importando..." para
    // sempre, sem mensagem. Era exatamente o extrato Wise que travava, e só
    // ele: os caminhos de IA e OFX não gravam este campo.
    const {
      isDuplicate: _isDuplicate,
      duplicateOf: _duplicateOf,
      installmentType,
      periodicity,
      installmentAmount,
      ...rest
    } = row;

    // `purchaseDate` = competência (data da compra original, também de cada
    // parcela) — referência secundária, NÃO governa o mês. `invoiceDate` = a
    // data de caixa (pagamento/vencimento) que vira o `date` e governa o mês.
    // Numa fatura de cartão as parcelas são gravadas como 'unica' e recebem o
    // vencimento desta fatura — ou seja, cada parcela cai no mês em que é PAGA,
    // não no mês da compra. Cada fatura mensal é importada com seu vencimento.
    const purchaseDate = rest.purchaseDate || rest.date;
    const invoiceDate = billingDate || rest.date;

    // Vínculo ciclo↔transação (T1/T3): gravado só no fluxo de cartão
    // (billingDate não-nulo). `billingMonth` é o mês da fatura a que a linha
    // pertence — para a parcela corrente é o mês selecionado; para parcelas
    // futuras é o mês projetado de cada uma. `provisionalDate` é a data de
    // caixa no momento da importação (a "provisória"), preservada intacta
    // quando a baixa da fatura sobrescrever `date` — é o que o reopen (T3)
    // usa para restaurar. Fora do fluxo de cartão os dois ficam ausentes.
    if (installmentType === 'parcelada' && rest.totalInstallments && rest.totalInstallments > 1) {
      const amount = installmentAmount ?? rest.amount;
      const currentInst = rest.installmentNumber || 1;
      const remaining = rest.totalInstallments - currentInst;

      // Current installment (the one in this invoice)
      toImport.push({
        ...rest,
        date: invoiceDate,
        purchaseDate,
        amount,
        installmentNumber: currentInst,
        totalInstallments: rest.totalInstallments,
        // `?? null` em todo campo opcional: o Firestore recusa `undefined`,
        // e a linha do extrato em moeda não tem nenhum dos dois.
        billingMonth: (billingDate ? billingMonth : rest.billingMonth) ?? null,
        provisionalDate: (billingDate ? invoiceDate : rest.provisionalDate) ?? null,
      });

      // Future installments
      for (let offset = 1; offset <= remaining; offset++) {
        const futureDate = new Date(invoiceDate);
        futureDate.setMonth(futureDate.getMonth() + offset * (periodicity || 1));
        toImport.push({
          ...rest,
          date: futureDate,
          purchaseDate,
          amount,
          installmentNumber: currentInst + offset,
          totalInstallments: rest.totalInstallments,
          billingMonth: (billingDate ? getMonthYear(futureDate) : rest.billingMonth) ?? null,
          provisionalDate: (billingDate ? futureDate : rest.provisionalDate) ?? null,
        });
      }
    } else {
      toImport.push({
        ...rest,
        date: invoiceDate,
        purchaseDate,
        billingMonth: (billingDate ? billingMonth : rest.billingMonth) ?? null,
        provisionalDate: (billingDate ? invoiceDate : rest.provisionalDate) ?? null,
      });
    }
  }

  return toImport;
}
