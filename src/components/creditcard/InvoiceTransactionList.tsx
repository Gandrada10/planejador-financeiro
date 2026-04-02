import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
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
  onUpdate?: (id: string, data: Partial<Transaction>) => void;
  onDelete?: (id: string) => void;
  /** If provided, guard edits behind closed-cycle confirmation */
  checkClosedCycle?: (transaction: Transaction) => { cycleId: string; label: string } | null;
  reopenCycle?: (cycleId: string) => Promise<void>;
}

export function InvoiceTransactionList({ groups, categories, totalTransactions, onUpdate, onDelete, checkClosedCycle, reopenCycle }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');

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
    return parent ? `${parent.name}/${cat.name}` : cat.name;
  }

  async function guardClosedCycle(t: Transaction): Promise<boolean> {
    if (!checkClosedCycle || !reopenCycle) return true;
    const closed = checkClosedCycle(t);
    if (!closed) return true;
    const ok = window.confirm(
      `A fatura "${closed.label}" esta encerrada.\n\nDeseja reabri-la para editar esta transacao?`
    );
    if (!ok) return false;
    await reopenCycle(closed.cycleId);
    return true;
  }

  function startEdit(id: string, field: string, currentValue: string) {
    setEditingCell({ id, field });
    setEditValue(currentValue);
  }

  async function commitEdit(t: Transaction) {
    if (!editingCell || !onUpdate) return;
    const { field } = editingCell;

    const ok = await guardClosedCycle(t);
    if (!ok) { setEditingCell(null); return; }

    if (field === 'description' && editValue.trim()) {
      onUpdate(t.id, { description: editValue.trim() });
    } else if (field === 'amount') {
      const val = parseFloat(editValue.replace(',', '.'));
      if (!isNaN(val)) onUpdate(t.id, { amount: val });
    }

    setEditingCell(null);
  }

  function handleKeyDown(e: React.KeyboardEvent, t: Transaction) {
    if (e.key === 'Enter') commitEdit(t);
    if (e.key === 'Escape') setEditingCell(null);
  }

  const editable = onUpdate ? 'cursor-pointer hover:bg-bg-secondary/50 transition-colors' : '';

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

                        {/* Purchase date */}
                        <span className="text-xs text-text-secondary w-[70px] flex-shrink-0">
                          {formatDate(t.purchaseDate || t.date)}
                        </span>

                        {/* Description - editable */}
                        <div
                          className={`flex-1 min-w-0 px-2 ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'description', t.description)}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'description' ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                            />
                          ) : (
                            <>
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
                            </>
                          )}
                        </div>

                        {/* Category - select */}
                        {onUpdate ? (
                          <div className="flex-shrink-0 w-[120px] mr-2">
                            <select
                              value={t.categoryId || ''}
                              onChange={async (e) => {
                                const val = e.target.value || null;
                                const ok = await guardClosedCycle(t);
                                if (!ok) { e.target.value = t.categoryId || ''; return; }
                                onUpdate(t.id, { categoryId: val });
                              }}
                              className="w-full bg-transparent border-none text-[10px] cursor-pointer focus:outline-none hover:text-text-primary"
                              style={{ color: categories.find((c) => c.id === t.categoryId)?.color || undefined }}
                            >
                              <option value="">Sem cat.</option>
                              {categories.map((cat) => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        {/* Amount - editable */}
                        <span
                          className={`text-xs font-bold flex-shrink-0 ${t.amount >= 0 ? 'text-accent-green' : 'text-accent-red'} ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'amount', String(t.amount))}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'amount' ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-20 bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs text-right focus:outline-none"
                            />
                          ) : (
                            formatBRL(t.amount)
                          )}
                        </span>

                        {/* Delete */}
                        {onDelete && (
                          <button
                            onClick={async () => {
                              const ok = await guardClosedCycle(t);
                              if (!ok) return;
                              onDelete(t.id);
                            }}
                            className="ml-2 text-text-secondary hover:text-accent-red flex-shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
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
