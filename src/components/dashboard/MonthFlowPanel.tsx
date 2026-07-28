import { useMemo, useState } from 'react';
import { CashFlowSankey } from './CashFlowSankey';
import { computeCategoryFlow, type FlowPeriod } from '../../lib/categoryFlow';
import type { Transaction, Category } from '../../types';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  isMonthInProgress: boolean;
}

/**
 * "Fluxo do dinheiro" — para onde foi, no mês selecionado ou na média dos
 * últimos 12 meses (a leitura estrutural). As duas janelas plotam a mesma
 * coisa, então dividem um card com seletor em vez de dois cards concorrentes;
 * foi assim que a "Composição do gasto · 12 meses" veio parar aqui.
 *
 * Subcategoria abre POR CATEGORIA, no clique. Abrir todas de uma vez punha
 * ~28 folhas na última coluna e o diagrama virava espaguete — Sankey comunica
 * proporção até ~15 folhas.
 */
export function MonthFlowPanel({ transactions, categories, monthYear, isMonthInProgress }: Props) {
  const [period, setPeriod] = useState<FlowPeriod>('month');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const flow = useMemo(
    () => computeCategoryFlow(transactions, categories, monthYear, isMonthInProgress, period),
    [transactions, categories, monthYear, isMonthInProgress, period]
  );

  function toggleCategory(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canCollapse = expanded.size > 0;

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Fluxo do dinheiro</h3>
          <p className="text-caption text-ink-3 mt-0.5">
            {flow.label} · % sobre tudo que entrou · toque numa categoria para abrir as subcategorias
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canCollapse && (
            <button
              type="button"
              onClick={() => setExpanded(new Set())}
              className="text-caption text-text-secondary hover:text-text-primary transition-colors"
            >
              Fechar todas
            </button>
          )}
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
        expanded={expanded}
        onToggleCategory={toggleCategory}
        unit={period === 'm12' ? '/mês' : ''}
      />

      {flow.balance < 0 && (
        <p className="text-caption text-ink-3">
          Resultado negativo entra pela esquerda: o período gastou mais do que entrou e a diferença veio
          de reserva, investimento ou crédito — o app não sabe de qual.
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
