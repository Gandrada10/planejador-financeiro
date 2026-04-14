import { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
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

const MONTH_ABBR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

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

  // Year-over-year deviation: accumulated (Jan → selected month) vs same period in the previous year.
  // Expenses and incomes are aggregated as positive magnitudes; the result keeps its natural sign.
  const yoy = useMemo(() => {
    const [y, m] = monthYear.split('-').map(Number);
    const prevYear = y - 1;

    let currIncome = 0;
    let currExpenses = 0;
    let prevIncome = 0;
    let prevExpenses = 0;
    let hasPrev = false;

    for (const t of transactions) {
      const ty = t.date.getFullYear();
      const tm = t.date.getMonth() + 1;
      if (tm > m) continue;
      if (ty === y) {
        if (t.amount > 0) currIncome += t.amount;
        else currExpenses += -t.amount;
      } else if (ty === prevYear) {
        hasPrev = true;
        if (t.amount > 0) prevIncome += t.amount;
        else prevExpenses += -t.amount;
      }
    }

    const currBalance = currIncome - currExpenses;
    const prevBalance = prevIncome - prevExpenses;

    // Percentage variation: (curr - prev) / |prev|. Returns null when prev is 0 (no basis).
    const pct = (curr: number, prev: number): number | null => {
      if (prev === 0) return null;
      return ((curr - prev) / Math.abs(prev)) * 100;
    };

    return {
      prevYear,
      hasPrev,
      expenses: { curr: currExpenses, prev: prevExpenses, pct: pct(currExpenses, prevExpenses) },
      income: { curr: currIncome, prev: prevIncome, pct: pct(currIncome, prevIncome) },
      balance: { curr: currBalance, prev: prevBalance, pct: pct(currBalance, prevBalance) },
    };
  }, [transactions, monthYear]);

  // Selected month is "in progress" when it matches the current real month (not yet closed).
  const isMonthInProgress = monthYear === getMonthYear();
  const selectedMonthIdx = Number(monthYear.split('-')[1]) - 1;
  const periodLabel = `Jan–${MONTH_ABBR[selectedMonthIdx]}`;

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
                <p className="text-xs font-bold text-text-primary uppercase tracking-wider">Acumulado {currentYear}</p>
                <p className={`text-xs font-bold tabular-nums ${yearBalance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatBRL(yearBalance)}
                </p>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <p className="text-xs font-bold text-text-primary uppercase tracking-wider">Média mensal (12m)</p>
                <p className={`text-xs font-bold tabular-nums ${avg12months >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatBRL(avg12months)}
                </p>
              </div>
            </div>

            {/* YoY deviation: same period vs previous year */}
            <div className="bg-bg-card border border-border rounded-lg">
              <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b border-border">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-text-primary uppercase tracking-wider">
                    Desvio YoY · acumulado do ano
                  </p>
                  <p className="text-[10px] text-text-secondary mt-0.5">
                    {periodLabel} {currentYear} vs {periodLabel} {yoy.prevYear}
                  </p>
                </div>
                {isMonthInProgress && (
                  <span
                    className="flex items-center gap-1 text-[10px] text-accent bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5 flex-shrink-0"
                    title="O mês selecionado ainda está em andamento; os valores podem mudar até o fechamento."
                  >
                    <AlertTriangle size={10} />
                    Mês em andamento
                  </span>
                )}
              </div>
              <div className="divide-y divide-border">
                <YoyRow label="Despesas" curr={yoy.expenses.curr} prev={yoy.expenses.prev} pct={yoy.expenses.pct} higherIsBetter={false} hasPrev={yoy.hasPrev} prevYear={yoy.prevYear} />
                <YoyRow label="Receitas" curr={yoy.income.curr} prev={yoy.income.prev} pct={yoy.income.pct} higherIsBetter={true} hasPrev={yoy.hasPrev} prevYear={yoy.prevYear} />
                <YoyRow label="Resultado" curr={yoy.balance.curr} prev={yoy.balance.prev} pct={yoy.balance.pct} higherIsBetter={true} hasPrev={yoy.hasPrev} prevYear={yoy.prevYear} signed />
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

interface YoyRowProps {
  label: string;
  curr: number;
  prev: number;
  pct: number | null;
  /** When true, a positive pct is good (green); when false, a positive pct is bad (red). */
  higherIsBetter: boolean;
  hasPrev: boolean;
  prevYear: number;
  /** When true, format the absolute values with their sign preserved (for "Resultado"). */
  signed?: boolean;
}

function YoyRow({ label, curr, prev, pct, higherIsBetter, hasPrev, prevYear, signed }: YoyRowProps) {
  // Colour & icon logic: map the sign of the pct through higherIsBetter.
  // pct === null ⇒ no prior basis (previous period was 0); show a neutral placeholder.
  let color = 'text-text-secondary';
  let Icon: typeof TrendingUp = Minus;
  let pctText = '—';

  if (!hasPrev) {
    pctText = 'sem dados';
  } else if (pct === null) {
    pctText = 'n/d';
  } else {
    const isBetter = higherIsBetter ? pct > 0 : pct < 0;
    const isWorse = higherIsBetter ? pct < 0 : pct > 0;
    if (Math.abs(pct) < 0.05) {
      color = 'text-text-secondary';
      Icon = Minus;
    } else if (isBetter) {
      color = 'text-accent-green';
      Icon = pct > 0 ? TrendingUp : TrendingDown;
    } else if (isWorse) {
      color = 'text-accent-red';
      Icon = pct > 0 ? TrendingUp : TrendingDown;
    }
    const sign = pct > 0 ? '+' : '';
    pctText = `${sign}${pct.toFixed(1)}%`;
  }

  const fmt = (v: number) => (signed || v < 0 ? formatBRL(v) : formatBRL(Math.abs(v)));

  return (
    <div className="flex items-center justify-between px-4 py-2">
      <div className="min-w-0">
        <p className="text-[11px] text-text-primary">{label}</p>
        <p className="text-[10px] text-text-secondary tabular-nums mt-0.5">
          {fmt(curr)}
          <span className="text-text-secondary/60"> · {prevYear}: {hasPrev ? fmt(prev) : '—'}</span>
        </p>
      </div>
      <div className={`flex items-center gap-1 text-xs font-bold tabular-nums ${color}`}>
        <Icon size={12} />
        <span>{pctText}</span>
      </div>
    </div>
  );
}
