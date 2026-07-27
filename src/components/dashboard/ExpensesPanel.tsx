import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { MonthlyExpensesChart } from './MonthlyExpensesChart';
import { CostOfLivingChart } from './CostOfLivingChart';
import { computeCostOfLiving } from '../../lib/costOfLiving';
import { formatBRL0 } from '../../lib/utils';
import type { CostOfLivingData } from '../../lib/costOfLiving';
import type { Transaction, Category } from '../../types';

type ViewWindow = 'year' | 'm24' | 'm36';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  /** Despesas do mês selecionado (negativo, como vem do DashboardPage). */
  monthExpenses: number;
  /** Rótulo do mês selecionado, ex.: "junho de 2026". */
  monthLabel: string;
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
export function ExpensesPanel({
  transactions,
  categories,
  monthYear,
  monthExpenses,
  monthLabel,
  costOfLiving,
  isMonthInProgress,
}: Props) {
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

  const spentMonth = Math.abs(monthExpenses);

  // Despesa do mês vs custo de vida. Num mês em andamento a comparação seria
  // enganosa (mês pela metade sempre parece "abaixo do normal").
  const spentDelta =
    !isMonthInProgress && col.endMA !== null && col.endMA > 0
      ? ((spentMonth - col.endMA) / col.endMA) * 100
      : null;
  // Gastar acima do custo de vida é RUIM.
  const deltaChipTone =
    spentDelta !== null && spentDelta > 0
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

      {/* Número-herói: despesa do MÊS SELECIONADO — o card responde ao seletor
          de mês, então o número grande tem que responder também. O custo de
          vida (média móvel) virou sinal vital lá em cima; aqui ele aparece
          como a linha do gráfico, rotulada na própria ponta. */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-kpi font-bold tracking-tight tnum leading-none text-text-primary">
            {formatBRL0(spentMonth)}
          </p>
          <p className="text-caption text-ink-3 mt-1 flex items-center gap-1">
            despesas de {monthLabel}
            <span
              className="cursor-help flex-shrink-0"
              title="A linha do gráfico é o custo de vida: em cada mês, a média das despesas dos 12 meses anteriores. O mês em andamento fica de fora dela. Inclui todas as despesas; transferências ficam de fora."
              aria-label="A linha do gráfico é a média das despesas dos 12 meses anteriores a cada mês."
            >
              <Info size={12} />
            </span>
          </p>
        </div>

        {spentDelta !== null && (
          <span
            className={`inline-flex items-center gap-1.5 text-caption font-semibold tnum px-2.5 py-1 rounded-full border ${deltaChipTone}`}
          >
            {spentDelta > 0 ? '+' : ''}
            {spentDelta.toFixed(1).replace('.', ',')}% vs custo de vida ({formatBRL0(col.endMA!)}/mês)
          </span>
        )}
        {spentDelta === null && isMonthInProgress && (
          <span className="text-caption text-ink-3">mês em andamento</span>
        )}
      </div>

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
