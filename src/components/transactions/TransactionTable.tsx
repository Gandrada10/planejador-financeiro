import { useState, useMemo } from 'react';
import { Trash2, CheckCircle2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { Transaction, Category } from '../../types';
import { formatBRL, formatDate, filterCategoriesByAmount } from '../../lib/utils';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  accountNames: string[];
  onUpdate: (id: string, data: Partial<Transaction>) => void;
  onDelete: (id: string) => void;
  onBatchReconcile?: (ids: string[], reconciled: boolean) => void;
  /** Optional: check if editing needs to reopen a closed billing cycle */
  checkClosedCycle?: (transaction: Transaction) => { cycleId: string; label: string } | null;
  reopenCycle?: (cycleId: string) => Promise<void>;
}

export function TransactionTable({ transactions, categories, accountNames, onUpdate, onDelete, onBatchReconcile, checkClosedCycle, reopenCycle }: Props) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<'date' | 'purchaseDate'>('date');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  function toggleSort(field: 'date' | 'purchaseDate') {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  }

  const sorted = useMemo(() => {
    return [...transactions].sort((a, b) => {
      const av = sortField === 'date' ? a.date : (a.purchaseDate || a.date);
      const bv = sortField === 'date' ? b.date : (b.purchaseDate || b.date);
      const diff = av.getTime() - bv.getTime();
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [transactions, sortField, sortDir]);

  function SortIcon({ field }: { field: 'date' | 'purchaseDate' }) {
    if (sortField !== field) return <ArrowUpDown size={10} className="inline ml-1 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp size={10} className="inline ml-1 text-accent" />
      : <ArrowDown size={10} className="inline ml-1 text-accent" />;
  }

  /** If the transaction is in a closed cycle, ask to reopen. Returns true if we can proceed. */
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

  async function commitEdit() {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const t = sorted.find((tx) => tx.id === id);

    if (t) {
      const canProceed = await guardClosedCycle(t);
      if (!canProceed) { setEditingCell(null); return; }
    }

    if (field === 'description' && editValue.trim()) {
      onUpdate(id, { description: editValue.trim() });
    } else if (field === 'amount') {
      const val = parseFloat(editValue.replace(',', '.'));
      if (!isNaN(val)) onUpdate(id, { amount: val });
    } else if (field === 'familyMember') {
      onUpdate(id, { familyMember: editValue.trim() });
    } else if (field === 'titular') {
      onUpdate(id, { titular: editValue.trim() });
    } else if (field === 'date' && editValue) {
      const d = new Date(editValue + 'T12:00:00');
      if (!isNaN(d.getTime())) onUpdate(id, { date: d });
    } else if (field === 'purchaseDate') {
      if (!editValue) {
        onUpdate(id, { purchaseDate: null });
      } else {
        const d = new Date(editValue + 'T12:00:00');
        if (!isNaN(d.getTime())) onUpdate(id, { purchaseDate: d });
      }
    } else if (field === 'installments') {
      const parts = editValue.split('/');
      const num = parseInt(parts[0]);
      const total = parseInt(parts[1]);
      if (!isNaN(num) && !isNaN(total)) {
        onUpdate(id, { installmentNumber: num, totalInstallments: total });
      } else if (!editValue.trim()) {
        onUpdate(id, { installmentNumber: null, totalInstallments: null });
      }
    }

    setEditingCell(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingCell(null);
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function toggleAll() {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((t) => t.id)));
    }
  }

  function deleteSelected() {
    selectedIds.forEach((id) => onDelete(id));
    setSelectedIds(new Set());
  }

  function reconcileSelected() {
    if (!onBatchReconcile) return;
    onBatchReconcile([...selectedIds], true);
    setSelectedIds(new Set());
  }

  if (sorted.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
        Nenhuma transacao ainda. Importe um extrato ou adicione manualmente.
      </div>
    );
  }

  const editableCell = 'cursor-pointer hover:bg-bg-secondary/50 transition-colors';
  const allSelected = selectedIds.size === sorted.length && sorted.length > 0;

  return (
    <div className="space-y-2">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-2 bg-bg-secondary rounded text-xs">
          <span className="text-text-secondary">{selectedIds.size} selecionadas</span>
          {onBatchReconcile && (
            <button onClick={reconcileSelected} className="text-accent-green hover:underline flex items-center gap-1">
              <CheckCircle2 size={12} /> Conciliar
            </button>
          )}
          <button onClick={deleteSelected} className="text-accent-red hover:underline flex items-center gap-1">
            <Trash2 size={12} /> Excluir
          </button>
        </div>
      )}

      <div className="overflow-auto bg-bg-card border border-border rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-text-secondary uppercase tracking-wider text-[10px]">
              <th className="p-2 w-8 text-center">
                {/* Select-all dot */}
                <div
                  className={`w-3 h-3 rounded-full border mx-auto cursor-pointer transition-colors ${
                    allSelected ? 'bg-accent border-accent' : 'border-border hover:border-accent'
                  }`}
                  onClick={toggleAll}
                  title={allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                />
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:text-text-primary" onClick={() => toggleSort('date')}>
                Competencia <SortIcon field="date" />
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:text-text-primary" onClick={() => toggleSort('purchaseDate')}>
                Data <SortIcon field="purchaseDate" />
              </th>
              <th className="p-2 text-left">Descricao</th>
              <th className="p-2 text-left">Conta</th>
              <th className="p-2 text-left">Membro</th>
              <th className="p-2 text-right">Valor</th>
              <th className="p-2 text-center">Parcelas</th>
              <th className="p-2 text-left">Categoria</th>
              <th className="p-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} className="border-b border-border/30 hover:bg-bg-secondary/30">
                {/* Status/select dot */}
                <td className="p-2 w-8">
                  <div
                    className={`w-3.5 h-3.5 rounded-full border mx-auto cursor-pointer transition-colors ${
                      selectedIds.has(t.id)
                        ? 'bg-accent border-accent'
                        : t.reconciled
                        ? 'bg-accent-green border-accent-green'
                        : 'border-border hover:border-accent hover:bg-accent/20'
                    }`}
                    onClick={() => toggleSelect(t.id)}
                    title={t.reconciled ? 'Conciliado – clique para selecionar' : 'Clique para selecionar'}
                  />
                </td>
                {/* Date - editable */}
                <td
                  className={`p-2 text-text-secondary whitespace-nowrap ${editableCell}`}
                  onClick={() => startEdit(t.id, 'date', t.date.toISOString().split('T')[0])}
                >
                  {editingCell?.id === t.id && editingCell.field === 'date' ? (
                    <input
                      autoFocus
                      type="date"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : formatDate(t.date)}
                </td>

                {/* Purchase date - editable */}
                <td
                  className={`p-2 text-text-secondary whitespace-nowrap ${editableCell}`}
                  onClick={() => startEdit(t.id, 'purchaseDate', t.purchaseDate ? t.purchaseDate.toISOString().split('T')[0] : '')}
                >
                  {editingCell?.id === t.id && editingCell.field === 'purchaseDate' ? (
                    <input
                      autoFocus
                      type="date"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : t.purchaseDate ? formatDate(t.purchaseDate) : '—'}
                </td>

                {/* Description - editable */}
                <td
                  className={`p-2 text-text-primary max-w-[200px] truncate ${editableCell}`}
                  onClick={() => startEdit(t.id, 'description', t.description)}
                >
                  {editingCell?.id === t.id && editingCell.field === 'description' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : (
                    t.description
                  )}
                </td>

                {/* Account - select */}
                <td className="p-2 text-text-secondary">
                  <select
                    value={t.account}
                    onChange={async (e) => {
                      const val = e.target.value;
                      const ok = await guardClosedCycle(t);
                      if (!ok) { e.target.value = t.account; return; }
                      onUpdate(t.id, { account: val });
                    }}
                    className="bg-transparent border-none text-xs text-text-secondary cursor-pointer focus:outline-none hover:text-text-primary"
                  >
                    <option value="">—</option>
                    {accountNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </td>

                {/* Membro - editable */}
                <td
                  className={`p-2 text-text-secondary ${editableCell}`}
                  onClick={() => startEdit(t.id, 'familyMember', t.familyMember || '')}
                >
                  {editingCell?.id === t.id && editingCell.field === 'familyMember' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : (
                    t.familyMember || '—'
                  )}
                </td>

                {/* Amount - editable */}
                <td
                  className={`p-2 text-right font-bold whitespace-nowrap ${t.amount >= 0 ? 'text-accent-green' : 'text-accent-red'} ${editableCell}`}
                  onClick={() => startEdit(t.id, 'amount', String(t.amount))}
                >
                  {editingCell?.id === t.id && editingCell.field === 'amount' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-20 bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs text-right focus:outline-none"
                    />
                  ) : (
                    formatBRL(t.amount)
                  )}
                </td>

                {/* Parcelas - editable */}
                <td
                  className={`p-2 text-center text-text-secondary ${editableCell}`}
                  onClick={() => startEdit(t.id, 'installments', t.totalInstallments ? `${t.installmentNumber ?? 1}/${t.totalInstallments}` : '')}
                >
                  {editingCell?.id === t.id && editingCell.field === 'installments' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      placeholder="1/12"
                      className="w-16 bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs text-center focus:outline-none"
                    />
                  ) : t.totalInstallments ? (
                    <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded text-[10px] font-mono">
                      {t.installmentNumber ?? '?'}/{t.totalInstallments}
                    </span>
                  ) : '—'}
                </td>

                {/* Category - select */}
                <td className="p-2">
                  {(() => {
                    const relevantCats = filterCategoriesByAmount(categories, t.amount);
                    const rootCats = relevantCats.filter((c) => !c.parentId);
                    const rowIndex = sorted.indexOf(t);
                    return (
                      <select
                        value={t.categoryId || ''}
                        data-category-select
                        onChange={async (e) => {
                          const val = e.target.value || null;
                          const ok = await guardClosedCycle(t);
                          if (!ok) { e.target.value = t.categoryId || ''; return; }
                          onUpdate(t.id, { categoryId: val });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Tab') {
                            e.preventDefault();
                            const selects = document.querySelectorAll<HTMLSelectElement>('[data-category-select]');
                            const nextIndex = e.shiftKey ? rowIndex - 1 : rowIndex + 1;
                            const nextSelect = selects[nextIndex];
                            if (nextSelect) nextSelect.focus();
                          }
                        }}
                        className="bg-bg-secondary border-none text-xs cursor-pointer focus:outline-none hover:text-text-primary rounded px-1"
                        style={{ color: categories.find((c) => c.id === t.categoryId)?.color || 'var(--color-text-secondary)' }}
                      >
                        <option value="" style={{ backgroundColor: '#111111', color: '#e5e5e5' }}>Sem categoria</option>
                        {rootCats.map((cat) => {
                          const subs = relevantCats.filter((c) => c.parentId === cat.id);
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
                </td>

                <td className="p-2">
                  <button onClick={async () => {
                    const ok = await guardClosedCycle(t);
                    if (!ok) return;
                    onDelete(t.id);
                  }} className="text-text-secondary hover:text-accent-red">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
