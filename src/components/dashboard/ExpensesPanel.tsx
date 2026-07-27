import { useMemo, useState } from 'react';
import { MonthlyExpensesChart } from './MonthlyExpensesChart';
import { CostOfLivingChart } from './CostOfLivingChart';
import { computeCostOfLiving } from '../../lib/costOfLiving';
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
 * Card de despesas — SÓ o gráfico. Todos os números-herói do dashboard vivem na
 * linha de indicadores acima (VitalSigns); um segundo número grande aqui
 * partia a hierarquia da tela em duas.
 *
 * A tendência (média móvel de 12M) não é uma "outra visão" escondida atrás de
 * aba — é atributo do gráfico, presente em TODAS as janelas, e se identifica
 * pelo rótulo na própria ponta da linha. O seletor muda só o recorte de tempo:
 * "Mês a mês" (ano vs ano anterior, alinhados por mês) ou a linha do tempo
 * contínua de 24/36 meses.
 */
export function ExpensesPanel({
  transactions,
  categories,
  monthYear,
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

  return (
    <div className="bg-bg-card border border-border rounded-card p-3 sm:p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Despesas</h3>
          <p className="text-caption text-ink-3 mt-0.5">
            {view === 'year'
              ? `${year} vs ${prevYear} · linha: custo de vida (média móvel de 12 meses)`
              : `Últimos ${view === 'm24' ? 24 : 36} meses · linha: custo de vida (média móvel de 12 meses)`}
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
      className={`tap px-3 py-1 rounded-[10px] text-caption font-medium transition-colors ${
        active ? 'bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary active:bg-elevated/60'
      }`}
    >
      {children}
    </button>
  );
}
