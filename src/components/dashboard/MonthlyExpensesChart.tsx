import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceDot,
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
  /** Mês selecionado ainda em andamento: fica FORA da média (diluiria para baixo). */
  isMonthInProgress: boolean;
  /**
   * Média móvel de 12M avaliada em cada mês do ano selecionado (12 posições,
   * null onde a janela não fecha ou o mês ainda não chegou). Vira a linha de
   * tendência sobre as barras.
   */
  ma: Array<number | null>;
}

interface MonthRow {
  month: string;
  monthIdx: number;
  curr: number | null;
  prev: number | null;
  ma: number | null;
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
export function MonthlyExpensesChart({ transactions, categories, monthYear, isMonthInProgress, ma }: Props) {
  const { rows, year, prevYear, currAvg, currAvgMonths, hasPrev, hasCurr } = useMemo(() => {
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
      ma: ma[idx] ?? null,
    }));

    // Média mensal do ano atual sobre os meses COMPLETOS com despesa — o mês
    // em andamento fica de fora (com ele dentro, um julho pela metade puxava a
    // média de R$ 45,5 mil para R$ 42,8 mil). Mesma convenção do custo de vida.
    const completeMax = isMonthInProgress ? m - 1 : m;
    const completeMonths = currByMonth.slice(0, completeMax).filter((v) => v !== 0);
    const avg =
      completeMonths.length > 0
        ? completeMonths.reduce((s, v) => s + v, 0) / completeMonths.length
        : 0;

    return {
      rows: data,
      year: y,
      prevYear: prev,
      currAvg: avg,
      currAvgMonths: completeMonths.length,
      // O mês parcial ainda conta como "tem dados" — só não entra na média.
      hasPrev: prevByMonth.some((v) => v !== 0),
      hasCurr: currByMonth.slice(0, m).some((v) => v !== 0),
    };
  }, [transactions, categories, monthYear, isMonthInProgress, ma]);

  const selectedIdx = Number(monthYear.split('-')[1]) - 1;
  const lastMa = [...rows].reverse().find((r) => r.ma !== null);

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
          média de {year}: {formatBRL0(currAvg)}/mês em {currAvgMonths}{' '}
          {currAvgMonths === 1 ? 'mês completo' : 'meses completos'} (linha tracejada)
        </p>
      )}

      {/* 24 barras (2 séries × 12 meses) em 393px viram um pente. Um piso de
          largura por mês faz a faixa rolar na horizontal no celular em vez de
          espremer — no desktop o min-width nunca é atingido. */}
      <div className="scroll-x">
        <div className="h-[200px] sm:h-[220px] min-w-[560px] sm:min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
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
            {(hasPrev || rows.some((r) => r.ma !== null)) && (
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
            {/* Casing na cor do card por baixo da linha: sem ele, a linha coral
                some onde cruza as barras coral sólidas do ano atual. */}
            <Line
              dataKey="ma"
              stroke="#1b1b1e"
              strokeWidth={5}
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />
            <Line
              dataKey="ma"
              name="Média móvel 12M"
              stroke={MONEY.expense}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {/* Rótulo direto na ponta da linha: com o herói do card sendo a
                despesa do mês, é aqui que o custo de vida se identifica. */}
            {lastMa && (
              <ReferenceDot
                x={lastMa.month}
                y={lastMa.ma!}
                r={4}
                fill={MONEY.expense}
                stroke="#1b1b1e"
                strokeWidth={2}
                label={{
                  value: formatCompactBRL(lastMa.ma!),
                  position: 'top',
                  offset: 8,
                  fill: '#f5f4f2',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: FONT,
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        </div>
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
      {row.ma !== null && (
        <p className="text-body tnum text-text-secondary">Média 12M: {formatBRL(row.ma)}</p>
      )}
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
