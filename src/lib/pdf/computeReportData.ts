import type { Category, Transaction } from '../../types';
import { getMonthLabel, getMonthYear, getMonthYearOffset } from '../utils';
import type {
  BudgetProgress,
  CashFlowByAccount,
  CashFlowRow,
  EvolutionRow,
  ExpenseCategoryBreakdown,
  InsightsData,
  KpiSummary,
  ProjectSummary,
  ReportCategoryGroup,
  ReportData,
  ReportDeps,
  ReportPeriod,
  ResolvedPeriod,
} from './types';

/** Short month label like "jan'26". */
function shortMonthLabel(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  const date = new Date(Number(year), Number(month) - 1);
  const m = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date);
  return `${m.replace('.', '')}'${String(year).slice(2)}`;
}

/** Pretty label for the full period (cover + headers). */
function formatPeriodLabel(months: string[], kind: ReportPeriod['kind']): string {
  if (months.length === 0) return '—';
  if (months.length === 1) return capitalize(getMonthLabel(months[0]));
  if (kind === 'year') {
    return `Ano ${months[0].slice(0, 4)}`;
  }
  if (kind === 'quarter') {
    const year = months[0].slice(0, 4);
    const firstMonth = Number(months[0].split('-')[1]);
    const q = Math.floor((firstMonth - 1) / 3) + 1;
    return `${q}º Trimestre ${year}`;
  }
  // month range
  const first = capitalize(getMonthLabel(months[0]));
  const last = capitalize(getMonthLabel(months[months.length - 1]));
  return `${first} – ${last}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthsBetween(start: string, end: string): string[] {
  const result: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    result.push(cursor);
    cursor = getMonthYearOffset(cursor, 1);
  }
  return result;
}

/** Resolve a user-selected ReportPeriod into a concrete list of months + label. */
export function resolvePeriod(period: ReportPeriod): ResolvedPeriod {
  let startMonth: string;
  let endMonth: string;
  switch (period.kind) {
    case 'month':
      startMonth = period.monthYear;
      endMonth = period.monthYear;
      break;
    case 'quarter': {
      const qStart = (period.quarter - 1) * 3 + 1;
      startMonth = `${period.year}-${String(qStart).padStart(2, '0')}`;
      endMonth = `${period.year}-${String(qStart + 2).padStart(2, '0')}`;
      break;
    }
    case 'year':
      startMonth = `${period.year}-01`;
      endMonth = `${period.year}-12`;
      break;
    case 'custom':
      startMonth = period.startMonth;
      endMonth = period.endMonth;
      break;
  }
  const months = monthsBetween(startMonth, endMonth);
  return {
    kind: period.kind,
    label: formatPeriodLabel(months, period.kind),
    months,
    startMonth,
    endMonth,
  };
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

function avg(values: number[]): number {
  const nonZero = values.filter((v) => v !== 0);
  if (nonZero.length === 0) return 0;
  return sum(nonZero) / nonZero.length;
}

function computeKpis(
  transactions: Transaction[],
  period: ResolvedPeriod
): KpiSummary {
  const inPeriod = transactions.filter((t) => {
    const my = getMonthYear(t.date);
    return my >= period.startMonth && my <= period.endMonth;
  });
  const totalEntries = sum(inPeriod.filter((t) => t.amount > 0).map((t) => t.amount));
  const totalExits = sum(inPeriod.filter((t) => t.amount < 0).map((t) => t.amount));
  const totalBalance = totalEntries + totalExits;

  // YTD based on end month's year (calendar year-to-date up to end month inclusive)
  const endYear = period.endMonth.slice(0, 4);
  const ytdBalance = sum(
    transactions
      .filter((t) => {
        const my = getMonthYear(t.date);
        return my.startsWith(endYear) && my <= period.endMonth;
      })
      .map((t) => t.amount)
  );

  // 12-month trailing average (relative to end month)
  const last12: string[] = [];
  for (let i = 0; i < 12; i++) {
    last12.push(getMonthYearOffset(period.endMonth, -i));
  }
  const monthsWithData = last12.filter((mo) =>
    transactions.some((t) => getMonthYear(t.date) === mo)
  );
  const avg12Months =
    monthsWithData.length > 0
      ? sum(
          monthsWithData.map((mo) =>
            sum(transactions.filter((t) => getMonthYear(t.date) === mo).map((t) => t.amount))
          )
        ) / monthsWithData.length
      : 0;

  return {
    totalEntries,
    totalExits,
    totalBalance,
    ytdBalance,
    avg12Months,
    savingsRate: totalEntries > 0 ? totalBalance / totalEntries : 0,
    transactionCount: inPeriod.length,
    monthsCount: period.months.length,
  };
}

function computeDashboardCashFlow(
  transactions: Transaction[],
  accounts: ReportDeps['accounts'],
  period: ResolvedPeriod
): CashFlowByAccount[] {
  const inPeriod = transactions.filter((t) => {
    const my = getMonthYear(t.date);
    return my >= period.startMonth && my <= period.endMonth;
  });
  const map = new Map<string, { entries: number; exits: number }>();
  for (const t of inPeriod) {
    const key = t.account || 'Sem conta';
    if (!map.has(key)) map.set(key, { entries: 0, exits: 0 });
    const acc = map.get(key)!;
    if (t.amount > 0) acc.entries += t.amount;
    else acc.exits += t.amount;
  }
  return Array.from(map.entries())
    .map(([accountName, v]) => {
      const account = accounts.find((a) => a.name === accountName);
      return {
        accountName,
        entries: v.entries,
        exits: v.exits,
        balance: v.entries + v.exits,
        isCard: account?.type === 'cartao',
      };
    })
    .sort((a, b) => Math.abs(b.exits) - Math.abs(a.exits));
}

function computeExpensesByCategory(
  transactions: Transaction[],
  categories: Category[],
  period: ResolvedPeriod,
  totalExits: number
): ExpenseCategoryBreakdown[] {
  const inPeriod = transactions.filter((t) => {
    const my = getMonthYear(t.date);
    return my >= period.startMonth && my <= period.endMonth && t.amount < 0;
  });
  const map = new Map<string, { amount: number; subs: Map<string, number> }>();
  for (const t of inPeriod) {
    const catId = t.categoryId || '__uncategorized';
    const cat = categories.find((c) => c.id === catId);
    const parentId = cat?.parentId || catId;
    if (!map.has(parentId)) map.set(parentId, { amount: 0, subs: new Map() });
    const entry = map.get(parentId)!;
    entry.amount += t.amount;
    if (cat?.parentId) {
      entry.subs.set(catId, (entry.subs.get(catId) || 0) + t.amount);
    }
  }
  const totalExp = Math.abs(totalExits);
  return Array.from(map.entries())
    .map(([catId, { amount, subs }]) => {
      const cat = categories.find((c) => c.id === catId);
      return {
        name: cat?.name || 'Sem categoria',
        color: cat?.color || '#94A3B8',
        amount,
        percentage: totalExp > 0 ? (Math.abs(amount) / totalExp) * 100 : 0,
        subs: Array.from(subs.entries())
          .map(([subId, subAmount]) => {
            const subCat = categories.find((c) => c.id === subId);
            return {
              name: subCat?.name || 'Sem subcategoria',
              color: subCat?.color || '#94A3B8',
              amount: subAmount,
              percentage: totalExp > 0 ? (Math.abs(subAmount) / totalExp) * 100 : 0,
            };
          })
          .sort((a, b) => a.amount - b.amount),
      };
    })
    .sort((a, b) => a.amount - b.amount);
}

function computeBudgetProgress(
  deps: ReportDeps,
  period: ResolvedPeriod
): { budgets: BudgetProgress[]; totalLimit: number; totalActual: number } {
  // Budgets are per-month; aggregate limits + actuals across the selected period.
  const byCategory = new Map<string, { limit: number; actual: number }>();

  for (const mo of period.months) {
    const monthBudgets = deps.budgets.filter((b) => b.monthYear === mo);
    for (const b of monthBudgets) {
      if (!byCategory.has(b.categoryId)) byCategory.set(b.categoryId, { limit: 0, actual: 0 });
      byCategory.get(b.categoryId)!.limit += b.limitAmount;
    }
  }

  for (const t of deps.transactions) {
    if (t.amount >= 0) continue;
    if (!t.categoryId) continue;
    if (!byCategory.has(t.categoryId)) continue;
    const my = getMonthYear(t.date);
    if (my < period.startMonth || my > period.endMonth) continue;
    byCategory.get(t.categoryId)!.actual += t.amount; // negative
  }

  const budgets: BudgetProgress[] = Array.from(byCategory.entries())
    .map(([categoryId, { limit, actual }]) => {
      const cat = deps.categories.find((c) => c.id === categoryId);
      const spent = Math.abs(actual);
      return {
        categoryName: cat?.name || 'Categoria',
        limit,
        actual: spent,
        pct: limit > 0 ? (spent / limit) * 100 : 0,
        over: limit > 0 && spent > limit,
      };
    })
    .sort((a, b) => b.pct - a.pct);

  const totalLimit = sum(budgets.map((b) => b.limit));
  const totalActual = sum(budgets.map((b) => b.actual));
  return { budgets, totalLimit, totalActual };
}

function computeProjects(deps: ReportDeps, period: ResolvedPeriod): ProjectSummary[] {
  const active = deps.projects.filter((p) => p.status === 'active');
  return active
    .map((p) => {
      const ptxs = deps.transactions.filter((t) => {
        if (t.projectId !== p.id) return false;
        const my = getMonthYear(t.date);
        return my >= period.startMonth && my <= period.endMonth;
      });
      const spent = sum(ptxs.filter((t) => t.amount < 0).map((t) => t.amount));
      const income = sum(ptxs.filter((t) => t.amount > 0).map((t) => t.amount));
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        spent,
        income,
        balance: income + spent,
        count: ptxs.length,
      };
    })
    .filter((p) => p.count > 0);
}

function computeByCategory(
  deps: ReportDeps,
  period: ResolvedPeriod
): ReportData['byCategory'] {
  const inPeriod = deps.transactions.filter((t) => {
    const my = getMonthYear(t.date);
    return my >= period.startMonth && my <= period.endMonth;
  });
  const totalEntries = sum(inPeriod.filter((t) => t.amount > 0).map((t) => t.amount));
  const totalExits = sum(inPeriod.filter((t) => t.amount < 0).map((t) => t.amount));
  const totalBalance = totalEntries + totalExits;
  const totalAbs = Math.abs(totalEntries) + Math.abs(totalExits);

  const catMap = new Map<string, Transaction[]>();
  for (const t of inPeriod) {
    const key = t.categoryId || '__uncategorized';
    if (!catMap.has(key)) catMap.set(key, []);
    catMap.get(key)!.push(t);
  }

  const groups: ReportCategoryGroup[] = [];

  for (const root of deps.rootCategories) {
    const subs = deps.subCategories(root.id);
    const subGroups: ReportCategoryGroup['subs'] = [];

    // Direct transactions attached to the root category itself
    const directTxs = catMap.get(root.id) || [];
    if (directTxs.length > 0) {
      const subTotal = sum(directTxs.map((t) => t.amount));
      subGroups.push({
        label: root.name,
        color: root.color,
        total: subTotal,
        percentage: totalAbs > 0 ? (Math.abs(subTotal) / totalAbs) * 100 : 0,
        transactions: directTxs
          .sort((a, b) => a.date.getTime() - b.date.getTime())
          .map(projectTx),
      });
      catMap.delete(root.id);
    }

    for (const sub of subs) {
      const txs = catMap.get(sub.id) || [];
      if (txs.length === 0) continue;
      const subTotal = sum(txs.map((t) => t.amount));
      subGroups.push({
        label: sub.name,
        color: sub.color,
        total: subTotal,
        percentage: totalAbs > 0 ? (Math.abs(subTotal) / totalAbs) * 100 : 0,
        transactions: txs
          .sort((a, b) => a.date.getTime() - b.date.getTime())
          .map(projectTx),
      });
      catMap.delete(sub.id);
    }

    if (subGroups.length > 0) {
      const groupTotal = sum(subGroups.map((g) => g.total));
      groups.push({
        label: root.name,
        color: root.color,
        total: groupTotal,
        percentage: totalAbs > 0 ? (Math.abs(groupTotal) / totalAbs) * 100 : 0,
        subs: subGroups,
      });
    }
  }

  // Orphan/uncategorized transactions
  for (const [key, txs] of catMap) {
    const cat = deps.categories.find((c) => c.id === key);
    const total = sum(txs.map((t) => t.amount));
    groups.push({
      label: cat?.name || 'Sem categoria',
      color: cat?.color || '#94A3B8',
      total,
      percentage: totalAbs > 0 ? (Math.abs(total) / totalAbs) * 100 : 0,
      subs: [
        {
          label: cat?.name || 'Sem categoria',
          color: cat?.color || '#94A3B8',
          total,
          percentage: totalAbs > 0 ? (Math.abs(total) / totalAbs) * 100 : 0,
          transactions: txs
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .map(projectTx),
        },
      ],
    });
  }

  groups.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return { groups, totalEntries, totalExits, totalBalance };
}

function projectTx(t: Transaction) {
  return {
    date: t.date,
    description: t.description,
    amount: t.amount,
    account: t.account,
    titular: t.titular,
    installmentNumber: t.installmentNumber,
    totalInstallments: t.totalInstallments,
  };
}

function computeCashFlow(
  transactions: Transaction[],
  period: ResolvedPeriod
): ReportData['cashFlow'] {
  const saldoAnterior = sum(
    transactions
      .filter((t) => getMonthYear(t.date) < period.startMonth)
      .map((t) => t.amount)
  );

  let runningSaldo = saldoAnterior;
  const rows: CashFlowRow[] = period.months.map((monthYear) => {
    const monthTxs = transactions.filter((t) => getMonthYear(t.date) === monthYear);
    const entradas = sum(monthTxs.filter((t) => t.amount > 0).map((t) => t.amount));
    const saidas = sum(monthTxs.filter((t) => t.amount < 0).map((t) => t.amount));
    const resultado = entradas + saidas;
    runningSaldo += resultado;
    return {
      monthYear,
      label: capitalize(getMonthLabel(monthYear)),
      entradas,
      saidas,
      resultado,
      saldo: runningSaldo,
    };
  });

  return {
    rows,
    saldoAnterior,
    totalEntradas: sum(rows.map((r) => r.entradas)),
    totalSaidas: sum(rows.map((r) => r.saidas)),
  };
}

function computeEvolution(
  deps: ReportDeps,
  period: ResolvedPeriod
): ReportData['evolution'] {
  const months = period.months;
  const monthLabels = months.map(shortMonthLabel);

  // Per-category totals per month
  const monthlyByCat: Record<string, Record<string, number>> = {};
  for (const t of deps.transactions) {
    const m = getMonthYear(t.date);
    if (!months.includes(m)) continue;
    const catId = t.categoryId || '__none';
    if (!monthlyByCat[catId]) monthlyByCat[catId] = {};
    monthlyByCat[catId][m] = (monthlyByCat[catId][m] || 0) + t.amount;
  }

  const sumForIds = (ids: string[]): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const m of months) {
      result[m] = ids.reduce((s, id) => s + (monthlyByCat[id]?.[m] || 0), 0);
    }
    return result;
  };

  const sectionTotals = {
    receitas: {} as Record<string, number>,
    despesas: {} as Record<string, number>,
  };
  for (const m of months) {
    const monthTxs = deps.transactions.filter((t) => getMonthYear(t.date) === m);
    sectionTotals.receitas[m] = sum(monthTxs.filter((t) => t.amount > 0).map((t) => t.amount));
    sectionTotals.despesas[m] = sum(monthTxs.filter((t) => t.amount < 0).map((t) => t.amount));
  }

  const incomeCats: Category[] = [];
  const expenseCats: Category[] = [];
  const ambosIncome: Category[] = [];
  const ambosExpense: Category[] = [];
  for (const cat of deps.rootCategories) {
    if (cat.type === 'receita') incomeCats.push(cat);
    else if (cat.type === 'despesa') expenseCats.push(cat);
    else {
      const subs = deps.subCategories(cat.id);
      const total = sum(
        Object.values(sumForIds([cat.id, ...subs.map((s) => s.id)]))
      );
      if (total >= 0) ambosIncome.push(cat);
      else ambosExpense.push(cat);
    }
  }

  const buildRows = (cats: Category[]): EvolutionRow[] => {
    const rows: EvolutionRow[] = [];
    for (const cat of cats) {
      const subs = deps.subCategories(cat.id);
      const allIds = [cat.id, ...subs.map((s) => s.id)];
      const totals = sumForIds(allIds);
      const values = months.map((m) => totals[m] ?? 0);
      const totalValue = sum(values);
      if (totalValue === 0) continue;
      const subRows: EvolutionRow[] = [];
      for (const sub of subs) {
        const subTotals = sumForIds([sub.id]);
        const subValues = months.map((m) => subTotals[m] ?? 0);
        const subTotalValue = sum(subValues);
        if (subTotalValue === 0) continue;
        subRows.push({
          id: sub.id,
          label: sub.name,
          color: sub.color,
          monthTotals: subTotals,
          total: subTotalValue,
          average: avg(subValues),
        });
      }
      rows.push({
        id: cat.id,
        label: cat.name,
        color: cat.color,
        monthTotals: totals,
        total: totalValue,
        average: avg(values),
        subs: subRows,
      });
    }
    return rows;
  };

  return {
    months,
    monthLabels,
    incomeRows: buildRows([...incomeCats, ...ambosIncome]),
    expenseRows: buildRows([...expenseCats, ...ambosExpense]),
    sectionTotals,
  };
}

function computeInsights(
  data: Omit<ReportData, 'insights'>
): InsightsData {
  // Top 5 expense categories by absolute value
  const topExpenses = data.dashboard.expensesByCategory
    .slice(0, 5)
    .map((e) => ({
      name: e.name,
      color: e.color,
      amount: e.amount,
      pct: e.percentage,
    }));

  // Monthly result series from cash flow rows
  const monthlyResult = data.cashFlow.rows.map((r) => ({
    month: r.monthYear,
    label: r.label.split(' ').slice(0, 1).join(' '), // "Janeiro 2026" -> "Janeiro"
    entradas: r.entradas,
    saidas: Math.abs(r.saidas),
    resultado: r.resultado,
  }));

  // Top 5 category trend (one line per category, one point per month)
  // Sum over each top category (including subs) for each month from evolution data.
  const trendCategories = topExpenses.map((e) => ({ name: e.name, color: e.color }));
  const topExpenseTrend = data.evolution.months.map((mo, i) => {
    const label = data.evolution.monthLabels[i] || mo;
    const row: { month: string; label: string } & Record<string, number | string> = {
      month: mo,
      label,
    };
    for (const cat of topExpenses) {
      const found = data.evolution.expenseRows.find((r) => r.label === cat.name);
      row[cat.name] = found ? Math.abs(found.monthTotals[mo] ?? 0) : 0;
    }
    return row;
  });

  // Auto-generated callouts in pt-BR
  const callouts: string[] = [];
  if (topExpenses.length > 0) {
    const top = topExpenses[0];
    callouts.push(
      `A maior categoria de despesa foi ${top.name}, representando ${top.pct.toFixed(
        1
      )}% do total de gastos.`
    );
  }
  if (data.kpis.totalBalance !== 0) {
    const positive = data.kpis.totalBalance > 0;
    const valueLabel = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(Math.abs(data.kpis.totalBalance));
    callouts.push(
      positive
        ? `Resultado do período positivo em ${valueLabel}.`
        : `Resultado do período negativo em ${valueLabel}.`
    );
  }
  if (data.kpis.savingsRate !== 0 && data.kpis.totalEntries > 0) {
    const pct = (data.kpis.savingsRate * 100).toFixed(1);
    callouts.push(
      data.kpis.savingsRate > 0
        ? `Taxa de poupança do período: ${pct}% das receitas.`
        : `Saídas excederam receitas em ${Math.abs(Number(pct)).toFixed(1)}%.`
    );
  }
  if (data.dashboard.budgets.length > 0 && data.dashboard.budgetTotalLimit > 0) {
    const globalPct =
      (data.dashboard.budgetTotalActual / data.dashboard.budgetTotalLimit) * 100;
    callouts.push(
      `Execução do orçamento: ${globalPct.toFixed(0)}% do limite total consumido.`
    );
  }

  return {
    topExpenses,
    monthlyResult,
    topExpenseTrend,
    trendCategories,
    callouts,
  };
}

/**
 * Main entry point: compute a fully-populated ReportData from raw deps + period.
 * All functions inside are pure — no hooks, no Firebase, no React.
 */
export function computeReportData(
  deps: ReportDeps,
  period: ReportPeriod
): ReportData {
  const resolved = resolvePeriod(period);
  const kpis = computeKpis(deps.transactions, resolved);
  const dashboardCashFlow = computeDashboardCashFlow(
    deps.transactions,
    deps.accounts,
    resolved
  );
  const expensesByCategory = computeExpensesByCategory(
    deps.transactions,
    deps.categories,
    resolved,
    kpis.totalExits
  );
  const { budgets, totalLimit, totalActual } = computeBudgetProgress(deps, resolved);
  const projects = computeProjects(deps, resolved);
  const byCategory = computeByCategory(deps, resolved);
  const cashFlow = computeCashFlow(deps.transactions, resolved);
  const evolution = computeEvolution(deps, resolved);

  const partial: Omit<ReportData, 'insights'> = {
    period: resolved,
    kpis,
    dashboard: {
      cashFlowByAccount: dashboardCashFlow,
      expensesByCategory,
      budgets,
      budgetTotalLimit: totalLimit,
      budgetTotalActual: totalActual,
      projects,
    },
    byCategory,
    cashFlow,
    evolution,
  };

  return {
    ...partial,
    insights: computeInsights(partial),
  };
}
