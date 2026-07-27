import { Info } from 'lucide-react';
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
import { MONEY, AXIS_STYLE, GRID_STYLE, TOOLTIP_STYLE } from '../../lib/chartTheme';
import { formatBRL, formatBRL0, formatSignedBRL, formatCompactBRL } from '../../lib/utils';
import type { CostOfLivingData, CostOfLivingPoint } from '../../lib/costOfLiving';

interface Props {
  data: CostOfLivingData;
  isMonthInProgress: boolean;
}

/**
 * Custo de vida como trajetória: número-herói (média móvel de 12 meses) + chip
 * de tendência, e o gráfico de 24 meses — barras mudas com a despesa de cada
 * mês, linha da média móvel por cima. A linha responde "está subindo, e em que
 * ritmo?"; as barras mostram o que a média esconde (picos pontuais).
 * Cálculo em src/lib/costOfLiving.ts, compartilhado com o tile de sinais vitais.
 */
export function CostOfLivingPanel({ data, isMonthInProgress }: Props) {
  const rising = data.deltaPct !== null && data.deltaPct > 0;
  const chipTone = rising
    ? 'bg-negative/10 border-negative/35 text-negative'
    : 'bg-positive/10 border-positive/35 text-positive';

  const lastMaPoint = [...data.points].reverse().find((p) => p.ma !== null);

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div>
        <p className="text-title font-semibold text-text-primary flex items-center gap-1.5">
          Custo de vida
          <span
            className="text-ink-3 flex-shrink-0 cursor-help"
            title="Cada ponto da linha é a média das despesas dos 12 meses anteriores àquele mês. Inclui todas as despesas; transferências ficam de fora."
            aria-label="Cada ponto da linha é a média das despesas dos 12 meses anteriores àquele mês."
          >
            <Info size={13} />
          </span>
        </p>
        <p className="text-caption text-ink-3 mt-0.5">
          Média móvel de 12 meses · encerrada em {data.endLabel}
          {isMonthInProgress && ' · o mês em andamento fica de fora'}
        </p>
      </div>

      {!data.hasData ? (
        <p className="text-caption text-ink-3 text-center py-8">Sem despesas no histórico para calcular a média.</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <p className="text-kpi font-bold tracking-tight tnum leading-none text-text-primary">
                {formatBRL0(data.endMA!)}
                <span className="text-body font-medium text-text-secondary tracking-normal">/mês</span>
              </p>
              {data.endPartialMonths !== null && (
                <p className="text-caption text-ink-3 mt-1">
                  média dos {data.endPartialMonths} {data.endPartialMonths === 1 ? 'mês' : 'meses'} com dados —
                  a janela cheia de 12 ainda não existe
                </p>
              )}
            </div>

            {data.deltaAbs !== null && data.base !== null ? (
              <div className="text-right">
                <span
                  className={`inline-flex items-center gap-1.5 text-caption font-semibold tnum px-2.5 py-1 rounded-full border ${chipTone}`}
                >
                  {formatSignedBRL(data.deltaAbs)} · {data.deltaPct! > 0 ? '+' : ''}
                  {data.deltaPct!.toFixed(1).replace('.', ',')}%{' '}
                  {data.base.kind === '12m' ? 'em 12 meses' : `desde ${data.base.label}`}
                </span>
                <p className="text-caption text-ink-3 mt-1.5 tnum">
                  {data.base.kind === '12m' ? 'há 12 meses' : data.base.label}: {formatBRL0(data.base.ma)}/mês
                  {data.worst && (
                    <>
                      {' '}
                      · pior mês: {data.worst.label} ({formatCompactBRL(data.worst.value)})
                    </>
                  )}
                </p>
              </div>
            ) : (
              data.worst && (
                <p className="text-caption text-ink-3 tnum">
                  pior mês: {data.worst.label} ({formatCompactBRL(data.worst.value)})
                </p>
              )
            )}
          </div>

          <div className="h-[190px] w-full">
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
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
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
