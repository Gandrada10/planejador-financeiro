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
