import { useState } from 'react';
import { CashFlowSankey, type CategorySlice, type FlowLevel } from './CashFlowSankey';

interface Props {
  data: CategorySlice[];
  /** Receitas e resultado do mês. */
  income: number;
  balance: number;
}

/**
 * "Fluxo do mês" — substitui o donut de despesas por categoria.
 *
 * O donut respondia "qual a fatia de cada categoria"; o Sankey responde isso E
 * de onde o dinheiro veio, quanto sobrou e (no nível de subcategoria) o que
 * dentro de cada categoria puxou o gasto. Mesma informação, uma leitura só.
 */
export function MonthFlowPanel({ data, income, balance }: Props) {
  const [level, setLevel] = useState<FlowLevel>('parent');
  const hasSubs = data.some((c) => c.amount < 0 && c.subs.some((s) => s.amount < 0));

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Fluxo do mês</h3>
          <p className="text-caption text-ink-3 mt-0.5">de onde veio e para onde foi o dinheiro</p>
        </div>

        {hasSubs && (
          <div
            className="flex bg-bg-secondary border border-border rounded-control p-0.5 flex-shrink-0"
            role="group"
            aria-label="Nível de detalhe do fluxo"
          >
            <LevelButton active={level === 'parent'} onClick={() => setLevel('parent')}>
              Categorias
            </LevelButton>
            <LevelButton active={level === 'sub'} onClick={() => setLevel('sub')}>
              + subcategorias
            </LevelButton>
          </div>
        )}
      </div>

      <CashFlowSankey income={income} balance={balance} categories={data} level={level} />
    </div>
  );
}

function LevelButton({
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
