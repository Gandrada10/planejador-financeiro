import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, StickyNote, X } from 'lucide-react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { computeCategoryDetail, computeCategoryMonth } from '../../lib/categoryFlow';
import { AXIS_STYLE, TOOLTIP_STYLE } from '../../lib/chartTheme';
import { formatBRL, formatBRL0 } from '../../lib/utils';
import { CategoryMonthPopup } from './CategoryMonthPopup';
import type { Transaction, Category } from '../../types';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  categoryId: string;
  monthYear: string;
  isMonthInProgress: boolean;
  onClose: () => void;
}

/** <10% ganha uma decimal — é a faixa onde "7%" vs "8%" esconde a história. */
const fmtPct = (v: number) => {
  const abs = Math.abs(v);
  return abs >= 10 ? abs.toFixed(0) : abs.toFixed(1).replace('.', ',');
};

/** Para DESPESA, subir é piorar: ▲ acima da base em coral, ▼ abaixo em menta. */
function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-ink-3 tnum">—</span>;
  if (Math.abs(pct) < 0.5) return <span className="text-ink-3 tnum">0%</span>;
  const up = pct > 0;
  return (
    <span className={`tnum ${up ? 'text-negative' : 'text-positive'}`}>
      {up ? '▲' : '▼'} {fmtPct(pct)}%
    </span>
  );
}

/**
 * Análise da categoria clicada no Sankey — o fluxo é o navegador da estrutura,
 * este painel é onde a categoria vira história: quanto foi, contra a média,
 * qual subcategoria puxou e a trilha dos últimos 12 meses.
 */
export function CategoryDetailPanel({
  transactions,
  categories,
  categoryId,
  monthYear,
  isMonthInProgress,
  onClose,
}: Props) {
  const detail = useMemo(
    () => computeCategoryDetail(transactions, categories, categoryId, monthYear, isMonthInProgress),
    [transactions, categories, categoryId, monthYear, isMonthInProgress]
  );
  // Só os lançamentos ANOTADOS do mês: o painel é agregado, não é lista de
  // lançamentos — mas a nota é justamente o que explica um gasto que a
  // descrição não explica, e sem ela é preciso abrir o popup para descobrir.
  const notes = useMemo(
    () =>
      computeCategoryMonth(transactions, categories, categoryId, monthYear).entries.filter(
        (e) => e.note,
      ),
    [transactions, categories, categoryId, monthYear],
  );
  const ref = useRef<HTMLDivElement>(null);
  // Mês da barra clicada na série de 12 meses. null = popup fechado.
  const [drillMonth, setDrillMonth] = useState<string | null>(null);

  // O painel abre NO LUGAR do Sankey, então em telas largas ele já nasce sob os
  // olhos e isto não faz nada (block:'nearest' não mexe na rolagem quando o
  // elemento já está visível). Continua valendo no celular: lá o diagrama é
  // alto, e trocá-lo por um painel mais curto pode deixar a dobra abaixo dele.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [categoryId]);

  const showSubs = detail.subs.some((s) => s.id !== '__direct');
  const GRID = 'grid grid-cols-[1fr_repeat(2,minmax(64px,76px))_58px] gap-2';

  return (
    <div ref={ref} className="bg-bg-card border border-border rounded-card p-4 space-y-3 scroll-mt-16">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-1 h-8 rounded-full flex-shrink-0"
            style={{ backgroundColor: detail.color }}
          />
          <div className="min-w-0">
            <h3 className="text-title font-semibold text-text-primary truncate">{detail.name}</h3>
            <p className="text-caption text-ink-3">
              análise da categoria{isMonthInProgress ? ' · mês em andamento' : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar análise"
          className="tap p-1 -m-1 text-ink-3 hover:text-text-primary transition-colors flex-shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-wider text-ink-3">
            {detail.monthName}
          </p>
          <p className="text-[21px] font-bold tracking-tight tnum text-text-primary truncate">
            {formatBRL0(detail.monthValue)}
          </p>
        </div>
        <div
          className="min-w-0"
          title={`média de ${detail.windowLabel} · ${detail.monthsCount} ${detail.monthsCount === 1 ? 'mês' : 'meses'} com lançamento`}
        >
          <p className="text-caption font-semibold uppercase tracking-wider text-ink-3">Média 12M</p>
          <p className="text-[21px] font-bold tracking-tight tnum text-text-primary truncate">
            {formatBRL0(detail.avg)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-wider text-ink-3">vs média</p>
          <p className="text-[21px] font-bold tracking-tight leading-[1.3] truncate">
            <Delta pct={detail.deltaPct} />
          </p>
        </div>
      </div>

      {detail.prevValue > 0 && (
        <p className="text-caption text-ink-3">
          Mês anterior: <span className="tnum">{formatBRL0(detail.prevValue)}</span> ·{' '}
          <Delta pct={detail.prevDeltaPct} />
        </p>
      )}

      {showSubs && (
        <div className="pt-2 border-t border-border space-y-1.5">
          <div className={`${GRID} text-caption text-ink-3 uppercase tracking-wider`}>
            <span>Subcategoria</span>
            <span className="text-right">{detail.monthName}</span>
            <span className="text-right">Média 12M</span>
            <span className="text-right">Δ</span>
          </div>
          {detail.subs.map((s) => (
            <div key={s.id} className={`${GRID} items-center`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <div
                  className="w-0.5 h-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-body text-text-secondary truncate">{s.name}</span>
              </div>
              <span className="text-body tnum text-text-primary text-right">
                {formatBRL0(s.monthValue)}
              </span>
              <span className="text-body tnum text-text-secondary text-right">
                {formatBRL0(s.avg)}
              </span>
              <span className="text-body text-right">
                <Delta pct={s.deltaPct} />
              </span>
            </div>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <div className="pt-2 border-t border-border space-y-1">
          <p className="text-caption text-ink-3 uppercase tracking-wider">
            Observações · {detail.monthName}
          </p>
          {notes.map((e) => (
            <div key={e.id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">
                {/* `block`: `truncate` é overflow:hidden, que não corta um
                    elemento inline — sem isso a descrição longa vaza. */}
                <span
                  className="block text-body text-text-secondary truncate"
                  title={e.description}
                >
                  {e.description}
                </span>
                <span
                  className={`text-caption flex items-start gap-1 ${
                    e.noteAlert ? 'text-accent-red' : 'text-accent'
                  }`}
                >
                  {e.noteAlert ? (
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                  ) : (
                    <StickyNote size={11} className="flex-shrink-0 mt-0.5" />
                  )}
                  <span className="min-w-0">{e.note}</span>
                </span>
              </span>
              <span className="text-body tnum text-text-primary flex-shrink-0">
                {formatBRL0(e.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-border space-y-1.5">
        <p className="text-caption text-ink-3 uppercase tracking-wider">
          Últimos 12 meses{' '}
          <span className="normal-case tracking-normal">
            · tracejado = média 12M · clique numa barra para ver os lançamentos
          </span>
        </p>
        <div className="h-[130px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={detail.series} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
              <XAxis dataKey="label" {...AXIS_STYLE} interval={0} />
              <YAxis hide />
              <Tooltip
                {...TOOLTIP_STYLE}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                formatter={(v) => [formatBRL(Number(v)), detail.name]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ''}
              />
              {detail.avg > 0 && (
                <ReferenceLine y={detail.avg} stroke="#8f8e89" strokeDasharray="4 3" />
              )}
              {/* Clique (não hover): o hover já mostra o valor no tooltip, e
                  um popup nele abriria sem intenção ao atravessar o gráfico. */}
              <Bar
                dataKey="value"
                radius={[4, 4, 0, 0]}
                maxBarSize={26}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(_, index) => setDrillMonth(detail.series[index]?.key ?? null)}
              >
                {detail.series.map((p) => (
                  <Cell key={p.key} fill={detail.color} fillOpacity={p.selected ? 1 : 0.45} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {drillMonth && (
        <CategoryMonthPopup
          transactions={transactions}
          categories={categories}
          categoryId={detail.id}
          categoryName={detail.name}
          color={detail.color}
          monthYear={drillMonth}
          avg={detail.avg}
          onClose={() => setDrillMonth(null)}
        />
      )}
    </div>
  );
}
