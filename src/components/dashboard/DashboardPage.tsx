import { useState, useMemo } from 'react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import { useAccounts } from '../../hooks/useAccounts';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import { useProjects } from '../../hooks/useProjects';
import { MonthSelector } from '../shared/MonthSelector';
import { CategoryIcon } from '../shared/CategoryIcon';
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

  // Expenses by category (grouped by parent; subcategory breakdowns tracked separately)
  const expensesByCategory = useMemo(() => {
    const map = new Map<string, { amount: number; subs: Map<string, number> }>();
    for (const t of monthTransactions) {
      if (t.amount >= 0) continue;
      const catId = t.categoryId || '__uncategorized';
      const cat = categories.find((c) => c.id === catId);
      const parentId = cat?.parentId || catId; // use parent if it's a subcategory

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
          icon: cat?.icon || '',
          color: cat?.color || '#737373',
          amount,
          percentage: totalExp > 0 ? (Math.abs(amount) / totalExp) * 100 : 0,
          subs: Array.from(subs.entries())
            .map(([subId, subAmount]) => {
              const subCat = categories.find((c) => c.id === subId);
              return {
                name: subCat?.name || 'Sem subcategoria',
                icon: subCat?.icon || '',
                color: subCat?.color || '#737373',
                amount: subAmount,
                percentage: totalExp > 0 ? (Math.abs(subAmount) / totalExp) * 100 : 0,
              };
            })
            .sort((a, b) => a.amount - b.amount),
        };
      })
      .sort((a, b) => a.amount - b.amount); // most negative first
  }, [monthTransactions, categories, totalExits]);

  // Budget progress - group by parent category, aggregate sub spending
  const budgetData = useMemo(() => {
    const monthBudgets = getBudgetsForMonth(monthYear);

    // Actual spending per category (absolute values)
    const actualByCategory = new Map<string, number>();
    for (const t of monthTransactions) {
      if (t.amount >= 0) continue;
      const catId = t.categoryId || '__uncategorized';
      actualByCategory.set(catId, (actualByCategory.get(catId) || 0) + Math.abs(t.amount));
    }

    // Build rows: parent budgets aggregate all sub spending, sub budgets are individual
    const processedParents = new Set<string>();
    const rows: Array<{
      categoryName: string;
      icon: string;
      color: string;
      limit: number;
      spent: number;
      remaining: number;
      isParent: boolean;
    }> = [];

    for (const b of monthBudgets) {
      const cat = categories.find((c) => c.id === b.categoryId);
      if (!cat) continue;

      const isParent = !cat.parentId;

      if (isParent) {
        // Parent: sum spending from self + all subcategories
        let totalSpent = actualByCategory.get(cat.id) || 0;
        const subs = categories.filter((c) => c.parentId === cat.id);
        for (const sub of subs) {
          totalSpent += actualByCategory.get(sub.id) || 0;
        }
        rows.push({
          categoryName: cat.name,
          icon: cat.icon,
          color: cat.color || '#737373',
          limit: b.limitAmount,
          spent: totalSpent,
          remaining: Math.max(b.limitAmount - totalSpent, 0),
          isParent: true,
        });
        processedParents.add(cat.id);
      } else {
        // Subcategory: only its own spending
        const spent = actualByCategory.get(cat.id) || 0;
        rows.push({
          categoryName: cat.name,
          icon: cat.icon,
          color: cat.color || '#737373',
          limit: b.limitAmount,
          spent,
          remaining: Math.max(b.limitAmount - spent, 0),
          isParent: false,
        });
      }
    }

    return rows;
  }, [monthYear, categories, monthTransactions, getBudgetsForMonth]);

  // Grand totals - only parent-level budgets
  const budgetTotalLimit = budgetData.filter((b) => b.isParent).reduce((s, b) => s + b.limit, 0);
  const budgetTotalActual = budgetData.filter((b) => b.isParent).reduce((s, b) => s + b.spent, 0);

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

      {hasData ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT COLUMN: Cash flow + KPIs */}
          <div className="space-y-4">
            <CashFlowChart
              data={cashFlowData}
              totalEntries={totalEntries}
              totalExits={totalExits}
              totalBalance={totalBalance}
            />

            {/* Compact KPIs: single card with 2 horizontal rows */}
            <div className="bg-bg-card border border-border rounded-lg divide-y divide-border">
              <div className="flex items-center justify-between px-4 py-2.5">
                <p className="text-[10px] text-text-secondary uppercase tracking-wider">Acumulado {currentYear}</p>
                <p className={`text-xs font-bold tabular-nums ${yearBalance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatBRL(yearBalance)}
                </p>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <p className="text-[10px] text-text-secondary uppercase tracking-wider">Média mensal (12m)</p>
                <p className={`text-xs font-bold tabular-nums ${avg12months >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatBRL(avg12months)}
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Expenses + Projects + Metas */}
          <div className="space-y-4">
            <ExpensesByCategoryChart data={expensesByCategory} />

            {/* Projetos em andamento */}
            <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Projetos em andamento</h3>
              {projectsData.length === 0 ? (
                <p className="text-xs text-text-secondary">Nenhum projeto ativo.</p>
              ) : (
                <div className="space-y-2.5">
                  {projectsData.map((p) => (
                    <div key={p.id}>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                          <span className="text-text-primary truncate">{p.name}</span>
                        </div>
                        <span className={`font-bold ${p.spent < 0 ? 'text-accent-red' : 'text-text-secondary'}`}>
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

            {/* Metas de despesas */}
            <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Metas de despesas</h3>
                <span className="text-[10px] text-accent-green">Situacao confirmada</span>
              </div>
              {budgetData.length === 0 ? (
                <p className="text-xs text-text-secondary">Nenhuma meta definida para este mes.</p>
              ) : (
                <div className="space-y-2">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_repeat(3,_minmax(60px,_80px))] gap-2 text-[10px] text-text-secondary uppercase tracking-wider">
                    <span />
                    <span className="text-right">Meta</span>
                    <span className="text-right">Realizado</span>
                    <span className="text-right">A realizar</span>
                  </div>

                  {budgetData.map((b, i) => {
                    const pct = b.limit > 0 ? (b.spent / b.limit) * 100 : 0;
                    const over = b.spent > b.limit;
                    const barPct = Math.min(pct, 100);
                    return (
                      <div key={i} className="grid grid-cols-[1fr_repeat(3,_minmax(60px,_80px))] gap-2 items-center">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <div className="w-0.5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                            <span className={`text-xs truncate ${b.isParent ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                              {b.categoryName}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 pl-2.5">
                            <div className="flex-1 h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${over ? 'bg-accent-red' : 'bg-accent'}`}
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                            <span className={`text-[10px] font-mono ${over ? 'text-accent-red' : 'text-text-secondary'}`}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                        <span className="text-xs font-mono text-text-primary text-right">{formatBRL(b.limit)}</span>
                        <span className={`text-xs font-mono text-right ${over ? 'text-accent-red' : 'text-text-primary'}`}>{formatBRL(b.spent)}</span>
                        <span className="text-xs font-mono text-text-secondary text-right">{formatBRL(b.remaining)}</span>
                      </div>
                    );
                  })}

                  {/* Total */}
                  <div className="pt-2 border-t border-border grid grid-cols-[1fr_repeat(3,_minmax(60px,_80px))] gap-2 items-center">
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-text-primary">Total</span>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${budgetOver ? 'bg-accent-red' : 'bg-accent'}`}
                            style={{ width: `${budgetPct}%` }}
                          />
                        </div>
                        <span className={`text-[10px] font-mono ${budgetOver ? 'text-accent-red' : 'text-text-secondary'}`}>
                          {budgetPct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold text-text-primary text-right">{formatBRL(budgetTotalLimit)}</span>
                    <span className={`text-xs font-mono font-bold text-right ${budgetOver ? 'text-accent-red' : 'text-text-primary'}`}>{formatBRL(budgetTotalActual)}</span>
                    <span className="text-xs font-mono text-text-secondary text-right">{formatBRL(Math.max(budgetTotalLimit - budgetTotalActual, 0))}</span>
                  </div>
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
