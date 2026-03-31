import { useState } from 'react';
import { Trash2, Tag } from 'lucide-react';
import type { Transaction } from '../../types';
import { formatBRL, formatDate } from '../../lib/utils';

interface Props {
  transactions: Transaction[];
  onUpdate: (id: string, data: Partial<Transaction>) => void;
  onDelete: (id: string) => void;
}

export function TransactionTable({ transactions, onUpdate, onDelete }: Props) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function startEdit(id: string, field: string, currentValue: string) {
    setEditingCell({ id, field });
    setEditValue(currentValue);
  }

  function commitEdit() {
    if (!editingCell) return;
    const { id, field } = editingCell;

    if (field === 'description' && editValue.trim()) {
      onUpdate(id, { description: editValue.trim() });
    } else if (field === 'amount') {
      const val = parseFloat(editValue.replace(',', '.'));
      if (!isNaN(val)) onUpdate(id, { amount: val });
    } else if (field === 'account') {
      onUpdate(id, { account: editValue.trim() });
    } else if (field === 'familyMember') {
      onUpdate(id, { familyMember: editValue.trim() });
    } else if (field === 'titular') {
      onUpdate(id, { titular: editValue.trim() });
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
    if (selectedIds.size === transactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map((t) => t.id)));
    }
  }

  function deleteSelected() {
    selectedIds.forEach((id) => onDelete(id));
    setSelectedIds(new Set());
  }

  if (transactions.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
        Nenhuma transacao ainda. Importe um extrato ou adicione manualmente.
      </div>
    );
  }

  const editableCell = 'cursor-pointer hover:bg-bg-secondary/50 transition-colors';

  return (
    <div className="space-y-2">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-2 bg-bg-secondary rounded text-xs">
          <span className="text-text-secondary">{selectedIds.size} selecionadas</span>
          <button onClick={deleteSelected} className="text-accent-red hover:underline flex items-center gap-1">
            <Trash2 size={12} /> Excluir
          </button>
        </div>
      )}

      <div className="overflow-auto bg-bg-card border border-border rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-text-secondary uppercase tracking-wider text-[10px]">
              <th className="p-2 w-8">
                <input type="checkbox" checked={selectedIds.size === transactions.length && transactions.length > 0} onChange={toggleAll} className="accent-accent" />
              </th>
              <th className="p-2 text-left">Data</th>
              <th className="p-2 text-left">Descricao</th>
              <th className="p-2 text-left">Conta</th>
              <th className="p-2 text-left">Titular</th>
              <th className="p-2 text-right">Valor</th>
              <th className="p-2 text-center">Parcelas</th>
              <th className="p-2 text-left">Tags</th>
              <th className="p-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-b border-border/30 hover:bg-bg-secondary/30">
                <td className="p-2">
                  <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} className="accent-accent" />
                </td>
                <td className="p-2 text-text-secondary whitespace-nowrap">{formatDate(t.date)}</td>

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

                {/* Account - editable */}
                <td
                  className={`p-2 text-text-secondary ${editableCell}`}
                  onClick={() => startEdit(t.id, 'account', t.account)}
                >
                  {editingCell?.id === t.id && editingCell.field === 'account' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : (
                    t.account || '—'
                  )}
                </td>

                {/* Titular - editable */}
                <td
                  className={`p-2 text-text-secondary ${editableCell}`}
                  onClick={() => startEdit(t.id, 'titular', t.titular || '')}
                >
                  {editingCell?.id === t.id && editingCell.field === 'titular' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : (
                    t.titular || '—'
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

                {/* Parcelas */}
                <td className="p-2 text-center text-text-secondary">
                  {t.totalInstallments ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded text-[10px] font-mono">
                        {t.installmentNumber || '?'}/{t.totalInstallments}
                      </span>
                      {t.purchaseDate && (
                        <span className="text-[9px] text-text-secondary" title="Data da compra original">
                          {formatDate(t.purchaseDate)}
                        </span>
                      )}
                    </div>
                  ) : '—'}
                </td>

                <td className="p-2">
                  {t.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {t.tags.map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-accent/10 text-accent rounded text-[10px]">
                          <Tag size={8} />{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </td>

                <td className="p-2">
                  <button onClick={() => onDelete(t.id)} className="text-text-secondary hover:text-accent-red">
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
