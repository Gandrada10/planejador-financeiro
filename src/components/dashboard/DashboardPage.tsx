import { useState, useMemo } from 'react';
import { FileBarChart } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import { useAccounts } from '../../hooks/useAccounts';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import { useProjects } from '../../hooks/useProjects';
import { MonthSelector } from '../shared/MonthSelector';
import { CashFlowTable } from './CashFlowTable';
import { MonthFlowPanel } from './MonthFlowPanel';
import { CategoryDetailPanel } from './CategoryDetailPanel';
import { YoyDeviationPanel } from './YoyDeviationPanel';
import { ExpensesPanel } from './ExpensesPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { VitalSigns } from './VitalSigns';
import { computeCostOfLiving } from '../../lib/costOfLiving';
import { formatBRL, getMonthYear, getClosedMonthYear, getMonthLabel, countsInTotals, getExcludedFromTotalsIds, isIncomeAmount, isExpenseAmount, accountingDate } from '../../lib/utils';

const MONTH_ABBR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function DashboardPage() {
  // Abre no último mês FECHADO: o mês corrente tem números pela metade.
  const [monthYear, setMonthYear] = useState(getClosedMonthYear());
  // Categoria clicada no Sankey: enquanto aberta, a análise dela ocupa a
  // coluna ao lado do fluxo (Metas/Caixa voltam ao fechar). O estado vive
  // aqui porque atravessa os dois cards da banda.
  const [flowCategory, setFlowCategory] = useState<string | null>(null);
  const { transactions, loading: loadingTx } = useTransactions();
  const { categories } = useCategories();
  const { getBudgetsForMonth } = useBudgets();
  const { accounts } = useAccounts();
  const { getCycleForCard } = useBillingCycles();
  const { projects } = useProjects();

  // Ids de categorias fora-dos-totais ("Transferência") — pré-computado uma vez
  // e reutilizado em todos os blocos de agregação abaixo (regra: countsInTotals).
  const excludedIds = useMemo(() => getExcludedFromTotalsIds(categories), [categories]);

  const monthTransactions = useMemo(
    () => transactions.filter((t) => getMonthYear(accountingDate(t)) === monthYear),
    [transactions, monthYear]
  );

  const availableMonths = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    set.add(getMonthYear());
    set.add(getClosedMonthYear()); // garante o mês de abertura na lista
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const totalEntries = useMemo(() => monthTransactions.filter((t) => countsInTotals(t, excludedIds) && isIncomeAmount(t)).reduce((s, t) => s + t.amount, 0), [monthTransactions, excludedIds]);
  const totalExits = useMemo(() => monthTransactions.filter((t) => countsInTotals(t, excludedIds) && isExpenseAmount(t)).reduce((s, t) => s + t.amount, 0), [monthTransactions, excludedIds]);
  const totalBalance = totalEntries + totalExits;

  // YTD accumulated result (year of selected month)
  const currentYear = monthYear.split('-')[0];
  const yearBalance = useMemo(() => {
    return transactions
      .filter((t) => countsInTotals(t, excludedIds) && getMonthYear(accountingDate(t)).startsWith(currentYear))
      .reduce((s, t) => s + t.amount, 0);
  }, [transactions, currentYear, excludedIds]);

  // Average monthly result over last 12 months (only months with data)
  const avg12months = useMemo(() => {
    const [y, m] = monthYear.split('-').map(Number);
    const last12: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(y, m - 1 - i, 1);
      last12.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const withData = last12.filter((mo) => transactions.some((t) => countsInTotals(t, excludedIds) && getMonthYear(accountingDate(t)) === mo));
    if (withData.length === 0) return 0;
    const total = withData.reduce((sum, mo) => {
      return sum + transactions.filter((t) => countsInTotals(t, excludedIds) && getMonthYear(accountingDate(t)) === mo).reduce((s, t) => s + t.amount, 0);
    }, 0);
    return total / withData.length;
  }, [transactions, monthYear, excludedIds]);

  // Selected month is "in progress" when it matches the current real month (not yet closed).
  const isMonthInProgress = monthYear === getMonthYear();
  const selectedMonthIdx = Number(monthYear.split('-')[1]) - 1;
  const periodLabel = `Jan–${MONTH_ABBR[selectedMonthIdx]}`;

  // Custo de vida (média móvel 12M) — compartilhado entre o tile de sinais
  // vitais e o card de trajetória.
  const costOfLiving = useMemo(
    () => computeCostOfLiving(transactions, categories, monthYear, isMonthInProgress),
    [transactions, categories, monthYear, isMonthInProgress]
  );

  // Cash flow by account
  const cashFlowData = useMemo(() => {
    const map = new Map<string, { entries: number; exits: number }>();
    for (const t of monthTransactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      const key = t.account || 'Sem conta';
      if (!map.has(key)) map.set(key, { entries: 0, exits: 0 });
      const acc = map.get(key)!;
      if (isIncomeAmount(t)) acc.entries += t.amount;
      else acc.exits += t.amount;
    }
    // A ORDEM entre tipos é do CashFlowTable (que agrupa por tipo); aqui só
    // ordena alfabeticamente dentro de cada grupo.
    return Array.from(map.entries())
      .map(([name, v]) => {
        const account = accounts.find((a) => a.name === name);
        const isCard = account?.type === 'cartao';
        const cycle = isCard && account ? getCycleForCard(account.id, monthYear) : undefined;
        return {
          accountName: name,
          type: account?.type,
          entries: v.entries,
          exits: v.exits,
          balance: v.entries + v.exits,
          isCard,
          cycleStatus: cycle?.status ?? (isCard ? 'open' : undefined),
        };
      })
      .sort((a, b) => a.accountName.localeCompare(b.accountName, 'pt-BR'));
  }, [monthTransactions, accounts, getCycleForCard, monthYear, excludedIds]);

  // Budget progress - group by parent category, aggregate sub spending
  const budgetData = useMemo(() => {
    const monthBudgets = getBudgetsForMonth(monthYear);

    // Actual spending per category (absolute values)
    const actualByCategory = new Map<string, number>();
    for (const t of monthTransactions) {
      if (!isExpenseAmount(t) || !countsInTotals(t, excludedIds)) continue;
      const catId = t.categoryId || '__uncategorized';
      // `-t.amount`: para despesa (negativa) é o mesmo que Math.abs; para um
      // reembolso (positivo) SUBTRAI, reduzindo o realizado (contra-despesa).
      actualByCategory.set(catId, (actualByCategory.get(catId) || 0) - t.amount);
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
  }, [monthYear, categories, monthTransactions, getBudgetsForMonth, excludedIds]);

  // Grand totals - only parent-level budgets
  const budgetTotalLimit = budgetData.filter((b) => b.isParent).reduce((s, b) => s + b.limit, 0);
  const budgetTotalActual = budgetData.filter((b) => b.isParent).reduce((s, b) => s + b.spent, 0);

  if (loadingTx) {
    return <DashboardSkeleton />;
  }

  const hasData = transactions.length > 0;

  const budgetPct = budgetTotalLimit > 0 ? Math.min((budgetTotalActual / budgetTotalLimit) * 100, 100) : 0;
  const budgetOver = budgetTotalLimit > 0 && budgetTotalActual > budgetTotalLimit;

  return (
    // Largura máxima centralizada: sem ela, num monitor de 1900px os cards
    // esticavam de borda a borda — colunas de ~830px para tabelas que pedem
    // ~600px, e os cards das pontas colados nas margens da janela.
    <div className="max-w-[1440px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-text-primary">Dashboard</h2>
        <MonthSelector value={monthYear} onChange={setMonthYear} months={availableMonths} />
      </div>

      {hasData ? (
        <div className="space-y-4">
        {/* Sinais vitais: "como estou?" em 4 números, antes de qualquer tabela */}
        <VitalSigns
          transactions={transactions}
          categories={categories}
          monthLabel={getMonthLabel(monthYear)}
          monthIncome={totalEntries}
          monthExpenses={totalExits}
          monthBalance={totalBalance}
          avg12mResult={avg12months}
          isMonthInProgress={isMonthInProgress}
          costOfLiving={costOfLiving}
        />

        {/* ---- FLUXO | COMPROMISSOS ----
            Esquerda (4/7): só o Sankey — ele estica até a altura da coluna
            vizinha e centraliza o diagrama no espaço que sobrar.
            Direita (3/7): projetos e metas, o que você se comprometeu a
            fazer com o dinheiro. A análise da categoria clicada entra no
            TOPO da coluna, cara a cara com o diagrama que a gerou, sem
            esconder nenhum dos dois. */}
        <div className="grid grid-cols-1 lg:grid-cols-[4fr_3fr] gap-4">
          <MonthFlowPanel
            transactions={transactions}
            categories={categories}
            monthYear={monthYear}
            isMonthInProgress={isMonthInProgress}
            selectedCategory={flowCategory}
            onSelectCategory={setFlowCategory}
          />

          <div className="space-y-4">
            {flowCategory && (
              <CategoryDetailPanel
                transactions={transactions}
                categories={categories}
                categoryId={flowCategory}
                monthYear={monthYear}
                isMonthInProgress={isMonthInProgress}
                onClose={() => setFlowCategory(null)}
              />
            )}

            <ProjectsPanel
              projects={projects}
              transactions={transactions}
              excludedIds={excludedIds}
              monthYear={monthYear}
            />

            {/* Metas de despesas */}
            <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
              <h3 className="text-title font-semibold text-text-primary">Metas de despesas</h3>
              {budgetData.length === 0 ? (
                <p className="text-caption text-ink-3">Nenhuma meta definida para este mês.</p>
              ) : (
                <div className="space-y-2">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_repeat(3,_minmax(60px,_80px))] gap-2 text-caption text-ink-3 uppercase tracking-wider">
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
                            <span className={`text-body truncate ${b.isParent ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                              {b.categoryName}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 pl-2.5">
                            <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${over ? 'bg-accent-red' : 'bg-accent'}`}
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                            <span className={`text-caption tnum ${over ? 'text-accent-red' : 'text-ink-3'}`}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                        <span className="text-body tnum text-text-primary text-right">{formatBRL(b.limit)}</span>
                        <span className={`text-body tnum text-right ${over ? 'text-accent-red' : 'text-text-primary'}`}>{formatBRL(b.spent)}</span>
                        <span className="text-body tnum text-text-secondary text-right">{formatBRL(b.remaining)}</span>
                      </div>
                    );
                  })}

                  {/* Total */}
                  <div className="pt-2 border-t border-border grid grid-cols-[1fr_repeat(3,_minmax(60px,_80px))] gap-2 items-center">
                    <div className="space-y-1">
                      <span className="text-body font-semibold text-text-primary">Total</span>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${budgetOver ? 'bg-accent-red' : 'bg-accent'}`}
                            style={{ width: `${budgetPct}%` }}
                          />
                        </div>
                        <span className={`text-caption tnum ${budgetOver ? 'text-accent-red' : 'text-ink-3'}`}>
                          {budgetPct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <span className="text-body tnum font-semibold text-text-primary text-right">{formatBRL(budgetTotalLimit)}</span>
                    <span className={`text-body tnum font-semibold text-right ${budgetOver ? 'text-accent-red' : 'text-text-primary'}`}>{formatBRL(budgetTotalActual)}</span>
                    <span className="text-body tnum text-text-secondary text-right">{formatBRL(Math.max(budgetTotalLimit - budgetTotalActual, 0))}</span>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* A evolução mês a mês em largura total: 24 barras respiram. */}
        <ExpensesPanel
          transactions={transactions}
          categories={categories}
          monthYear={monthYear}
          costOfLiving={costOfLiving}
          isMonthInProgress={isMonthInProgress}
        />

        {/* ---- FECHAMENTO: o mês conferido | o ano explicado ----
            Mesma proporção da faixa de cima, para as colunas fecharem
            alinhadas de ponta a ponta da página. */}
        <div className="grid grid-cols-1 lg:grid-cols-[4fr_3fr] gap-4 items-start">
          <CashFlowTable
            data={cashFlowData}
            totalEntries={totalEntries}
            totalExits={totalExits}
            totalBalance={totalBalance}
            yearBalance={yearBalance}
            avg12months={avg12months}
            currentYear={currentYear}
          />

          <YoyDeviationPanel
            transactions={transactions}
            categories={categories}
            monthYear={monthYear}
            isMonthInProgress={isMonthInProgress}
            periodLabel={periodLabel}
          />
        </div>
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-card p-10 text-center space-y-2">
          <FileBarChart size={24} className="mx-auto text-ink-3" strokeWidth={1.5} />
          <p className="text-body text-text-primary">Nada por aqui ainda</p>
          <p className="text-caption text-ink-3">Importe seus extratos em Transações para o dashboard ganhar vida.</p>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="max-w-[1440px] mx-auto space-y-4" aria-busy="true" aria-label="Carregando dashboard">
      <div className="flex items-center justify-between">
        <div className="h-6 w-32 bg-elevated rounded animate-pulse" />
        <div className="h-8 w-44 bg-elevated rounded animate-pulse" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[92px] bg-bg-card border border-border rounded-card animate-pulse" />
        ))}
      </div>
      <div className="h-[260px] bg-bg-card border border-border rounded-card animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[320px] bg-bg-card border border-border rounded-card animate-pulse" />
        <div className="h-[320px] bg-bg-card border border-border rounded-card animate-pulse" />
      </div>
    </div>
  );
}

