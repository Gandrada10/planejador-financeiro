import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ExpenseCategoryBreakdown } from '../types';

interface Props {
  data: ExpenseCategoryBreakdown[];
  width: number;
  height: number;
}

/** Light-theme donut chart for "Despesas por Categoria" — used only by the PDF. */
export function ExpensesDonutPdf({ data, width, height }: Props) {
  const pieData = data
    .filter((d) => d.amount < 0)
    .slice(0, 10)
    .map((d) => ({
      name: d.name,
      value: Math.abs(d.amount),
      color: d.color,
      percentage: d.percentage,
    }));

  const total = pieData.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{ width, height, background: '#ffffff', padding: 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="40%"
            cy="50%"
            innerRadius="45%"
            outerRadius="75%"
            paddingAngle={1}
            isAnimationActive={false}
            label={false}
          >
            {pieData.map((entry, index) => (
              <Cell key={index} fill={entry.color} stroke="#ffffff" strokeWidth={1} />
            ))}
          </Pie>
          <Tooltip formatter={() => ''} contentStyle={{ display: 'none' }} />
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 10, color: '#0F1E3C', paddingLeft: 10 }}
            formatter={(value: string, _entry, index: number) => {
              const d = pieData[index];
              if (!d) return value;
              const pct = total > 0 ? (d.value / total) * 100 : 0;
              return (
                <span style={{ color: '#0F1E3C' }}>
                  {value}{' '}
                  <span style={{ color: '#475569', fontSize: 9 }}>
                    ({pct.toFixed(1)}%)
                  </span>
                </span>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
