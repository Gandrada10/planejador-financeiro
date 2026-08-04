import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts';
import { formatBRL, formatBRL0, formatCompactBRL } from '../../../lib/utils';
import { MONEY, AXIS_STYLE, GRID_STYLE, TOOLTIP_STYLE } from '../../../lib/chartTheme';
import type { AnnualStats } from '../../../lib/annualStats';

interface Props {
  stats: AnnualStats;
}

/**
 * Receitas, despesas e resultado mês a mês na janela de 12 meses — as barras
 * respondem "quanto entrou e saiu", a linha responde "sobrou ou faltou", que é
 * a leitura que ninguém consegue fazer de cabeça olhando só as barras.
 *
 * O ano corrente entra como uma FAIXA discreta atrás das barras, não como
 * segunda série: a série é uma só (12 meses), e o ano é uma marcação de onde o
 * ciclo começou. Duas séries concorrentes no mesmo gráfico é o que torna esse
 * tipo de tela ilegível.
 */
export function AnnualFlowChart({ stats }: Props) {
  const { rows, period, m12 } = stats;
  const avgResult = m12.result / 12;

  const currentYearRows = rows.filter((r) => r.isCurrentYear);
  const yearBand =
    currentYearRows.length > 0 && currentYearRows.length < rows.length
      ? { from: currentYearRows[0].label, to: currentYearRows[currentYearRows.length - 1].label }
      : null;

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Entradas, saídas e resultado</h3>
          <p className="text-caption text-ink-3 mt-0.5">
            {period.label} · 12 meses fechados · a linha é o resultado de cada mês
          </p>
        </div>
        <div className="flex items-center gap-3 text-caption text-text-secondary flex-wrap">
          <Key color={MONEY.income} label="Receita" />
          <Key color={MONEY.expense} label="Despesa" />
          <Key color={MONEY.balance} label="Resultado" line />
        </div>
      </div>

      {/* min-w garante que 12 grupos de barras não virem tiras no celular:
          abaixo disso o gráfico rola na horizontal em vez de comprimir. */}
      <div className="scroll-x">
        <div className="min-w-[560px] h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="label" {...AXIS_STYLE} interval={0} />
              <YAxis {...AXIS_STYLE} tickFormatter={formatCompactBRL} width={62} />

              {yearBand && (
                <ReferenceArea
                  x1={yearBand.from}
                  x2={yearBand.to}
                  fill="#f5f4f2"
                  fillOpacity={0.03}
                  label={{ value: String(period.year), position: 'insideTopRight', fill: '#6e6d69', fontSize: 11 }}
                />
              )}

              <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'rgba(245,244,242,0.04)' }} content={<FlowTooltip />} />

              <Bar dataKey="income" fill={MONEY.income} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              <Bar dataKey="expense" fill={MONEY.expense} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />

              {/* Zero sólido: com resultado negativo, a leitura é o cruzamento. */}
              <ReferenceLine y={0} stroke="#3a3a3f" strokeWidth={1} />
              <ReferenceLine
                y={avgResult}
                stroke={MONEY.balance}
                strokeDasharray="4 4"
                strokeOpacity={0.45}
              />

              {/* Casing escuro por baixo da linha: onde ela cruza o topo das
                  barras, o contorno impede que se confunda com a borda delas. */}
              <Line
                dataKey="result"
                stroke="#1b1b1e"
                strokeWidth={5}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
              <Line
                dataKey="result"
                stroke={MONEY.balance}
                strokeWidth={2}
                dot={{ r: 2.5, fill: MONEY.balance, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Os totais da janela, no mesmo card que os plotou: a soma das barras
          nunca fica a cargo de quem olha. */}
      <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
        <Total label="Receitas · 12M" value={formatBRL0(m12.income)} tone="text-positive" />
        <Total label="Despesas · 12M" value={formatBRL0(m12.expense)} tone="text-negative" />
        <Total
          label="Resultado · 12M"
          value={`${m12.result > 0 ? '+' : ''}${formatBRL0(m12.result)}`}
          tone={m12.result >= 0 ? 'text-positive' : 'text-negative'}
          foot={`média ${formatBRL0(avgResult)}/mês`}
        />
      </div>

      {/* Melhor e pior mês ficam AQUI, junto das barras que os desenham, e não
          entre os indicadores: é leitura de AMPLITUDE — dois anos de mesmo
          resultado total, um estável e um aos solavancos, pedem planejamento
          diferente, e essa diferença é a forma do gráfico. */}
      {stats.best && stats.worst && (
        <p className="text-caption text-ink-3">
          Melhor mês:{' '}
          <span className="text-text-secondary">
            {stats.best.label} (<span className="tnum">{stats.best.result > 0 ? '+' : ''}{formatBRL0(stats.best.result)}</span>)
          </span>{' '}
          · Pior mês:{' '}
          <span className="text-text-secondary">
            {stats.worst.label} (<span className="tnum">{stats.worst.result > 0 ? '+' : ''}{formatBRL0(stats.worst.result)}</span>)
          </span>{' '}
          · <span className="tnum">{stats.positiveMonths}</span> de{' '}
          <span className="tnum">{m12.monthsWithData}</span> meses no azul
        </p>
      )}
    </div>
  );
}

function Key({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={line ? 'w-3.5 h-[2px] rounded-full' : 'w-2.5 h-2.5 rounded-[3px]'}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function Total({
  label,
  value,
  tone,
  foot,
}: {
  label: string;
  value: string;
  tone: string;
  foot?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-caption font-semibold uppercase tracking-wider text-ink-3 leading-tight">
        {label}
      </p>
      <p className={`text-body font-bold tnum truncate ${tone}`}>{value}</p>
      {foot && <p className="text-caption text-ink-3 tnum">{foot}</p>}
    </div>
  );
}

interface TooltipPayload {
  payload: { label: string; income: number; expense: number; result: number; saldo: number };
}

function FlowTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE.contentStyle}>
      <p style={TOOLTIP_STYLE.labelStyle}>{d.label}</p>
      <Row label="Receitas" value={formatBRL(d.income)} color={MONEY.income} />
      <Row label="Despesas" value={formatBRL(d.expense)} color={MONEY.expense} />
      <Row
        label="Resultado"
        value={`${d.result > 0 ? '+' : ''}${formatBRL(d.result)}`}
        color={MONEY.balance}
      />
      <Row label="Saldo acumulado" value={formatBRL(d.saldo)} color="#6e6d69" />
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <p style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ color }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </p>
  );
}
