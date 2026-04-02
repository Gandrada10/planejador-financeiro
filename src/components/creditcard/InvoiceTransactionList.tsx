import { ChevronDown, ChevronUp, Trash2, CheckCircle2 } from 'lucide-react';
import { useState, useMemo } from 'react';
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
  onBatchReconcile?: (ids: string[], reconciled: boolean) => void;
  /** If provided, guard edits behind closed-cycle confirmation */
  checkClosedCycle?: (transaction: Transaction) => { cycleId: string; label: string } | null;
  reopenCycle?: (cycleId: string) => Promise<void>;
}

export function InvoiceTransactionList({ groups, categories, totalTransactions, onUpdate, onDelete, onBatchReconcile, checkClosedCycle, reopenCycle }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const allTransactions = useMemo(() => groups.flatMap((g) => g.transactions), [groups]);
  const pendingCount = useMemo(() => allTransactions.filter((t) => !t.reconciled).length, [allTransactions]);

  function toggleGroup(titular: string) {
    const next = new Set(collapsed);
    if (next.has(titular)) next.delete(titular); else next.add(titular);
    setCollapsed(next);
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
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
    } else if (field === 'date' && editValue) {
      const d = new Date(editValue + 'T12:00:00');
      if (!isNaN(d.getTime())) onUpdate(t.id, { date: d });
    } else if (field === 'purchaseDate') {
      if (!editValue) {
        onUpdate(t.id, { purchaseDate: null });
      } else {
        const d = new Date(editValue + 'T12:00:00');
        if (!isNaN(d.getTime())) onUpdate(t.id, { purchaseDate: d });
      }
    } else if (field === 'installments') {
      const parts = editValue.split('/');
      const num = parseInt(parts[0]);
      const total = parseInt(parts[1]);
      if (!isNaN(num) && !isNaN(total)) {
        onUpdate(t.id, { installmentNumber: num, totalInstallments: total });
      } else if (!editValue.trim()) {
        onUpdate(t.id, { installmentNumber: null, totalInstallments: null });
      }
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
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-text-primary">{totalTransactions} lancamentos</span>
          {pendingCount > 0 && (
            <span className="text-[10px] text-accent">{pendingCount} pendentes conciliacao</span>
          )}
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            {onBatchReconcile && (
              <button
                onClick={() => { onBatchReconcile([...selectedIds], true); setSelectedIds(new Set()); }}
                className="flex items-center gap-1 text-xs text-accent-green hover:underline"
              >
                <CheckCircle2 size={12} /> Conciliar ({selectedIds.size})
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => { selectedIds.forEach((id) => onDelete(id)); setSelectedIds(new Set()); }}
                className="flex items-center gap-1 text-xs text-accent-red hover:underline"
              >
                <Trash2 size={12} /> Excluir ({selectedIds.size})
              </button>
            )}
          </div>
        )}
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
                    {(() => {
                      const cardNum = group.transactions[0]?.cardNumber;
                      const last4 = cardNum ? cardNum.replace(/\D/g, '').slice(-4) : null;
                      return last4 ? (
                        <span className="text-[10px] text-text-secondary font-mono">**** {last4}</span>
                      ) : null;
                    })()}
                  </div>
                  <span className="text-xs font-bold text-accent-red">{formatBRL(group.total)}</span>
                </button>

                {/* Transactions */}
                {!isCollapsed && (
                  <div className="divide-y divide-border/30">
                    {group.transactions.map((t) => (
                      <div key={t.id} className="flex items-center px-4 py-2 hover:bg-bg-secondary/30 transition-colors">
                        {/* Status / select dot */}
                        <div className="w-6 flex-shrink-0 flex justify-center">
                          <div
                            className={`w-3.5 h-3.5 rounded-full border cursor-pointer transition-colors ${
                              selectedIds.has(t.id)
                                ? 'bg-accent border-accent'
                                : t.reconciled
                                ? 'bg-accent-green border-accent-green'
                                : 'border-border hover:border-accent hover:bg-accent/20'
                            }`}
                            onClick={(e) => { e.stopPropagation(); toggleSelect(t.id); }}
                            title={t.reconciled ? 'Conciliado – clique para selecionar' : 'Clique para selecionar'}
                          />
                        </div>

                        {/* Purchase date - editable */}
                        <div
                          className={`text-xs text-text-secondary w-[70px] flex-shrink-0 ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'purchaseDate', (t.purchaseDate || t.date).toISOString().split('T')[0])}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'purchaseDate' ? (
                            <input
                              autoFocus
                              type="date"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-[90px] bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                            />
                          ) : formatDate(t.purchaseDate || t.date)}
                        </div>

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
                              <div className="text-xs text-text-primary truncate flex items-center gap-1">
                                {t.description}
                                {editingCell?.id === t.id && editingCell.field === 'installments' ? (
                                  <input
                                    autoFocus
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={() => commitEdit(t)}
                                    onKeyDown={(e) => handleKeyDown(e, t)}
                                    placeholder="1/12"
                                    className="ml-1 w-14 bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-[10px] text-center focus:outline-none"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : t.totalInstallments ? (
                                  <span
                                    className={`ml-1.5 text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded flex-shrink-0 ${editable}`}
                                    onClick={(e) => { e.stopPropagation(); onUpdate && startEdit(t.id, 'installments', `${t.installmentNumber ?? 1}/${t.totalInstallments}`); }}
                                  >
                                    {t.installmentNumber}/{t.totalInstallments}
                                  </span>
                                ) : null}
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
                          <div className="flex-shrink-0 w-[130px] mr-2">
                            {(() => {
                              const rootCats = categories.filter((c) => !c.parentId);
                              return (
                                <select
                                  value={t.categoryId || ''}
                                  onChange={async (e) => {
                                    const val = e.target.value || null;
                                    const ok = await guardClosedCycle(t);
                                    if (!ok) { e.target.value = t.categoryId || ''; return; }
                                    onUpdate(t.id, { categoryId: val });
                                  }}
                                  className="w-full bg-bg-secondary border-none text-[10px] cursor-pointer focus:outline-none hover:text-text-primary rounded px-1"
                                  style={{ color: categories.find((c) => c.id === t.categoryId)?.color || 'var(--color-text-secondary)' }}
                                >
                                  <option value="" style={{ backgroundColor: '#111111', color: '#e5e5e5' }}>Sem cat.</option>
                                  {rootCats.map((cat) => {
                                    const subs = categories.filter((c) => c.parentId === cat.id);
                                    if (subs.length > 0) {
                                      return (
                                        <optgroup key={cat.id} label={cat.name} style={{ backgroundColor: '#111111', color: '#737373' }}>
                                          <option value={cat.id} style={{ backgroundColor: '#111111', color: '#e5e5e5' }}>{cat.name}</option>
                                          {subs.map((sub) => (
                                            <option key={sub.id} value={sub.id} style={{ backgroundColor: '#111111', color: '#e5e5e5' }}>↳ {sub.name}</option>
                                          ))}
                                        </optgroup>
                                      );
                                    }
                                    return <option key={cat.id} value={cat.id} style={{ backgroundColor: '#111111', color: '#e5e5e5' }}>{cat.name}</option>;
                                  })}
                                </select>
                              );
                            })()}
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
