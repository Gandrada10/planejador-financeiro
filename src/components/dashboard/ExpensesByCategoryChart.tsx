import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TOOLTIP_STYLE, CHART_COLORS } from '../../lib/chartTheme';
import { formatBRL } from '../../lib/utils';
import { CategoryIcon } from '../shared/CategoryIcon';
import { CashFlowSankey } from './CashFlowSankey';

interface SubExpense {
  name: string;
  icon: string;
  color: string;
  amount: number;
  percentage: number;
}

interface CategoryExpense {
  name: string;
  icon: string;
  color: string;
  amount: number;
  percentage: number;
  subs: SubExpense[];
}

interface Props {
  data: CategoryExpense[];
  /** Receitas e resultado do mês — alimentam a visão "Fluxo" (Sankey). */
  income: number;
  balance: number;
}

export function ExpensesByCategoryChart({ data, income, balance }: Props) {
  // O Fluxo é a visão padrão — é a leitura-resumo do mês; a lista de
  // categorias com drill-down fica a um toque para quem quer o detalhe.
  const [view, setView] = useState<'cats' | 'flow'>('flow');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const expandableNames = data.filter((d) => d.subs.length > 0).map((d) => d.name);
  const allExpanded = expandableNames.length > 0 && expandableNames.every((n) => expanded.has(n));

  function toggleAll() {
    if (allExpanded) setExpanded(new Set());
    else setExpanded(new Set(expandableNames));
  }

  const chartData = data.map((d) => ({
    name: d.name,
    value: Math.abs(d.amount),
  }));

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">
            {view === 'cats' ? 'Despesas por categoria' : 'Fluxo do mês'}
          </h3>
          {view === 'flow' && (
            <p className="text-caption text-ink-3 mt-0.5">de onde veio e para onde foi o dinheiro</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {view === 'cats' && expandableNames.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-1 text-caption text-text-secondary hover:text-text-primary transition-colors"
              title={allExpanded ? 'Colapsar todos' : 'Expandir todos'}
            >
              {allExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
              <span className="hidden sm:inline">{allExpanded ? 'Colapsar todos' : 'Expandir todos'}</span>
            </button>
          )}
          <div
            className="flex bg-bg-secondary border border-border rounded-control p-0.5 flex-shrink-0"
            role="group"
            aria-label="Visão das despesas por categoria"
          >
            <ViewButton active={view === 'flow'} onClick={() => setView('flow')}>
              Fluxo
            </ViewButton>
            <ViewButton active={view === 'cats'} onClick={() => setView('cats')}>
              Categorias
            </ViewButton>
          </div>
        </div>
      </div>

      {view === 'flow' ? (
        <CashFlowSankey income={income} balance={balance} categories={data} />
      ) : data.length > 0 ? (
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <div className="w-[200px] h-[200px] flex-shrink-0 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  innerRadius={58}
                  outerRadius={94}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={data[i]?.color || CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(value) => [formatBRL(Number(value)), 'Valor']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex-1 space-y-0.5 w-full min-w-0">
            {data.map((d, i) => {
              const isExpanded = expanded.has(d.name);
              const hasSubs = d.subs.length > 0;
              const catColor = d.color || CHART_COLORS[i % CHART_COLORS.length];
              return (
                <div key={i}>
                  {/* Category row */}
                  <div
                    className={`grid grid-cols-[1fr_auto] items-center gap-2 text-body rounded px-1 py-1 ${hasSubs ? 'cursor-pointer hover:bg-elevated/60' : ''}`}
                    onClick={() => hasSubs && toggleExpand(d.name)}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {hasSubs ? (
                        isExpanded
                          ? <ChevronDown size={12} className="flex-shrink-0" style={{ color: catColor }} />
                          : <ChevronRight size={12} className="flex-shrink-0" style={{ color: catColor }} />
                      ) : (
                        <span className="w-3 flex-shrink-0" />
                      )}
                      <span className="text-text-primary flex items-center gap-1.5 min-w-0">
                        <CategoryIcon icon={d.icon} size={13} className="flex-shrink-0" style={{ color: catColor }} />
                        <span className="truncate">{d.name}</span>
                      </span>
                      <span className="text-caption text-ink-3 flex-shrink-0 tnum">{d.percentage.toFixed(1)}%</span>
                    </div>
                    <span className="text-accent-red font-semibold whitespace-nowrap tnum">{formatBRL(d.amount)}</span>
                  </div>

                  {/* Subcategory rows (expanded) */}
                  {isExpanded && d.subs.map((sub, j) => {
                    const subColor = sub.color || catColor;
                    return (
                      <div key={j} className="grid grid-cols-[1fr_auto] items-center gap-2 text-body pl-7 pr-1 py-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-text-secondary flex items-center gap-1.5 min-w-0">
                            <CategoryIcon icon={sub.icon} size={12} className="flex-shrink-0" style={{ color: subColor }} />
                            <span className="truncate">{sub.name}</span>
                          </span>
                          <span className="text-caption text-ink-3 flex-shrink-0 tnum">{sub.percentage.toFixed(1)}%</span>
                        </div>
                        <span className="text-accent-red/80 whitespace-nowrap tnum">{formatBRL(sub.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="h-[150px] flex items-center justify-center text-caption text-ink-3">
          Sem despesas neste mês
        </div>
      )}
    </div>
  );
}

function ViewButton({
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
