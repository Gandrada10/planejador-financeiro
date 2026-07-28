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

export interface CategoryDetailRow {
  id: string;
  name: string;
  color: string;
  /** Gasto do mês selecionado (positivo = despesa; negativo = reembolso líquido). */
  monthValue: number;
  /** Média mensal na janela de 12 meses completos. */
  avg: number;
  /** Mês vs média, em % (null quando não há média para comparar). */
  deltaPct: number | null;
}

export interface CategoryDetail extends CategoryDetailRow {
  /** "Junho" — o mês selecionado, para rótulos de coluna. */
  monthName: string;
  prevValue: number;
  prevDeltaPct: number | null;
  /** Meses com lançamento na janela da média (divisor). */
  monthsCount: number;
  /** "jul/25 a jun/26" — janela da média, para o title. */
  windowLabel: string;
  /** Id "__direct" = gasto lançado direto na categoria-mãe. */
  subs: CategoryDetailRow[];
  /** Últimos 12 meses TERMINANDO no selecionado (inclui o em andamento). */
  series: Array<{ key: string; label: string; full: string; value: number; selected: boolean }>;
}

/**
 * Análise de UMA categoria para o painel lateral do fluxo: mês selecionado vs
 * média 12M, quebra por subcategoria e série dos últimos 12 meses.
 *
 * A média segue a convenção da casa (fluxo/custo de vida): janela de 12 meses
 * terminando no último mês COMPLETO, dividida pelos meses com lançamento. A
 * série é outra janela — termina no mês SELECIONADO, porque a pergunta dela é
 * "como cheguei até aqui", não "qual é o padrão".
 */
export function computeCategoryDetail(
  transactions: Transaction[],
  categories: Category[],
  categoryId: string,
  monthYear: string,
  isMonthInProgress: boolean,
): CategoryDetail {
  const excludedIds = getExcludedFromTotalsIds(categories);

  const avgEnd = isMonthInProgress ? getMonthYearOffset(monthYear, -1) : monthYear;
  const avgWindow = new Set<string>();
  for (let i = 0; i < 12; i++) avgWindow.add(getMonthYearOffset(avgEnd, -i));

  const seriesKeys: string[] = [];
  for (let i = 11; i >= 0; i--) seriesKeys.push(getMonthYearOffset(monthYear, -i));
  const seriesSet = new Set(seriesKeys);
  const prevKey = getMonthYearOffset(monthYear, -1);

  const monthsWithData = new Set<string>();
  let monthValue = 0;
  let prevValue = 0;
  let windowTotal = 0;
  const bySeries = new Map<string, number>();
  const subMonth = new Map<string, number>();
  const subWindow = new Map<string, number>();

  for (const t of transactions) {
    if (!countsInTotals(t, excludedIds)) continue;
    const key = getMonthYear(accountingDate(t));
    // Divisor da média: meses com QUALQUER lançamento, não só desta categoria —
    // um mês sem gasto na categoria é um zero legítimo, não um buraco.
    if (avgWindow.has(key)) monthsWithData.add(key);
    if (!isExpenseAmount(t)) continue;

    const catId = t.categoryId || '__uncategorized';
    const cat = categories.find((c) => c.id === catId);
    if ((cat?.parentId || catId) !== categoryId) continue;

    const spend = -t.amount; // despesa negativa vira magnitude; reembolso subtrai
    const subId = cat?.parentId ? catId : '__direct';
    if (key === monthYear) {
      monthValue += spend;
      subMonth.set(subId, (subMonth.get(subId) || 0) + spend);
    }
    if (key === prevKey) prevValue += spend;
    if (avgWindow.has(key)) {
      windowTotal += spend;
      subWindow.set(subId, (subWindow.get(subId) || 0) + spend);
    }
    if (seriesSet.has(key)) bySeries.set(key, (bySeries.get(key) || 0) + spend);
  }

  const monthsCount = Math.max(monthsWithData.size, 1);
  const avg = windowTotal / monthsCount;
  const pct = (curr: number, base: number) => (base > 0 ? ((curr - base) / base) * 100 : null);

  const cat = categories.find((c) => c.id === categoryId);
  const catMeta = { name: cat?.name || 'Sem categoria', color: cat?.color || '#737373' };

  const subIds = new Set([...subMonth.keys(), ...subWindow.keys()]);
  const subs: CategoryDetailRow[] = Array.from(subIds)
    .map((id) => {
      const sub = categories.find((c) => c.id === id);
      const mv = subMonth.get(id) || 0;
      const av = (subWindow.get(id) || 0) / monthsCount;
      return {
        id,
        name: id === '__direct' ? 'Sem subcategoria' : sub?.name || 'Sem categoria',
        color: (id === '__direct' ? catMeta.color : sub?.color) || catMeta.color,
        monthValue: mv,
        avg: av,
        deltaPct: pct(mv, av),
      };
    })
    .filter((s) => Math.abs(s.monthValue) >= 0.5 || Math.abs(s.avg) >= 0.5)
    .sort((a, b) => b.monthValue - a.monthValue || b.avg - a.avg);

  const monthNameRaw = getMonthLabel(monthYear).split(' de ')[0];
  const avgKeys = Array.from(avgWindow).sort();

  return {
    id: categoryId,
    ...catMeta,
    monthValue,
    avg,
    deltaPct: pct(monthValue, avg),
    monthName: monthNameRaw.charAt(0).toUpperCase() + monthNameRaw.slice(1),
    prevValue,
    prevDeltaPct: pct(monthValue, prevValue),
    monthsCount,
    windowLabel: `${shortLabel(avgKeys[0])} a ${shortLabel(avgKeys[avgKeys.length - 1])}`,
    subs,
    series: seriesKeys.map((key) => ({
      key,
      label: MONTH_ABBR[Number(key.split('-')[1]) - 1],
      full: shortLabel(key),
      value: bySeries.get(key) || 0,
      selected: key === monthYear,
    })),
  };
}

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
