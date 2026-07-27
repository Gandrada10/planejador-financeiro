import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import {
  formatBRL0,
  getMonthYear,
  getMonthYearOffset,
  countsInTotals,
  getExcludedFromTotalsIds,
  isIncomeAmount,
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
  /** Rótulo do mês selecionado, ex.: "junho de 2026". */
  monthLabel: string;
  /** Receitas do mês (positivo) e despesas do mês (negativo), como vêm do DashboardPage. */
  monthIncome: number;
  monthExpenses: number;
  monthBalance: number;
  /** Resultado médio dos últimos 12 meses (o mesmo da tabela de caixa). */
  avg12mResult: number;
  isMonthInProgress: boolean;
  costOfLiving: CostOfLivingData;
  budget: BudgetSummary;
}

/**
 * Todos os indicadores do dashboard vivem aqui, em duas fileiras de três — não
 * há segundo lugar com número grande na tela (o card de Despesas ficou só com o
 * gráfico). A divisão é por natureza da métrica:
 *
 *   fileira 1 — o MÊS selecionado: receitas, despesas, resultado. A conta
 *   inteira à vista (receitas − despesas = resultado), auto-verificável.
 *   fileira 2 — TENDÊNCIA e plano: taxa de poupança do ano, custo de vida
 *   (média móvel 12M) e metas.
 *
 * Três por fileira também é o que quebra bem: 3+3 no desktop, empilhado no
 * celular — cinco tiles numa fileira só deixariam órfão em tela média.
 * Cada tile é rótulo → número-herói → delta com seta E sinal (nunca só cor).
 */
export function VitalSigns({
  transactions,
  categories,
  monthYear,
  monthLabel,
  monthIncome,
  monthExpenses,
  monthBalance,
  avg12mResult,
  isMonthInProgress,
  costOfLiving,
  budget,
}: Props) {
  const col = costOfLiving;

  const data = useMemo(() => {
    const excludedIds = getExcludedFromTotalsIds(categories);
    const [y, m] = monthYear.split('-').map(Number);
    const prevYear = y - 1;

    let currInc = 0;
    let currExp = 0;
    let prevInc = 0;
    let prevExp = 0;
    const incomeByMonth = new Map<string, number>();

    for (const t of transactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      const ad = accountingDate(t);
      const income = isIncomeAmount(t);

      if (income) {
        const key = getMonthYear(ad);
        incomeByMonth.set(key, (incomeByMonth.get(key) || 0) + t.amount);
      }

      // Taxa de poupança YTD: Jan..m do ano do seletor vs mesmo período anterior.
      const ty = ad.getFullYear();
      const tm = ad.getMonth() + 1;
      if (tm > m) continue;
      const inc = income ? t.amount : 0;
      const exp = income ? 0 : -t.amount;
      if (ty === y) {
        currInc += inc;
        currExp += exp;
      } else if (ty === prevYear) {
        prevInc += inc;
        prevExp += exp;
      }
    }

    // Receita média dos 12 meses encerrados no mesmo mês do custo de vida —
    // para os dois deltas do topo terem a mesma janela de referência.
    let incomeAvg12m: number | null = null;
    if (col.endKey) {
      let sum = 0;
      let months = 0;
      for (let i = 0; i < 12; i++) {
        const v = incomeByMonth.get(getMonthYearOffset(col.endKey, -i));
        if (v !== undefined && v !== 0) {
          sum += v;
          months++;
        }
      }
      if (months > 0) incomeAvg12m = sum / months;
    }

    const currRate = currInc > 0 ? (currInc - currExp) / currInc : null;
    const prevRate = prevInc > 0 ? (prevInc - prevExp) / prevInc : null;

    return {
      incomeAvg12m,
      currRate,
      savingsDeltaPp: currRate !== null && prevRate !== null ? (currRate - prevRate) * 100 : null,
      prevYear,
    };
  }, [transactions, categories, monthYear, col.endKey]);

  const spentMonth = Math.abs(monthExpenses);

  // Num mês em andamento comparar com uma média mensal engana (mês pela metade
  // sempre parece "abaixo do normal") — os deltas do mês viram aviso.
  const pctVs = (value: number, base: number | null): number | null =>
    !isMonthInProgress && base !== null && base > 0 ? ((value - base) / base) * 100 : null;

  const incomeDelta = pctVs(monthIncome, data.incomeAvg12m);
  const spentDelta = pctVs(spentMonth, col.endMA);
  const resultDelta = isMonthInProgress ? null : monthBalance - avg12mResult;

  const inProgress: TileDelta = {
    Icon: Minus,
    tone: 'text-ink-3',
    text: 'mês em andamento',
    context: '',
  };

  /** Delta percentual com semântica: para despesa, subir é ruim. */
  const pctDelta = (pct: number | null, higherIsBetter: boolean, context: string): TileDelta | undefined => {
    if (pct === null) return isMonthInProgress ? inProgress : undefined;
    if (Math.abs(pct) < 0.05) return { Icon: Minus, tone: 'text-ink-3', text: 'no normal', context };
    const good = higherIsBetter ? pct > 0 : pct < 0;
    return {
      Icon: pct > 0 ? TrendingUp : TrendingDown,
      tone: good ? 'text-positive' : 'text-negative',
      text: `${pct > 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%`,
      context,
    };
  };

  const budgetPct = budget.limit > 0 ? Math.round((budget.actual / budget.limit) * 100) : null;
  const monthTitle = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  return (
    <div className="space-y-3">
      <Group label={monthTitle}>
        <Tile
          label="Receitas do mês"
          hint="Total de receitas do mês selecionado. O delta compara com a sua receita média dos últimos 12 meses."
          value={formatBRL0(monthIncome)}
          valueTone="text-positive"
          delta={pctDelta(incomeDelta, true, 'vs média 12M')}
        />
        <Tile
          label="Despesas do mês"
          hint="Total de despesas do mês selecionado. O delta compara com o seu custo de vida (média móvel de 12 meses)."
          value={formatBRL0(spentMonth)}
          valueTone="text-negative"
          delta={pctDelta(spentDelta, false, 'vs custo de vida')}
        />
        <Tile
          label="Resultado do mês"
          hint="Receitas menos despesas do mês. O delta compara com o seu resultado médio dos últimos 12 meses."
          value={`${monthBalance > 0 ? '+' : ''}${formatBRL0(monthBalance)}`}
          valueTone={monthBalance >= 0 ? 'text-positive' : 'text-negative'}
          delta={
            resultDelta === null
              ? inProgress
              : {
                  Icon: resultDelta > 0 ? TrendingUp : resultDelta < 0 ? TrendingDown : Minus,
                  tone:
                    Math.abs(resultDelta) < 1
                      ? 'text-ink-3'
                      : resultDelta > 0
                        ? 'text-positive'
                        : 'text-negative',
                  text: `${resultDelta > 0 ? '+' : ''}${formatBRL0(resultDelta)}`,
                  context: 'vs média 12M',
                }
          }
        />
      </Group>

      <Group label="Tendência e plano">
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
          label="Custo de vida · 12 meses"
          hint={
            col.endMA !== null
              ? `Média das despesas dos 12 meses encerrados em ${col.endLabel} — o mês em andamento fica de fora.${
                  col.deltaAbs !== null && col.base !== null
                    ? ` Aumento de ${formatBRL0(col.deltaAbs)}/mês desde ${col.base.label}, quando era ${formatBRL0(col.base.ma)}/mês.`
                    : ''
                }`
              : 'Média das despesas dos últimos 12 meses.'
          }
          value={col.endMA !== null ? formatBRL0(col.endMA) : '—'}
          valueSuffix={col.endMA !== null ? '/mês' : undefined}
          delta={
            col.deltaPct !== null && col.base !== null
              ? {
                  Icon: col.deltaPct > 0 ? TrendingUp : col.deltaPct < 0 ? TrendingDown : Minus,
                  // Custo de vida subindo é RUIM.
                  tone:
                    Math.abs(col.deltaPct) < 0.05
                      ? 'text-ink-3'
                      : col.deltaPct > 0
                        ? 'text-negative'
                        : 'text-positive',
                  text: `${col.deltaPct > 0 ? '+' : ''}${col.deltaPct.toFixed(1).replace('.', ',')}%`,
                  context: `em ${col.base.spanMonths} meses`,
                }
              : col.endPartialMonths !== null
                ? {
                    Icon: Minus,
                    tone: 'text-ink-3',
                    text: `${col.endPartialMonths} ${col.endPartialMonths === 1 ? 'mês' : 'meses'}`,
                    context: 'de histórico',
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
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-caption font-semibold uppercase tracking-wider text-ink-3 mb-1.5 px-0.5">
        {label}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{children}</div>
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
