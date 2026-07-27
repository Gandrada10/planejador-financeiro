import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { MONEY, AXIS_STYLE, GRID_STYLE, TOOLTIP_STYLE, FONT } from '../../lib/chartTheme';
import {
  formatBRL,
  formatBRL0,
  formatSignedBRL,
  formatCompactBRL,
  countsInTotals,
  getExcludedFromTotalsIds,
  isExpenseAmount,
  accountingDate,
} from '../../lib/utils';
import type { Transaction, Category } from '../../types';

const MONTH_ABBR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
}

interface MonthRow {
  month: string;
  monthIdx: number;
  curr: number | null;
  prev: number | null;
}

/** Props do tick customizado do eixo X (o mês selecionado ganha destaque). */
interface MonthTickProps {
  x?: string | number;
  y?: string | number;
  payload?: { value?: string | number; index?: number };
}

/**
 * Evolução de despesas mês a mês: ano do mês selecionado vs ano anterior.
 *
 * A série do ano atual PARA no mês selecionado (meses futuros não têm barra),
 * enquanto o ano anterior mostra os 12 — o que ainda vem pela frente fica
 * visível como referência.
 */
export function MonthlyExpensesChart({ transactions, categories, monthYear }: Props) {
  const { rows, year, prevYear, currAvg, hasPrev, hasCurr } = useMemo(() => {
    const excludedIds = getExcludedFromTotalsIds(categories);
    const [y, m] = monthYear.split('-').map(Number);
    const prev = y - 1;

    const currByMonth = new Array<number>(12).fill(0);
    const prevByMonth = new Array<number>(12).fill(0);

    for (const t of transactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      if (!isExpenseAmount(t)) continue;
      const ad = accountingDate(t);
      const ty = ad.getFullYear();
      const idx = ad.getMonth();
      // Despesa como positivo; reembolso (positivo) reduz o gasto do mês.
      const amt = -t.amount;
      if (ty === y) currByMonth[idx] += amt;
      else if (ty === prev) prevByMonth[idx] += amt;
    }

    const data: MonthRow[] = MONTH_ABBR.map((label, idx) => ({
      month: label,
      monthIdx: idx,
      curr: idx < m ? currByMonth[idx] : null,
      prev: prevByMonth[idx] === 0 ? null : prevByMonth[idx],
    }));

    // Média mensal do ano atual sobre os meses COM despesa — mesma convenção
    // do card de Custo de Vida.
    const currMonthsWithData = currByMonth.slice(0, m).filter((v) => v !== 0);
    const avg =
      currMonthsWithData.length > 0
        ? currMonthsWithData.reduce((s, v) => s + v, 0) / currMonthsWithData.length
        : 0;

    return {
      rows: data,
      year: y,
      prevYear: prev,
      currAvg: avg,
      hasPrev: prevByMonth.some((v) => v !== 0),
      hasCurr: currMonthsWithData.length > 0,
    };
  }, [transactions, categories, monthYear]);

  const selectedIdx = Number(monthYear.split('-')[1]) - 1;

  if (!hasCurr && !hasPrev) {
    return (
      <p className="text-caption text-ink-3 text-center py-8">
        Sem despesas em {year} ou {prevYear}.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {currAvg > 0 && (
        <p className="text-caption text-ink-3">
          média de {year}: {formatBRL0(currAvg)}/mês (linha tracejada)
        </p>
      )}

      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="month"
              {...AXIS_STYLE}
              tick={({ x, y, payload }: MonthTickProps) => {
                const isSelected = payload?.index === selectedIdx;
                return (
                  <text
                    x={Number(x)}
                    y={Number(y) + 12}
                    textAnchor="middle"
                    fontFamily={FONT}
                    fontSize={11}
                    fill={isSelected ? '#5ee0a0' : '#6e6d69'}
                    fontWeight={isSelected ? 600 : 400}
                  >
                    {payload?.value}
                  </text>
                );
              }}
            />
            <YAxis {...AXIS_STYLE} width={78} tickFormatter={(v) => formatCompactBRL(Number(v))} />
            <Tooltip
              {...TOOLTIP_STYLE}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={<ExpensesTooltip year={year} prevYear={prevYear} />}
            />
            {hasPrev && (
              <Legend
                verticalAlign="top"
                align="right"
                height={24}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontFamily: FONT, fontSize: 11, color: '#8f8e89' }}
              />
            )}
            {currAvg > 0 && (
              <ReferenceLine
                y={currAvg}
                stroke="#8f8e89"
                strokeDasharray="4 4"
                strokeWidth={1}
                ifOverflow="extendDomain"
              />
            )}
            {hasPrev && (
              <Bar
                dataKey="prev"
                name={String(prevYear)}
                fill={MONEY.expense}
                fillOpacity={0.35}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            )}
            <Bar
              dataKey="curr"
              name={String(year)}
              fill={MONEY.expense}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface TooltipPayloadItem {
  payload: MonthRow;
}

function ExpensesTooltip({
  active,
  payload,
  year,
  prevYear,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  year: number;
  prevYear: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const curr = row.curr;
  const prev = row.prev;
  const delta = curr !== null && prev !== null ? curr - prev : null;
  const pct = delta !== null && prev ? (delta / prev) * 100 : null;

  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className="text-caption text-ink-3 mb-1">{row.month}</p>
      <p className="text-body tnum text-text-primary">
        {year}: {curr !== null ? formatBRL(curr) : '—'}
      </p>
      <p className="text-body tnum text-text-secondary">
        {prevYear}: {prev !== null ? formatBRL(prev) : '—'}
      </p>
      {delta !== null && (
        <p
          className={`text-caption tnum mt-1 pt-1 border-t border-border ${
            delta > 0 ? 'text-negative' : 'text-positive'
          }`}
        >
          {formatSignedBRL(delta)}
          {pct !== null && <> · {pct > 0 ? '+' : ''}{pct.toFixed(1).replace('.', ',')}%</>}
        </p>
      )}
    </div>
  );
}
