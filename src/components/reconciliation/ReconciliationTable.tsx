import { CheckCircle, Circle } from 'lucide-react';
import { formatBRL, formatDate } from '../../lib/utils';
import type { Transaction, Category } from '../../types';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  onToggleReconciled: (id: string, reconciled: boolean) => void;
}

export function ReconciliationTable({ transactions, categories, onToggleReconciled }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-lg p-8 text-center text-text-secondary text-xs">
        Nenhuma transacao encontrada para este periodo e conta.
      </div>
    );
  }

  function getCategoryName(catId: string | null): string {
    if (!catId) return '—';
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return '—';
    const parent = cat.parentId ? categories.find((c) => c.id === cat.parentId) : null;
    return parent ? `${parent.name} / ${cat.name}` : cat.name;
  }

  return (
    <div className="overflow-auto bg-bg-card border border-border rounded-lg">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-text-secondary uppercase tracking-wider text-[10px]">
            <th className="p-2 w-10 text-center">Status</th>
            <th className="p-2 text-left">Data</th>
            <th className="p-2 text-left">Descricao</th>
            <th className="p-2 text-left">Categoria</th>
            <th className="p-2 text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr
              key={t.id}
              onClick={() => onToggleReconciled(t.id, !t.reconciled)}
              className={`border-b border-border/30 cursor-pointer transition-colors hover:bg-bg-secondary/30 ${
                t.reconciled
                  ? 'bg-accent-green/5'
                  : 'border-l-2 border-l-accent'
              }`}
            >
              <td className="p-2 text-center">
                {t.reconciled ? (
                  <CheckCircle size={16} className="inline text-accent-green" />
                ) : (
                  <Circle size={16} className="inline text-text-secondary" />
                )}
              </td>
              <td className="p-2 text-text-secondary whitespace-nowrap">
                {formatDate(t.date)}
              </td>
              <td className="p-2 text-text-primary max-w-[250px] truncate">
                {t.description}
                {t.totalInstallments && (
                  <span className="ml-1.5 text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                    {t.installmentNumber}/{t.totalInstallments}
                  </span>
                )}
              </td>
              <td className="p-2 text-text-secondary truncate max-w-[150px]">
                {getCategoryName(t.categoryId)}
              </td>
              <td className={`p-2 text-right font-bold whitespace-nowrap ${t.amount >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {formatBRL(t.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
