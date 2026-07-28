import {
  countsInTotals,
  getExcludedFromTotalsIds,
  isIncomeAmount,
  isExpenseAmount,
  accountingDate,
  getMonthYear,
  getMonthYearOffset,
  getMonthLabel,
} from './utils';
import type { Transaction, Category } from '../types';

export type FlowPeriod = 'month' | 'm12';

export interface FlowSlice {
  id: string;
  name: string;
  color: string;
  /** Negativo = despesa; positivo = reembolso líquido. Média mensal quando m12. */
  amount: number;
  subs: FlowSlice[];
}

export interface FlowData {
  /** Receitas do período (média mensal quando m12). */
  income: number;
  /** Resultado: receitas + despesas. Negativo = o mês consumiu reserva. */
  balance: number;
  categories: FlowSlice[];
  /** Nº de meses agregados (1 no mês; até 12 na média). */
  monthsCount: number;
  /** "junho de 2026" ou "média de jul/25 a jun/26". */
  label: string;
}

const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const shortLabel = (key: string) => {
  const [y, m] = key.split('-');
  return `${MONTH_ABBR[Number(m) - 1]}/${y.slice(2)}`;
};

/**
 * Composição do gasto por categoria — no mês selecionado ou como MÉDIA MENSAL
 * dos últimos 12 meses. As duas respondem "para onde foi o dinheiro"; a de 12
 * meses é a leitura estrutural (um mês tem compras pontuais, doze mostram o
 * padrão), e é por isso que vivem no mesmo card com um seletor, em vez de
 * dois cards plotando a mesma coisa em janelas diferentes.
 *
 * Na média, a janela encerra no último mês COMPLETO — o mês em andamento tem
 * números pela metade e puxaria a média para baixo. O divisor é o nº de meses
 * COM lançamento, mesma convenção do custo de vida.
 */
export function computeCategoryFlow(
  transactions: Transaction[],
  categories: Category[],
  monthYear: string,
  isMonthInProgress: boolean,
  period: FlowPeriod,
): FlowData {
  const excludedIds = getExcludedFromTotalsIds(categories);

  const endKey = period === 'm12' && isMonthInProgress ? getMonthYearOffset(monthYear, -1) : monthYear;
  const window = new Set<string>();
  const span = period === 'm12' ? 12 : 1;
  for (let i = 0; i < span; i++) window.add(getMonthYearOffset(endKey, -i));

  const byParent = new Map<string, { amount: number; subs: Map<string, number> }>();
  const monthsWithData = new Set<string>();
  let income = 0;
  let expenses = 0;

  for (const t of transactions) {
    if (!countsInTotals(t, excludedIds)) continue;
    const key = getMonthYear(accountingDate(t));
    if (!window.has(key)) continue;
    monthsWithData.add(key);

    if (isIncomeAmount(t)) {
      income += t.amount;
      continue;
    }
    if (!isExpenseAmount(t)) continue;

    expenses += t.amount;
    const catId = t.categoryId || '__uncategorized';
    const cat = categories.find((c) => c.id === catId);
    const parentId = cat?.parentId || catId;

    if (!byParent.has(parentId)) byParent.set(parentId, { amount: 0, subs: new Map() });
    const entry = byParent.get(parentId)!;
    entry.amount += t.amount;
    if (cat?.parentId) entry.subs.set(catId, (entry.subs.get(catId) || 0) + t.amount);
  }

  const divisor = period === 'm12' ? Math.max(monthsWithData.size, 1) : 1;
  const meta = (id: string) => {
    const c = categories.find((cc) => cc.id === id);
    return { name: c?.name || 'Sem categoria', color: c?.color || '#737373' };
  };

  const slices: FlowSlice[] = Array.from(byParent.entries())
    .map(([id, { amount, subs }]) => ({
      id,
      ...meta(id),
      amount: amount / divisor,
      subs: Array.from(subs.entries())
        .map(([subId, subAmount]) => ({ id: subId, ...meta(subId), amount: subAmount / divisor, subs: [] }))
        .sort((a, b) => a.amount - b.amount),
    }))
    .sort((a, b) => a.amount - b.amount);

  const months = Array.from(window).sort();
  const label =
    period === 'm12'
      ? `média de ${shortLabel(months[0])} a ${shortLabel(months[months.length - 1])} · ${divisor} ${
          divisor === 1 ? 'mês' : 'meses'
        }`
      : getMonthLabel(monthYear);

  return {
    income: income / divisor,
    balance: (income + expenses) / divisor,
    categories: slices,
    monthsCount: divisor,
    label,
  };
}
