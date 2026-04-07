import { useState, useMemo } from 'react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import { useAccounts } from '../../hooks/useAccounts';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import { useProjects } from '../../hooks/useProjects';
import { MonthSelector } from '../shared/MonthSelector';
import { CashFlowChart } from './CashFlowChart';
import { ExpensesByCategoryChart } from './ExpensesByCategoryChart';
import { formatBRL, getMonthYear } from '../../lib/utils';

export function DashboardPage() {
  const [monthYear, setMonthYear] = useState(getMonthYear());
  const { transactions, loading: loadingTx } = useTransactions();
  const { categories } = useCategories();
  const { getBudgetsForMonth } = useBudgets();
  const { accounts } = useAccounts();
  const { getCycleForCard } = useBillingCycles();
  const { activeProjects } = useProjects();

  const monthTransactions = useMemo(
    () => transactions.filter((t) => getMonthYear(t.date) === monthYear),
    [transactions, monthYear]
  );

  const availableMonths = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    set.add(getMonthYear());
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const totalEntries = useMemo(() => monthTransactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0), [monthTransactions]);
  const totalExits = useMemo(() => monthTransactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0), [monthTransactions]);
  const totalBalance = totalEntries + totalExits;
  const pendingReconciliation = useMemo(() => transactions.filter((t) => !t.reconciled).length, [transactions]);

  // YTD accumulated result (year of selected month)
  const currentYear = monthYear.split('-')[0];
  const yearBalance = useMemo(() => {
    return transactions
      .filter((t) => getMonthYear(t.date).startsWith(currentYear))
      .reduce((s, t) => s + t.amount, 0);
  }, [transactions, currentYear]);

  // Average monthly result over last 12 months (only months with data)
  const avg12months = useMemo(() => {
    const [y, m] = monthYear.split('-').map(Number);
    const last12: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(y, m - 1 - i, 1);
      last12.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const withData = last12.filter((mo) => transactions.some((t) => getMonthYear(t.date) === mo));
    if (withData.length === 0) return 0;
    const total = withData.reduce((sum, mo) => {
      return sum + transactions.filter((t) => getMonthYear(t.date) === mo).reduce((s, t) => s + t.amount, 0);
    }, 0);
    return total / withData.length;
  }, [transactions, monthYear]);

  // Active projects with spending in the selected period
  const projectsData = useMemo(() => {
    return activeProjects.map((p) => {
      const ptxs = monthTransactions.filter((t) => t.projectId === p.id);
      const spent = ptxs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
      const income = ptxs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      return { ...p, spent, income, balance: income + spent, count: ptxs.length };
    });
  }, [activeProjects, monthTransactions]);

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
    return Array.from(map.entries()).map(([name, v]) => {
      const account = accounts.find((a) => a.name === name);
      const isCard = account?.type === 'cartao';
      const cycle = isCard && account ? getCycleForCard(account.id, monthYear) : undefined;
      return {
        accountName: name,
        entries: v.entries,
        exits: v.exits,
        balance: v.entries + v.exits,
        color: '',
        isCard,
        cycleStatus: cycle?.status ?? (isCard ? 'open' : undefined),
      };
    });
  }, [monthTransactions, accounts, getCycleForCard, monthYear]);

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

  const budgetPct = budgetTotalLimit > 0 ? Math.min((budgetTotalActual / budgetTotalLimit) * 100, 100) : 0;
  const budgetOver = budgetTotalLimit > 0 && budgetTotalActual > budgetTotalLimit;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Dashboard</h2>
        <MonthSelector value={monthYear} onChange={setMonthYear} months={availableMonths} />
      </div>

      {/* 4 summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Acumulado {currentYear}</p>
          <p className={`text-lg font-bold ${yearBalance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {formatBRL(yearBalance)}
          </p>
        </div>
        <div className="bg-bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Média mensal (12m)</p>
          <p className={`text-lg font-bold ${avg12months >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {formatBRL(avg12months)}
          </p>
        </div>
        <div className="bg-bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Pendentes conciliação</p>
          <p className={`text-lg font-bold ${pendingReconciliation > 0 ? 'text-accent' : 'text-accent-green'}`}>
            {pendingReconciliation}
          </p>
        </div>
        <div className="bg-bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Metas de despesas</p>
          {budgetData.length > 0 ? (
            <>
              <p className={`text-lg font-bold ${budgetOver ? 'text-accent-red' : 'text-accent-green'}`}>
                {formatBRL(budgetTotalRemaining)} restante
              </p>
              <div className="mt-1.5 w-full h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${budgetOver ? 'bg-accent-red' : 'bg-accent-green'}`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
              <p className="text-[10px] text-text-secondary mt-0.5">{budgetPct.toFixed(0)}% utilizado</p>
            </>
          ) : (
            <p className="text-lg font-bold text-text-secondary">—</p>
          )}
        </div>
      </div>

      {hasData ? (
        <div className="space-y-4">
          {/* Resultados de caixa — full width */}
          <CashFlowChart
            data={cashFlowData}
            totalEntries={totalEntries}
            totalExits={totalExits}
            totalBalance={totalBalance}
          />

          {/* Despesas por categoria + Projetos em andamento */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <ExpensesByCategoryChart data={expensesByCategory} />
            </div>

            <div className="lg:col-span-2 bg-bg-card border border-border rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Projetos em andamento</h3>
              {projectsData.length === 0 ? (
                <p className="text-xs text-text-secondary">Nenhum projeto ativo.</p>
              ) : (
                <div className="space-y-2.5">
                  {projectsData.map((p) => (
                    <div key={p.id}>
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                          <span className="text-text-primary truncate">{p.name}</span>
                        </div>
                        <span className={`font-bold flex-shrink-0 ml-2 ${p.spent < 0 ? 'text-accent-red' : 'text-text-secondary'}`}>
                          {p.count > 0 ? formatBRL(p.spent) : '—'}
                        </span>
                      </div>
                      {p.count > 0 && (
                        <div className="flex gap-3 text-[10px] text-text-secondary pl-4 mt-0.5">
                          {p.income > 0 && <span className="text-accent-green">+{formatBRL(p.income)}</span>}
                          <span>{p.count} lançamento{p.count !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
          Importe seus extratos para começar a ver dados aqui.
        </div>
      )}
    </div>
  );
}
