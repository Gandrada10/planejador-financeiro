import { useEffect, useMemo, useState } from 'react';
import { X, History } from 'lucide-react';
import { fetchSessionTransactions } from '../../hooks/useCategorizationSession';
import { CategoryIcon } from '../shared/CategoryIcon';
import { formatBRL, formatDate, getMonthLabel } from '../../lib/utils';
import type { CategorizationSession, CategorizationTransaction, Category } from '../../types';

interface Props {
  session: CategorizationSession;
  categories: Category[];
  onClose: () => void;
}

function formatDateTime(date: Date): string {
  const d = formatDate(date);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${d} às ${time}`;
}

function statusLabel(session: CategorizationSession): string {
  if (session.status === 'applied') {
    return session.appliedAt
      ? `Aplicado em ${formatDateTime(session.appliedAt)}`
      : 'Aplicado';
  }
  if (session.status === 'dismissed') return 'Dispensado';
  return 'Em andamento';
}

export function CategorizationHistoryModal({ session, categories, onClose }: Props) {
  const [items, setItems] = useState<CategorizationTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSessionTransactions(session.id)
      .then((list) => {
        if (cancelled) return;
        list.sort((a, b) => b.date.getTime() - a.date.getTime());
        setItems(list);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Não foi possível carregar os lançamentos desta sessão.');
      });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  const periodLabel = session.monthFilter && session.monthFilter !== 'all'
    ? getMonthLabel(session.monthFilter)
    : 'Todos os meses';
  const accountsLabel = session.accounts.length > 0 ? session.accounts.join(' • ') : '—';
  const categorizedItems = items?.filter((t) => t.categoryId).length ?? 0;
  const uncategorizedItems = items ? items.length - categorizedItems : 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-border rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <History size={16} className="text-accent" />
            Detalhes da sessão
          </h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 border-b border-border grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-[10px] text-text-secondary uppercase tracking-wider">Titular</div>
            <div className="text-text-primary font-medium">{session.titularName}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-secondary uppercase tracking-wider">Período</div>
            <div className="text-text-primary font-medium">{periodLabel}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-secondary uppercase tracking-wider">Status</div>
            <div className="text-text-primary font-medium">{statusLabel(session)}</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-[10px] text-text-secondary uppercase tracking-wider">Contas</div>
            <div className="text-text-primary font-medium">{accountsLabel}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-secondary uppercase tracking-wider">Enviado em</div>
            <div className="text-text-primary font-medium">{formatDateTime(session.createdAt)}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-secondary uppercase tracking-wider">Total enviado</div>
            <div className="text-text-primary font-medium">{formatBRL(session.totalAmount)}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-secondary uppercase tracking-wider">Lançamentos</div>
            <div className="text-text-primary font-medium">
              {session.transactionIds.length} enviados • {session.categorizedCount} categorizados
              {session.status === 'applied' && ` • ${session.appliedCount} aplicados`}
            </div>
          </div>
          {session.lastActivityAt && (
            <div>
              <div className="text-[10px] text-text-secondary uppercase tracking-wider">Última atividade</div>
              <div className="text-text-primary font-medium">{formatDateTime(session.lastActivityAt)}</div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {error && (
            <div className="p-4 text-xs text-accent-red">{error}</div>
          )}
          {!error && items === null && (
            <div className="p-4 text-xs text-text-secondary animate-pulse">Carregando lançamentos...</div>
          )}
          {!error && items !== null && (
            <>
              <div className="px-4 py-2 text-[11px] text-text-secondary border-b border-border">
                {items.length} lançamentos: {categorizedItems} categorizados • {uncategorizedItems} sem categoria
              </div>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-text-secondary">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2">Data</th>
                    <th className="text-left px-4 py-2">Descrição</th>
                    <th className="text-right px-4 py-2">Valor</th>
                    <th className="text-left px-4 py-2">Categoria</th>
                    <th className="text-left px-4 py-2">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((tx) => {
                    const cat = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;
                    return (
                      <tr key={tx.id} className="border-b border-border/60">
                        <td className="px-4 py-2 text-text-secondary whitespace-nowrap">{formatDate(tx.date)}</td>
                        <td className="px-4 py-2 text-text-primary">
                          {tx.description}
                          {tx.installmentNumber && tx.totalInstallments && (
                            <span className="text-text-secondary"> ({tx.installmentNumber}/{tx.totalInstallments})</span>
                          )}
                        </td>
                        <td className={`px-4 py-2 text-right whitespace-nowrap ${tx.amount < 0 ? 'text-accent-red' : 'text-accent-green'}`}>
                          {formatBRL(tx.amount)}
                        </td>
                        <td className="px-4 py-2">
                          {cat ? (
                            <span className="inline-flex items-center gap-1 text-text-primary">
                              <CategoryIcon icon={cat.icon} size={12} style={{ color: cat.color }} />
                              {cat.name}
                            </span>
                          ) : tx.categoryId ? (
                            <span className="text-text-secondary italic">Categoria removida</span>
                          ) : (
                            <span className="text-amber-400">Não categorizado</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-text-secondary">{tx.notes || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="p-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
