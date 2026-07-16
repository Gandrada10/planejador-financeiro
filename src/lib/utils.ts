export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

export function getMonthYear(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthLabel(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  const date = new Date(Number(year), Number(month) - 1);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
}

export function getMonthYearOffset(monthYear: string, offset: number): string {
  const [year, month] = monthYear.split('-').map(Number);
  const d = new Date(year, month - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Data de caixa de uma fatura de cartão (regime de CAIXA): o lançamento entra
 * no fluxo de caixa no DIA de vencimento/pagamento do MÊS de pagamento
 * escolhido. O mês vem do parâmetro e é a autoridade — governa o mês do
 * lançamento (inclusive quando a fatura fecha num mês e vence no seguinte).
 * O dia é travado dentro do mês (último dia como teto) para nunca vazar pro
 * mês seguinte por overflow. Sem dia de vencimento configurado, cai no dia 1º
 * (fallback retrocompatível — ver aviso explícito no ImportModal quando isso
 * acontece silenciosamente).
 *
 * SSOT compartilhado por ImportModal (importação) e CreditCardPage (reabrir
 * fatura, que recalcula a provisória para transações legadas sem
 * `provisionalDate` gravado).
 */
export function invoiceDateFor(monthYear: string, dueDay: number | null | undefined): Date | null {
  if (!monthYear) return null;
  const [year, month] = monthYear.split('-').map(Number);
  if (!year || !month) return null;
  const daysInMonth = new Date(year, month, 0).getDate();
  const raw = dueDay && dueDay > 0 ? dueDay : 1;
  const day = Math.min(Math.max(raw, 1), daysInMonth);
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Fuzzy-match a raw statement/import name to a registered member name.
 * Single source of truth shared by the AI import flow (ImportModal) and the
 * "Normalizar titulares" maintenance tool. Returns the canonical member name,
 * or '' when nothing matches with confidence.
 */
export function fuzzyMatchMember(statementName: string, memberNames: string[]): string {
  if (!statementName || memberNames.length === 0) return '';
  const normalized = statementName.toLowerCase().trim();

  // Exact match
  const exact = memberNames.find((n) => n.toLowerCase() === normalized);
  if (exact) return exact;

  // Statement name contains member name or vice versa
  for (const name of memberNames) {
    const nameLower = name.toLowerCase();
    if (normalized.includes(nameLower) || nameLower.includes(normalized)) return name;
  }

  // All parts of member name appear in statement name (handles abbreviations like "K" matching "Kuhn")
  for (const name of memberNames) {
    const parts = name.toLowerCase().split(/\s+/);
    const statementParts = normalized.split(/\s+/);
    const allMatch = parts.every((part) =>
      part.length === 1
        ? statementParts.some((w) => w.startsWith(part))
        : statementParts.some((w) => w.startsWith(part) || part.startsWith(w))
    );
    if (allMatch) return name;
  }

  // First name match (min 3 chars)
  for (const name of memberNames) {
    const firstName = name.toLowerCase().split(/\s+/)[0];
    const statementFirst = normalized.split(/\s+/)[0];
    if (firstName.length >= 3 && firstName === statementFirst) return name;
  }

  return '';
}

/** Normalize titular name to Title Case so "JULIANA KUHN" and "juliana kuhn" are treated as the same person */
export function normalizeTitular(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (ch) => ch.toUpperCase());
}

/**
 * Detect and extract a trailing installment marker from a description.
 * Spreadsheets often embed the parcel at the end of the description column
 * (e.g. "DA CAPO       02/02", "MERCADOLIVRE*MERCA05/05", "PARC 3/10 NETFLIX").
 * Returns the cleaned description plus current/total installment numbers, or
 * null if no trailing marker was found.
 */
export function extractTrailingInstallment(desc: string): {
  description: string;
  installmentNumber: number;
  totalInstallments: number;
} | null {
  if (!desc) return null;

  // Patterns ordered from most specific to most permissive. All anchor the
  // installment marker at the END of the string so we never strip markers that
  // happen to appear in the middle of a description.
  const patterns: RegExp[] = [
    // "PARC X/Y", "PARCELA X/Y", "PARCELA X de Y"
    /^(.*?)\s+PARC(?:ELA)?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i,
    // "(X/Y)"
    /^(.*?)\s*\((\d{1,2})\s*\/\s*(\d{1,2})\)\s*$/,
    // "X de Y"
    /^(.*?)\s+(\d{1,2})\s*de\s*(\d{1,2})\s*$/i,
    // "X/Y" preceded by whitespace (any width)
    /^(.*?)\s+(\d{1,2})\/(\d{1,2})\s*$/,
    // Glued variant: NN/NN directly after a letter or symbol (e.g. "MERCA05/05")
    /^(.*?[A-Za-z*])(\d{2})\/(\d{2})\s*$/,
  ];

  for (const re of patterns) {
    const m = desc.match(re);
    if (!m) continue;
    const cleaned = m[1].replace(/\s+$/, '').trim();
    const current = parseInt(m[2], 10);
    const total = parseInt(m[3], 10);
    if (
      Number.isFinite(current) &&
      Number.isFinite(total) &&
      current >= 1 &&
      total >= 2 &&
      total <= 48 &&
      current <= total &&
      cleaned.length >= 2
    ) {
      return {
        description: cleaned.replace(/\s{2,}/g, ' '),
        installmentNumber: current,
        totalInstallments: total,
      };
    }
  }

  return null;
}

/**
 * Normalize a transaction description for duplicate detection.
 * Strips a trailing installment marker (if any), collapses multiple spaces,
 * and lowercases. This makes duplicate matching tolerant to inconsistent
 * parser output across re-imports — e.g. "DA CAPO       02/02", "DA CAPO 02/02",
 * and "DA CAPO" all normalize to "da capo".
 */
export function normalizeDescriptionForDedup(desc: string): string {
  if (!desc) return '';
  const extracted = extractTrailingInstallment(desc);
  const base = extracted ? extracted.description : desc;
  return base.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Filter categories so the dropdown only shows relevant types for a given amount.
 * amount >= 0 → receita + ambos; amount < 0 → despesa + ambos
 */
export function filterCategoriesByAmount<T extends { type: string }>(categories: T[], amount: number): T[] {
  const allowed = amount >= 0 ? ['receita', 'ambos'] : ['despesa', 'ambos'];
  return categories.filter((c) => allowed.includes(c.type));
}

/**
 * Conjunto de ids de categorias marcadas como fora-dos-totais (`excludeFromTotals`,
 * ex.: "Transferência"). Pré-compute uma vez e reutilize em loops grandes
 * (relatórios, PDF) para não pagar um `find` por transação.
 */
export function getExcludedFromTotalsIds(
  categories: { id: string; excludeFromTotals?: boolean }[]
): Set<string> {
  return new Set(categories.filter((c) => c.excludeFromTotals).map((c) => c.id));
}

/**
 * REGRA CENTRAL de exclusão-de-total. Retorna `false` só quando a transação
 * pertence a uma categoria `excludeFromTotals` (ex.: "Transferência") — nesse
 * caso ela é dinheiro trocando de bolso (pagamento de fatura, PIX interno) e
 * NÃO entra em nenhum total de receita/despesa nem no breakdown por categoria.
 * Transação sem categoria sempre conta.
 *
 * Aplique como PRIMEIRO `.filter()` de qualquer pipeline de agregação. Aceita
 * tanto o array de categorias (ergonomia) quanto um Set pré-computado por
 * `getExcludedFromTotalsIds` (performance em loops). É o único ponto onde a
 * regra vive — nunca reimplemente a checagem inline.
 */
export function countsInTotals(
  t: { categoryId?: string | null },
  categoriesOrExcludedIds: { id: string; excludeFromTotals?: boolean }[] | Set<string>
): boolean {
  if (!t.categoryId) return true;
  const excluded =
    categoriesOrExcludedIds instanceof Set
      ? categoriesOrExcludedIds
      : getExcludedFromTotalsIds(categoriesOrExcludedIds);
  return !excluded.has(t.categoryId);
}

/**
 * Classificação receita vs despesa para TODOS os totais. Um valor POSITIVO
 * marcado como reembolso (`isReimbursement`) não é receita — é recuperação de
 * um gasto, então entra no lado da DESPESA reduzindo-a (contra-despesa): somar
 * `+amount` (positivo) a um bucket de despesa (negativo) aproxima do zero.
 *
 * Use SEMPRE estes helpers em vez de `t.amount > 0` / `t.amount < 0` em splits
 * de total — junto com `lib/accounting.ts` (ancoragem de reembolso alocado no
 * mês/categoria da despesa-alvo), é onde a regra do reembolso vive. Aceitam
 * tanto Transaction quanto AccountingEntry. Compõem com `countsInTotals`
 * (transferências continuam fora de tudo): filtre por `countsInTotals`
 * primeiro, depois classifique por estes.
 *
 * Valor 0 (ou reembolso com valor não-positivo, incoerente) não entra em
 * nenhum dos dois — mesmo comportamento do split por sinal anterior.
 */
export function isReimbursementTx(t: { amount: number; isReimbursement?: boolean }): boolean {
  return !!t.isReimbursement && t.amount > 0;
}
export function isIncomeAmount(t: { amount: number; isReimbursement?: boolean }): boolean {
  return t.amount > 0 && !t.isReimbursement;
}
export function isExpenseAmount(t: { amount: number; isReimbursement?: boolean }): boolean {
  return t.amount < 0 || isReimbursementTx(t);
}

/**
 * Busca por VALOR: casa uma query numérica contra o valor de uma transação.
 * Semântica "contém" sobre uma forma canônica (sem separador de milhar, vírgula
 * como decimal), então o usuário digita "150", "8022,48", "8.022,48" ou
 * "8022.48" e acha o mesmo lançamento, não importa como escreveu os
 * separadores. A vírgula decimal é RESPEITADA: "150" NÃO casa R$ 1,50, nem
 * "5000" casa R$ 50,00 — a busca é em reais, não bagunça reais com centavos.
 * Compara pelo valor ABSOLUTO (o sinal receita/despesa é papel do filtro de
 * tipo). Query sem nenhum dígito não casa nada (deixa a busca textual agir).
 */
export function amountMatchesQuery(amount: number, query: string): boolean {
  // Canônico do valor: toFixed(2) nunca gera separador de milhar → "8022,48".
  const canonAmount = Math.abs(amount).toFixed(2).replace('.', ',');
  // Canônico da query: só dígitos/separadores, normalizado p/ vírgula decimal.
  let q = query.replace(/[^\d.,]/g, '');
  if (!/\d/.test(q)) return false;
  if (q.includes(',')) {
    // Vírgula presente = decimal (pt-BR); os pontos são milhar → remove-os.
    q = q.replace(/\./g, '');
  } else if (q.includes('.')) {
    // Só ponto(s): decimal quando é um único ponto com 1–2 casas no fim
    // ("8022.48"); senão é separador de milhar ("8.022", "1.234.567").
    q = /^\d+\.\d{1,2}$/.test(q) ? q.replace('.', ',') : q.replace(/\./g, '');
  }
  return canonAmount.includes(q);
}

/**
 * Apply Brazilian money mask as user types.
 * Transforms raw keypresses into formatted currency: "12345" → "123,45"
 * Supports negative values for expenses.
 */
export function applyMoneyMask(value: string): string {
  const isNeg = value.startsWith('-');
  const digits = value.replace(/\D/g, '');
  if (!digits) return isNeg ? '-' : '';
  const num = parseInt(digits, 10);
  const formatted = (num / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isNeg ? '-' + formatted : formatted;
}

/**
 * Parse a money-masked string back to a number.
 * "1.234,56" → 1234.56 | "-500,00" → -500
 */
export function parseMoneyInput(value: string): number {
  if (!value) return 0;
  const isNeg = value.startsWith('-');
  const cleaned = value.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned.replace(/[^\d.]/g, ''));
  if (isNaN(num)) return 0;
  return isNeg ? -Math.abs(num) : Math.abs(num);
}

/**
 * Navigate between editable cells marked with [data-tab-cell].
 * Finds the next (or prev) cell in DOM order and activates it.
 * - If the target has a [data-category-trigger], clicks it (opens combobox).
 * - Otherwise clicks the cell itself (starts inline editing).
 */
export function tabNavigate(fromElement: HTMLElement, direction: 'next' | 'prev') {
  const allCells = Array.from(document.querySelectorAll<HTMLElement>('[data-tab-cell]'));
  const currentIdx = allCells.findIndex(
    (el) => el === fromElement || el.contains(fromElement) || fromElement.contains(el)
  );
  if (currentIdx === -1) return;
  const nextIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
  if (nextIdx < 0 || nextIdx >= allCells.length) return;
  const target = allCells[nextIdx];
  // Category combobox → click trigger to open dropdown
  const trigger = target.querySelector<HTMLElement>('[data-category-trigger]');
  if (trigger) {
    trigger.click();
    return;
  }
  // Conciliation dot (or other focusable role=checkbox) → focus it
  const checkbox = target.querySelector<HTMLElement>('[role="checkbox"]');
  if (checkbox) {
    checkbox.focus();
    return;
  }
  // Regular editable cell → click to start inline editing
  target.click();
}
