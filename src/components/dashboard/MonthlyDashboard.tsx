import { useState, useMemo } from 'react';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import { useAccounts } from '../../hooks/useAccounts';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import { useProjects } from '../../hooks/useProjects';
import { CashFlowTable } from './CashFlowTable';
import { MonthFlowPanel } from './MonthFlowPanel';
import { CategoryDetailPanel } from './CategoryDetailPanel';
import { ExpensesPanel } from './ExpensesPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { BudgetGoalsPanel } from './BudgetGoalsPanel';
import { VitalSigns } from './VitalSigns';
import { computeCostOfLiving } from '../../lib/costOfLiving';
import { computeMonthProjection, computeCommitments } from '../../lib/annualStats';
import {
  getMonthYear,
  getMonthLabel,
  getMonthYearOffset,
  countsInTotals,
  getExcludedFromTotalsIds,
  isIncomeAmount,
  isExpenseAmount,
  accountingDate,
} from '../../lib/utils';
import type { Transaction } from '../../types';

interface Props {
  transactions: Transaction[];
  monthYear: string;
}

/**
 * A face MENSAL do dashboard — o corpo que antes vivia direto no
 * `DashboardPage`, extraído quando a chave Mês/Ano entrou e a página virou uma
 * casca com duas faces.
 *
 * O "o que puxou o ano" saiu daqui: ele comparava jan→mês selecionado contra o
 * mesmo período do ano passado, uma leitura ANUAL morando no mês. Foi para o
 * dashboard anual, que é onde a pergunta que ele responde é feita.
 */
export function MonthlyDashboard({ transactions, monthYear }: Props) {
  // Categoria clicada no Sankey: enquanto aberta, a análise dela ocupa a
  // coluna ao lado do fluxo (Metas/Caixa voltam ao fechar). O estado vive
  // aqui porque atravessa os dois cards da banda.
  const [flowCategory, setFlowCategory] = useState<string | null>(null);
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

  const totalEntries = useMemo(() => monthTransactions.filter((t) => countsInTotals(t, excludedIds) && isIncomeAmount(t)).reduce((s, t) => s + t.amount, 0), [monthTransactions, excludedIds]);
  const totalExits = useMemo(() => monthTransactions.filter((t) => countsInTotals(t, excludedIds) && isExpenseAmount(t)).reduce((s, t) => s + t.amount, 0), [monthTransactions, excludedIds]);
  const totalBalance = totalEntries + totalExits;

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

  // Custo de vida (média móvel 12M) — compartilhado entre o tile de sinais
  // vitais e o card de trajetória.
  const costOfLiving = useMemo(
    () => computeCostOfLiving(transactions, categories, monthYear, isMonthInProgress),
    [transactions, categories, monthYear, isMonthInProgress]
  );

  // Onde o mês em andamento deve fechar. Só existe no mês corrente — num mês
  // fechado o número real já está na tela e projetar seria ruído.
  const projection = useMemo(
    () => (isMonthInProgress ? computeMonthProjection(transactions, categories, monthYear) : null),
    [transactions, categories, monthYear, isMonthInProgress]
  );

  // O que já está contratado para o mês seguinte ao selecionado: parcelas
  // futuras já gravadas na importação. Fecha o curto prazo do planejamento.
  const nextMonth = useMemo(
    () => computeCommitments(transactions, categories, getMonthYearOffset(monthYear, 1), 1),
    [transactions, categories, monthYear]
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

  return (
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
        projection={projection}
      />

      {/* ---- BANDA 1: O MÊS POR DENTRO ----
          O fluxo do dinheiro e a conferência do caixa LADO A LADO: são a mesma
          pergunta vista de dois ângulos ("para onde foi" e "de qual conta
          saiu"), e um em cima do outro obrigava a rolar para cruzar os dois.
          O Sankey leva 4/7 porque é desenho e precisa de largura; a tabela de
          caixa tem 4 colunas e cabe em 3/7.

          Sem `items-start`: as duas colunas terminam em alturas diferentes e a
          sobra é absorvida pelo card mais curto (`h-full`), virando respiro
          DENTRO da moldura em vez de um buraco na página — a mesma escolha que
          a versão anterior desta tela já fazia com `flex-1`. */}
      <div className="grid grid-cols-1 lg:grid-cols-[4fr_3fr] gap-4">
        <div className="min-w-0">
          <MonthFlowPanel
            transactions={transactions}
            categories={categories}
            monthYear={monthYear}
            isMonthInProgress={isMonthInProgress}
            selectedCategory={flowCategory}
            onSelectCategory={setFlowCategory}
            nextMonthCommitted={nextMonth.total}
            nextMonthLabel={getMonthLabel(getMonthYearOffset(monthYear, 1))}
          />
        </div>

        <div className="min-w-0">
          <CashFlowTable
            data={cashFlowData}
            totalEntries={totalEntries}
            totalExits={totalExits}
            totalBalance={totalBalance}
            monthLabel={getMonthLabel(monthYear)}
            className="h-full"
          />
        </div>
      </div>

      {/* A análise da categoria clicada entra em largura total logo abaixo do
          diagrama que a gerou — com o caixa ocupando a coluna da direita, não
          há mais uma lateral livre para ela, e em largura total a lista de
          subcategorias respira em vez de truncar. */}
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

      {/* ---- BANDA 2: OS COMPROMISSOS ----
          Projetos e metas lado a lado: os dois respondem "o que eu combinei
          comigo mesmo, e como está indo". */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="min-w-0">
          <ProjectsPanel
            projects={projects}
            transactions={transactions}
            excludedIds={excludedIds}
            monthYear={monthYear}
            className="h-full"
          />
        </div>

        <div className="min-w-0">
          <BudgetGoalsPanel rows={budgetData} className="h-full" />
        </div>
      </div>

      {/* Fecha a página em largura total: 24 barras (e 36, nas janelas
          longas) respiram. É o único card cuja leitura depende de largura,
          então é o que fica de fora da grade de duas colunas. */}
      <ExpensesPanel
        transactions={transactions}
        categories={categories}
        monthYear={monthYear}
        costOfLiving={costOfLiving}
        isMonthInProgress={isMonthInProgress}
      />
    </div>
  );
}
