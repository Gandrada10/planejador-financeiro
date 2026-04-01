import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TOOLTIP_STYLE, CHART_COLORS } from '../../lib/chartTheme';
import { formatBRL } from '../../lib/utils';
import { CategoryIcon } from '../shared/CategoryIcon';

interface CategoryExpense {
  name: string;
  icon: string;
  color: string;
  amount: number;
  percentage: number;
}

interface Props {
  data: CategoryExpense[];
}

export function ExpensesByCategoryChart({ data }: Props) {
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

          <div className="flex-1 space-y-1.5 w-full">
            {data.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color || CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="text-text-primary flex items-center gap-1"><CategoryIcon icon={d.icon} size={12} className="text-text-primary" /> {d.name}</span>
                  <span className="text-text-secondary">{d.percentage.toFixed(1)}%</span>
                </div>
                <span className="text-accent-red font-bold">{formatBRL(d.amount)}</span>
              </div>
            ))}
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
