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
 * Filter categories so the dropdown only shows relevant types for a given amount.
 * amount >= 0 → receita + ambos; amount < 0 → despesa + ambos
 */
export function filterCategoriesByAmount<T extends { type: string }>(categories: T[], amount: number): T[] {
  const allowed = amount >= 0 ? ['receita', 'ambos'] : ['despesa', 'ambos'];
  return categories.filter((c) => allowed.includes(c.type));
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
  const trigger = target.querySelector<HTMLElement>('[data-category-trigger]');
  if (trigger) {
    trigger.click();
  } else {
    target.click();
  }
}
