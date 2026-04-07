import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TOOLTIP_STYLE, CHART_COLORS } from '../../lib/chartTheme';
import { formatBRL } from '../../lib/utils';
import { CategoryIcon } from '../shared/CategoryIcon';

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
}

export function ExpensesByCategoryChart({ data }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const chartData = data.map((d) => ({
    name: d.name,
    value: Math.abs(d.amount),
  }));

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
      <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Despesas por categoria</h3>

      {data.length > 0 ? (
        <div className="flex flex-col lg:flex-row items-center gap-4">
          <div className="w-[180px] h-[180px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  innerRadius={50}
                  outerRadius={80}
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

          <div className="flex-1 space-y-0.5 w-full">
            {data.map((d, i) => {
              const isExpanded = expanded.has(d.name);
              const hasSubs = d.subs.length > 0;
              return (
                <div key={i}>
                  {/* Category row */}
                  <div
                    className={`flex items-center justify-between text-xs rounded px-1 py-1 ${hasSubs ? 'cursor-pointer hover:bg-bg-secondary/50' : ''}`}
                    onClick={() => hasSubs && toggleExpand(d.name)}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {hasSubs ? (
                        isExpanded
                          ? <ChevronDown size={11} className="text-text-secondary flex-shrink-0" />
                          : <ChevronRight size={11} className="text-text-secondary flex-shrink-0" />
                      ) : (
                        <span className="w-[11px] flex-shrink-0" />
                      )}
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color || CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-text-primary flex items-center gap-1 truncate">
                        <CategoryIcon icon={d.icon} size={12} className="text-text-primary flex-shrink-0" />
                        {d.name}
                      </span>
                      <span className="text-text-secondary flex-shrink-0">{d.percentage.toFixed(1)}%</span>
                    </div>
                    <span className="text-accent-red font-bold flex-shrink-0 ml-2">{formatBRL(d.amount)}</span>
                  </div>

                  {/* Subcategory rows (expanded) */}
                  {isExpanded && d.subs.map((sub, j) => (
                    <div key={j} className="flex items-center justify-between text-xs pl-7 pr-1 py-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0 opacity-70" style={{ backgroundColor: sub.color || d.color }} />
                        <span className="text-text-secondary flex items-center gap-1 truncate">
                          <CategoryIcon icon={sub.icon} size={11} className="text-text-secondary flex-shrink-0" />
                          {sub.name}
                        </span>
                        <span className="text-text-secondary/60 flex-shrink-0">{sub.percentage.toFixed(1)}%</span>
                      </div>
                      <span className="text-accent-red/80 flex-shrink-0 ml-2">{formatBRL(sub.amount)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="h-[180px] flex items-center justify-center text-text-secondary text-xs">
          Sem despesas neste mes
        </div>
      )}
    </div>
  );
}
