import { formatBRL } from '../../lib/utils';
import type { Account } from '../../types';

export interface AccountFlow {
  accountName: string;
  type?: Account['type'];
  entries: number;
  exits: number;
  balance: number;
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

/**
 * Resultados de caixa agrupados por TIPO de conta, com subtotal por grupo.
 *
 * A lista plana anterior misturava naturezas diferentes na mesma coluna —
 * saldo em conta corrente e dívida de cartão somados como se fossem a mesma
 * coisa. O agrupamento deixa explícito o que é dinheiro em caixa, o que é
 * fatura a pagar e o que é benefício.
 */
const GROUPS: Array<{ label: string; types: Array<Account['type'] | undefined> }> = [
  { label: 'Conta corrente', types: ['corrente'] },
  { label: 'Cartões de crédito', types: ['cartao'] },
  { label: 'Vale / benefício', types: ['beneficio'] },
  { label: 'Poupança e investimentos', types: ['poupanca', 'investimento', 'outro'] },
  { label: 'Sem conta', types: [undefined] },
];

/** Zero vira travessão: numa linha de cartão, "R$ 0,00" de entrada é só ruído. */
function money(value: number, tone: string) {
  if (value === 0) return <span className="text-ink-3">—</span>;
  return <span className={tone}>{formatBRL(value)}</span>;
}

export function CashFlowTable({
  data,
  totalEntries,
  totalExits,
  totalBalance,
  yearBalance,
  avg12months,
  currentYear,
}: Props) {
  const groups = GROUPS.map((g) => {
    const rows = data.filter((d) => g.types.includes(d.type));
    return {
      label: g.label,
      rows,
      entries: rows.reduce((s, r) => s + r.entries, 0),
      exits: rows.reduce((s, r) => s + r.exits, 0),
      balance: rows.reduce((s, r) => s + r.balance, 0),
    };
  }).filter((g) => g.rows.length > 0);

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

          {groups.map((g) => {
            // Grupo com uma conta só não repete o mesmo número duas vezes:
            // o nome da conta vira sufixo do cabeçalho do grupo.
            const single = g.rows.length === 1 ? g.rows[0] : null;
            return (
              <tbody key={g.label} className="border-b border-border/40">
                <tr>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                      <span className="text-caption uppercase tracking-wider text-ink-3 font-semibold">
                        {g.label}
                      </span>
                      {single && single.accountName !== g.label && (
                        <span className="text-text-primary truncate">
                          {single.accountName}
                          {single.isCard && <CycleChip status={single.cycleStatus} />}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 px-3 text-right tnum">{money(g.entries, 'text-accent-green')}</td>
                  <td className="py-1.5 px-3 text-right tnum">{money(g.exits, 'text-accent-red')}</td>
                  <td className="py-1.5 pl-3 text-right tnum font-semibold">
                    {money(g.balance, g.balance >= 0 ? 'text-accent-green' : 'text-accent-red')}
                  </td>
                </tr>

                {!single &&
                  g.rows.map((d) => (
                    <tr key={d.accountName}>
                      <td className="py-1 pr-3 pl-3 text-text-secondary">
                        <span className="truncate">
                          {d.accountName}
                          {d.isCard && <CycleChip status={d.cycleStatus} />}
                        </span>
                      </td>
                      <td className="py-1 px-3 text-right tnum">{money(d.entries, 'text-accent-green/80')}</td>
                      <td className="py-1 px-3 text-right tnum">{money(d.exits, 'text-accent-red/80')}</td>
                      <td className="py-1 pl-3 text-right tnum">
                        {money(d.balance, d.balance >= 0 ? 'text-accent-green/80' : 'text-accent-red/80')}
                      </td>
                    </tr>
                  ))}
              </tbody>
            );
          })}

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

function CycleChip({ status }: { status?: 'open' | 'closed' }) {
  return (
    <span
      className={`ml-1.5 px-1.5 py-0.5 rounded text-caption font-semibold leading-none ${
        status === 'closed'
          ? 'bg-text-secondary/15 text-text-secondary'
          : 'bg-accent/15 text-accent'
      }`}
    >
      {status === 'closed' ? 'Fechada' : 'Aberta'}
    </span>
  );
}
