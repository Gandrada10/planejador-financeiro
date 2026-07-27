import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import {
  formatBRL0,
  countsInTotals,
  getExcludedFromTotalsIds,
  isIncomeAmount,
  isExpenseAmount,
  accountingDate,
} from '../../lib/utils';
import type { Transaction, Category } from '../../types';
import type { CostOfLivingData } from '../../lib/costOfLiving';

interface BudgetSummary {
  limit: number;
  actual: number;
  overCount: number;
  count: number;
}

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  /** Resultado do mês selecionado (já computado pelo DashboardPage). */
  monthBalance: number;
  /** Resultado médio dos últimos 12 meses (o mesmo da tabela de caixa). */
  avg12mResult: number;
  /** Despesas do mês selecionado (negativo, como vem do DashboardPage). */
  monthExpenses: number;
  isMonthInProgress: boolean;
  costOfLiving: CostOfLivingData;
  budget: BudgetSummary;
}

/**
 * Linha de sinais vitais: o dashboard responde "como estou?" em quatro números
 * antes de qualquer tabela. Cada tile é rótulo → número-herói → delta com seta
 * E sinal (nunca só cor). Comparações usam a média 12M como base — "vs mês
 * anterior" era ruidoso demais (13º, fatura anual e reembolso distorcem).
 * Ver docs/MELHORIAS-VISUAIS.md §3.2/§5.
 */
export function VitalSigns({
  transactions,
  categories,
  monthYear,
  monthBalance,
  avg12mResult,
  monthExpenses,
  isMonthInProgress,
  costOfLiving,
  budget,
}: Props) {
  const data = useMemo(() => {
    const excludedIds = getExcludedFromTotalsIds(categories);
    const [y, m] = monthYear.split('-').map(Number);
    const prevYear = y - 1;

    let currInc = 0;
    let currExp = 0;
    let prevInc = 0;
    let prevExp = 0;

    // Taxa de poupança YTD: Jan..m do ano do seletor vs mesmo período anterior.
    for (const t of transactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      const ad = accountingDate(t);
      const ty = ad.getFullYear();
      const tm = ad.getMonth() + 1;
      if (tm > m) continue;
      const inc = isIncomeAmount(t) ? t.amount : 0;
      const exp = isExpenseAmount(t) ? -t.amount : 0;
      if (ty === y) {
        currInc += inc;
        currExp += exp;
      } else if (ty === prevYear) {
        prevInc += inc;
        prevExp += exp;
      }
    }

    const currRate = currInc > 0 ? (currInc - currExp) / currInc : null;
    const prevRate = prevInc > 0 ? (prevInc - prevExp) / prevInc : null;

    return {
      currRate,
      savingsDeltaPp: currRate !== null && prevRate !== null ? (currRate - prevRate) * 100 : null,
      prevYear,
    };
  }, [transactions, categories, monthYear]);

  const col = costOfLiving;
  const spentMonth = Math.abs(monthExpenses);

  // Despesa do mês vs média móvel 12M. Num mês em andamento a comparação seria
  // enganosa (mês pela metade sempre parece "abaixo do normal") — vira aviso.
  const spentDelta =
    !isMonthInProgress && col.endMA !== null && col.endMA > 0
      ? ((spentMonth - col.endMA) / col.endMA) * 100
      : null;

  const resultDelta = monthBalance - avg12mResult;

  const budgetPct = budget.limit > 0 ? Math.round((budget.actual / budget.limit) * 100) : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile
        label="Resultado do mês"
        hint="Receitas menos despesas do mês selecionado. O delta compara com o seu resultado médio dos últimos 12 meses."
        value={`${monthBalance > 0 ? '+' : ''}${formatBRL0(monthBalance)}`}
        valueTone={monthBalance >= 0 ? 'text-positive' : 'text-negative'}
        delta={{
          Icon: resultDelta > 0 ? TrendingUp : resultDelta < 0 ? TrendingDown : Minus,
          tone: Math.abs(resultDelta) < 1 ? 'text-ink-3' : resultDelta > 0 ? 'text-positive' : 'text-negative',
          text: `${resultDelta > 0 ? '+' : ''}${formatBRL0(resultDelta)}`,
          context: 'vs média 12M',
        }}
      />
      <Tile
        label="Taxa de poupança · ano"
        hint="Resultado ÷ receitas, acumulados de janeiro até o mês selecionado. Negativa: no ano, você gastou mais do que ganhou (ex.: −24% = saíram R$ 124 para cada R$ 100 que entraram)."
        value={data.currRate !== null ? `${(data.currRate * 100).toFixed(1).replace('.', ',')}%` : '—'}
        delta={
          data.savingsDeltaPp !== null
            ? Math.abs(data.savingsDeltaPp) < 0.05
              ? { Icon: Minus, tone: 'text-ink-3', text: '0,0 p.p.', context: `vs ${data.prevYear}` }
              : {
                  Icon: data.savingsDeltaPp > 0 ? TrendingUp : TrendingDown,
                  tone: data.savingsDeltaPp > 0 ? 'text-positive' : 'text-negative',
                  text: `${data.savingsDeltaPp > 0 ? '+' : '−'}${Math.abs(data.savingsDeltaPp)
                    .toFixed(1)
                    .replace('.', ',')} p.p.`,
                  context: `vs ${data.prevYear}`,
                }
            : undefined
        }
      />
      <Tile
        label="Despesas do mês"
        hint="Total de despesas do mês selecionado. O delta compara com a sua média móvel de 12 meses (custo de vida)."
        value={formatBRL0(spentMonth)}
        delta={
          isMonthInProgress
            ? { Icon: Minus, tone: 'text-ink-3', text: 'mês em andamento', context: '' }
            : spentDelta !== null
              ? {
                  Icon: spentDelta > 0 ? TrendingUp : spentDelta < 0 ? TrendingDown : Minus,
                  // Gastar acima do normal é RUIM.
                  tone:
                    Math.abs(spentDelta) < 0.05
                      ? 'text-ink-3'
                      : spentDelta > 0
                        ? 'text-negative'
                        : 'text-positive',
                  text: `${spentDelta > 0 ? '+' : ''}${spentDelta.toFixed(1).replace('.', ',')}%`,
                  context: 'vs média 12M',
                }
              : undefined
        }
      />
      <Tile
        label="Metas do mês"
        hint="Quanto do total das metas de despesa já foi consumido no mês."
        value={budgetPct !== null ? `${budgetPct}%` : '—'}
        delta={
          budgetPct !== null
            ? budget.overCount > 0
              ? {
                  Icon: AlertTriangle,
                  tone: 'text-status-warn',
                  text: `${budget.overCount} de ${budget.count}`,
                  context: budget.overCount === 1 ? 'estourada' : 'estouradas',
                }
              : {
                  Icon: TrendingUp,
                  tone: 'text-positive',
                  text: `${budget.count} ${budget.count === 1 ? 'meta' : 'metas'}`,
                  context: 'no ritmo',
                }
            : { Icon: Minus, tone: 'text-ink-3', text: 'sem metas', context: 'neste mês' }
        }
      />
    </div>
  );
}

interface TileDelta {
  Icon: typeof TrendingUp;
  tone: string;
  text: string;
  context: string;
}

function Tile({
  label,
  hint,
  value,
  valueSuffix,
  valueTone = 'text-text-primary',
  delta,
}: {
  label: string;
  hint?: string;
  value: string;
  valueSuffix?: string;
  valueTone?: string;
  delta?: TileDelta;
}) {
  return (
    <div
      className="bg-bg-card border border-border rounded-card px-4 py-3.5 flex flex-col gap-1.5 min-w-0"
      title={hint}
    >
      <span className="text-caption font-semibold uppercase tracking-wider text-ink-3 truncate">{label}</span>
      <span className={`text-kpi font-bold tracking-tight tnum leading-none truncate ${valueTone}`}>
        {value}
        {valueSuffix && <span className="text-body font-medium text-text-secondary tracking-normal">{valueSuffix}</span>}
      </span>
      {delta ? (
        <span className={`flex items-baseline gap-1.5 text-caption font-semibold tnum ${delta.tone} min-w-0`}>
          <delta.Icon size={12} className="flex-shrink-0 self-center" />
          <span className="truncate">{delta.text}</span>
          {delta.context && <span className="text-ink-3 font-normal flex-shrink-0">{delta.context}</span>}
        </span>
      ) : (
        <span className="text-caption text-ink-3">—</span>
      )}
    </div>
  );
}
