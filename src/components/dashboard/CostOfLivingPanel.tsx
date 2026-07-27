import { useMemo } from 'react';
import { Info } from 'lucide-react';
import {
  formatBRL,
  formatSignedBRL,
  countsInTotals,
  getExcludedFromTotalsIds,
  isIncomeAmount,
  accountingDate,
} from '../../lib/utils';
import type { Transaction, Category } from '../../types';
import { resolveTrend } from './yoyShared';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  isMonthInProgress: boolean;
}

/**
 * Custo de vida — despesa média MENSAL (trajetória).
 *
 * Card SEPARADO do "Desvio YoY" de propósito: a base de comparação é outra.
 * Lá são dois recortes YTD idênticos (Jan–Jul vs Jan–Jul); aqui é a média
 * mensal do ano anterior INTEIRO contra a média dos meses COMPLETOS do ano
 * atual (o mês em andamento fica de fora para não diluir a média com um mês
 * parcial). Misturar as duas metodologias sob um título só era a origem da
 * confusão — por isso o subtítulo declara a base de cada ano.
 *
 * NOTA: por ora inclui TODAS as despesas; excluir supérfluos (viagens,
 * presentes) fica para uma evolução futura ("custo de vida real").
 */
export function CostOfLivingPanel({ transactions, categories, monthYear, isMonthInProgress }: Props) {
  const data = useMemo(() => {
    const excludedIds = getExcludedFromTotalsIds(categories);
    const [y, m] = monthYear.split('-').map(Number);
    const prevYear = y - 1;

    // Divide pelo nº de meses COM despesa de cada ano — justo quando o
    // histórico começou no meio do ano.
    const effectiveCurrMax = isMonthInProgress ? m - 1 : m;
    let prevSum = 0;
    let currSum = 0;
    const prevMonths = new Set<number>();
    const currMonths = new Set<number>();

    for (const t of transactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      if (isIncomeAmount(t)) continue; // só despesas (reembolso reduz o gasto)
      const ad = accountingDate(t);
      const ty = ad.getFullYear();
      const tm = ad.getMonth() + 1;
      const expAmt = -t.amount; // despesa como positivo; reembolso (positivo) reduz
      if (ty === prevYear) {
        prevSum += expAmt;
        prevMonths.add(tm);
      } else if (ty === y && tm <= effectiveCurrMax) {
        currSum += expAmt;
        currMonths.add(tm);
      }
    }

    const prevN = prevMonths.size;
    const currN = currMonths.size;
    const currAvg = currN > 0 ? currSum / currN : 0;
    const prevAvg = prevN > 0 ? prevSum / prevN : 0;

    return {
      year: y,
      prevYear,
      currAvg,
      prevAvg,
      currSum,
      prevSum,
      currMonths: currN,
      prevMonths: prevN,
      varianceAbs: currAvg - prevAvg,
      pct: prevAvg === 0 ? null : ((currAvg - prevAvg) / prevAvg) * 100,
      hasData: prevN > 0 && currN > 0,
    };
  }, [transactions, categories, monthYear, isMonthInProgress]);

  // Subir o custo de vida é RUIM → higherIsBetter = false.
  const trend = resolveTrend(data.pct, false, { hasPrev: data.hasData });
  const maxAvg = Math.max(data.currAvg, data.prevAvg, 1);
  // A barra do ano atual carrega a mesma semântica do indicador: subiu = coral.
  const currBarTone = !data.hasData
    ? 'bg-text-secondary/40'
    : data.varianceAbs > 0
      ? 'bg-negative'
      : 'bg-positive';

  const rows = [
    { year: data.year, avg: data.currAvg, sum: data.currSum, months: data.currMonths, strong: true },
    { year: data.prevYear, avg: data.prevAvg, sum: data.prevSum, months: data.prevMonths, strong: false },
  ];

  function monthsLabel(n: number, isCurrent: boolean): string {
    if (n === 0) return 'sem dados';
    const unit = n === 1 ? 'mês' : 'meses';
    return isCurrent ? `média de ${n} ${unit} completos` : `média de ${n} ${unit}`;
  }

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-title font-semibold text-text-primary flex items-center gap-1.5">
            Custo de vida · média mensal
            <span
              className="text-ink-3 flex-shrink-0 cursor-help"
              title="Média por mês COM despesa de cada ano. O mês em andamento fica de fora para não diluir a média com um mês parcial. Inclui todas as despesas."
              aria-label="Média por mês com despesa de cada ano. O mês em andamento fica de fora. Inclui todas as despesas."
            >
              <Info size={13} />
            </span>
          </p>
          <p className="text-caption text-ink-3 mt-0.5">
            {data.year}: {monthsLabel(data.currMonths, true)} · {data.prevYear}:{' '}
            {monthsLabel(data.prevMonths, false)}
          </p>
        </div>

        {data.hasData ? (
          <div className={`flex items-center gap-2 tnum flex-shrink-0 ${trend.color}`}>
            <span className="flex items-center gap-1 text-body font-semibold">
              {trend.hasValue && <trend.Icon size={13} />}
              {trend.text}
            </span>
            <span className="text-caption font-medium opacity-80 border-l border-current/20 pl-2">
              {formatSignedBRL(data.varianceAbs)}/mês
            </span>
          </div>
        ) : (
          <span className="text-caption text-ink-3 flex-shrink-0">sem dados suficientes</span>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.year}
            title={
              row.months > 0
                ? `${formatBRL(row.sum)} ÷ ${row.months} ${row.months === 1 ? 'mês' : 'meses'}`
                : undefined
            }
          >
            <div className="flex items-baseline justify-between gap-2 tnum">
              <span className={`text-caption ${row.strong ? 'text-text-primary' : 'text-ink-3'}`}>
                {row.year}
              </span>
              <span
                className={`text-body font-semibold ${
                  row.strong ? 'text-text-primary' : 'text-text-secondary'
                }`}
              >
                {row.months > 0 ? `${formatBRL(row.avg)}/mês` : '—'}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-elevated overflow-hidden">
              <div
                className={`h-full rounded-full ${row.strong ? currBarTone : 'bg-text-secondary/40'}`}
                style={{ width: `${(row.avg / maxAvg) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
