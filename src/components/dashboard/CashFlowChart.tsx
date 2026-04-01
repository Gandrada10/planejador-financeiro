import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AXIS_STYLE, TOOLTIP_STYLE, GRID_STYLE } from '../../lib/chartTheme';
import { formatBRL } from '../../lib/utils';

interface AccountFlow {
  accountName: string;
  entries: number;
  exits: number;
  balance: number;
  color: string;
}

interface Props {
  data: AccountFlow[];
  totalEntries: number;
  totalExits: number;
  totalBalance: number;
}

const ACCOUNT_COLORS = ['#f59e0b', '#8b5cf6', '#3b82f6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316'];

export function CashFlowChart({ data, totalEntries, totalExits, totalBalance }: Props) {
  const chartData = data.map((d, i) => ({
    name: d.accountName.length > 15 ? d.accountName.slice(0, 15) + '...' : d.accountName,
    Entradas: d.entries,
    Saidas: d.exits,
    color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
  }));

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
      <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Resultados de caixa</h3>

      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid vertical={false} {...GRID_STYLE} />
            <XAxis dataKey="name" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value) => [formatBRL(Number(value)), '']}
            />
            <Bar dataKey="Entradas" radius={[3, 3, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill="#22c55e" fillOpacity={0.8} />
              ))}
            </Bar>
            <Bar dataKey="Saidas" radius={[3, 3, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill="#ef4444" fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[200px] flex items-center justify-center text-text-secondary text-xs">
          Sem movimentacoes neste mes
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-text-secondary">
              <th className="py-1.5 text-left">Conta</th>
              <th className="py-1.5 text-right">Entradas</th>
              <th className="py-1.5 text-right">Saidas</th>
              <th className="py-1.5 text-right">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-1.5 text-text-primary flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }} />
                  {d.accountName}
                </td>
                <td className="py-1.5 text-right text-accent-green">{formatBRL(d.entries)}</td>
                <td className="py-1.5 text-right text-accent-red">{formatBRL(d.exits)}</td>
                <td className={`py-1.5 text-right font-bold ${d.balance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatBRL(d.balance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td className="py-2 text-text-primary font-bold">Total</td>
              <td className="py-2 text-right text-accent-green font-bold">{formatBRL(totalEntries)}</td>
              <td className="py-2 text-right text-accent-red font-bold">{formatBRL(totalExits)}</td>
              <td className={`py-2 text-right font-bold ${totalBalance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {formatBRL(totalBalance)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
