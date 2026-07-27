import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts';
import { MONEY, AXIS_STYLE, GRID_STYLE, TOOLTIP_STYLE, FONT } from '../../lib/chartTheme';
import { formatBRL, formatCompactBRL } from '../../lib/utils';
import type { CostOfLivingData, CostOfLivingPoint } from '../../lib/costOfLiving';

/**
 * Gráfico da trajetória do custo de vida (só o plot — o número-herói vive no
 * ExpensesPanel): 24 meses de barras mudas com a despesa de cada mês e a linha
 * da média móvel de 12M por cima. A linha responde "está subindo, e em que
 * ritmo?"; as barras mostram o que a média esconde (picos pontuais).
 * Cálculo em src/lib/costOfLiving.ts.
 */
export function CostOfLivingChart({ data }: { data: CostOfLivingData }) {
  const lastMaPoint = [...data.points].reverse().find((p) => p.ma !== null);

  if (data.points.length === 0) {
    return (
      <p className="text-caption text-ink-3 text-center py-8">
        Sem despesas no histórico para calcular a média.
      </p>
    );
  }

  return (
    // Janelas longas (36M) rolam horizontalmente em vez de espremer as barras:
    // o min-width dá ~34px por mês e o scroll só aparece quando não cabe.
    <div className="w-full overflow-x-auto">
      <div className="h-[220px]" style={{ minWidth: `${data.points.length * 34}px` }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="label" {...AXIS_STYLE} interval={2} />
          <YAxis {...AXIS_STYLE} width={78} tickFormatter={(v) => formatCompactBRL(Number(v))} />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={<CostTooltip />}
          />
          <Bar
            dataKey="expense"
            name="Despesa do mês"
            fill={MONEY.expense}
            fillOpacity={0.22}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
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
          {lastMaPoint && (
            <ReferenceDot
              x={lastMaPoint.label}
              y={lastMaPoint.ma!}
              r={4}
              fill={MONEY.expense}
              stroke="#1b1b1e"
              strokeWidth={2}
              label={{
                value: formatCompactBRL(lastMaPoint.ma!),
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
  );
}

function CostTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CostOfLivingPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className="text-caption text-ink-3 mb-1">{p.label}</p>
      <p className="text-body tnum text-text-primary">Despesa: {formatBRL(p.expense)}</p>
      <p className="text-body tnum text-text-secondary">
        Média 12M: {p.ma !== null ? formatBRL(p.ma) : '—'}
      </p>
    </div>
  );
}
