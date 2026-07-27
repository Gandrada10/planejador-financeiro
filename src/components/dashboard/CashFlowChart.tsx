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
  yearBalance: number;
  avg12months: number;
  currentYear: string;
}

export function CashFlowChart({ data, totalEntries, totalExits, totalBalance, yearBalance, avg12months, currentYear }: Props) {
  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <h3 className="text-title font-semibold text-text-primary">Resultados de caixa</h3>

      <div className="overflow-auto">
        <table className="w-full text-body table-fixed">
          <colgroup>
            <col />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-caption uppercase tracking-wider text-ink-3">
              <th className="py-1.5 pr-3 text-left font-semibold">Conta</th>
              <th className="py-1.5 px-3 text-right font-semibold">Entradas</th>
              <th className="py-1.5 px-3 text-right font-semibold">Saídas</th>
              <th className="py-1.5 pl-3 text-right font-semibold">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-1.5 pr-3 text-text-primary">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="truncate">{d.accountName}</span>
                    {d.isCard && (
                      <span className={`px-1.5 py-0.5 rounded text-caption font-semibold leading-none ${
                        d.cycleStatus === 'closed'
                          ? 'bg-text-secondary/15 text-text-secondary'
                          : 'bg-accent/15 text-accent'
                      }`}>
                        {d.cycleStatus === 'closed' ? 'Fechada' : 'Aberta'}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-1.5 px-3 text-right tnum text-accent-green">{formatBRL(d.entries)}</td>
                <td className="py-1.5 px-3 text-right tnum text-accent-red">{formatBRL(d.exits)}</td>
                <td className={`py-1.5 pl-3 text-right tnum font-semibold ${d.balance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatBRL(d.balance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td className="py-2 pr-3 text-text-primary font-semibold">Total (mês)</td>
              <td className="py-2 px-3 text-right tnum text-accent-green font-semibold">{formatBRL(totalEntries)}</td>
              <td className="py-2 px-3 text-right tnum text-accent-red font-semibold">{formatBRL(totalExits)}</td>
              <td className={`py-2 pl-3 text-right tnum font-semibold ${totalBalance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {formatBRL(totalBalance)}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-text-secondary">Acumulado {currentYear}</td>
              <td className="py-1.5 px-3" colSpan={2} />
              <td className={`py-1.5 pl-3 text-right tnum ${yearBalance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {formatBRL(yearBalance)}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-text-secondary">Média mensal (12M)</td>
              <td className="py-1.5 px-3" colSpan={2} />
              <td className={`py-1.5 pl-3 text-right tnum ${avg12months >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {formatBRL(avg12months)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
