import { useState } from 'react';
import { Info } from 'lucide-react';
import { MonthlyExpensesChart } from './MonthlyExpensesChart';
import { CostOfLivingChart } from './CostOfLivingChart';
import { formatBRL0, formatSignedBRL, formatCompactBRL } from '../../lib/utils';
import type { CostOfLivingData } from '../../lib/costOfLiving';
import type { Transaction, Category } from '../../types';

type Lens = 'yoy' | 'trend';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  costOfLiving: CostOfLivingData;
  isMonthInProgress: boolean;
}

/**
 * Card único de despesas: as duas lentes temporais (mês a mês vs ano anterior;
 * trajetória da média móvel 24M) plotam a MESMA série, então dividem um card
 * com seletor em vez de dois cards que obrigavam a cruzar gráficos de cabeça.
 * O número-herói do custo de vida é a manchete e fica fixo no cabeçalho,
 * independente da lente escolhida.
 */
export function ExpensesPanel({ transactions, categories, monthYear, costOfLiving, isMonthInProgress }: Props) {
  const [lens, setLens] = useState<Lens>('yoy');

  const year = Number(monthYear.split('-')[0]);
  const prevYear = year - 1;
  const col = costOfLiving;
  const rising = col.deltaPct !== null && col.deltaPct > 0;
  const chipTone = rising
    ? 'bg-negative/10 border-negative/35 text-negative'
    : 'bg-positive/10 border-positive/35 text-positive';

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Despesas</h3>
          <p className="text-caption text-ink-3 mt-0.5">
            {lens === 'yoy'
              ? `${year} vs ${prevYear}`
              : `Média móvel de 12 meses · encerrada em ${col.endLabel}${
                  isMonthInProgress ? ' · o mês em andamento fica de fora' : ''
                }`}
          </p>
        </div>

        {/* Seletor de lente */}
        <div className="flex bg-bg-secondary border border-border rounded-control p-0.5 flex-shrink-0" role="group" aria-label="Lente do gráfico de despesas">
          <LensButton active={lens === 'yoy'} onClick={() => setLens('yoy')}>
            Mês a mês
          </LensButton>
          <LensButton active={lens === 'trend'} onClick={() => setLens('trend')}>
            Tendência 24M
          </LensButton>
        </div>
      </div>

      {/* Número-herói: custo de vida (média móvel 12M), sempre visível */}
      {col.hasData && (
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <p className="text-kpi font-bold tracking-tight tnum leading-none text-text-primary">
              {formatBRL0(col.endMA!)}
              <span className="text-body font-medium text-text-secondary tracking-normal">/mês</span>
            </p>
            <p className="text-caption text-ink-3 mt-1 flex items-center gap-1">
              custo de vida · média móvel 12M
              <span
                className="cursor-help flex-shrink-0"
                title="Cada ponto da linha (lente Tendência) é a média das despesas dos 12 meses anteriores àquele mês. Inclui todas as despesas; transferências ficam de fora."
                aria-label="Cada ponto da linha é a média das despesas dos 12 meses anteriores àquele mês."
              >
                <Info size={12} />
              </span>
            </p>
            {col.endPartialMonths !== null && (
              <p className="text-caption text-ink-3 mt-0.5">
                média dos {col.endPartialMonths} {col.endPartialMonths === 1 ? 'mês' : 'meses'} com dados —
                a janela cheia de 12 ainda não existe
              </p>
            )}
          </div>

          {col.deltaAbs !== null && col.base !== null ? (
            <div className="text-right">
              <span
                className={`inline-flex items-center gap-1.5 text-caption font-semibold tnum px-2.5 py-1 rounded-full border ${chipTone}`}
              >
                {formatSignedBRL(col.deltaAbs)} · {col.deltaPct! > 0 ? '+' : ''}
                {col.deltaPct!.toFixed(1).replace('.', ',')}%{' '}
                {col.base.kind === '12m' ? 'em 12 meses' : `desde ${col.base.label}`}
              </span>
              <p className="text-caption text-ink-3 mt-1.5 tnum">
                {col.base.kind === '12m' ? 'há 12 meses' : col.base.label}: {formatBRL0(col.base.ma)}/mês
                {col.worst && (
                  <>
                    {' '}
                    · pior mês: {col.worst.label} ({formatCompactBRL(col.worst.value)})
                  </>
                )}
              </p>
            </div>
          ) : (
            col.worst && (
              <p className="text-caption text-ink-3 tnum">
                pior mês: {col.worst.label} ({formatCompactBRL(col.worst.value)})
              </p>
            )
          )}
        </div>
      )}

      {lens === 'yoy' ? (
        <MonthlyExpensesChart
          transactions={transactions}
          categories={categories}
          monthYear={monthYear}
          isMonthInProgress={isMonthInProgress}
        />
      ) : (
        <CostOfLivingChart data={col} />
      )}
    </div>
  );
}

function LensButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 rounded-[10px] text-caption font-medium transition-colors ${
        active ? 'bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}
