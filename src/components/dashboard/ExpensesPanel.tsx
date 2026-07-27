import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { MonthlyExpensesChart } from './MonthlyExpensesChart';
import { CostOfLivingChart } from './CostOfLivingChart';
import { computeCostOfLiving } from '../../lib/costOfLiving';
import { formatBRL0, formatSignedBRL, formatCompactBRL } from '../../lib/utils';
import type { CostOfLivingData } from '../../lib/costOfLiving';
import type { Transaction, Category } from '../../types';

type ViewWindow = 'year' | 'm24' | 'm36';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  costOfLiving: CostOfLivingData;
  isMonthInProgress: boolean;
}

/**
 * Card único de despesas. A tendência (média móvel de 12M) não é uma "outra
 * visão" — é atributo do gráfico principal, presente em TODAS as janelas. O
 * seletor muda só o recorte de tempo: "Mês a mês" (ano vs ano anterior,
 * alinhados por mês) ou a linha do tempo contínua de 24/36 meses. O
 * número-herói do custo de vida é a manchete e fica fixo no cabeçalho.
 */
export function ExpensesPanel({ transactions, categories, monthYear, costOfLiving, isMonthInProgress }: Props) {
  const [view, setView] = useState<ViewWindow>('year');

  const year = Number(monthYear.split('-')[0]);
  const prevYear = year - 1;
  const col = costOfLiving;

  // A janela de 36 meses só é computada quando selecionada.
  const col36 = useMemo(
    () =>
      view === 'm36'
        ? computeCostOfLiving(transactions, categories, monthYear, isMonthInProgress, 36)
        : null,
    [view, transactions, categories, monthYear, isMonthInProgress]
  );
  // Dados da janela ativa. O herói usa sempre `col`: endMA/base são ancorados
  // no fim da série e não mudam com a janela — só `worst` muda.
  const colView = col36 ?? col;

  // Média móvel avaliada em cada mês do ano selecionado — a linha de tendência
  // sobre as barras da visão "Mês a mês".
  const maForYear = useMemo(() => {
    const arr: Array<number | null> = new Array(12).fill(null);
    for (const p of col.points) {
      const [py, pm] = p.key.split('-').map(Number);
      if (py === year) arr[pm - 1] = p.ma;
    }
    return arr;
  }, [col, year]);

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
            {view === 'year'
              ? `${year} vs ${prevYear} · linha: média móvel de 12 meses`
              : `Últimos ${view === 'm24' ? 24 : 36} meses · barras mensais + média móvel de 12 meses`}
          </p>
        </div>

        {/* Seletor de janela de tempo — a tendência está presente em todas */}
        <div className="flex bg-bg-secondary border border-border rounded-control p-0.5 flex-shrink-0" role="group" aria-label="Janela de tempo do gráfico de despesas">
          <LensButton active={view === 'year'} onClick={() => setView('year')}>
            Mês a mês
          </LensButton>
          <LensButton active={view === 'm24'} onClick={() => setView('m24')}>
            24M
          </LensButton>
          <LensButton active={view === 'm36'} onClick={() => setView('m36')}>
            36M
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
              custo de vida · média móvel 12M · encerrada em {col.endLabel}
              <span
                className="cursor-help flex-shrink-0"
                title="Cada ponto da linha de tendência é a média das despesas dos 12 meses anteriores àquele mês. O mês em andamento fica de fora. Inclui todas as despesas; transferências ficam de fora."
                aria-label="Cada ponto da linha de tendência é a média das despesas dos 12 meses anteriores àquele mês."
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
                {colView.worst && (
                  <>
                    {' '}
                    · pior mês: {colView.worst.label} ({formatCompactBRL(colView.worst.value)})
                  </>
                )}
              </p>
            </div>
          ) : (
            colView.worst && (
              <p className="text-caption text-ink-3 tnum">
                pior mês: {colView.worst.label} ({formatCompactBRL(colView.worst.value)})
              </p>
            )
          )}
        </div>
      )}

      {view === 'year' ? (
        <MonthlyExpensesChart
          transactions={transactions}
          categories={categories}
          monthYear={monthYear}
          isMonthInProgress={isMonthInProgress}
          ma={maForYear}
        />
      ) : (
        <CostOfLivingChart data={colView} />
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
