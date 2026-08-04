import { useState, useMemo } from 'react';
import { FileBarChart } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { MonthSelector } from '../shared/MonthSelector';
import { SegmentedControl } from '../shared/SegmentedControl';
import { MonthlyDashboard } from './MonthlyDashboard';
import { AnnualDashboard } from './annual/AnnualDashboard';
import { getMonthYear, getClosedMonthYear } from '../../lib/utils';

type DashboardMode = 'mes' | 'ano';

/**
 * A casca do dashboard: a chave Mês/Ano e o seletor de mês, sobre duas faces
 * que respondem perguntas diferentes.
 *
 *   Mês — "como foi este mês?". Um recorte, comparado com a média.
 *   Ano — "de onde eu venho e para onde vou?". Doze meses móveis como régua,
 *         com o ano corrente destacado em um card de progresso e projeção.
 *
 * Por que 12 meses móveis e não o ano do calendário: é a única janela que
 * sempre contém um Natal, um IPVA, umas férias e um 13º — a média significa
 * alguma coisa e não muda de sentido entre março e novembro. O ano corrente
 * é ciclo de compromisso (metas, imposto), não janela de análise, e por isso
 * aparece uma vez só, como placar, em vez de duplicar todos os números.
 */
export function DashboardPage() {
  const [mode, setMode] = useState<DashboardMode>('mes');
  // Abre no último mês FECHADO: o mês corrente tem números pela metade.
  const [monthYear, setMonthYear] = useState(getClosedMonthYear());
  const { transactions, loading: loadingTx } = useTransactions();

  const availableMonths = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    set.add(getMonthYear());
    set.add(getClosedMonthYear()); // garante o mês de abertura na lista
    return Array.from(set).sort().reverse();
  }, [transactions]);

  if (loadingTx) {
    return <DashboardSkeleton />;
  }

  const hasData = transactions.length > 0;

  return (
    // Largura máxima centralizada: sem ela, num monitor de 1900px os cards
    // esticavam de borda a borda — colunas de ~830px para tabelas que pedem
    // ~600px, e os cards das pontas colados nas margens da janela.
    <div className="max-w-[1440px] mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold tracking-tight text-text-primary">Dashboard</h2>
        <div className="flex items-center gap-2">
          <SegmentedControl
            ariaLabel="Janela do dashboard"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'mes', label: 'Mês' },
              { value: 'ano', label: 'Ano', title: 'Últimos 12 meses fechados' },
            ]}
          />
          {/* O seletor de mês só existe na face mensal — a anual deriva a
              janela do relógio e não tem o que escolher. */}
          {mode === 'mes' && (
            <MonthSelector value={monthYear} onChange={setMonthYear} months={availableMonths} />
          )}
        </div>
      </div>

      {hasData ? (
        mode === 'mes' ? (
          <MonthlyDashboard transactions={transactions} monthYear={monthYear} />
        ) : (
          <AnnualDashboard transactions={transactions} />
        )
      ) : (
        <div className="bg-bg-card border border-border rounded-card p-10 text-center space-y-2">
          <FileBarChart size={24} className="mx-auto text-ink-3" strokeWidth={1.5} />
          <p className="text-body text-text-primary">Nada por aqui ainda</p>
          <p className="text-caption text-ink-3">Importe seus extratos em Transações para o dashboard ganhar vida.</p>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="max-w-[1440px] mx-auto space-y-4" aria-busy="true" aria-label="Carregando dashboard">
      <div className="flex items-center justify-between">
        <div className="h-6 w-32 bg-elevated rounded animate-pulse" />
        <div className="h-8 w-44 bg-elevated rounded animate-pulse" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[92px] bg-bg-card border border-border rounded-card animate-pulse" />
        ))}
      </div>
      <div className="h-[260px] bg-bg-card border border-border rounded-card animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[320px] bg-bg-card border border-border rounded-card animate-pulse" />
        <div className="h-[320px] bg-bg-card border border-border rounded-card animate-pulse" />
      </div>
    </div>
  );
}
