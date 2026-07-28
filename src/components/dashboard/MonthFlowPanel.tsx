import { useMemo, useState } from 'react';
import { CashFlowSankey } from './CashFlowSankey';
import { computeCategoryFlow, type FlowPeriod } from '../../lib/categoryFlow';
import type { Transaction, Category } from '../../types';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  isMonthInProgress: boolean;
  /** Categoria em análise no painel lateral (o dashboard é o dono do estado). */
  selectedCategory: string | null;
  onSelectCategory: (id: string | null) => void;
}

/**
 * "Fluxo do dinheiro" — para onde foi, no mês selecionado ou na média dos
 * últimos 12 meses (a leitura estrutural). As duas janelas plotam a mesma
 * coisa, então dividem um card com seletor em vez de dois cards concorrentes;
 * foi assim que a "Composição do gasto · 12 meses" veio parar aqui.
 *
 * O diagrama é de NÍVEL ÚNICO (só categorias-mãe). Subcategoria mora no painel
 * de análise, que abre no clique: em lista ela cabe inteira, com valor, média e
 * Δ; dentro do Sankey virava nome cortado empurrando o resto do desenho.
 */
export function MonthFlowPanel({
  transactions,
  categories,
  monthYear,
  isMonthInProgress,
  selectedCategory,
  onSelectCategory,
}: Props) {
  const [period, setPeriod] = useState<FlowPeriod>('month');

  const flow = useMemo(
    () => computeCategoryFlow(transactions, categories, monthYear, isMonthInProgress, period),
    [transactions, categories, monthYear, isMonthInProgress, period]
  );

  // Média mensal 12M por categoria, para o ▲▼ dos rótulos do Sankey.
  // Na visão "Média 12M" não existe delta: o valor exibido É a média.
  const averages = useMemo(() => {
    if (period !== 'month') return undefined;
    const m12 = computeCategoryFlow(transactions, categories, monthYear, isMonthInProgress, 'm12');
    const map = new Map<string, number>();
    for (const c of m12.categories) if (c.amount < 0) map.set(c.id, -c.amount);
    return map;
  }, [transactions, categories, monthYear, isMonthInProgress, period]);

  return (
    // Altura NATURAL: a coluna vizinha cresce sozinha quando a análise abre
    // ou quando entram mais metas/projetos, sem arrastar o diagrama junto.
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Fluxo do dinheiro</h3>
          <p className="text-caption text-ink-3 mt-0.5">
            {flow.label} · % sobre tudo que entrou
            {period === 'month' ? ' · ▲▼ vs média 12M' : ''} · toque numa categoria para ver a
            análise e as subcategorias
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex bg-bg-secondary border border-border rounded-control p-0.5 flex-shrink-0"
            role="group"
            aria-label="Período do fluxo"
          >
            <PeriodButton active={period === 'month'} onClick={() => setPeriod('month')}>
              Este mês
            </PeriodButton>
            <PeriodButton active={period === 'm12'} onClick={() => setPeriod('m12')}>
              Média 12M
            </PeriodButton>
          </div>
        </div>
      </div>

      <CashFlowSankey
        income={flow.income}
        balance={flow.balance}
        categories={flow.categories}
        unit={period === 'm12' ? '/mês' : ''}
        selectedId={selectedCategory}
        onSelectCategory={(id) => onSelectCategory(id === selectedCategory ? null : id)}
        averages={averages}
      />

      {flow.balance < 0 && (
        <p className="text-caption text-ink-3">
          Uso de reservas: o período gastou mais do que entrou — a diferença veio de reserva,
          investimento ou crédito (o app não sabe de qual).
        </p>
      )}
    </div>
  );
}

function PeriodButton({
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
