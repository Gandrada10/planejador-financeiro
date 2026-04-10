import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AXIS_STYLE, TOOLTIP_STYLE, GRID_STYLE } from '../../lib/chartTheme';
import { formatBRL } from '../../lib/utils';

interface AccountFlow {
  accountName: string;
  entries: number;
  exits: number;
  balance: number;
  color: string;
  isCard?: boolean;
  cycleStatus?: 'open' | 'closed';
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
    name: d.accountName.length > 14 ? d.accountName.slice(0, 14) + '...' : d.accountName,
    Entradas: d.entries,
    Saidas: d.exits,
    color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
  }));

  // Dynamic height: ~52px per account + padding, clamped to a reasonable range
  const chartHeight = Math.max(110, Math.min(260, data.length * 52 + 30));

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
      <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Resultados de caixa</h3>

      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 12, left: 0, bottom: 4 }}
            barGap={2}
            barCategoryGap="25%"
          >
            <CartesianGrid horizontal={false} {...GRID_STYLE} />
            <XAxis
              type="number"
              {...AXIS_STYLE}
              tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`}
            />
            <YAxis
              type="category"
              dataKey="name"
              {...AXIS_STYLE}
              width={100}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value) => [formatBRL(Number(value)), '']}
            />
            <Bar dataKey="Entradas" fill="#22c55e" fillOpacity={0.8} radius={[0, 3, 3, 0]} />
            <Bar dataKey="Saidas" fill="#ef4444" fillOpacity={0.8} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[110px] flex items-center justify-center text-text-secondary text-xs">
          Sem movimentacoes neste mes
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto">
        <table className="w-full text-xs table-fixed">
          <colgroup>
            <col />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-24" />
          </colgroup>
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
                <td className="py-1.5 text-text-primary">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }} />
                    <span>{d.accountName}</span>
                    {d.isCard && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold leading-none ${
                        d.cycleStatus === 'closed'
                          ? 'bg-text-secondary/15 text-text-secondary'
                          : 'bg-accent/15 text-accent'
                      }`}>
                        {d.cycleStatus === 'closed' ? 'Fechada' : 'Aberta'}
                      </span>
                    )}
                  </div>
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
