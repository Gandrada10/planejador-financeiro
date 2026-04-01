import { useState, useMemo } from 'react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import { MonthSelector } from '../shared/MonthSelector';
import { CashFlowChart } from './CashFlowChart';
import { ExpensesByCategoryChart } from './ExpensesByCategoryChart';
import { BudgetProgressPanel } from './BudgetProgressPanel';
import { formatBRL, getMonthYear } from '../../lib/utils';

export function DashboardPage() {
  const [monthYear, setMonthYear] = useState(getMonthYear());
  const { transactions, loading: loadingTx } = useTransactions();
  const { categories } = useCategories();
  const { getBudgetsForMonth } = useBudgets();

  const monthTransactions = useMemo(
    () => transactions.filter((t) => getMonthYear(t.date) === monthYear),
    [transactions, monthYear]
  );

  const totalEntries = useMemo(() => monthTransactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0), [monthTransactions]);
  const totalExits = useMemo(() => monthTransactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0), [monthTransactions]);
  const totalBalance = totalEntries + totalExits;

  // Cash flow by account
  const cashFlowData = useMemo(() => {
    const map = new Map<string, { entries: number; exits: number }>();
    for (const t of monthTransactions) {
      const key = t.account || 'Sem conta';
      if (!map.has(key)) map.set(key, { entries: 0, exits: 0 });
      const acc = map.get(key)!;
      if (t.amount > 0) acc.entries += t.amount;
      else acc.exits += t.amount;
    }
    return Array.from(map.entries()).map(([name, v]) => ({
      accountName: name,
      entries: v.entries,
      exits: v.exits,
      balance: v.entries + v.exits,
      color: '',
    }));
  }, [monthTransactions]);

  // Expenses by category
  const expensesByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of monthTransactions) {
      if (t.amount >= 0) continue;
      const catId = t.categoryId || '__uncategorized';
      map.set(catId, (map.get(catId) || 0) + t.amount);
    }
    const totalExp = Math.abs(totalExits);
    return Array.from(map.entries())
      .map(([catId, amount]) => {
        const cat = categories.find((c) => c.id === catId);
        return {
          name: cat?.name || 'Sem categoria',
          icon: cat?.icon || '',
          color: cat?.color || '#737373',
          amount,
          percentage: totalExp > 0 ? (Math.abs(amount) / totalExp) * 100 : 0,
        };
      })
      .sort((a, b) => a.amount - b.amount); // most negative first
  }, [monthTransactions, categories, totalExits]);

  // Budget progress
  const budgetData = useMemo(() => {
    const monthBudgets = getBudgetsForMonth(monthYear);
    return monthBudgets.map((b) => {
      const cat = categories.find((c) => c.id === b.categoryId);
      const actual = monthTransactions
        .filter((t) => t.categoryId === b.categoryId && t.amount < 0)
        .reduce((s, t) => s + t.amount, 0);
      const remaining = Math.max(b.limitAmount - Math.abs(actual), 0);
      return {
        categoryName: cat?.name || 'Categoria',
        icon: cat?.icon || '',
        limit: b.limitAmount,
        actual,
        remaining,
      };
    });
  }, [monthYear, categories, monthTransactions, getBudgetsForMonth]);

  const budgetTotalLimit = budgetData.reduce((s, b) => s + b.limit, 0);
  const budgetTotalActual = budgetData.reduce((s, b) => s + Math.abs(b.actual), 0);
  const budgetTotalRemaining = budgetData.reduce((s, b) => s + b.remaining, 0);

  if (loadingTx) {
    return <div className="text-accent text-sm animate-pulse">Carregando dashboard...</div>;
  }

  const hasData = transactions.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Dashboard</h2>
        <MonthSelector value={monthYear} onChange={setMonthYear} />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Receitas</p>
          <p className="text-xl font-bold text-accent-green">{formatBRL(totalEntries)}</p>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Despesas</p>
          <p className="text-xl font-bold text-accent-red">{formatBRL(totalExits)}</p>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Saldo</p>
          <p className={`text-xl font-bold ${totalBalance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {formatBRL(totalBalance)}
          </p>
        </div>
      </div>

      {hasData ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Left column: 60% */}
          <div className="lg:col-span-3 space-y-4">
            <CashFlowChart
              data={cashFlowData}
              totalEntries={totalEntries}
              totalExits={totalExits}
              totalBalance={totalBalance}
            />
            <ExpensesByCategoryChart data={expensesByCategory} />
          </div>

          {/* Right column: 40% */}
          <div className="lg:col-span-2">
            <BudgetProgressPanel
              data={budgetData}
              totalLimit={budgetTotalLimit}
              totalActual={budgetTotalActual}
              totalRemaining={budgetTotalRemaining}
            />
          </div>
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
          Importe seus extratos para comecar a ver dados aqui.
        </div>
      )}
    </div>
  );
}
