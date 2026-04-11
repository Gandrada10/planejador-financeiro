import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { InsightsData } from '../types';

interface Props {
  data: InsightsData['monthlyResult'];
  width: number;
  height: number;
}

/** Light-theme bar chart of "Resultado Mensal" — receitas/despesas/resultado por mês. */
export function MonthlyResultPdf({ data, width, height }: Props) {
  const formatCurrencyShort = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `R$${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `R$${(value / 1_000).toFixed(0)}k`;
    return `R$${value.toFixed(0)}`;
  };

  return (
    <div style={{ width, height, background: '#ffffff', padding: 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis
            dataKey="label"
            stroke="#475569"
            fontSize={10}
            tick={{ fill: '#475569' }}
          />
          <YAxis
            stroke="#475569"
            fontSize={10}
            tick={{ fill: '#475569' }}
            tickFormatter={formatCurrencyShort}
          />
          <Tooltip
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #E2E8F0',
              color: '#0F1E3C',
              fontSize: 10,
            }}
            formatter={(value) =>
              typeof value === 'number'
                ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
                : String(value ?? '')
            }
          />
          <Legend wrapperStyle={{ fontSize: 10, color: '#0F1E3C' }} />
          <Bar dataKey="entradas" name="Entradas" fill="#059669" isAnimationActive={false} />
          <Bar dataKey="saidas" name="Saídas" fill="#DC2626" isAnimationActive={false} />
          <Bar dataKey="resultado" name="Resultado" isAnimationActive={false}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.resultado >= 0 ? '#0F1E3C' : '#F59E0B'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
