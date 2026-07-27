import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import {
  formatBRL0,
  getMonthYear,
  countsInTotals,
  getExcludedFromTotalsIds,
  isIncomeAmount,
  isExpenseAmount,
  accountingDate,
  getMonthYearOffset,
} from '../../lib/utils';
import type { Transaction, Category } from '../../types';
import type { CostOfLivingData } from '../../lib/costOfLiving';

const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

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
  costOfLiving: CostOfLivingData;
  budget: BudgetSummary;
}

/**
 * Linha de sinais vitais: o dashboard responde "como estou?" em quatro números
 * antes de qualquer tabela. Cada tile é rótulo → número-herói → delta com seta
 * E sinal (nunca só cor). Ver docs/MELHORIAS-VISUAIS.md §3.2/§5.
 */
export function VitalSigns({ transactions, categories, monthYear, monthBalance, costOfLiving, budget }: Props) {
  const data = useMemo(() => {
    const excludedIds = getExcludedFromTotalsIds(categories);
    const [y, m] = monthYear.split('-').map(Number);
    const prevYear = y - 1;
    const prevMonthKey = getMonthYearOffset(monthYear, -1);

    let prevMonthBalance = 0;
    let prevMonthTxCount = 0;
    let currInc = 0;
    let currExp = 0;
    let prevInc = 0;
    let prevExp = 0;

    for (const t of transactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      const ad = accountingDate(t);
      const key = getMonthYear(ad);

      if (key === prevMonthKey) {
        prevMonthBalance += t.amount;
        prevMonthTxCount++;
      }

      // Taxa de poupança YTD: Jan..m do ano do seletor vs mesmo período anterior.
      const ty = ad.getFullYear();
      const tm = ad.getMonth() + 1;
      if (tm > m) continue;
      const income = isIncomeAmount(t);
      const inc = income ? t.amount : 0;
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
      prevMonthBalance,
      prevMonthTxCount,
      prevMonthAbbr: MONTH_ABBR[Number(prevMonthKey.split('-')[1]) - 1],
      currRate,
      savingsDeltaPp: currRate !== null && prevRate !== null ? (currRate - prevRate) * 100 : null,
      prevYear,
    };
  }, [transactions, categories, monthYear]);

  const col = costOfLiving;
  const colDeltaText =
    col.deltaPct !== null && col.base !== null
      ? `${col.deltaPct > 0 ? '+' : ''}${col.deltaPct.toFixed(1).replace('.', ',')}% ${
          col.base.kind === '12m' ? 'em 12 meses' : `desde ${col.base.label}`
        }`
      : col.endPartialMonths !== null
        ? `média de ${col.endPartialMonths} ${col.endPartialMonths === 1 ? 'mês' : 'meses'}`
        : 'histórico curto';

  const budgetPct = budget.limit > 0 ? Math.round((budget.actual / budget.limit) * 100) : null;
  const resultDelta = data.prevMonthTxCount > 0 ? monthBalance - data.prevMonthBalance : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile
        label="Resultado do mês"
        value={`${monthBalance > 0 ? '+' : ''}${formatBRL0(monthBalance)}`}
        valueTone={monthBalance >= 0 ? 'text-positive' : 'text-negative'}
        delta={
          resultDelta !== null
            ? {
                Icon: resultDelta > 0 ? TrendingUp : resultDelta < 0 ? TrendingDown : Minus,
                tone: resultDelta >= 0 ? 'text-positive' : 'text-negative',
                text: `${resultDelta > 0 ? '+' : ''}${formatBRL0(resultDelta)}`,
                context: `vs ${data.prevMonthAbbr}`,
              }
            : undefined
        }
      />
      <Tile
        label="Taxa de poupança · ano"
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
        label="Custo de vida · 12 meses"
        value={col.endMA !== null ? formatBRL0(col.endMA) : '—'}
        valueSuffix={col.endMA !== null ? '/mês' : undefined}
        delta={
          col.endMA !== null
            ? {
                Icon:
                  col.deltaPct === null ? Minus : col.deltaPct > 0 ? TrendingUp : TrendingDown,
                // Custo de vida subindo é RUIM.
                tone:
                  col.deltaPct === null
                    ? 'text-ink-3'
                    : col.deltaPct > 0
                      ? 'text-negative'
                      : 'text-positive',
                text: colDeltaText,
                context: '',
              }
            : undefined
        }
      />
      <Tile
        label="Metas do mês"
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
  value,
  valueSuffix,
  valueTone = 'text-text-primary',
  delta,
}: {
  label: string;
  value: string;
  valueSuffix?: string;
  valueTone?: string;
  delta?: TileDelta;
}) {
  return (
    <div className="bg-bg-card border border-border rounded-card px-4 py-3.5 flex flex-col gap-1.5 min-w-0">
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
