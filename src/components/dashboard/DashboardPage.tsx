import { useState, useMemo, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, ChevronDown, ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import { useAccounts } from '../../hooks/useAccounts';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import { useProjects } from '../../hooks/useProjects';
import { MonthSelector } from '../shared/MonthSelector';
import { CashFlowChart } from './CashFlowChart';
import { ExpensesByCategoryChart } from './ExpensesByCategoryChart';
import { CategoryIcon } from '../shared/CategoryIcon';
import { formatBRL, getMonthYear } from '../../lib/utils';

const MONTH_ABBR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

type YoyMetric = 'expenses' | 'income' | 'balance';

interface YoyDriver {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  /** Amount to display (delta for expense/income, impact for balance). */
  amount: number;
  /** Percentual variation vs previous year (null = no basis). */
  pct: number | null;
  /** Optional badge tag (e.g. "novo", "↑ Receitas"). */
  badge?: string;
}

interface AiInsightState {
  loading: boolean;
  text: string;
  error: string;
}

const EMPTY_AI: AiInsightState = { loading: false, text: '', error: '' };

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
  // Also builds per-category drivers (subcategories roll up to parents) for the attribution UI.
  const yoy = useMemo(() => {
    const [y, m] = monthYear.split('-').map(Number);
    const prevYear = y - 1;
    const catById = new Map(categories.map((c) => [c.id, c]));
    const UNCAT = '__uncat';

    let currIncome = 0;
    let currExpenses = 0;
    let prevIncome = 0;
    let prevExpenses = 0;
    let hasPrev = false;

    const expenseByCat = new Map<string, { curr: number; prev: number }>();
    const incomeByCat = new Map<string, { curr: number; prev: number }>();

    const bump = (
      map: Map<string, { curr: number; prev: number }>,
      key: string,
      field: 'curr' | 'prev',
      v: number
    ) => {
      const e = map.get(key) ?? { curr: 0, prev: 0 };
      e[field] += v;
      map.set(key, e);
    };

    for (const t of transactions) {
      const ty = t.date.getFullYear();
      const tm = t.date.getMonth() + 1;
      if (tm > m) continue;
      if (ty !== y && ty !== prevYear) continue;

      // Roll subcategory spending up to its parent category for attribution.
      const rawId = t.categoryId || UNCAT;
      const cat = catById.get(rawId);
      const parentId = cat?.parentId ?? rawId;
      const field: 'curr' | 'prev' = ty === y ? 'curr' : 'prev';

      if (ty === prevYear) hasPrev = true;

      if (t.amount > 0) {
        if (field === 'curr') currIncome += t.amount;
        else prevIncome += t.amount;
        bump(incomeByCat, parentId, field, t.amount);
      } else {
        const abs = -t.amount;
        if (field === 'curr') currExpenses += abs;
        else prevExpenses += abs;
        bump(expenseByCat, parentId, field, abs);
      }
    }

    // Percentage variation: (curr - prev) / |prev|. Returns null when prev is 0 (no basis).
    const pct = (curr: number, prev: number): number | null => {
      if (prev === 0) return null;
      return ((curr - prev) / Math.abs(prev)) * 100;
    };

    const metaFor = (catId: string) => {
      const cat = catById.get(catId);
      return {
        name: cat?.name ?? (catId === UNCAT ? 'Sem categoria' : 'Categoria removida'),
        icon: cat?.icon ?? '',
        color: cat?.color ?? '#737373',
      };
    };

    // Build sorted Top N lists for a single-direction driver map (expense or income).
    const buildDrivers = (
      map: Map<string, { curr: number; prev: number }>
    ): { increases: YoyDriver[]; reductions: YoyDriver[] } => {
      const rows: YoyDriver[] = [];
      for (const [catId, { curr, prev }] of map) {
        const delta = curr - prev;
        if (delta === 0) continue;
        const meta = metaFor(catId);
        let badge: string | undefined;
        if (prev === 0 && curr > 0) badge = 'novo';
        else if (curr === 0 && prev > 0) badge = 'zerado';
        rows.push({
          categoryId: catId,
          name: meta.name,
          icon: meta.icon,
          color: meta.color,
          amount: delta,
          pct: pct(curr, prev),
          badge,
        });
      }
      const byAbs = (a: YoyDriver, b: YoyDriver) =>
        Math.abs(b.amount) - Math.abs(a.amount) || a.name.localeCompare(b.name);
      return {
        increases: rows.filter((r) => r.amount > 0).sort(byAbs).slice(0, 5),
        reductions: rows.filter((r) => r.amount < 0).sort(byAbs).slice(0, 5),
      };
    };

    const expenseDrivers = buildDrivers(expenseByCat);
    const incomeDrivers = buildDrivers(incomeByCat);

    // Result drivers: per category, impact = ΔIncome − ΔExpense (expense down ⇒ lifts result).
    const allCatIds = new Set<string>([...expenseByCat.keys(), ...incomeByCat.keys()]);
    const balanceRows: YoyDriver[] = [];
    for (const catId of allCatIds) {
      const e = expenseByCat.get(catId) ?? { curr: 0, prev: 0 };
      const i = incomeByCat.get(catId) ?? { curr: 0, prev: 0 };
      const incomeDelta = i.curr - i.prev;
      const expenseDelta = e.curr - e.prev;
      const impact = incomeDelta - expenseDelta;
      if (impact === 0) continue;
      const meta = metaFor(catId);
      // Hint whether the impact comes from income or expense side.
      const hint =
        Math.abs(incomeDelta) > Math.abs(expenseDelta)
          ? incomeDelta > 0
            ? 'Receita ↑'
            : 'Receita ↓'
          : expenseDelta > 0
            ? 'Despesa ↑'
            : 'Despesa ↓';
      balanceRows.push({
        categoryId: catId,
        name: meta.name,
        icon: meta.icon,
        color: meta.color,
        amount: impact,
        pct: null,
        badge: hint,
      });
    }
    const byAbsImpact = (a: YoyDriver, b: YoyDriver) =>
      Math.abs(b.amount) - Math.abs(a.amount) || a.name.localeCompare(b.name);

    const currBalance = currIncome - currExpenses;
    const prevBalance = prevIncome - prevExpenses;

    return {
      prevYear,
      hasPrev,
      expenses: {
        curr: currExpenses,
        prev: prevExpenses,
        pct: pct(currExpenses, prevExpenses),
        increases: expenseDrivers.increases,
        reductions: expenseDrivers.reductions,
      },
      income: {
        curr: currIncome,
        prev: prevIncome,
        pct: pct(currIncome, prevIncome),
        increases: incomeDrivers.increases,
        reductions: incomeDrivers.reductions,
      },
      balance: {
        curr: currBalance,
        prev: prevBalance,
        pct: pct(currBalance, prevBalance),
        incomeContribution: currIncome - prevIncome,
        expenseContribution: -(currExpenses - prevExpenses),
        increases: balanceRows.filter((r) => r.amount > 0).sort(byAbsImpact).slice(0, 5),
        reductions: balanceRows.filter((r) => r.amount < 0).sort(byAbsImpact).slice(0, 5),
      },
    };
  }, [transactions, monthYear, categories]);

  // Selected month is "in progress" when it matches the current real month (not yet closed).
  const isMonthInProgress = monthYear === getMonthYear();
  const selectedMonthIdx = Number(monthYear.split('-')[1]) - 1;
  const periodLabel = `Jan–${MONTH_ABBR[selectedMonthIdx]}`;

  // Per-row expansion + per-metric AI insight cache. Both reset when the selected month changes.
  const [expandedYoy, setExpandedYoy] = useState<Set<YoyMetric>>(new Set());
  const [aiInsights, setAiInsights] = useState<Record<YoyMetric, AiInsightState>>({
    expenses: EMPTY_AI,
    income: EMPTY_AI,
    balance: EMPTY_AI,
  });

  useEffect(() => {
    setExpandedYoy(new Set());
    setAiInsights({ expenses: EMPTY_AI, income: EMPTY_AI, balance: EMPTY_AI });
  }, [monthYear]);

  const toggleYoyRow = (metric: YoyMetric) => {
    setExpandedYoy((prev) => {
      const next = new Set(prev);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });
  };

  const requestYoyInsight = async (metric: YoyMetric) => {
    const apiKey = localStorage.getItem('anthropic_api_key') || '';
    if (!apiKey) {
      setAiInsights((s) => ({
        ...s,
        [metric]: { ...EMPTY_AI, error: 'Configure sua chave Anthropic em Configurações > Chave API.' },
      }));
      return;
    }
    setAiInsights((s) => ({ ...s, [metric]: { loading: true, text: '', error: '' } }));
    try {
      const context = buildYoyContext(metric, yoy, periodLabel, Number(currentYear));
      const message = buildYoyPrompt(metric, yoy);
      const response = await fetch('/api/financial-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: [], context, apiKey }),
      });
      const data = (await response.json()) as { response?: string; error?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setAiInsights((s) => ({ ...s, [metric]: { loading: false, text: data.response || '', error: '' } }));
    } catch (err) {
      setAiInsights((s) => ({
        ...s,
        [metric]: { loading: false, text: '', error: err instanceof Error ? err.message : 'Falha ao gerar análise.' },
      }));
    }
  };

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
                <YoyRow
                  metric="expenses"
                  label="Despesas"
                  curr={yoy.expenses.curr}
                  prev={yoy.expenses.prev}
                  pct={yoy.expenses.pct}
                  higherIsBetter={false}
                  hasPrev={yoy.hasPrev}
                  prevYear={yoy.prevYear}
                  expanded={expandedYoy.has('expenses')}
                  onToggle={() => toggleYoyRow('expenses')}
                  increases={yoy.expenses.increases}
                  reductions={yoy.expenses.reductions}
                  ai={aiInsights.expenses}
                  onRequestAi={() => requestYoyInsight('expenses')}
                />
                <YoyRow
                  metric="income"
                  label="Receitas"
                  curr={yoy.income.curr}
                  prev={yoy.income.prev}
                  pct={yoy.income.pct}
                  higherIsBetter
                  hasPrev={yoy.hasPrev}
                  prevYear={yoy.prevYear}
                  expanded={expandedYoy.has('income')}
                  onToggle={() => toggleYoyRow('income')}
                  increases={yoy.income.increases}
                  reductions={yoy.income.reductions}
                  ai={aiInsights.income}
                  onRequestAi={() => requestYoyInsight('income')}
                />
                <YoyRow
                  metric="balance"
                  label="Resultado"
                  curr={yoy.balance.curr}
                  prev={yoy.balance.prev}
                  pct={yoy.balance.pct}
                  higherIsBetter
                  hasPrev={yoy.hasPrev}
                  prevYear={yoy.prevYear}
                  signed
                  expanded={expandedYoy.has('balance')}
                  onToggle={() => toggleYoyRow('balance')}
                  increases={yoy.balance.increases}
                  reductions={yoy.balance.reductions}
                  balanceSummary={{
                    incomeContribution: yoy.balance.incomeContribution,
                    expenseContribution: yoy.balance.expenseContribution,
                  }}
                  ai={aiInsights.balance}
                  onRequestAi={() => requestYoyInsight('balance')}
                />
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
  metric: YoyMetric;
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
  expanded: boolean;
  onToggle: () => void;
  increases: YoyDriver[];
  reductions: YoyDriver[];
  balanceSummary?: { incomeContribution: number; expenseContribution: number };
  ai: AiInsightState;
  onRequestAi: () => void;
}

function YoyRow({
  metric,
  label,
  curr,
  prev,
  pct,
  higherIsBetter,
  hasPrev,
  prevYear,
  signed,
  expanded,
  onToggle,
  increases,
  reductions,
  balanceSummary,
  ai,
  onRequestAi,
}: YoyRowProps) {
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

  // Labels for the two driver blocks — phrased differently per metric.
  const copy: Record<YoyMetric, { up: string; down: string }> = {
    expenses: { up: 'Principais aumentos', down: 'Principais reduções' },
    income: { up: 'Principais aumentos', down: 'Principais quedas' },
    balance: { up: 'Contribuíram positivamente', down: 'Pressionaram negativamente' },
  };

  // Semantics for driver colour: for expenses, "up" is bad (red) and "down" is good (green);
  // for income and balance, the opposite.
  const upIsGood = metric !== 'expenses';

  const canExpand = hasPrev && (increases.length > 0 || reductions.length > 0 || metric === 'balance');

  return (
    <div>
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        className={`w-full flex items-center justify-between px-4 py-2 text-left ${canExpand ? 'cursor-pointer hover:bg-bg-secondary/40' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {canExpand ? (
            expanded ? (
              <ChevronDown size={12} className="text-text-secondary flex-shrink-0" />
            ) : (
              <ChevronRight size={12} className="text-text-secondary flex-shrink-0" />
            )
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-[11px] text-text-primary">{label}</p>
            <p className="text-[10px] text-text-secondary tabular-nums mt-0.5">
              {fmt(curr)}
              <span className="text-text-secondary/60"> · {prevYear}: {hasPrev ? fmt(prev) : '—'}</span>
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs font-bold tabular-nums ${color}`}>
          <Icon size={12} />
          <span>{pctText}</span>
        </div>
      </button>

      {expanded && canExpand && (
        <div className="bg-bg-secondary/30 border-t border-border px-4 py-3 space-y-3">
          {!hasPrev ? (
            <p className="text-[11px] text-text-secondary">Sem base de comparação em {prevYear}.</p>
          ) : (
            <>
              {balanceSummary && (
                <div className="flex items-center gap-3 flex-wrap text-[10px] text-text-secondary tabular-nums">
                  <span>
                    Receitas{' '}
                    <span className={balanceSummary.incomeContribution >= 0 ? 'text-accent-green' : 'text-accent-red'}>
                      {balanceSummary.incomeContribution >= 0 ? '+' : ''}
                      {formatBRL(balanceSummary.incomeContribution)}
                    </span>
                  </span>
                  <span className="text-text-secondary/50">·</span>
                  <span>
                    Despesas{' '}
                    <span className={balanceSummary.expenseContribution >= 0 ? 'text-accent-green' : 'text-accent-red'}>
                      {balanceSummary.expenseContribution >= 0 ? '+' : ''}
                      {formatBRL(balanceSummary.expenseContribution)}
                    </span>
                  </span>
                </div>
              )}

              <DriverBlock title={copy[metric].up} drivers={increases} positive={upIsGood} />
              <DriverBlock title={copy[metric].down} drivers={reductions} positive={!upIsGood} />

              <AiInsightBlock state={ai} onRequest={onRequestAi} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DriverBlock({ title, drivers, positive }: { title: string; drivers: YoyDriver[]; positive: boolean }) {
  if (drivers.length === 0) {
    return (
      <div>
        <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">{title}</p>
        <p className="text-[11px] text-text-secondary/70">Nenhuma categoria com variação significativa.</p>
      </div>
    );
  }
  const amountColor = positive ? 'text-accent-green' : 'text-accent-red';
  return (
    <div>
      <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">{title}</p>
      <div className="space-y-0.5">
        {drivers.map((d) => {
          const sign = d.amount > 0 ? '+' : '';
          const pctSign = d.pct !== null && d.pct > 0 ? '+' : '';
          return (
            <div key={d.categoryId} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                <CategoryIcon icon={d.icon} size={11} className="text-text-primary flex-shrink-0" />
                <span className="text-text-primary truncate">{d.name}</span>
                {d.badge && (
                  <span className="text-[9px] text-text-secondary bg-bg-card border border-border rounded px-1 py-0.5 leading-none flex-shrink-0">
                    {d.badge}
                  </span>
                )}
              </div>
              <div className={`flex items-center gap-1.5 tabular-nums font-bold ${amountColor}`}>
                <span>
                  {sign}
                  {formatBRL(d.amount)}
                </span>
                {d.pct !== null && (
                  <span className="text-text-secondary/70 font-normal text-[10px]">
                    ({pctSign}
                    {d.pct.toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AiInsightBlock({ state, onRequest }: { state: AiInsightState; onRequest: () => void }) {
  return (
    <div className="pt-2 border-t border-border/60 space-y-2">
      {state.text ? (
        <div className="flex gap-2 text-[11px] text-text-primary bg-bg-card border border-border rounded px-2 py-1.5">
          <Sparkles size={12} className="text-accent flex-shrink-0 mt-0.5" />
          <p className="leading-relaxed whitespace-pre-wrap">{state.text}</p>
        </div>
      ) : null}
      {state.error ? <p className="text-[10px] text-accent-red">{state.error}</p> : null}
      <button
        type="button"
        onClick={onRequest}
        disabled={state.loading}
        className="flex items-center gap-1.5 text-[10px] text-accent hover:text-accent/80 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {state.loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
        {state.loading ? 'Gerando análise...' : state.text ? 'Regenerar análise com IA' : 'Gerar análise com IA'}
      </button>
    </div>
  );
}

// ------- AI payload builders -------

interface YoySection {
  curr: number;
  prev: number;
  pct: number | null;
  increases: YoyDriver[];
  reductions: YoyDriver[];
  incomeContribution?: number;
  expenseContribution?: number;
}

interface YoySummary {
  prevYear: number;
  hasPrev: boolean;
  expenses: YoySection;
  income: YoySection;
  balance: YoySection;
}

const METRIC_LABEL: Record<YoyMetric, string> = {
  expenses: 'Despesas',
  income: 'Receitas',
  balance: 'Resultado (receitas − despesas)',
};

function formatDriverLine(d: YoyDriver): string {
  const sign = d.amount > 0 ? '+' : '';
  const pct = d.pct !== null ? ` (${d.pct > 0 ? '+' : ''}${d.pct.toFixed(1)}%)` : '';
  const badge = d.badge ? ` [${d.badge}]` : '';
  return `- ${d.name}: ${sign}${formatBRL(d.amount)}${pct}${badge}`;
}

function buildYoyContext(metric: YoyMetric, yoy: YoySummary, periodLabel: string, currentYear: number): string {
  const s = yoy[metric];
  const pctText = s.pct !== null ? `${s.pct > 0 ? '+' : ''}${s.pct.toFixed(1)}%` : 'sem base (ano anterior = 0)';
  const header = [
    `MÉTRICA: ${METRIC_LABEL[metric]}`,
    `PERÍODO: ${periodLabel} ${currentYear} vs ${periodLabel} ${yoy.prevYear}`,
    `VALOR ATUAL: ${formatBRL(s.curr)}`,
    `VALOR ANO ANTERIOR: ${formatBRL(s.prev)}`,
    `VARIAÇÃO YoY: ${pctText}`,
  ];
  if (metric === 'balance' && s.incomeContribution !== undefined && s.expenseContribution !== undefined) {
    header.push(
      `DECOMPOSIÇÃO: receitas ${s.incomeContribution >= 0 ? '+' : ''}${formatBRL(s.incomeContribution)} · despesas ${s.expenseContribution >= 0 ? '+' : ''}${formatBRL(s.expenseContribution)}`
    );
  }
  const upTitle = metric === 'balance' ? 'CATEGORIAS QUE CONTRIBUÍRAM POSITIVAMENTE' : 'PRINCIPAIS AUMENTOS';
  const downTitle = metric === 'balance' ? 'CATEGORIAS QUE PRESSIONARAM NEGATIVAMENTE' : 'PRINCIPAIS REDUÇÕES';
  const upLines = s.increases.length ? s.increases.map(formatDriverLine).join('\n') : '(nenhuma relevante)';
  const downLines = s.reductions.length ? s.reductions.map(formatDriverLine).join('\n') : '(nenhuma relevante)';
  return [
    header.join('\n'),
    `\n${upTitle}:\n${upLines}`,
    `\n${downTitle}:\n${downLines}`,
  ].join('\n');
}

function buildYoyPrompt(metric: YoyMetric, yoy: YoySummary): string {
  const s = yoy[metric];
  const pctText = s.pct !== null ? `${s.pct > 0 ? '+' : ''}${s.pct.toFixed(1)}%` : 'variação indeterminada';
  return (
    `Explique em 2 a 3 frases curtas e objetivas, em português brasileiro, por que ${METRIC_LABEL[metric]} variou ${pctText} YoY no acumulado do ano. ` +
    `Baseie-se exclusivamente nos drivers listados no contexto; destaque os principais nomes de categoria e o comportamento (o que cresceu, o que caiu). ` +
    `Evite repetir os valores literalmente — contextualize. Se for relevante, encerre sugerindo um ponto que merece atenção. Sem títulos ou listas, apenas o parágrafo.`
  );
}
