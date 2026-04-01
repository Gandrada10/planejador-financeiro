import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { formatBRL, formatDate } from '../../lib/utils';
import type { Transaction, Category } from '../../types';

interface TitularGroup {
  titular: string;
  total: number;
  transactions: Transaction[];
}

interface Props {
  groups: TitularGroup[];
  categories: Category[];
  totalTransactions: number;
}

export function InvoiceTransactionList({ groups, categories, totalTransactions }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleGroup(titular: string) {
    const next = new Set(collapsed);
    if (next.has(titular)) next.delete(titular); else next.add(titular);
    setCollapsed(next);
  }

  function getCategoryLabel(catId: string | null): string {
    if (!catId) return '';
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return '';
    const parent = cat.parentId ? categories.find((c) => c.id === cat.parentId) : null;
    return parent ? `${parent.icon} ${parent.name}/${cat.name}` : `${cat.icon} ${cat.name}`;
  }

  return (
    <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-xs font-bold text-text-primary">{totalTransactions} lancamentos</span>
      </div>

      {groups.length === 0 ? (
        <div className="p-8 text-center text-text-secondary text-xs">
          Nenhuma transacao neste periodo
        </div>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.titular);
            return (
              <div key={group.titular}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.titular)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-bg-secondary hover:bg-bg-secondary/80 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? <ChevronDown size={14} className="text-text-secondary" /> : <ChevronUp size={14} className="text-text-secondary" />}
                    <span className="text-xs font-bold text-text-primary">
                      {group.titular || 'Sem titular'}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-accent-red">{formatBRL(group.total)}</span>
                </button>

                {/* Transactions */}
                {!isCollapsed && (
                  <div className="divide-y divide-border/30">
                    {group.transactions.map((t) => (
                      <div key={t.id} className="flex items-center px-4 py-2 hover:bg-bg-secondary/30 transition-colors">
                        {/* Status dot */}
                        <div className="w-6 flex-shrink-0">
                          <span className={`w-2 h-2 rounded-full inline-block ${t.amount >= 0 ? 'bg-accent-green' : 'bg-accent'}`} />
                        </div>

                        {/* Date */}
                        <span className="text-xs text-text-secondary w-[70px] flex-shrink-0">
                          {formatDate(t.date)}
                        </span>

                        {/* Description + category */}
                        <div className="flex-1 min-w-0 px-2">
                          <div className="text-xs text-text-primary truncate">
                            {t.description}
                            {t.totalInstallments && (
                              <span className="ml-1.5 text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                                {t.installmentNumber}/{t.totalInstallments}
                              </span>
                            )}
                          </div>
                          {t.categoryId && (
                            <p className="text-[10px] text-text-secondary truncate">
                              {getCategoryLabel(t.categoryId)}
                            </p>
                          )}
                        </div>

                        {/* Amount */}
                        <span className={`text-xs font-bold flex-shrink-0 ${t.amount >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          {formatBRL(t.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
